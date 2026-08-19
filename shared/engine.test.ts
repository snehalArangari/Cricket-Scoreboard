// Engine assertions. No test framework on purpose — `npm test` runs this
// directly through tsx, which also proves the shared/ import path resolves.

import {
  applyBall,
  createMatch,
  deleteBallAt,
  deriveMatchState,
  deriveNextUp,
  groupIntoOvers,
  oversDisplay,
  recomputeInnings,
  startSecondInnings,
  undoLastBall,
  validateSetup,
} from './engine';
import type { Ball, MatchCore, Setup, Team } from './types';

let passed = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failures.push(`${label}\n     expected: ${e}\n     actual:   ${a}`);
  }
}

// ---- fixtures ----

const setup: Setup = validateSetup({
  overs: 2,
  teamAName: 'Mumbai',
  teamBName: 'Chennai',
  teamAPlayers: ['A1', 'A2', 'A3', 'A4'],
  teamBPlayers: ['B1', 'B2', 'B3', 'B4'],
});

const teamA: Team = setup.teamA;
const teamB: Team = setup.teamB;

let seq = 0;
function ball(partial: Partial<Ball> = {}): Ball {
  seq++;
  return {
    id: `ball-${seq}`,
    delivery: 'NORMAL',
    batRuns: 0,
    strikerId: 'a1',
    nonStrikerId: 'a2',
    bowlerId: 'b1',
    wicket: null,
    ...partial,
  };
}

function inn(events: Ball[]) {
  return recomputeInnings(events, teamA, teamB);
}

function bat(events: Ball[], id: string) {
  return inn(events).batting.find((c) => c.playerId === id)!;
}

function bowl(events: Ball[], id: string) {
  return inn(events).bowling.find((c) => c.playerId === id)!;
}

// ---- 1. overs are integer legal-ball counts, never decimals ----

check('oversDisplay 14 legal balls', oversDisplay(14), '2.2');
check('oversDisplay 6 legal balls', oversDisplay(6), '1.0');

// ---- 2. no-ball hit for six: 7 runs, 0 legal balls ----
{
  const e = [ball({ delivery: 'NO_BALL', batRuns: 6 })];
  const i = inn(e);
  check('no-ball six · team runs', i.runs, 7);
  check('no-ball six · legal balls', i.legalBalls, 0);
  check('no-ball six · extras', i.extras, 1);
  check('no-ball six · batter runs', bat(e, 'a1').runs, 6);
  check('no-ball six · batter balls faced', bat(e, 'a1').balls, 1);
  check('no-ball six · batter sixes', bat(e, 'a1').sixes, 1);
  check('no-ball six · bowler conceded', bowl(e, 'b1').runs, 7);
  check('no-ball six · bowler legal balls', bowl(e, 'b1').legalBalls, 0);
}

// ---- 3. stumping off a wide: 1 run, 0 legal balls, wicket, no ball faced ----
{
  const e = [
    ball({ delivery: 'WIDE', batRuns: 0, wicket: { outBatterId: 'a1', creditBowler: true } }),
  ];
  const i = inn(e);
  check('stumped off wide · team runs', i.runs, 1);
  check('stumped off wide · legal balls', i.legalBalls, 0);
  check('stumped off wide · wickets', i.wickets, 1);
  check('stumped off wide · extras', i.extras, 1);
  check('stumped off wide · batter faced no ball', bat(e, 'a1').balls, 0);
  check('stumped off wide · batter is out', bat(e, 'a1').out, true);
  check('stumped off wide · bowler credited', bowl(e, 'b1').wickets, 1);
}

// ---- 4. run-out on the 2nd run of a no-ball: bowler NOT credited ----
{
  const e = [
    ball({
      delivery: 'NO_BALL',
      batRuns: 2,
      wicket: { outBatterId: 'a2', creditBowler: false },
    }),
  ];
  const i = inn(e);
  check('run-out on no-ball · team runs', i.runs, 3);
  check('run-out on no-ball · legal balls', i.legalBalls, 0);
  check('run-out on no-ball · wickets', i.wickets, 1);
  check('run-out on no-ball · non-striker is out', bat(e, 'a2').out, true);
  check('run-out on no-ball · striker not out', bat(e, 'a1').out, false);
  check('run-out on no-ball · bowler NOT credited', bowl(e, 'b1').wickets, 0);
  check('run-out on no-ball · bowler still conceded 3', bowl(e, 'b1').runs, 3);
}

