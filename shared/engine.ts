// Pure cricket scoring engine — no I/O, no framework, no side effects.
//
// THE CORE INVARIANT: the events array is the only source of truth. Every total
// and every player statistic is re-derived by folding over the whole array from
// scratch. Nothing is incrementally mutated. That is precisely what makes undo,
// edit and delete correct, and what guarantees a live viewer can never drift.

import type {
  Ball,
  BattingCard,
  BowlingCard,
  Delivery,
  DerivedInnings,
  InningsKey,
  MatchCore,
  MatchState,
  Player,
  Setup,
  SquadEntry,
  Team,
  TossDecision,
  Winner,
} from './types';

export const MIN_OVERS = 1;
export const MAX_OVERS = 200;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 30;
export const DEFAULT_OVERS = 10;
export const DEFAULT_PLAYERS = 11;
export const MAX_BAT_RUNS = 12;

export const DELIVERY_LABEL: Record<Delivery, string> = {
  NORMAL: 'Normal',
  WIDE: 'Wide',
  NO_BALL: 'No Ball',
  DEAD_BALL: 'Dead Ball',
};

// ---- Small helpers ----

export function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function maxWickets(team: Team): number {
  return Math.max(0, team.players.length - 1);
}

export function maxLegalBalls(overs: number): number {
  return overs * 6;
}

/** Overs are stored as an integer legal-ball count and only ever formatted for
 *  display — never held as a decimal, so 14.3 means 14 overs 3 balls. */
