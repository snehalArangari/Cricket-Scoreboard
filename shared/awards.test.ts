// Award assertions. `npm run test:awards`.

import { computeAwards, IMPACT_NOTES } from './awards';
import {
  applyBall,
  createMatch,
  deriveMatchState,
  startSecondInnings,
  validateSetup,
} from './engine';
import type { Ball, MatchCore } from './types';

let passed = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else failures.push(`${label}\n     expected: ${e}\n     actual:   ${a}`);
}

const setup = validateSetup({
  overs: 4,
  teamAName: 'Reds',
  teamBName: 'Blues',
  teamAPlayers: [{ name: 'R1' }, { name: 'R2' }, { name: 'R3' }, { name: 'R4' }, { name: 'R5' }],
  teamBPlayers: [{ name: 'B1' }, { name: 'B2' }, { name: 'B3' }, { name: 'B4' }, { name: 'B5' }],
});

let seq = 0;
function ball(over: Partial<Ball> = {}): Ball {
  seq++;
  return {
    id: `aw-${seq}`,
    delivery: 'NORMAL',
    batRuns: 0,
    strikerId: 'a1',
    nonStrikerId: 'a2',
    bowlerId: 'b1',
    wicket: null,
    ...over,
  };
}

// ---- 1. an empty match has no awards to give ----
{
  const awards = computeAwards(deriveMatchState(createMatch('m', setup)));
  check('empty · no player of the match', awards.playerOfTheMatch, null);
  check('empty · no best batter', awards.bestBatter, null);
  check('empty · no best bowler', awards.bestBowler, null);
  check('empty · nobody ranked', awards.ranked.length, 0);
  check('empty · not final', awards.final, false);
}

// ---- 2. best batter and best bowler are picked on their own merits ----
{
  let m: MatchCore = createMatch('m', setup);
  // R1 scores 24 off 12 (four fours), R2 is at the other end.
  for (let i = 0; i < 12; i++) {
    m = applyBall(m, ball({ batRuns: i % 3 === 0 ? 4 : 1, strikerId: 'a1', nonStrikerId: 'a2', bowlerId: 'b1' }));
  }
  const state = deriveMatchState(m);
  const awards = computeAwards(state);

  const r1 = awards.ranked.find((r) => r.playerId === 'a1')!;
  check('batting · runs counted', r1.runs, 4 * 4 + 8 * 1);
  check('best batter is the top scorer', awards.bestBatter?.playerId, 'a1');
  check('nobody has a wicket, so no best bowler', awards.bestBowler, null);
  check('only players who did something are ranked', awards.ranked.every((r) => r.batted || r.bowled), true);
}

// ---- 3. a two-ball cameo cannot outrank a real innings ----
// Without the minimum-balls floor, a six off one ball is a strike rate of 600
// and would win every match award ever played.
{
  let m: MatchCore = createMatch('m', setup);
  // R1 grinds 20 off 20.
  for (let i = 0; i < 20; i++) {
    m = applyBall(m, ball({ batRuns: 1, strikerId: 'a1', nonStrikerId: 'a2', bowlerId: 'b1' }));
  }
  const state = deriveMatchState(m);
  const awards = computeAwards(state);
  const grinder = awards.ranked.find((r) => r.playerId === 'a1')!;
  // 20 runs, no boundaries, SR 100 -> the rate term contributes nothing.
  check('grinder impact is just the runs', grinder.impact, 20);
  check('strike-rate floor exists', IMPACT_NOTES.minBallsForStrikeRate, 10);
}

// ---- 4. wickets are worth real impact ----
{
  let m: MatchCore = createMatch('m', setup);
  // Reds bat: three wickets to B1 across six deliveries, no runs.
  m = applyBall(m, ball({ wicket: { outBatterId: 'a1', creditBowler: true } }));
  m = applyBall(m, ball({ strikerId: 'a3', wicket: { outBatterId: 'a3', creditBowler: true } }));
  m = applyBall(m, ball({ strikerId: 'a4', wicket: { outBatterId: 'a4', creditBowler: true } }));
  const state = deriveMatchState(m);
  const awards = computeAwards(state);

  const b1 = awards.ranked.find((r) => r.playerId === 'b1')!;
  check('bowler credited three wickets', b1.wickets, 3);
  check('three wickets are worth 75', b1.impact, 3 * IMPACT_NOTES.perWicket);
  check('best bowler is the wicket-taker', awards.bestBowler?.playerId, 'b1');
  check('a bowler outranks a batter who did nothing', awards.playerOfTheMatch?.playerId, 'b1');
}

