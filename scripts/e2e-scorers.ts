// Permission boundaries for co-scorers, against a running server.
//   npx tsx scripts/e2e-scorers.ts
//
// The whole point of the feature is who may do what, so that is what this tests.

import { io, type Socket } from 'socket.io-client';
import type { MatchState } from '../shared/types';
import { Session, signedInUser } from './testkit';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3100';

// The owner's session cookie; every handshake in this suite carries it.
let COOKIE = '';
let OWNER: Session | null = null;

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

function connect(matchId: string, scorerToken?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      auth: { matchId, scorerToken },
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: COOKIE },
    });
    const states: MatchState[] = [];
    let role: string | null = null;
    socket.on('match:state', (s: MatchState) => states.push(s));
    socket.on('match:role', (p: { role: string }) => (role = p.role));
    const t = setTimeout(() => reject(new Error('connect timeout')), 20000);
    socket.on('connect', () => {
      clearTimeout(t);
      resolve({ socket, states, role: () => role });
    });
    socket.on('connect_error', (e: Error) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function emit(socket: Socket, event: string, payload: unknown): Promise<any> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, code: 'ACK_TIMEOUT' }), 15000);
    socket.emit(event, payload, (ack: unknown) => {
      clearTimeout(t);
      resolve(ack);
    });
  });
}

async function waitState(
  client: Client,
  predicate: (s: MatchState) => boolean,
  label: string,
): Promise<MatchState> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const found = [...client.states].reverse().find(predicate);
    if (found) return found;
    await sleep(40);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function waitFor(fn: () => boolean, label: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(40);
  }
  throw new Error(`timed out waiting for ${label}`);
}

let seq = 0;
const ball = (over: Record<string, unknown> = {}) => ({
  id: `sc-${Date.now()}-${++seq}`,
  delivery: 'NORMAL',
  batRuns: 1,
  strikerId: 'a1',
  nonStrikerId: 'a2',
  bowlerId: 'b1',
  wicket: null,
  ...over,
});

