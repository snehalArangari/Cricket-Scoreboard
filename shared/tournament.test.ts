// Standings and net run rate. `npm run test:tournament`.

import {
  DEFAULT_POINTS,
  ballsForRunRate,
  computeLeaderboards,
  computeStandings,
  type TournamentMatchRef,
  type TournamentTeam,
} from './tournament';
import { applyBall, createMatch, deriveMatchState, startSecondInnings, validateSetup } from './engine';
import type { Ball, MatchCore, MatchState } from './types';

let passed = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else failures.push(`${label}\n     expected: ${e}\n     actual:   ${a}`);
}

const teams: TournamentTeam[] = [
  { id: 't1', name: 'Reds' },
  { id: 't2', name: 'Blues' },
  { id: 't3', name: 'Greens' },
];

let seq = 0;
function ball(over: Partial<Ball> = {}): Ball {
  seq++;
  return {
    id: `tr-${seq}`,
    delivery: 'NORMAL',
    batRuns: 0,
    strikerId: 'a1',
    nonStrikerId: 'a2',
    bowlerId: 'b1',
    wicket: null,
    ...over,
  };
}

/** Plays a 2-over match: side A scores `aRuns`, side B scores `bRuns`. */
function playMatch(aName: string, bName: string, aRuns: number, bRuns: number): MatchState {
  const setup = validateSetup({
    overs: 2,
    teamAName: aName,
    teamBName: bName,
    teamAPlayers: [{ name: `${aName}1` }, { name: `${aName}2` }, { name: `${aName}3` }],
    teamBPlayers: [{ name: `${bName}1` }, { name: `${bName}2` }, { name: `${bName}3` }],
  });
  let m: MatchCore = createMatch(`m${seq}`, setup);
  // 12 balls, distributing the runs one per ball where possible.
  for (let i = 0; i < 12; i++) {
    const runs = i < aRuns ? 1 : 0;
    m = applyBall(m, ball({ batRuns: runs, strikerId: 'a1', nonStrikerId: 'a2', bowlerId: 'b1' }));
  }
  m = startSecondInnings(m);
  for (let i = 0; i < 12; i++) {
    const runs = i < bRuns ? 1 : 0;
    m = applyBall(m, ball({ batRuns: runs, strikerId: 'b1', nonStrikerId: 'b2', bowlerId: 'a1' }));
    if (m.status === 'complete') break;
  }
  return deriveMatchState(m);
}

// ---- 1. an empty table still lists every team ----
{
  const table = computeStandings(teams, []);
  check('empty · all teams listed', table.length, 3);
  check('empty · nothing played', table[0].played, 0);
  check('empty · no points', table[0].points, 0);
  check('empty · nrr is null, not zero', table[0].nrr, null);
}

// ---- 2. a win is worth two points and a loss none ----
{
  const state = playMatch('Reds', 'Blues', 10, 4);
  check('reds won', state.winner, 'A');
  const table = computeStandings(teams, [
    { matchId: 'm1', teamAId: 't1', teamBId: 't2', state },
  ]);
  const reds = table.find((r) => r.teamId === 't1')!;
  const blues = table.find((r) => r.teamId === 't2')!;
  check('winner gets 2 points', reds.points, DEFAULT_POINTS.win);
  check('loser gets 0', blues.points, DEFAULT_POINTS.loss);
  check('both played one', reds.played + blues.played, 2);
  check('winner is top of the table', table[0].teamId, 't1');
  check('runs for the winner', reds.runsFor, 10);
  check('runs against the winner', reds.runsAgainst, 4);
  check('the loser mirrors it', blues.runsFor, 4);
}

// ---- 3. a tie splits the points ----
{
  const state = playMatch('Reds', 'Blues', 6, 6);
  check('the match tied', state.winner, 'TIE');
  const table = computeStandings(teams, [
    { matchId: 'm2', teamAId: 't1', teamBId: 't2', state },
  ]);
  check('both get a point', table.find((r) => r.teamId === 't1')!.points, DEFAULT_POINTS.tie);
  check('both counted as tied', table.find((r) => r.teamId === 't2')!.tied, 1);
}

// ---- 4. THE RULE PEOPLE GET WRONG: a side bowled out is charged its FULL quota ----
// Otherwise collapsing quickly would flatter a team's run rate, and a side could
// improve its net run rate by being skittled faster.
{
  const innings = { wickets: 2, legalBalls: 6 } as any; // 2 down from a squad of 3 = all out
  check(
    'all out is charged the full quota',
    ballsForRunRate(innings, 2, 3),
    12,
  );
  const surviving = { wickets: 1, legalBalls: 6 } as any;
  check(
    'a side still batting is charged what it used',
    ballsForRunRate(surviving, 2, 3),
    6,
  );
  // A one-player side can never be "all out" — there is nobody to partner.
  check('a single-player side is never all out', ballsForRunRate(innings, 2, 1), 6);
}