// ---- 5. runs off a wide are extras, not the batter's ----
{
  const e = [ball({ delivery: 'WIDE', batRuns: 2 })];
  check('wide + 2 · team runs', inn(e).runs, 3);
  check('wide + 2 · all extras', inn(e).extras, 3);
  check('wide + 2 · batter credited nothing', bat(e, 'a1').runs, 0);
}

// ---- 6. a dead ball is completely inert ----
{
  const e = [ball({ delivery: 'DEAD_BALL', batRuns: 4, wicket: { outBatterId: 'a1', creditBowler: true } })];
  const i = inn(e);
  check('dead ball · no runs', i.runs, 0);
  check('dead ball · no legal ball', i.legalBalls, 0);
  check('dead ball · no wicket', i.wickets, 0);
  check('dead ball · batter untouched', bat(e, 'a1').balls, 0);
}

// ---- 7. strike rotation ----
{
  // odd runs swap the ends
  const e1 = [ball({ batRuns: 1 })];
  check('rotation · single swaps strike', deriveNextUp(e1, teamA).strikerId, 'a2');

  // even runs do not
  const e2 = [ball({ batRuns: 2 })];
  check('rotation · two runs keeps strike', deriveNextUp(e2, teamA).strikerId, 'a1');

  // end of over swaps
  const e3 = [ball(), ball(), ball(), ball(), ball(), ball()];
  check('rotation · end of over swaps', deriveNextUp(e3, teamA).strikerId, 'a2');
  check('rotation · new bowler due', inn(e3).needNewBowler, true);

  // a wide does not advance the over
  const e4 = [ball(), ball(), ball(), ball(), ball(), ball({ delivery: 'WIDE' })];
  check('rotation · wide does not end over', inn(e4).needNewBowler, false);
  check('rotation · wide leaves 5 legal balls', inn(e4).legalBalls, 5);

  // single off the last ball of the over: two swaps cancel out
  const e5 = [ball(), ball(), ball(), ball(), ball(), ball({ batRuns: 1 })];
  check('rotation · single on last ball cancels out', deriveNextUp(e5, teamA).strikerId, 'a1');

  // new batter comes in on strike when the striker is out
  const e6 = [ball({ wicket: { outBatterId: 'a1', creditBowler: true } })];
  check('rotation · new batter takes strike', deriveNextUp(e6, teamA).strikerId, 'a3');
}

// ---- 8. maiden over ----
{
  const maiden = [ball(), ball(), ball(), ball(), ball(), ball()];
  check('maiden · counted', bowl(maiden, 'b1').maidens, 1);
  check('maiden · economy zero', bowl(maiden, 'b1').economy, 0);

  const notMaiden = [ball(), ball(), ball(), ball(), ball(), ball({ batRuns: 1 })];
  check('maiden · a single breaks it', bowl(notMaiden, 'b1').maidens, 0);

  const wideBreaksIt = [ball(), ball(), ball(), ball(), ball(), ball({ delivery: 'WIDE' }), ball()];
  check('maiden · a wide breaks it', bowl(wideBreaksIt, 'b1').maidens, 0);

  const incomplete = [ball(), ball(), ball()];
  check('maiden · incomplete over is not a maiden', bowl(incomplete, 'b1').maidens, 0);
}

// ---- 9. over grouping ----
{
  const e = [ball(), ball({ delivery: 'WIDE' }), ball(), ball(), ball(), ball(), ball(), ball()];
  const overs = groupIntoOvers(e);
  check('grouping · two overs', overs.length, 2);
  check('grouping · first over has 7 deliveries (wide extends it)', overs[0].length, 7);
  check('grouping · second over has 1', overs[1].length, 1);
}

// ---- 10. strike rate and economy ----
{
  const e = [ball({ batRuns: 4 }), ball({ batRuns: 2 })];
  check('strike rate · 6 off 2 = 300', bat(e, 'a1').strikeRate, 300);
  check('economy · 6 off 2 legal balls', bowl(e, 'b1').economy, 18);
}

