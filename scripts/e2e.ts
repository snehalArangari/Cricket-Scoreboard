// End-to-end proof against a running server + real Atlas.
//   1. start the server (npm start)
//   2. npx tsx scripts/e2e.ts
//
// This exercises what unit tests cannot: the socket protocol, the scorer/viewer
// split, write authorisation, live propagation, and score-goes-down.

import { io, type Socket } from 'socket.io-client';
import type { MatchState } from '../shared/types';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';

let passed = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label} — expected ${e}, got ${a}`);
    console.log(`  FAIL ${label} — expected ${e}, got ${a}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Client {
  socket: Socket;
  states: MatchState[];
  role: () => string | null;
}

/**
 * Listeners are attached at construction, BEFORE the connection completes.
 * The server emits match:state and match:role the instant it accepts a socket,
 * so attaching after `connect` resolves is a race that loses about half the time.
 */
function connect(matchId: string, scorerToken?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      auth: { matchId, scorerToken },
      transports: ['websocket'],
      reconnection: false,
    });
    const states: MatchState[] = [];
    let role: string | null = null;

    socket.on('match:state', (s: MatchState) => states.push(s));
    socket.on('match:role', (p: { role: string }) => {
      role = p.role;
    });

    const timer = setTimeout(() => reject(new Error('connect timeout')), 20000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve({ socket, states, role: () => role });
    });
    socket.on('connect_error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Polls the collected states, so an event that already arrived still counts. */
async function waitState(
  client: Client,
  predicate: (s: MatchState) => boolean,
  label = 'state',
): Promise<MatchState> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const found = [...client.states].reverse().find(predicate);
    if (found) return found;
    await sleep(40);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * Waits for the broadcast produced by a specific operation, identified by the
 * version in its ack. Predicates on score alone are ambiguous — "wickets === 0"
 * is equally true of a state from earlier in the match.
 */
async function afterOp(client: Client, ack: { version?: number }, label: string) {
  const target = ack?.version ?? 0;
  return waitState(client, (s) => s.version >= target, label);
}

async function waitFor(fn: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(40);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function emit(socket: Socket, event: string, payload: unknown): Promise<any> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: 'ACK_TIMEOUT' }), 20000);
    socket.emit(event, payload, (ack: unknown) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

let seq = 0;
function ball(over: Record<string, unknown> = {}) {
  seq++;
  return {
    id: `e2e-${Date.now()}-${seq}`,
    delivery: 'NORMAL',
    batRuns: 0,
    strikerId: 'a1',
    nonStrikerId: 'a2',
    bowlerId: 'b1',
    wicket: null,
    ...over,
  };
}

async function main() {
  console.log(`\nEnd-to-end against ${BASE}\n`);

  // --- create a match over REST ---
  const res = await fetch(`${BASE}/api/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      overs: 2,
      teamAName: 'Mumbai',
      teamBName: 'Chennai',
      teamAPlayers: ['Rohit', 'Ishan', 'Suryakumar', 'Tilak'],
      teamBPlayers: ['Ruturaj', 'Conway', 'Jadeja', 'Dhoni'],
    }),
  });
  check('REST create returns 201', res.status, 201);
  const { matchId, scorerToken } = (await res.json()) as { matchId: string; scorerToken: string };
  console.log(`  →  matchId ${matchId}\n`);

  const scorer = await connect(matchId, scorerToken);
  const viewer = await connect(matchId);

  await waitFor(() => scorer.role() !== null && viewer.role() !== null, 'roles');
  // The creator is the owner: scores AND manages co-scorers. Invited scorers
  // get role 'scorer' — see scripts/e2e-scorers.ts.
  check('token holder is the owner', scorer.role(), 'owner');
  check('no token means viewer', viewer.role(), 'viewer');

  // --- score a boundary; confirm the VIEWER sees it live ---
  const a1 = await emit(scorer.socket, 'ball:add', { matchId, opId: 'op1', ball: ball({ batRuns: 4 }) });
  let vs = await afterOp(viewer, a1, 'boundary');
  check('viewer receives the boundary live', vs.innings1.runs, 4);
  check('viewer sees a legal ball counted', vs.innings1.legalBalls, 1);
  check('viewer sees the batting card', vs.innings1.batting.find((c) => c.playerId === 'a1')?.runs, 4);
  check('viewer sees fours', vs.innings1.batting.find((c) => c.playerId === 'a1')?.fours, 1);
  check('viewer sees the bowling card', vs.innings1.bowling.find((c) => c.playerId === 'b1')?.runs, 4);

  // --- no-ball hit for six: 7 runs, still only 1 legal ball ---
  const a2 = await emit(scorer.socket, 'ball:add', {
    matchId,
    opId: 'op2',
    ball: ball({ delivery: 'NO_BALL', batRuns: 6 }),
  });
  vs = await afterOp(viewer, a2, 'no-ball six');
  check('no-ball six adds 7', vs.innings1.runs, 11);
  check('no-ball is not a legal ball', vs.innings1.legalBalls, 1);
  check('batter credited the six', vs.innings1.batting.find((c) => c.playerId === 'a1')?.runs, 10);

  // --- a stumping off a wide ---
  const a3 = await emit(scorer.socket, 'ball:add', {
    matchId,
    opId: 'op3',
    ball: ball({ delivery: 'WIDE', wicket: { outBatterId: 'a1', creditBowler: true } }),
  });
  vs = await afterOp(viewer, a3, 'wicket');
  check('stumping off a wide adds 1', vs.innings1.runs, 12);
  check('wicket registered', vs.innings1.wickets, 1);
  check('bowler credited', vs.innings1.bowling.find((c) => c.playerId === 'b1')?.wickets, 1);
  check('wide is still not a legal ball', vs.innings1.legalBalls, 1);

  // --- THE CRITICAL CASE: a delete must make the viewer's score DROP ---
  const del = await emit(scorer.socket, 'ball:delete', {
    matchId,
    opId: 'op4',
    inningsKey: 'innings1',
    index: 1, // the no-ball six
  });
  check('delete acknowledged', del?.ok, true);
  vs = await afterOp(viewer, del, 'score to drop');
  check('viewer score went DOWN', vs.innings1.runs, 5);
  check('batting card went down too', vs.innings1.batting.find((c) => c.playerId === 'a1')?.runs, 4);

  // --- undo ---
  const undo = await emit(scorer.socket, 'match:undo', { matchId, opId: 'op5' });
  check('undo acknowledged', undo?.ok, true);
  vs = await afterOp(viewer, undo, 'undo');
  check('undo removed the wicket', vs.innings1.wickets, 0);
  check('undo removed its run', vs.innings1.runs, 4);

  // --- a viewer must not be able to write ---
  const forbidden = await emit(viewer.socket, 'ball:add', {
    matchId,
    opId: 'op6',
    ball: ball({ batRuns: 6 }),
  });
  check('viewer write is refused', forbidden?.code, 'FORBIDDEN');

  // --- idempotency: replaying the same ball id must not double-count ---
  const replay = ball({ batRuns: 2 });
  await emit(scorer.socket, 'ball:add', { matchId, opId: 'op7', ball: replay });
  const first = await emit(scorer.socket, 'match:resync', { matchId });
  await emit(scorer.socket, 'ball:add', { matchId, opId: 'op8', ball: replay });
  const second = await emit(scorer.socket, 'match:resync', { matchId });
  check('replayed ball did not double-count', second?.version, first?.version);
  vs = await waitState(scorer, (s) => s.version === second?.version, 'resync');
  check('runs after replay', vs.innings1.runs, 6);

  // --- a late joiner gets full state, not a catch-up stream ---
  const latecomer = await connect(matchId);
  const late = await waitState(latecomer, () => true, 'late join');
  check('late joiner gets current runs', late.innings1.runs, 6);
  check('late joiner gets the cards', late.innings1.batting.some((c) => c.batted), true);

  // --- ORDERING: the broadcast must reach the writer BEFORE its ack ---
  // The client drops an operation from its pending outbox when the ack lands.
  // If the ack came first, the UI would briefly fall back to the pre-operation
  // state — and around the innings break that flicker was enough to wipe the
  // scorer's on-field selections and re-open the gate under them.
  {
    let sawBroadcast = false;
    let broadcastCameFirst: boolean | null = null;
    const onState = () => {
      sawBroadcast = true;
    };
    scorer.socket.on('match:state', onState);
    await new Promise<void>((resolve) => {
      scorer.socket.emit(
        'ball:add',
        { matchId, opId: 'op-order', ball: ball({ batRuns: 1 }) },
        () => {
          broadcastCameFirst = sawBroadcast;
          resolve();
        },
      );
    });
    scorer.socket.off('match:state', onState);
    check('broadcast reaches the writer before its ack', broadcastCameFirst, true);
  }

  // --- an unknown match id is refused at the handshake ---
  let badMessage = '';
  try {
    await connect('NOPE99');
  } catch (err) {
    badMessage = (err as Error).message;
  }
  check('unknown match id refused', badMessage, 'MATCH_NOT_FOUND');

  scorer.socket.disconnect();
  viewer.socket.disconnect();
  latecomer.socket.disconnect();

  console.log('');
  if (failures.length === 0) {
    console.log(`  PASS — all ${passed} end-to-end checks passed\n`);
    process.exit(0);
  } else {
    console.log(`  ${passed} passed, ${failures.length} FAILED\n`);
    for (const f of failures) console.log(`  - ${f}`);
    console.log('');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\ne2e crashed:', err);
  process.exit(1);
});
