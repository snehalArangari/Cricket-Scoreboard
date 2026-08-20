// Match awards — derived, like everything else, from the ball log.
//
// This lives in shared/ so the server and the client compute the same winner
// from the same state. An award decided in two places is an award that will
// eventually disagree with itself.

import type { MatchState, Player } from './types';

export interface PlayerAward {
  playerId: string;
  name: string;
  username: string | null;
  side: 'A' | 'B';
  teamName: string;

  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  out: boolean;
  batted: boolean;
  strikeRate: number;

  wickets: number;
  runsConceded: number;
  bowlingBalls: number;
  maidens: number;
  economy: number;
  bowled: boolean;

  /** Impact points — see IMPACT_NOTES. */
  impact: number;
  /** Impact after the winning-side uplift, used only to pick the headline award. */
  weighted: number;
}

export interface MatchAwards {
  /** Null until somebody has actually done something. */
  playerOfTheMatch: PlayerAward | null;
  bestBatter: PlayerAward | null;
  bestBowler: PlayerAward | null;
  /** Everyone who contributed, best first. */
  ranked: PlayerAward[];
  /** False while the match is still being played. */
  final: boolean;
}

/**
 * The impact model, stated openly so a disputed award can be argued about with
 * numbers rather than vibes:
 *
 *   +1   per run scored
 *   +1   per four, +2 per six      — boundary hitting is worth more than the
 *                                    same runs nudged around
 *   +25  per wicket                — the long-standing rule of thumb that a
 *                                    wicket is worth roughly 25 runs
 *   +10  per maiden
 *   +(SR - 100) / 5                — only once a batter has faced 10 balls, so
 *                                    a 2-ball cameo cannot top the list
 *   +(6 - economy) x 4             — only once a bowler has sent down 2 overs,
 *                                    for the same reason
 *
 * Every term is in "runs-equivalent" units, which is what makes batting and
 * bowling comparable at all. The thresholds exist because rate statistics are
 * meaningless on tiny samples — a single six off one ball is a strike rate of
 * 600, and without a floor it would win every match award ever played.
 */
export const IMPACT_NOTES = {
  perRun: 1,
  perFour: 1,
  perSix: 2,
  perWicket: 25,
  perMaiden: 10,
  minBallsForStrikeRate: 10,
  minBallsForEconomy: 12,
  /** A match-winning contribution counts for more than the same numbers in a loss. */
  winningSideUplift: 1.1,
} as const;

function impactOf(a: Omit<PlayerAward, 'impact' | 'weighted'>): number {
  let points = 0;

  points += a.runs * IMPACT_NOTES.perRun;
  points += a.fours * IMPACT_NOTES.perFour;
  points += a.sixes * IMPACT_NOTES.perSix;
  if (a.balls >= IMPACT_NOTES.minBallsForStrikeRate) {
    points += (a.strikeRate - 100) / 5;
  }

  points += a.wickets * IMPACT_NOTES.perWicket;
  points += a.maidens * IMPACT_NOTES.perMaiden;
  if (a.bowlingBalls >= IMPACT_NOTES.minBallsForEconomy) {
    points += (6 - a.economy) * 4;
  }

  return points;
}

/** Most wickets wins; on a tie, fewer runs conceded; then more maidens. */
function bowlingBetter(a: PlayerAward, b: PlayerAward): boolean {
  if (a.wickets !== b.wickets) return a.wickets > b.wickets;
  if (a.runsConceded !== b.runsConceded) return a.runsConceded < b.runsConceded;
  return a.maidens > b.maidens;
}

/** Most runs wins; on a tie, fewer balls used; then not out ahead of out. */
function battingBetter(a: PlayerAward, b: PlayerAward): boolean {
  if (a.runs !== b.runs) return a.runs > b.runs;
  if (a.balls !== b.balls) return a.balls < b.balls;
  return !a.out && b.out;
}

export function computeAwards(state: MatchState): MatchAwards {
  const rows: PlayerAward[] = [];

  const collect = (players: Player[], side: 'A' | 'B') => {
    // teamA bats in innings 1 and bowls in innings 2; teamB the other way round.
    const battingInnings = side === 'A' ? state.innings1 : state.innings2;
    const bowlingInnings = side === 'A' ? state.innings2 : state.innings1;
    const teamName = side === 'A' ? state.setup.teamA.name : state.setup.teamB.name;

    for (const p of players) {
      const bat = battingInnings.batting.find((c) => c.playerId === p.id);
      const bowl = bowlingInnings.bowling.find((c) => c.playerId === p.id);
      const batted = Boolean(bat?.batted);
      const bowled = Boolean(bowl?.bowled);
      if (!batted && !bowled) continue;

      const base = {
        playerId: p.id,
        name: p.name,
        username: p.username ?? null,
        side,
        teamName,
        runs: bat?.runs ?? 0,
        balls: bat?.balls ?? 0,
        fours: bat?.fours ?? 0,
        sixes: bat?.sixes ?? 0,
        out: Boolean(bat?.out),
        batted,
        strikeRate: bat?.strikeRate ?? 0,
        wickets: bowl?.wickets ?? 0,
        runsConceded: bowl?.runs ?? 0,
        bowlingBalls: bowl?.legalBalls ?? 0,
        maidens: bowl?.maidens ?? 0,
        economy: bowl?.economy ?? 0,
        bowled,
      };

      const impact = impactOf(base);
      const onWinningSide = state.winner === side;
      rows.push({
        ...base,
        impact,
        // Only uplift a positive score; multiplying a negative one would
        // reward the winning side's worst performer.
        weighted: onWinningSide && impact > 0 ? impact * IMPACT_NOTES.winningSideUplift : impact,
      });
    }
  };

  collect(state.setup.teamA.players, 'A');
  collect(state.setup.teamB.players, 'B');

  const ranked = [...rows].sort((a, b) => b.weighted - a.weighted);

  let bestBatter: PlayerAward | null = null;
  let bestBowler: PlayerAward | null = null;
  for (const row of rows) {
    if (row.batted && row.runs > 0 && (!bestBatter || battingBetter(row, bestBatter))) {
      bestBatter = row;
    }
    if (row.bowled && row.wickets > 0 && (!bestBowler || bowlingBetter(row, bestBowler))) {
      bestBowler = row;
    }
  }

  return {
    playerOfTheMatch: ranked.length > 0 && ranked[0].impact > 0 ? ranked[0] : null,
    bestBatter,
    bestBowler,
    ranked,
    final: state.status === 'complete',
  };
}