// ---- 11. innings ends on overs exhausted (2-over match) ----
{
  let m: MatchCore = createMatch('test', setup);
  for (let i = 0; i < 12; i++) m = applyBall(m, ball({ batRuns: 1 }));
  check('innings ends · status', m.status, 'innings1-complete');
  check('innings ends · 12 legal balls', deriveMatchState(m).innings1.legalBalls, 12);
  // further balls are rejected once the innings has closed
  const after = applyBall(m, ball({ batRuns: 4 }));
  check('innings ends · further balls rejected', deriveMatchState(after).innings1.runs, 12);
}

// ---- 12. all out ends the innings (4 players -> 3 wickets) ----
{
  let m: MatchCore = createMatch('test', setup);
  m = applyBall(m, ball({ wicket: { outBatterId: 'a1', creditBowler: true } }));
  m = applyBall(m, ball({ strikerId: 'a3', wicket: { outBatterId: 'a3', creditBowler: true } }));
  check('all out · not yet after 2', m.status, 'innings1');
  m = applyBall(m, ball({ strikerId: 'a4', wicket: { outBatterId: 'a4', creditBowler: true } }));
  check('all out · innings closes on 3rd wicket', m.status, 'innings1-complete');
}

// ---- 13. the chase: target, result, and reaching it ends the match ----
{
  let m: MatchCore = createMatch('test', setup);
  for (let i = 0; i < 12; i++) m = applyBall(m, ball({ batRuns: 1 })); // 12 runs
  m = startSecondInnings(m);
  check('chase · status', m.status, 'innings2');
  check('chase · target is 13', deriveMatchState(m).target, 13);
  check('chase · 13 required', deriveMatchState(m).runsRequired, 13);

  for (let i = 0; i < 3; i++) {
    m = applyBall(m, ball({ delivery: 'NORMAL', batRuns: 4, strikerId: 'b1', nonStrikerId: 'b2', bowlerId: 'a1' }));
  }
  check('chase · 12 scored, 1 needed', deriveMatchState(m).runsRequired, 1);
  check('chase · still live', m.status, 'innings2');

  m = applyBall(m, ball({ batRuns: 4, strikerId: 'b1', nonStrikerId: 'b2', bowlerId: 'a1' }));
  check('chase · reaching target ends it', m.status, 'complete');
  check('chase · winner', m.winner, 'B');
  check('chase · result text', m.resultText, 'Chennai won by 3 wickets');
}

// ---- 14. defending side wins by runs ----
{
  let m: MatchCore = createMatch('test', setup);
  for (let i = 0; i < 12; i++) m = applyBall(m, ball({ batRuns: 2 })); // 24
  m = startSecondInnings(m);
  for (let i = 0; i < 12; i++) {
    m = applyBall(m, ball({ batRuns: 1, strikerId: 'b1', nonStrikerId: 'b2', bowlerId: 'a1' }));
  }
  check('defend · complete', m.status, 'complete');
  check('defend · winner', m.winner, 'A');
  check('defend · by 12 runs', m.resultText, 'Mumbai won by 12 runs');
}

// ---- 15. a tie ----
{
  let m: MatchCore = createMatch('test', setup);
  for (let i = 0; i < 12; i++) m = applyBall(m, ball({ batRuns: 1 })); // 12
  m = startSecondInnings(m);
  for (let i = 0; i < 12; i++) {
    m = applyBall(m, ball({ batRuns: 1, strikerId: 'b1', nonStrikerId: 'b2', bowlerId: 'a1' }));
  }
  check('tie · complete', m.status, 'complete');
  check('tie · winner', m.winner, 'TIE');
  check('tie · text', m.resultText, 'Match tied');
}

// ---- 16. THE CRITICAL ONE: deleting a ball makes the score go DOWN ----
{
  let m: MatchCore = createMatch('test', setup);
  m = applyBall(m, ball({ batRuns: 6 }));
  m = applyBall(m, ball({ batRuns: 4 }));
  check('delete · before', deriveMatchState(m).innings1.runs, 10);
  m = deleteBallAt(m, 'innings1', 0);
  check('delete · score decreased', deriveMatchState(m).innings1.runs, 4);
  check('delete · legal balls decreased', deriveMatchState(m).innings1.legalBalls, 1);
  check('delete · batter card decreased', deriveMatchState(m).innings1.batting[0].runs, 4);
  check('delete · sixes gone', deriveMatchState(m).innings1.batting[0].sixes, 0);
}

