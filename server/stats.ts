import { MatchModel, toCore, type MatchDoc } from './models/Match';
import { deriveMatchState } from '../shared/engine';
import type { BattingCard, BowlingCard, MatchState, Player } from '../shared/types';
import type { PublicUser } from './models/User';

/**
 * Career stats are DERIVED, never stored.
 *
 * The same reasoning as the scoring engine: every match already holds its full
 * ball log, so a career total is a fold over those. Storing running aggregates
 * would mean a corrected scorecard silently disagreed with the profile it fed,
 * and there would be no way to tell which was right.
 */

export interface CareerBatting {
  innings: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  notOuts: number;
  highScore: number;
  highScoreNotOut: boolean;
  /** Null until they have been dismissed at least once — a batting average with
   *  no dismissals is undefined, not infinite. */
  average: number | null;
  strikeRate: number;
  fifties: number;
  hundreds: number;
}

export interface CareerBowling {
  innings: number;
  balls: number;
  runs: number;
  wickets: number;
  maidens: number;
  best: { wickets: number; runs: number } | null;
  average: number | null;
  economy: number;
  /** Balls per wicket. Null with no wickets. */
  strikeRate: number | null;
  threeWicketHauls: number;
  fiveWicketHauls: number;
}

export interface RecentMatch {
  matchId: string;
  playedAt: string;
  status: string;
  teamName: string;
  opponent: string;
  runs: number;
  balls: number;
  out: boolean;
  wickets: number;
  runsConceded: number;
  bowlingBalls: number;
  result: 'won' | 'lost' | 'tied' | 'in-progress';
}

export interface CareerStats {
  user: PublicUser;
  matches: number;
  won: number;
  lost: number;
  tied: number;
  batting: CareerBatting;
  bowling: CareerBowling;
  recent: RecentMatch[];
}

/** Which slot a user occupies, and on which side. */
function findSlot(state: MatchState, userId: string): { player: Player; side: 'A' | 'B' } | null {
  const inA = state.setup.teamA.players.find((p) => p.userId && String(p.userId) === userId);
  if (inA) return { player: inA, side: 'A' };
  const inB = state.setup.teamB.players.find((p) => p.userId && String(p.userId) === userId);
  if (inB) return { player: inB, side: 'B' };
  return null;
}

function betterBowling(
  a: { wickets: number; runs: number } | null,
  b: { wickets: number; runs: number },
): { wickets: number; runs: number } {
  if (!a) return b;
  if (b.wickets !== a.wickets) return b.wickets > a.wickets ? b : a;
  // More wickets wins; on a tie, fewer runs conceded.
  return b.runs < a.runs ? b : a;
}

export async function careerStats(user: PublicUser): Promise<CareerStats> {
  const docs = (await MatchModel.find({
    $or: [
      { 'setup.teamA.players.userId': user.id },
      { 'setup.teamB.players.userId': user.id },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(300)) as MatchDoc[];

  const batting: CareerBatting = {
    innings: 0,
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    notOuts: 0,
    highScore: 0,
    highScoreNotOut: false,
    average: null,
    strikeRate: 0,
    fifties: 0,
    hundreds: 0,
  };
  const bowling: CareerBowling = {
    innings: 0,
    balls: 0,
    runs: 0,
    wickets: 0,
    maidens: 0,
    best: null,
    average: null,
    economy: 0,
    strikeRate: null,
    threeWicketHauls: 0,
    fiveWicketHauls: 0,
  };

  let matches = 0;
  let won = 0;
  let lost = 0;
  let tied = 0;
  let dismissals = 0;
  const recent: RecentMatch[] = [];

  for (const doc of docs) {
    const state = deriveMatchState(toCore(doc));
    const slot = findSlot(state, user.id);
    if (!slot) continue;

    // teamA bats in innings 1 and bowls in innings 2, and vice versa.
    const battingInnings = slot.side === 'A' ? state.innings1 : state.innings2;
    const bowlingInnings = slot.side === 'A' ? state.innings2 : state.innings1;
    const bat: BattingCard | undefined = battingInnings.batting.find(
      (c) => c.playerId === slot.player.id,
    );
    const bowl: BowlingCard | undefined = bowlingInnings.bowling.find(
      (c) => c.playerId === slot.player.id,
    );

    const didBat = Boolean(bat?.batted);
    const didBowl = Boolean(bowl?.bowled);
    // A match only counts once the player actually took part.
    if (!didBat && !didBowl) continue;
    matches++;

    if (state.status === 'complete') {
      const winnerSide = state.winner;
      if (winnerSide === 'TIE') tied++;
      else if (winnerSide === slot.side) won++;
      else if (winnerSide) lost++;
    }

    if (didBat && bat) {
      batting.innings++;
      batting.runs += bat.runs;
      batting.balls += bat.balls;
      batting.fours += bat.fours;
      batting.sixes += bat.sixes;
      if (bat.out) dismissals++;
      else batting.notOuts++;
      if (bat.runs > batting.highScore) {
        batting.highScore = bat.runs;
        batting.highScoreNotOut = !bat.out;
      } else if (bat.runs === batting.highScore && !bat.out) {
        // Same score not out reads better than the same score out.
        batting.highScoreNotOut = true;
      }
      if (bat.runs >= 100) batting.hundreds++;
      else if (bat.runs >= 50) batting.fifties++;
    }

    if (didBowl && bowl) {
      bowling.innings++;
      bowling.balls += bowl.legalBalls;
      bowling.runs += bowl.runs;
      bowling.wickets += bowl.wickets;
      bowling.maidens += bowl.maidens;
      bowling.best = betterBowling(bowling.best, { wickets: bowl.wickets, runs: bowl.runs });
      if (bowl.wickets >= 5) bowling.fiveWicketHauls++;
      else if (bowl.wickets >= 3) bowling.threeWicketHauls++;
    }

    if (recent.length < 12) {
      const myTeam = slot.side === 'A' ? state.setup.teamA : state.setup.teamB;
      const theirTeam = slot.side === 'A' ? state.setup.teamB : state.setup.teamA;
      recent.push({
        matchId: state.matchId,
        playedAt: new Date((doc as any).createdAt ?? Date.now()).toISOString(),
        status: state.status,
        teamName: myTeam.name,
        opponent: theirTeam.name,
        runs: bat?.runs ?? 0,
        balls: bat?.balls ?? 0,
        out: Boolean(bat?.out),
        wickets: bowl?.wickets ?? 0,
        runsConceded: bowl?.runs ?? 0,
        bowlingBalls: bowl?.legalBalls ?? 0,
        result:
          state.status !== 'complete'
            ? 'in-progress'
            : state.winner === 'TIE'
              ? 'tied'
              : state.winner === slot.side
                ? 'won'
                : 'lost',
      });
    }
  }

  batting.average = dismissals > 0 ? batting.runs / dismissals : null;
  batting.strikeRate = batting.balls > 0 ? (batting.runs / batting.balls) * 100 : 0;
  bowling.average = bowling.wickets > 0 ? bowling.runs / bowling.wickets : null;
  bowling.economy = bowling.balls > 0 ? bowling.runs / (bowling.balls / 6) : 0;
  bowling.strikeRate = bowling.wickets > 0 ? bowling.balls / bowling.wickets : null;

  return { user, matches, won, lost, tied, batting, bowling, recent };
}