// ---- 5. net run rate is runs-per-over for, minus runs-per-over against ----
{
  const state = playMatch('Reds', 'Blues', 12, 6);
  const table = computeStandings(teams, [
    { matchId: 'm3', teamAId: 't1', teamBId: 't2', state },
  ]);
  const reds = table.find((r) => r.teamId === 't1')!;
  const blues = table.find((r) => r.teamId === 't2')!;
  // Reds 12 off 2 overs = 6.00; Blues 6 off 2 = 3.00.
  check('winner nrr is positive', Math.round(reds.nrr! * 100) / 100, 3);
  check('loser nrr is the exact negative', Math.round(blues.nrr! * 100) / 100, -3);
}

// ---- 6. equal points are separated by net run rate ----
{
  // Reds thrash Greens; Blues scrape past Greens. Both have one win.
  const bigWin = playMatch('Reds', 'Greens', 12, 1);
  const narrowWin = playMatch('Blues', 'Greens', 5, 4);
  const table = computeStandings(teams, [
    { matchId: 'm4', teamAId: 't1', teamBId: 't3', state: bigWin },
    { matchId: 'm5', teamAId: 't2', teamBId: 't3', state: narrowWin },
  ]);
  check('both winners on two points', table[0].points === table[1].points, true);
  check('the bigger win is ranked first', table[0].teamId, 't1');
  check('the beaten team is last', table[2].teamId, 't3');
  check('the beaten team played twice', table[2].played, 2);
}

// ---- 7. an unfinished match contributes nothing ----
{
  const setup = validateSetup({
    overs: 2,
    teamAName: 'Reds',
    teamBName: 'Blues',
    teamAPlayers: [{ name: 'r1' }, { name: 'r2' }],
    teamBPlayers: [{ name: 'b1' }, { name: 'b2' }],
  });
  let m: MatchCore = createMatch('live', setup);
  m = applyBall(m, ball({ batRuns: 4 }));
  const table = computeStandings(teams, [
    { matchId: 'live', teamAId: 't1', teamBId: 't2', state: deriveMatchState(m) },
  ]);
  check('a match in progress is not counted', table.find((r) => r.teamId === 't1')!.played, 0);
  check('and adds no runs', table.find((r) => r.teamId === 't1')!.runsFor, 0);
}

// ---- 8. leaderboards aggregate a player across matches ----
{
  const setupOf = (n: string) =>
    validateSetup({
      overs: 2,
      teamAName: 'Reds',
      teamBName: 'Blues',
      teamAPlayers: [{ name: 'Star', username: 'star' }, { name: 'Mate' }],
      teamBPlayers: [{ name: 'Foe', username: 'foe' }, { name: 'Other' }],
    });

  const build = (runsPerBall: number): MatchState => {
    let m: MatchCore = createMatch('lb', setupOf('x'));
    for (let i = 0; i < 12; i++) {
      m = applyBall(m, ball({ batRuns: runsPerBall, strikerId: 'a1', nonStrikerId: 'a2', bowlerId: 'b1' }));
    }
    return deriveMatchState(m);
  };

  const refs: TournamentMatchRef[] = [
    { matchId: 'lb1', teamAId: 't1', teamBId: 't2', state: build(1) },
    { matchId: 'lb2', teamAId: 't1', teamBId: 't2', state: build(2) },
  ];
  const { batting, bowling } = computeLeaderboards(refs);

  const star = batting.find((r) => r.username === 'star')!;
  check('a registered player is one row across matches', star.matches, 2);
  check('runs aggregated', star.runs, 12 + 24);
  check('balls aggregated', star.balls, 24);
  check('top of the batting list', batting[0].username, 'star');

  const foe = bowling.find((r) => r.username === 'foe')!;
  check('the bowler appears once', foe.matches, 2);
  check('runs conceded aggregated', foe.runsConceded, 36);

  // Guests are keyed per match, since nothing proves two "Mate"s are one person.
  const mates = batting.concat(bowling).filter((r) => r.name === 'Mate');
  check('guests are not merged across matches', mates.every((r) => r.matches === 1), true);
}

// ---- report ----
console.log('');
if (failures.length === 0) {
  console.log(`  ✓ all ${passed} tournament assertions passed\n`);
} else {
  console.log(`  ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}\n`);
  process.exit(1);
}