// ---- 17. undo, including undoing the ball that ended the match ----
{
  let m: MatchCore = createMatch('test', setup);
  for (let i = 0; i < 12; i++) m = applyBall(m, ball({ batRuns: 1 }));
  check('undo · innings closed', m.status, 'innings1-complete');
  m = undoLastBall(m);
  check('undo · reopened the innings', m.status, 'innings1');
  check('undo · one ball removed', deriveMatchState(m).innings1.legalBalls, 11);
}

// ---- 18. idempotency: the same ball id twice is a no-op ----
{
  let m: MatchCore = createMatch('test', setup);
  const b = ball({ batRuns: 4 });
  m = applyBall(m, b);
  m = applyBall(m, b); // replayed by the offline outbox
  check('idempotency · applied once only', deriveMatchState(m).innings1.events.length, 1);
  check('idempotency · runs counted once', deriveMatchState(m).innings1.runs, 4);
}

// ---- 19. status is DERIVED, so it can move backwards ----
{
  // Build a completed match, then delete a ball out of the chase.
  let m: MatchCore = createMatch('test', setup);
  for (let i = 0; i < 12; i++) m = applyBall(m, ball({ batRuns: 1 })); // 12
  m = startSecondInnings(m);
  for (let i = 0; i < 4; i++) {
    m = applyBall(m, ball({ batRuns: 4, strikerId: 'b1', nonStrikerId: 'b2', bowlerId: 'a1' }));
  }
  check('derived status · match complete', m.status, 'complete');
  check('derived status · winner set', m.winner, 'B');

  m = deleteBallAt(m, 'innings2', 0);
  check('derived status · deleting un-completes it', m.status, 'innings2');
  check('derived status · winner cleared', m.winner, null);
  check('derived status · result text cleared', m.resultText, null);

  // And deleting from a closed FIRST innings reopens that too.
  let n: MatchCore = createMatch('test', setup);
  for (let i = 0; i < 12; i++) n = applyBall(n, ball({ batRuns: 1 }));
  check('derived status · innings1 closed', n.status, 'innings1-complete');
  n = deleteBallAt(n, 'innings1', 3);
  check('derived status · innings1 reopened', n.status, 'innings1');
}

// ---- 20. undo rewinds across the innings break ----
{
  let m: MatchCore = createMatch('test', setup);
  for (let i = 0; i < 12; i++) m = applyBall(m, ball({ batRuns: 1 }));
  m = startSecondInnings(m);
  check('undo break · in innings 2', m.status, 'innings2');
  m = applyBall(m, ball({ batRuns: 2, strikerId: 'b1', nonStrikerId: 'b2', bowlerId: 'a1' }));

  m = undoLastBall(m); // removes the one ball of innings 2
  check('undo break · innings2 emptied', deriveMatchState(m).innings2.events.length, 0);
  check('undo break · still in innings 2', m.status, 'innings2');

  m = undoLastBall(m); // now un-starts the second innings
  check('undo break · back to the break', m.status, 'innings1-complete');
  check('undo break · innings2Started cleared', m.innings2Started, false);

  m = undoLastBall(m); // now eats into innings 1
  check('undo break · innings1 reopened', m.status, 'innings1');
  check('undo break · 11 legal balls left', deriveMatchState(m).innings1.legalBalls, 11);
}

// ---- 21. a ball id is unique across the whole match, not just one innings ----
{
  let m: MatchCore = createMatch('test', setup);
  const b = ball({ batRuns: 4 });
  m = applyBall(m, b);
  for (let i = 0; i < 11; i++) m = applyBall(m, ball({ batRuns: 1 }));
  m = startSecondInnings(m);
  const before = deriveMatchState(m).innings2.events.length;
  m = applyBall(m, b); // same id, now in the other innings
  check('idempotency · spans both innings', deriveMatchState(m).innings2.events.length, before);
}

// ---- report ----

console.log('');
if (failures.length === 0) {
  console.log(`  ✓ all ${passed} engine assertions passed`);
  console.log('');
} else {
  console.log(`  ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}\n`);
  process.exit(1);
}
