// Tournament standings — derived from the matches, like everything else here.

import type { DerivedInnings, MatchState } from './types';

export interface TournamentTeam {
  id: string;
  name: string;
}

export interface TournamentPoints {
  win: number;
  tie: number;
  loss: number;
}

export const DEFAULT_POINTS: TournamentPoints = { win: 2, tie: 1, loss: 0 };

/** A completed match, tied to the two tournament teams that played it. */
export interface TournamentMatchRef {
  matchId: string;
  /** Tournament team that batted FIRST (the match's teamA). */
  teamAId: string;
  teamBId: string;
  state: MatchState;
}

export interface Standing {
  teamId: string;
  teamName: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  points: number;
  runsFor: number;
  ballsFor: number;
  runsAgainst: number;
  ballsAgainst: number;
  /** Net run rate. Null until the team has actually batted and bowled. */
  nrr: number | null;
}

/**
 * Overs to charge a side for net run rate.
 *
 * The rule people get wrong: a side bowled out is charged its FULL quota, not
 * the overs it actually used. Otherwise being skittled for 40 in 8 of 20 overs
 * would produce a better run rate than surviving the full 20 for 100, and a
 * team could improve its NRR by collapsing faster.
 */
export function ballsForRunRate(
  innings: DerivedInnings,
  totalOvers: number,
  squadSize: number,
): number {
  // A side is all out one wicket short of its squad size — the last batter has
  // nobody to partner.
  const allOut = squadSize > 1 && innings.wickets >= squadSize - 1;
  return allOut ? totalOvers * 6 : innings.legalBalls;
}

function blank(team: TournamentTeam): Standing {
  return {
    teamId: team.id,
    teamName: team.name,
    played: 0,
    won: 0,
    lost: 0,
    tied: 0,
    points: 0,
    runsFor: 0,
    ballsFor: 0,
    runsAgainst: 0,
    ballsAgainst: 0,
    nrr: null,
  };
}

export function computeStandings(
  teams: TournamentTeam[],
  matches: TournamentMatchRef[],
  points: TournamentPoints = DEFAULT_POINTS,
): Standing[] {
  const table = new Map<string, Standing>();
  for (const t of teams) table.set(t.id, blank(t));

  for (const ref of matches) {
    // Only a finished match counts towards a table.
    if (ref.state.status !== 'complete') continue;
    const a = table.get(ref.teamAId);
    const b = table.get(ref.teamBId);
    if (!a || !b) continue; // a match against a team since removed

    const { setup, innings1, innings2 } = ref.state;
    const ballsA = ballsForRunRate(innings1, setup.overs, setup.teamA.players.length);
    const ballsB = ballsForRunRate(innings2, setup.overs, setup.teamB.players.length);

    a.played++;
    b.played++;

    a.runsFor += innings1.runs;
    a.ballsFor += ballsA;
    a.runsAgainst += innings2.runs;
    a.ballsAgainst += ballsB;

    b.runsFor += innings2.runs;
    b.ballsFor += ballsB;
    b.runsAgainst += innings1.runs;
    b.ballsAgainst += ballsA;

    if (ref.state.winner === 'TIE') {
      a.tied++;
      b.tied++;
      a.points += points.tie;
      b.points += points.tie;
    } else if (ref.state.winner === 'A') {
      a.won++;
      b.lost++;
      a.points += points.win;
      b.points += points.loss;
    } else if (ref.state.winner === 'B') {
      b.won++;
      a.lost++;
      b.points += points.win;
      a.points += points.loss;
    }
  }

  for (const s of table.values()) {
    if (s.ballsFor > 0 && s.ballsAgainst > 0) {
      s.nrr = s.runsFor / (s.ballsFor / 6) - s.runsAgainst / (s.ballsAgainst / 6);
    }
  }

  // Points, then net run rate, then more wins, then name — so the order is
  // total and never depends on insertion order.
  return [...table.values()].sort((x, y) => {
    if (y.points !== x.points) return y.points - x.points;
    const nx = x.nrr ?? -Infinity;
    const ny = y.nrr ?? -Infinity;
    if (ny !== nx) return ny - nx;
    if (y.won !== x.won) return y.won - x.won;
    return x.teamName.localeCompare(y.teamName);
  });
}

// ---- Leaderboards ----

export interface LeaderRow {
  playerId: string;
  name: string;
  username: string | null;
  teamName: string;
  matches: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  wickets: number;
  runsConceded: number;
  bowlingBalls: number;
  strikeRate: number;
  economy: number;
}

/**
 * Aggregates every player across the tournament. Players are keyed by username
 * where they have one, so the same person appearing for two teams is a single
 * row; guests are keyed per match and stay separate, since there is nothing to
 * prove that two "Guest Keeper"s are the same human.
 */
export function computeLeaderboards(matches: TournamentMatchRef[]): {
  batting: LeaderRow[];
  bowling: LeaderRow[];
} {
  const rows = new Map<string, LeaderRow>();

  const touch = (
    key: string,
    name: string,
    username: string | null,
    teamName: string,
  ): LeaderRow => {
    const found = rows.get(key);
    if (found) return found;
    const created: LeaderRow = {
      playerId: key,
      name,
      username,
      teamName,
      matches: 0,
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      wickets: 0,
      runsConceded: 0,
      bowlingBalls: 0,
      strikeRate: 0,
      economy: 0,
    };
    rows.set(key, created);
    return created;
  };

  for (const ref of matches) {
    const { state } = ref;
    const sides = [
      { players: state.setup.teamA.players, bat: state.innings1, bowl: state.innings2, name: state.setup.teamA.name },
      { players: state.setup.teamB.players, bat: state.innings2, bowl: state.innings1, name: state.setup.teamB.name },
    ];

    for (const side of sides) {
      for (const p of side.players) {
        const batCard = side.bat.batting.find((c) => c.playerId === p.id);
        const bowlCard = side.bowl.bowling.find((c) => c.playerId === p.id);
        if (!batCard?.batted && !bowlCard?.bowled) continue;

        const key = p.username ? `u:${p.username}` : `g:${ref.matchId}:${p.id}`;
        const row = touch(key, p.name, p.username ?? null, side.name);
        row.matches++;
        row.runs += batCard?.runs ?? 0;
        row.balls += batCard?.balls ?? 0;
        row.fours += batCard?.fours ?? 0;
        row.sixes += batCard?.sixes ?? 0;
        row.wickets += bowlCard?.wickets ?? 0;
        row.runsConceded += bowlCard?.runs ?? 0;
        row.bowlingBalls += bowlCard?.legalBalls ?? 0;
      }
    }
  }

  const all = [...rows.values()];
  for (const r of all) {
    r.strikeRate = r.balls > 0 ? (r.runs / r.balls) * 100 : 0;
    r.economy = r.bowlingBalls > 0 ? r.runsConceded / (r.bowlingBalls / 6) : 0;
  }

  const batting = all
    .filter((r) => r.balls > 0)
    .sort((a, b) => b.runs - a.runs || b.strikeRate - a.strikeRate)
    .slice(0, 15);

  const bowling = all
    .filter((r) => r.bowlingBalls > 0)
    .sort(
      (a, b) =>
        b.wickets - a.wickets || a.economy - b.economy || a.runsConceded - b.runsConceded,
    )
    .slice(0, 15);

  return { batting, bowling };
}
