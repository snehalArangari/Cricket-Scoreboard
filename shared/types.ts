// Shared domain types — imported by BOTH the client and the server so the
// optimistic client apply and the authoritative server apply are identical.

export type Delivery = 'NORMAL' | 'WIDE' | 'NO_BALL' | 'DEAD_BALL';
export type MatchStatus = 'innings1' | 'innings1-complete' | 'innings2' | 'complete';
export type InningsKey = 'innings1' | 'innings2';
export type Winner = 'A' | 'B' | 'TIE';

export interface Player {
  id: string;
  name: string;
}

export interface Team {
  name: string;
  players: Player[];
}

/**
 * The minimum dismissal model needed for correct cards: which batter is out
 * (on a run-out it may be the non-striker), and whether the bowler is credited
 * (run-outs must not increment a bowler's wicket column).
 */
export interface Wicket {
  outBatterId: string;
  creditBowler: boolean;
}

/**
 * Delivery type, runs and wicket are three INDEPENDENT axes. That is what makes
 * the awkward cases fall out for free: a no-ball hit for six, a stumping off a
 * wide, a run-out on the second run of a no-ball.
 */
export interface Ball {
  id: string; // client-generated — the idempotency key for retries
  delivery: Delivery;
  batRuns: number; // 0..12, runs actually run or hit
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  wicket: Wicket | null;
}

export interface Setup {
  overs: number;
  teamA: Team; // bats first
  teamB: Team;
}

export interface BattingCard {
  playerId: string;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strikeRate: number;
  out: boolean;
  batted: boolean;
}

export interface BowlingCard {
  playerId: string;
  name: string;
  legalBalls: number;
  maidens: number;
  runs: number;
  wickets: number;
  economy: number;
  bowled: boolean;
}

export interface DerivedInnings {
  events: Ball[];
  runs: number;
  wickets: number;
  legalBalls: number;
  extras: number;
  batting: BattingCard[];
  bowling: BowlingCard[];
  /** Who should face the next ball — derived, used to pre-fill the scorer UI. */
  strikerId: string | null;
  nonStrikerId: string | null;
  /** True when the previous over just completed, so a new bowler is due. */
  needNewBowler: boolean;
  lastBowlerId: string | null;
}

/** What is persisted in Mongo — events only, never derived totals. */
export interface MatchCore {
  matchId: string;
  setup: Setup;
  innings1: { events: Ball[] };
  innings2: { events: Ball[] };
  /** Set when the scorer confirms the innings break. Together with the two event
   *  arrays this is the ONLY persisted state — `status` is derived from it. */
  innings2Started: boolean;
  status: MatchStatus;
  winner: Winner | null;
  resultText: string | null;
  version: number;
}

/** What is broadcast to clients — fully derived, always complete, never a delta. */
export interface MatchState {
  matchId: string;
  setup: Setup;
  status: MatchStatus;
  winner: Winner | null;
  resultText: string | null;
  version: number;
  /** Carried through so the scorer can rebuild a MatchCore from a broadcast and
   *  replay its pending outbox locally against the shared engine. */
  innings2Started: boolean;
  innings1: DerivedInnings;
  innings2: DerivedInnings;
  target: number | null;
  runsRequired: number | null;
  ballsRemaining: number | null;
}

// ---- Socket payloads ----

export interface JoinPayload {
  matchId: string;
  scorerToken?: string;
}

export interface BallAddPayload {
  matchId: string;
  ball: Ball;
}

export interface BallEditPayload {
  matchId: string;
  inningsKey: InningsKey;
  index: number;
  ball: Ball;
}

export interface BallDeletePayload {
  matchId: string;
  inningsKey: InningsKey;
  index: number;
}

export interface SimplePayload {
  matchId: string;
}

export interface SocketError {
  code: string;
  message: string;
}
