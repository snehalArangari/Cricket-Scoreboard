import { Router } from 'express';
import crypto from 'node:crypto';
import { TournamentModel, type TournamentDoc } from '../models/Tournament';
import { MatchModel, toCore, type MatchDoc } from '../models/Match';
import { requireAuth } from '../auth';
import { isDbConnected } from '../db';
import { deriveMatchState } from '../../shared/engine';
import {
  computeLeaderboards,
  computeStandings,
  type TournamentMatchRef,
} from '../../shared/tournament';

export const tournamentRouter = Router();

const ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function shortId(length = 6): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

function dbReady(res: any): boolean {
  if (isDbConnected()) return true;
  res.status(503).json({ error: 'DB_UNAVAILABLE', message: 'Database is not connected yet' });
  return false;
}

async function loadOwned(req: any, res: any): Promise<TournamentDoc | null> {
  if (!dbReady(res)) return null;
  const doc = (await TournamentModel.findOne({
    tournamentId: String(req.params.tournamentId),
  })) as TournamentDoc | null;
  if (!doc) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'No such tournament' });
    return null;
  }
  if (String(doc.get('ownerUserId')) !== req.user.id) {
    res
      .status(403)
      .json({ error: 'OWNER_ONLY', message: 'Only the organiser can change this tournament' });
    return null;
  }
  return doc;
}

tournamentRouter.use(requireAuth);

/** Tournaments this user organises. */
tournamentRouter.get('/', async (req, res) => {
  if (!dbReady(res)) return;
  const docs = await TournamentModel.find({ ownerUserId: req.user!.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({
    tournaments: docs.map((t: any) => ({
      tournamentId: t.tournamentId,
      name: t.name,
      teams: t.teams ?? [],
      createdAt: t.createdAt,
    })),
  });
});

tournamentRouter.post('/', async (req, res) => {
  if (!dbReady(res)) return;
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  if (!name) {
    res.status(400).json({ error: 'NAME_REQUIRED', message: 'Give the tournament a name' });
    return;
  }

  let tournamentId = shortId();
  for (let i = 0; i < 5; i++) {
    if (!(await TournamentModel.exists({ tournamentId }))) break;
    tournamentId = shortId();
  }

  // Team names can be supplied up front; they can also be added later.
  const rawTeams = Array.isArray(req.body?.teams) ? req.body.teams : [];
  const teams = rawTeams
    .map((t: unknown) => String(typeof t === 'string' ? t : (t as any)?.name ?? '').trim())
    .filter((n: string) => n.length > 0)
    .slice(0, 20)
    .map((n: string) => ({ id: shortId(4), name: n }));

  const doc = await TournamentModel.create({
    tournamentId,
    name,
    ownerUserId: req.user!.id,
    teams,
  });

  res.status(201).json({
    tournamentId: doc.get('tournamentId'),
    name: doc.get('name'),
    teams: doc.get('teams'),
  });
});

/** Detail: teams, the points table, leaderboards and the match list. */
tournamentRouter.get('/:tournamentId', async (req, res) => {
  if (!dbReady(res)) return;
  const doc = (await TournamentModel.findOne({
    tournamentId: String(req.params.tournamentId),
  }).lean()) as any;
  if (!doc) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'No such tournament' });
    return;
  }

  const matchDocs = (await MatchModel.find({
    'tournament.tournamentId': doc.tournamentId,
  })
    .sort({ createdAt: 1 })
    .limit(200)) as MatchDoc[];

  const refs: TournamentMatchRef[] = matchDocs.map((m) => ({
    matchId: m.get('matchId'),
    teamAId: (m.get('tournament') as any)?.teamAId ?? '',
    teamBId: (m.get('tournament') as any)?.teamBId ?? '',
    state: deriveMatchState(toCore(m)),
  }));

  const completed = refs.filter((r) => r.state.status === 'complete');

  res.json({
    tournamentId: doc.tournamentId,
    name: doc.name,
    isOwner: String(doc.ownerUserId) === req.user!.id,
    teams: doc.teams ?? [],
    points: doc.points ?? { win: 2, tie: 1, loss: 0 },
    standings: computeStandings(doc.teams ?? [], refs, doc.points),
    leaderboards: computeLeaderboards(completed),
    matches: refs.map((r) => ({
      matchId: r.matchId,
      teamAId: r.teamAId,
      teamBId: r.teamBId,
      status: r.state.status,
      resultText: r.state.resultText,
      teamAName: r.state.setup.teamA.name,
      teamBName: r.state.setup.teamB.name,
      innings1: { runs: r.state.innings1.runs, wickets: r.state.innings1.wickets, legalBalls: r.state.innings1.legalBalls },
      innings2: { runs: r.state.innings2.runs, wickets: r.state.innings2.wickets, legalBalls: r.state.innings2.legalBalls },
    })),
  });
});

tournamentRouter.post('/:tournamentId/teams', async (req, res) => {
  const doc = await loadOwned(req, res);
  if (!doc) return;
  const name = String(req.body?.name ?? '').trim().slice(0, 40);
  if (!name) {
    res.status(400).json({ error: 'NAME_REQUIRED', message: 'Give the team a name' });
    return;
  }
  const teams = (doc.get('teams') as any[]) ?? [];
  if (teams.length >= 20) {
    res.status(400).json({ error: 'TOO_MANY', message: 'Up to 20 teams' });
    return;
  }
  if (teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    res.status(409).json({ error: 'DUPLICATE', message: 'That team is already in the tournament' });
    return;
  }
  const team = { id: shortId(4), name };
  doc.set('teams', [...teams, team]);
  await doc.save();
  res.status(201).json({ team, teams: doc.get('teams') });
});

tournamentRouter.delete('/:tournamentId/teams/:teamId', async (req, res) => {
  const doc = await loadOwned(req, res);
  if (!doc) return;
  const teamId = String(req.params.teamId);

  // A team that has already played cannot be removed — its results are part of
  // everyone else's standings, and deleting it would silently rewrite the table.
  const played = await MatchModel.exists({
    'tournament.tournamentId': doc.get('tournamentId'),
    $or: [{ 'tournament.teamAId': teamId }, { 'tournament.teamBId': teamId }],
  });
  if (played) {
    res.status(409).json({
      error: 'TEAM_HAS_MATCHES',
      message: 'That team has already played — removing it would rewrite the table',
    });
    return;
  }

  const teams = ((doc.get('teams') as any[]) ?? []).filter((t) => t.id !== teamId);
  doc.set('teams', teams);
  await doc.save();
  res.json({ teams });
});