export function oversDisplay(legalBalls: number): string {
  return `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
}

// ---- Per-ball accounting ----
//
// A DEAD_BALL is a void delivery: it contributes nothing at all. It is recorded
// so the scorer can see it happened, but it scores no runs, faces no ball,
// advances no over and takes no wicket.

export function isLegalDelivery(delivery: Delivery): boolean {
  return delivery === 'NORMAL';
}

export function isVoid(delivery: Delivery): boolean {
  return delivery === 'DEAD_BALL';
}

/** The 1-run penalty for a wide or a no-ball. */
export function penaltyRuns(delivery: Delivery): number {
  return delivery === 'WIDE' || delivery === 'NO_BALL' ? 1 : 0;
}

/** Total runs the ball adds to the team score. */
export function teamRunsFor(ball: Ball): number {
  if (isVoid(ball.delivery)) return 0;
  return ball.batRuns + penaltyRuns(ball.delivery);
}

/** Runs credited to the batter. Runs scored off a WIDE are extras, not the
 *  batter's — but a no-ball hit for six is very much the batter's six. */
export function batterRunsFor(ball: Ball): number {
  if (ball.delivery === 'NORMAL' || ball.delivery === 'NO_BALL') return ball.batRuns;
  return 0;
}

export function extrasFor(ball: Ball): number {
  return teamRunsFor(ball) - batterRunsFor(ball);
}

/** A wide is not a ball faced; a no-ball is. */
export function countsAsBallFaced(ball: Ball): boolean {
  return ball.delivery === 'NORMAL' || ball.delivery === 'NO_BALL';
}

export function countsAsWicket(ball: Ball): boolean {
  return !isVoid(ball.delivery) && ball.wicket !== null;
}

export function ballChipLabel(ball: Ball): string {
  const parts: string[] = [];
  if (ball.delivery === 'WIDE') parts.push('WD');
  if (ball.delivery === 'NO_BALL') parts.push('NB');
  if (ball.delivery === 'DEAD_BALL') parts.push('DB');
  if (ball.batRuns > 0) parts.push(String(ball.batRuns));
  if (countsAsWicket(ball)) parts.push('W');
  if (parts.length === 0) parts.push('0');
  return parts.join('+');
}

// ---- Over grouping ----

/** Chunks an innings' deliveries into overs. An over closes on its 6th LEGAL
 *  ball, so wides and no-balls extend it rather than advancing it. */
export function groupIntoOvers(events: Ball[]): Ball[][] {
  const overs: Ball[][] = [];
  let current: Ball[] = [];
  let legal = 0;
  for (const ball of events) {
    current.push(ball);
    if (isLegalDelivery(ball.delivery)) {
      legal++;
      if (legal === 6) {
        overs.push(current);
        current = [];
        legal = 0;
      }
    }
  }
  if (current.length > 0) overs.push(current);
  return overs;
}

function legalCount(balls: Ball[]): number {
  return balls.filter((b) => isLegalDelivery(b.delivery)).length;
}

// ---- The fold ----

function emptyBatting(p: Player): BattingCard {
  return {
    playerId: p.id,
    name: p.name,
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    strikeRate: 0,
    out: false,
    batted: false,
  };
}

function emptyBowling(p: Player): BowlingCard {
  return {
    playerId: p.id,
    name: p.name,
    legalBalls: 0,
    maidens: 0,
    runs: 0,
    wickets: 0,
    economy: 0,
    bowled: false,
  };
}

/**
 * Replays an entire innings from its events and returns every total and every
 * player card. Called on every single change — that is the point.
 */
export function recomputeInnings(
  events: Ball[],
  battingTeam: Team,
  bowlingTeam: Team,
): DerivedInnings {
  const batting = new Map<string, BattingCard>();
  for (const p of battingTeam.players) batting.set(p.id, emptyBatting(p));
  const bowling = new Map<string, BowlingCard>();
  for (const p of bowlingTeam.players) bowling.set(p.id, emptyBowling(p));

  let runs = 0;
  let wickets = 0;
  let legalBalls = 0;
  let extras = 0;

  for (const ball of events) {
    const total = teamRunsFor(ball);
    runs += total;
    extras += extrasFor(ball);
    if (isLegalDelivery(ball.delivery)) legalBalls++;
    if (countsAsWicket(ball)) wickets++;

    if (isVoid(ball.delivery)) continue;

    // --- batter ---
    const striker = batting.get(ball.strikerId);
    if (striker) {
      striker.batted = true;
      striker.runs += batterRunsFor(ball);
      if (countsAsBallFaced(ball)) striker.balls++;
      if (ball.delivery === 'NORMAL' || ball.delivery === 'NO_BALL') {
        if (ball.batRuns === 4) striker.fours++;
        if (ball.batRuns === 6) striker.sixes++;
      }
    }
    const nonStriker = batting.get(ball.nonStrikerId);
    if (nonStriker) nonStriker.batted = true;

    if (ball.wicket) {
      const out = batting.get(ball.wicket.outBatterId);
      if (out) {
        out.out = true;
        out.batted = true;
      }
    }

    // --- bowler ---
    const bowler = bowling.get(ball.bowlerId);
    if (bowler) {
      bowler.bowled = true;
      bowler.runs += total; // wides and no-balls count against the bowler
      if (isLegalDelivery(ball.delivery)) bowler.legalBalls++;
      if (ball.wicket && ball.wicket.creditBowler) bowler.wickets++;
    }
  }

  // Maidens: a COMPLETE over conceding zero runs, credited to whoever bowled it.
  for (const over of groupIntoOvers(events)) {
    if (legalCount(over) !== 6) continue;
    const conceded = over.reduce((sum, b) => sum + teamRunsFor(b), 0);
    if (conceded !== 0) continue;
    const bowlerId = over.find((b) => !isVoid(b.delivery))?.bowlerId;
    if (!bowlerId) continue;
    const card = bowling.get(bowlerId);
    if (card) card.maidens++;
  }

  for (const card of batting.values()) {
    card.strikeRate = card.balls > 0 ? (card.runs / card.balls) * 100 : 0;
  }
  for (const card of bowling.values()) {
    card.economy = card.legalBalls > 0 ? card.runs / (card.legalBalls / 6) : 0;
  }

  const next = deriveNextUp(events, battingTeam);
  const lastReal = [...events].reverse().find((b) => !isVoid(b.delivery)) ?? null;

  return {
    events,
    runs,
    wickets,
    legalBalls,
    extras,
    batting: [...batting.values()],
    bowling: [...bowling.values()],
    strikerId: next.strikerId,
    nonStrikerId: next.nonStrikerId,
    needNewBowler: legalBalls > 0 && legalBalls % 6 === 0,
    lastBowlerId: lastReal ? lastReal.bowlerId : null,
  };
}

// ---- Strike rotation ----

/**
 * Where the batters stand after a delivery:
 *   1. swap on an odd number of runs run,
 *   2. an incoming batter takes the out batter's end,
 *   3. swap again if the over just closed.
 */
export function nextBatterPositions(
  strikerId: string,
  nonStrikerId: string,
  ball: Ball,
  overCompleted: boolean,
  incomingBatterId: string | null,
): { strikerId: string; nonStrikerId: string } {
  let s = strikerId;
  let ns = nonStrikerId;

  if (!isVoid(ball.delivery)) {
    // Runs physically run swap the ends — including runs taken off a wide.
    if (ball.batRuns % 2 === 1) [s, ns] = [ns, s];

    if (ball.wicket && incomingBatterId) {
      if (s === ball.wicket.outBatterId) s = incomingBatterId;
      else if (ns === ball.wicket.outBatterId) ns = incomingBatterId;
    }
  }

  if (overCompleted) [s, ns] = [ns, s];
  return { strikerId: s, nonStrikerId: ns };
}

/** The next batter in squad order who has neither batted nor been dismissed. */
export function nextAvailableBatter(events: Ball[], battingTeam: Team): string | null {
  const seen = new Set<string>();
  for (const b of events) {
    if (isVoid(b.delivery)) continue;
    seen.add(b.strikerId);
    seen.add(b.nonStrikerId);
  }
  return battingTeam.players.find((p) => !seen.has(p.id))?.id ?? null;
}

/** Who faces the next ball. Balls store their batters explicitly, so this only
 *  ever pre-fills the UI — it never rewrites history. */
export function deriveNextUp(
  events: Ball[],
  battingTeam: Team,
): { strikerId: string | null; nonStrikerId: string | null } {
  const players = battingTeam.players;
  if (events.length === 0) {
    return {
      strikerId: players[0]?.id ?? null,
      nonStrikerId: players[1]?.id ?? null,
    };
  }
  const last = events[events.length - 1];
  const legal = events.filter((b) => isLegalDelivery(b.delivery)).length;
  const overCompleted = legal > 0 && legal % 6 === 0;
  const incoming = last.wicket ? nextAvailableBatter(events, battingTeam) : null;
  return nextBatterPositions(last.strikerId, last.nonStrikerId, last, overCompleted, incoming);
}

// ---- Innings / match state ----

export function battingTeamFor(key: InningsKey, setup: Setup): Team {
  return key === 'innings1' ? setup.teamA : setup.teamB;
}

export function bowlingTeamFor(key: InningsKey, setup: Setup): Team {
  return key === 'innings1' ? setup.teamB : setup.teamA;
}

/** Which innings the scorer is currently filling. Driven by the persisted
 *  `innings2Started` flag, never by the derived status. */
export function activeInningsKey(core: MatchCore): InningsKey {
  return core.innings2Started ? 'innings2' : 'innings1';
}

export function isInningsOver(innings: DerivedInnings, battingTeam: Team, overs: number): boolean {
  return innings.legalBalls >= maxLegalBalls(overs) || innings.wickets >= maxWickets(battingTeam);
}

export function computeResult(
  firstInningsRuns: number,
  second: DerivedInnings,
  chasingTeam: Team,
  setup: Setup,
): { winner: Winner; text: string } {
  if (second.runs > firstInningsRuns) {
    const left = maxWickets(chasingTeam) - second.wickets;
    return {
      winner: 'B',
      text: `${setup.teamB.name} won by ${left} wicket${left === 1 ? '' : 's'}`,
    };
  }
  if (second.runs < firstInningsRuns) {
    const margin = firstInningsRuns - second.runs;
    return {
      winner: 'A',
      text: `${setup.teamA.name} won by ${margin} run${margin === 1 ? '' : 's'}`,
    };
  }
  return { winner: 'TIE', text: 'Match tied' };
}

export function createMatch(matchId: string, setup: Setup): MatchCore {
  return {
    matchId,
    setup,
    innings1: { events: [] },
    innings2: { events: [] },
    innings2Started: false,
    status: 'innings1',
    winner: null,
    resultText: null,
    version: 0,
  };
}

/** Derives the full broadcast state from the stored core. */
export function deriveMatchState(core: MatchCore): MatchState {
  const { setup } = core;
  const innings1 = recomputeInnings(core.innings1.events, setup.teamA, setup.teamB);
  const innings2 = recomputeInnings(core.innings2.events, setup.teamB, setup.teamA);

  const target = core.status === 'innings1' ? null : innings1.runs + 1;
  const runsRequired = target === null ? null : Math.max(0, target - innings2.runs);
  const ballsRemaining =
    core.status === 'innings2' ? Math.max(0, maxLegalBalls(setup.overs) - innings2.legalBalls) : null;

  return {
    matchId: core.matchId,
    setup,
    status: core.status,
    winner: core.winner,
    resultText: core.resultText,
    version: core.version,
    innings2Started: core.innings2Started,
    innings1,
    innings2,
    target,
    runsRequired,
    ballsRemaining,
  };
}

/**
 * Derives the status from scratch on every change.
 *
 * This is deliberately NOT a forward-only promotion. An edit, a delete or an
 * undo can move a match BACKWARDS — un-completing a chase, reopening a closed
 * innings — and a status that could only ever advance would strand the match on
 * 'complete' forever. Deriving it means the status is as reversible as the
 * events it is computed from.
 */
export function deriveStatus(core: MatchCore): MatchCore {
  const { setup } = core;
  const i1 = recomputeInnings(core.innings1.events, setup.teamA, setup.teamB);

  if (!isInningsOver(i1, setup.teamA, setup.overs)) {
    return { ...core, status: 'innings1', winner: null, resultText: null };
  }
  if (!core.innings2Started) {
    return { ...core, status: 'innings1-complete', winner: null, resultText: null };
  }

  const i2 = recomputeInnings(core.innings2.events, setup.teamB, setup.teamA);
  const reachedTarget = i2.runs >= i1.runs + 1;
  if (reachedTarget || isInningsOver(i2, setup.teamB, setup.overs)) {
    const result = computeResult(i1.runs, i2, setup.teamB, setup);
    return { ...core, status: 'complete', winner: result.winner, resultText: result.text };
  }
  return { ...core, status: 'innings2', winner: null, resultText: null };
}

export function canRecord(core: MatchCore): boolean {
  return core.status === 'innings1' || core.status === 'innings2';
}

// ---- Mutations. Each one rebuilds from events, then re-derives status. ----

function withEvents(core: MatchCore, key: InningsKey, events: Ball[]): MatchCore {
  return deriveStatus({ ...core, [key]: { events } });
}

export function applyBall(core: MatchCore, ball: Ball): MatchCore {
  if (!canRecord(core)) return core;
  const key = activeInningsKey(core);
  // Idempotency: a replayed ball (offline outbox, reconnect) is a no-op.
  const seen = [...core.innings1.events, ...core.innings2.events];
  if (seen.some((b) => b.id === ball.id)) return core;
  return withEvents(core, key, [...core[key].events, ball]);
}

export function editBallAt(
  core: MatchCore,
  key: InningsKey,
  index: number,
  ball: Ball,
): MatchCore {
  const events = core[key].events.slice();
  if (index < 0 || index >= events.length) return core;
  events[index] = ball;
  return withEvents(core, key, events);
}

export function deleteBallAt(core: MatchCore, key: InningsKey, index: number): MatchCore {
  const events = core[key].events.slice();
  if (index < 0 || index >= events.length) return core;
  events.splice(index, 1);
  return withEvents(core, key, events);
}

/**
 * Removes the most recent ball. Because the status is derived rather than
 * stored, this needs no special handling for a closed innings or a finished
 * match — dropping the event and re-deriving reopens whatever that ball closed.
 * Undoing back past the innings break un-starts the second innings.
 */
export function undoLastBall(core: MatchCore): MatchCore {
  if (core.innings2Started) {
    const events = core.innings2.events.slice();
    if (events.length === 0) return deriveStatus({ ...core, innings2Started: false });
    events.pop();
    return withEvents(core, 'innings2', events);
  }
  const events = core.innings1.events.slice();
  if (events.length === 0) return core;
  events.pop();
  return withEvents(core, 'innings1', events);
}

export function startSecondInnings(core: MatchCore): MatchCore {
  if (core.status !== 'innings1-complete') return core;
  return deriveStatus({ ...core, innings2Started: true });
}

// ---- Setup validation ----

/** A squad slot as supplied by a caller: a plain name, or a resolved account. */
export type SquadInput = string | (SquadEntry & { userId?: string | null });

function normalizeEntry(entry: SquadInput): SquadEntry & { userId?: string | null } {
  return typeof entry === 'string' ? { name: entry } : entry;
}

export function makePlayers(entries: SquadInput[], prefix: string): Player[] {
  return entries.map((raw, i) => {
    const entry = normalizeEntry(raw);
    return {
      id: `${prefix}${i + 1}`,
      name: (entry.name ?? '').trim() || `Player ${i + 1}`,
      userId: entry.userId ?? null,
      username: entry.username ?? null,
    };
  });
}

/** How many slots in a squad belong to a registered account. */
export function registeredCount(team: Team): number {
  return team.players.filter((p) => Boolean(p.userId)).length;
}

/**
 * Builds a Setup from the two teams as the user typed them, then ORDERS them by
 * the toss so that teamA is always the side batting first.
 *
 * Resolving the batting order once, here, is why nothing downstream — not the
 * fold, not the status derivation, not the result text — ever has to think about
 * the toss. `teamA bats first` stays an invariant of the whole engine.
 */
export function validateSetup(input: {
  overs: number;
  teamAName: string;
  teamBName: string;
  teamAPlayers: SquadInput[];
  teamBPlayers: SquadInput[];
  /** Which of the two teams AS TYPED won the toss. */
  tossWinner?: 'A' | 'B' | null;
  tossDecision?: TossDecision | null;
}): Setup {
  const overs = clamp(Math.round(input.overs), MIN_OVERS, MAX_OVERS);
  const trim = (entries: SquadInput[]) => {
    const cleaned = entries
      .map(normalizeEntry)
      .filter((e) => (e.name ?? '').trim().length > 0);
    return cleaned.slice(0, MAX_PLAYERS);
  };
  const first = trim(input.teamAPlayers);
  const second = trim(input.teamBPlayers);
  while (first.length < MIN_PLAYERS) first.push({ name: `Player ${first.length + 1}` });
  while (second.length < MIN_PLAYERS) second.push({ name: `Player ${second.length + 1}` });

  const typedA = { name: input.teamAName.trim() || 'Team A', players: first };
  const typedB = { name: input.teamBName.trim() || 'Team B', players: second };

  // Absent a toss, the first team typed bats first.
  const winner = input.tossWinner === 'B' ? 'B' : 'A';
  const decision: TossDecision = input.tossDecision === 'BOWL' ? 'BOWL' : 'BAT';
  const hasToss = Boolean(input.tossWinner && input.tossDecision);

  // The toss winner bats first if they chose to bat, otherwise the other side does.
  const winnerBatsFirst = decision === 'BAT';
  const typedABatsFirst = battingFirstIsTypedA(winner, decision);

  const batFirst = typedABatsFirst ? typedA : typedB;
  const bowlFirst = typedABatsFirst ? typedB : typedA;

  return {
    overs,
    teamA: { name: batFirst.name, players: makePlayers(batFirst.players, 'a') },
    teamB: { name: bowlFirst.name, players: makePlayers(bowlFirst.players, 'b') },
    // After ordering, the winner is 'A' exactly when they chose to bat.
    toss: hasToss ? { wonBy: winnerBatsFirst ? 'A' : 'B', decision } : null,
  };
}

/**
 * Which of the two teams AS TYPED bats first, given the toss.
 * Exported because the tournament layer must decide which tournament team ends
 * up in slot A, and duplicating this rule is how the two would drift apart.
 */
export function battingFirstIsTypedA(
  tossWinner: 'A' | 'B' | null | undefined,
  tossDecision: TossDecision | null | undefined,
): boolean {
  const winner = tossWinner === 'B' ? 'B' : 'A';
  const winnerBatsFirst = tossDecision !== 'BOWL';
  return winner === 'A' ? winnerBatsFirst : !winnerBatsFirst;
}

/** "Chennai won the toss and chose to bowl" — for display only. */
export function tossSummary(setup: Setup): string | null {
  if (!setup.toss) return null;
  const winner = setup.toss.wonBy === 'A' ? setup.teamA : setup.teamB;
  return `${winner.name} won the toss and chose to ${
    setup.toss.decision === 'BAT' ? 'bat' : 'bowl'
  }`;
}
