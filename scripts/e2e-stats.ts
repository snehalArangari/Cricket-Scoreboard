// Career stats, against a running server.
//   npx tsx scripts/e2e-stats.ts
//
// Plays two complete matches with known scorecards, then checks the profile
// totals are exactly the sum of them.

import { io, type Socket } from 'socket.io-client';
import { BASE, Session, makeChecker, signedInUser, sleep } from './testkit';

const { check, report } = makeChecker();

function connect(matchId: string, cookie: string, scorerToken?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      auth: { matchId, scorerToken },
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: cookie },
    });
    const t = setTimeout(() => reject(new Error('connect timeout')), 20000);
    socket.on('connect', () => {
      clearTimeout(t);
      resolve(socket);
    });
    socket.on('connect_error', (e: Error) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function emit(socket: Socket, event: string, payload: unknown): Promise<any> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, code: 'ACK_TIMEOUT' }), 20000);
    socket.emit(event, payload, (ack: unknown) => {
      clearTimeout(t);
      resolve(ack);
    });
  });
}

let seq = 0;
const ball = (over: Record<string, unknown> = {}) => ({
  id: `st-${Date.now()}-${++seq}`,
  delivery: 'NORMAL',
  batRuns: 0,
  strikerId: 'a1',
  nonStrikerId: 'a2',
  bowlerId: 'b1',
  wicket: null,
  ...over,
});

/**
 * Plays one 1-over-a-side match to completion.
 * Team A: `hero` opens and faces every ball. Team B: `foe` bowls every ball.
 * Returns nothing — the point is the side effect on both careers.
 */
async function playMatch(
  owner: Session,
  cookie: string,
  heroName: string,
  foeName: string,
  opts: { heroRunsPerBall: number; heroOutOnLastBall: boolean },
): Promise<string> {
  const created = await owner.fetch('/api/matches', {
    method: 'POST',
    body: JSON.stringify({
      overs: 1,
      teamAName: 'Heroes',
      teamBName: 'Foes',
      teamAPlayers: [{ name: 'Hero', username: heroName }, { name: 'Partner' }],
      teamBPlayers: [{ name: 'Foe', username: foeName }, { name: 'Fielder' }],
      tossWinner: 'A',
      tossDecision: 'BAT',
    }),
  });
  const { matchId, scorerToken } = await created.json();
  const socket = await connect(matchId, cookie, scorerToken);

  // Innings 1: six deliveries, hero on strike throughout (even runs keep strike).
  for (let i = 0; i < 6; i++) {
    const last = i === 5;
    const ack = await emit(socket, 'ball:add', {
      matchId,
      opId: `${matchId}-i1-${i}`,
      ball: ball({
        batRuns: opts.heroRunsPerBall,
        strikerId: 'a1',
        nonStrikerId: 'a2',
        bowlerId: 'b1',
        wicket:
          last && opts.heroOutOnLastBall ? { outBatterId: 'a1', creditBowler: true } : null,
      }),
    });
    // Silently ignoring a rejected ball would make the totals below wrong for
    // reasons impossible to see from the assertion messages.
    if (!ack?.ok) throw new Error(`innings1 ball ${i + 1} rejected: ${JSON.stringify(ack)}`);
  }
  const s2 = await emit(socket, 'innings:start2', { matchId, opId: `${matchId}-start2` });
  if (!s2?.ok) throw new Error(`innings:start2 rejected: ${JSON.stringify(s2)}`);
  // Innings 2: six dots, so Heroes always win and the chase never ends early.
  for (let i = 0; i < 6; i++) {
    const ack = await emit(socket, 'ball:add', {
      matchId,
      opId: `${matchId}-i2-${i}`,
      ball: ball({ batRuns: 0, strikerId: 'b1', nonStrikerId: 'b2', bowlerId: 'a1' }),
    });
    if (!ack?.ok) throw new Error(`innings2 ball ${i + 1} rejected: ${JSON.stringify(ack)}`);
  }
  await sleep(300);
  socket.disconnect();
  return matchId;
}

async function main() {
  console.log(`\nCareer stats against ${BASE}\n`);

  const hero = await signedInUser('hero');
  const foe = await signedInUser('foe');

  // A brand-new account has an empty, well-formed record.
  const empty = await hero.session.json(`/api/auth/users/${hero.username}/stats`);
  check('new player has no matches', empty.matches, 0);
  check('new player batting is zeroed', empty.batting.runs, 0);
  check('average is null, not zero, before any dismissal', empty.batting.average, null);
  check('bowling best is null before any bowling', empty.bowling.best, null);

  // Match 1: hero scores 2 off every ball (12), not out.
  await playMatch(hero.session, hero.session.cookieHeader, hero.username, foe.username, {
    heroRunsPerBall: 2,
    heroOutOnLastBall: false,
  });
  // Match 2: hero scores 4 off every ball (24), out on the last.
  await playMatch(hero.session, hero.session.cookieHeader, hero.username, foe.username, {
    heroRunsPerBall: 4,
    heroOutOnLastBall: true,
  });

  const s = await hero.session.json(`/api/auth/users/${hero.username}/stats`);

  check('two matches counted', s.matches, 2);
  check('both won', s.won, 2);
  check('none lost', s.lost, 0);

  // 12 + 24 = 36 off 12 balls.
  check('runs are the sum of both innings', s.batting.runs, 36);
  check('balls faced summed', s.batting.balls, 12);
  check('innings counted', s.batting.innings, 2);
  check('high score is the better innings', s.batting.highScore, 24);
  check('high score was an out innings', s.batting.highScoreNotOut, false);
  check('one not out recorded', s.batting.notOuts, 1);
  // 36 runs for a single dismissal.
  check('average divides by dismissals, not innings', s.batting.average, 36);
  check('strike rate over both innings', s.batting.strikeRate, 300);
  check('six fours counted', s.batting.fours, 6);
  check('no sixes', s.batting.sixes, 0);

  // Hero also bowled innings 2 of both matches: 6 dots each, so 2 maidens.
  check('bowling innings counted', s.bowling.innings, 2);
  check('bowling balls summed', s.bowling.balls, 12);
  check('no runs conceded', s.bowling.runs, 0);
  check('two maidens', s.bowling.maidens, 2);
  check('economy is zero', s.bowling.economy, 0);
  check('bowling average null with no wickets', s.bowling.average, null);
  check('bowling strike rate null with no wickets', s.bowling.strikeRate, null);

  check('recent matches listed', s.recent.length, 2);
  check('recent entry names the opponent', s.recent[0].opponent, 'Foes');
  check('recent entry knows the result', s.recent[0].result, 'won');

  // The opponent's record is the mirror image.
  const f = await foe.session.json(`/api/auth/users/${foe.username}/stats`);
  check('opponent played the same two matches', f.matches, 2);
  check('opponent lost both', f.lost, 2);
  check('opponent conceded what hero scored', f.bowling.runs, 36);
  check('opponent took the one wicket', f.bowling.wickets, 1);
  check('opponent best figures', f.bowling.best, { wickets: 1, runs: 24 });

  // Guests must never leak into anyone's career.
  const guestless = await hero.session.fetch('/api/auth/users/partner/stats');
  check('a guest name is not a profile', guestless.status, 404);

  report('career stat checks');
}

main().catch((err) => {
  console.error('\ncrashed:', err);
  process.exit(1);
});