const api = (path: string, token?: string, init: RequestInit = {}) =>
  OWNER!.fetch(path, {
    ...init,
    headers: {
      ...(token ? { 'x-scorer-token': token } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });

async function main() {
  console.log(`\nCo-scorer permissions against ${BASE}\n`);

  const account = await signedInUser('perm');
  const guest = await signedInUser('opp'); // registered player for the other side
  OWNER = account.session;
  COOKIE = account.session.cookieHeader;

  const created = await api('/api/matches', undefined, {
    method: 'POST',
    body: JSON.stringify({
      // Long enough to exceed the 30-ball viewer trim further down.
      overs: 20,
      teamAName: 'Owners',
      teamBName: 'Guests',
      teamAPlayers: [{ name: 'a', username: account.username }, { name: 'b' }, { name: 'c' }],
      teamBPlayers: [{ name: 'x', username: guest.username }, { name: 'y' }, { name: 'z' }],
    }),
  }).then((r) => r.json());
  const { matchId, scorerToken: ownerToken } = created;
  console.log(`  →  match ${matchId}\n`);

  // --- the creator is the owner ---
  const owner = await connect(matchId, ownerToken);
  await waitFor(() => owner.role() !== null, 'owner role');
  check('creator connects as owner', owner.role(), 'owner');

  // --- a stranger cannot see or change the scorer list ---
  check('stranger cannot list scorers', (await api(`/api/matches/${matchId}/scorers`)).status, 403);
  check(
    'stranger cannot invite',
    (
      await api(`/api/matches/${matchId}/scorers`, undefined, {
        method: 'POST',
        body: JSON.stringify({ name: 'Intruder' }),
      })
    ).status,
    403,
  );

  // --- the owner invites Ravi ---
  const invite = await api(`/api/matches/${matchId}/scorers`, ownerToken, {
    method: 'POST',
    body: JSON.stringify({ name: 'Ravi' }),
  });
  check('owner can invite', invite.status, 201);
  const ravi = await invite.json();
  check('invite returns a token once', typeof ravi.token, 'string');

  const list = await api(`/api/matches/${matchId}/scorers`, ownerToken).then((r) => r.json());
  check('owner sees one co-scorer', list.scorers.length, 1);
  check('co-scorer is named', list.scorers[0].name, 'Ravi');
  check('list never leaks a token', 'token' in list.scorers[0], false);
  check('list never leaks a hash', 'tokenHash' in list.scorers[0], false);

  // --- Ravi can score ---
  const ravSock = await connect(matchId, ravi.token);
  await waitFor(() => ravSock.role() !== null, 'ravi role');
  check('invited person connects as scorer', ravSock.role(), 'scorer');

  const wrote = await emit(ravSock.socket, 'ball:add', {
    matchId,
    opId: 'sc-op1',
    ball: ball({ batRuns: 4 }),
  });
  check('co-scorer can score', wrote?.ok, true);

  // --- and the owner sees it live ---
  await waitFor(() => owner.states.some((s) => s.innings1.runs === 4), "owner sees Ravi's ball");
  check('owner sees the co-scorer ball live', true, true);

  // --- but Ravi may NOT invite or revoke ---
  check(
    'co-scorer cannot invite',
    (
      await api(`/api/matches/${matchId}/scorers`, ravi.token, {
        method: 'POST',
        body: JSON.stringify({ name: 'Friend' }),
      })
    ).status,
    403,
  );
  check(
    'co-scorer cannot list scorers',
    (await api(`/api/matches/${matchId}/scorers`, ravi.token)).status,
    403,
  );
  check(
    'co-scorer cannot revoke anyone',
    (
      await api(`/api/matches/${matchId}/scorers/${ravi.id}`, ravi.token, { method: 'DELETE' })
    ).status,
    403,
  );

  // --- a plain viewer still cannot write ---
  const viewer = await connect(matchId);
  await waitFor(() => viewer.role() !== null, 'viewer role');
  check('no token is a viewer', viewer.role(), 'viewer');
  const denied = await emit(viewer.socket, 'ball:add', { matchId, opId: 'sc-op2', ball: ball() });
  check('viewer still refused', denied?.code, 'FORBIDDEN');

  // --- the owner revokes Ravi ---
  const revoked = await api(`/api/matches/${matchId}/scorers/${ravi.id}`, ownerToken, {
    method: 'DELETE',
  });
  check('owner can revoke', revoked.status, 200);

  // revoking disconnects them immediately
  await waitFor(() => ravSock.socket.connected === false, 'ravi disconnected');
  check('revoked scorer is disconnected', ravSock.socket.connected, false);

  // and the revoked token no longer grants write access
  const afterRevoke = await connect(matchId, ravi.token);
  await waitFor(() => afterRevoke.role() !== null, 'post-revoke role');
  check('revoked token is only a viewer', afterRevoke.role(), 'viewer');
  const blocked = await emit(afterRevoke.socket, 'ball:add', {
    matchId,
    opId: 'sc-op3',
    ball: ball({ batRuns: 6 }),
  });
  check('revoked scorer cannot write', blocked?.code, 'FORBIDDEN');

  // --- WRITERS get the full ball log; viewers get a trimmed tail ---
  // Viewers only render recent balls, so their payload is trimmed. Writers must
  // never be: edit and delete address a ball by its INDEX, so a truncated log
  // would silently point them at the wrong delivery. The trim is 30, so this
  // only shows up in a long innings — which is why nothing else caught it.
  {
    for (let i = 0; i < 34; i++) {
      await emit(owner.socket, 'ball:add', {
        matchId,
        opId: `bulk-${i}`,
        ball: ball({ batRuns: 0 }),
      });
    }
    // Wait on a field present in BOTH views, then assert on the log length —
    // otherwise a regression times out instead of failing with a clear message.
    const ownerState = await waitState(owner, (s) => s.innings1.legalBalls >= 34, 'bulk balls');
    check('owner receives the FULL ball log', ownerState.innings1.events.length > 30, true);

    const plain = await connect(matchId);
    const viewerState = await waitState(plain, () => true, 'viewer state');
    check('viewer log is trimmed', viewerState.innings1.events.length <= 30, true);
    check(
      'but the viewer total is still complete',
      viewerState.innings1.runs,
      ownerState.innings1.runs,
    );
    plain.socket.disconnect();
  }

  // --- the owner is unaffected throughout ---
  const stillFine = await emit(owner.socket, 'ball:add', {
    matchId,
    opId: 'sc-op4',
    ball: ball({ batRuns: 2 }),
  });
  check('owner can still score after revoking', stillFine?.ok, true);

  owner.socket.disconnect();
  ravSock.socket.disconnect();
  viewer.socket.disconnect();
  afterRevoke.socket.disconnect();

  console.log('');
  if (failures.length === 0) {
    console.log(`  PASS — all ${passed} permission checks passed\n`);
    process.exit(0);
  } else {
    console.log(`  ${passed} passed, ${failures.length} FAILED\n`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\ncrashed:', err);
  process.exit(1);
});