// ---- 5. bowling tiebreaks: wickets, then runs conceded ----
{
  let m: MatchCore = createMatch('m', setup);
  // b1 takes 2 for plenty; b2 takes 2 for nothing.
  m = applyBall(m, ball({ batRuns: 6, bowlerId: 'b1' }));
  m = applyBall(m, ball({ batRuns: 6, bowlerId: 'b1' }));
  m = applyBall(m, ball({ bowlerId: 'b1', wicket: { outBatterId: 'a1', creditBowler: true } }));
  m = applyBall(m, ball({ strikerId: 'a3', bowlerId: 'b1', wicket: { outBatterId: 'a3', creditBowler: true } }));
  m = applyBall(m, ball({ strikerId: 'a4', bowlerId: 'b2', wicket: { outBatterId: 'a4', creditBowler: true } }));
  const state = deriveMatchState(m);
  const awards = computeAwards(state);

  const b1 = awards.ranked.find((r) => r.playerId === 'b1')!;
  const b2 = awards.ranked.find((r) => r.playerId === 'b2')!;
  check('b1 took two', b1.wickets, 2);
  check('b2 took one', b2.wickets, 1);
  check('more wickets wins regardless of runs', awards.bestBowler?.playerId, 'b1');
  check('b1 conceded 12', b1.runsConceded, 12);
}

// ---- 6. the winning side gets an uplift, and only on a positive score ----
{
  let m: MatchCore = createMatch('m', setup);
  // Reds make 24 in 4 overs, all to R1.
  for (let i = 0; i < 24; i++) {
    m = applyBall(m, ball({ batRuns: 1, strikerId: 'a1', nonStrikerId: 'a2', bowlerId: 'b1' }));
  }
  m = startSecondInnings(m);
  // Blues chase it down: B1 makes 25 off 24.
  for (let i = 0; i < 24; i++) {
    m = applyBall(m, ball({ batRuns: i === 0 ? 2 : 1, strikerId: 'b1', nonStrikerId: 'b2', bowlerId: 'a1' }));
  }
  const state = deriveMatchState(m);
  check('blues won the chase', state.winner, 'B');

  const awards = computeAwards(state);
  const b1 = awards.ranked.find((r) => r.playerId === 'b1')!;
  const a1 = awards.ranked.find((r) => r.playerId === 'a1')!;
  check('winner uplift applied', Math.round(b1.weighted * 100) / 100, Math.round(b1.impact * IMPACT_NOTES.winningSideUplift * 100) / 100);
  check('loser gets no uplift', a1.weighted, a1.impact);
  check('awards are final once the match is', awards.final, true);
  check('player of the match is on the winning side', awards.playerOfTheMatch?.side, 'B');
}

// ---- 7. ranking is by weighted impact, best first ----
{
  let m: MatchCore = createMatch('m', setup);
  for (let i = 0; i < 12; i++) {
    m = applyBall(m, ball({ batRuns: 4, strikerId: 'a1', nonStrikerId: 'a2', bowlerId: 'b1' }));
  }
  const awards = computeAwards(deriveMatchState(m));
  const descending = awards.ranked.every(
    (r, i) => i === 0 || awards.ranked[i - 1].weighted >= r.weighted,
  );
  check('ranked descending', descending, true);
  check('top of the ranking is the player of the match', awards.ranked[0].playerId, awards.playerOfTheMatch?.playerId);
}

// ---- report ----
console.log('');
if (failures.length === 0) {
  console.log(`  ✓ all ${passed} award assertions passed\n`);
} else {
  console.log(`  ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}\n`);
  process.exit(1);
}
