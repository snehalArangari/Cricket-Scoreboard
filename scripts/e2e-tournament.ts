// Tournaments against a running server.
//   npx tsx scripts/e2e-tournament.ts
//
// Plays a real three-team round robin and checks the resulting table.

import { io, type Socket } from 'socket.io-client';
import { BASE, Session, makeChecker, signedInUser, sleep } from './testkit';

const { check, report } = makeChecker();

function connect(matchId: string, cookie: string, scorerToken: string): Promise<Socket> {
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
  id: `tn-${Date.now()}-${++seq}`,
  delivery: 'NORMAL',
  batRuns: 0,
  strikerId: 'a1',
  nonStrikerId: 'a2',
  bowlerId: 'b1',
  wicket: null,
  ...over,
});

async function main() {
  console.log(`\nTournaments against ${BASE}\n`);

  const organiser = await signedInUser('org');
  const rival = await signedInUser('riv');
  const S = organiser.session;
  const cookie = S.cookieHeader;

  // ---- create ----
  const created = await S.fetch('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify({ name: 'Sunday League', teams: ['Reds', 'Blues', 'Greens'] }),
  });
  check('tournament created', created.status, 201);
  const t = await created.json();
  check('three teams registered', t.teams.length, 3);
  const [reds, blues, greens] = t.teams;

  const empty = await S.json(`/api/tournaments/${t.tournamentId}`);
  check('empty table still lists every team', empty.standings.length, 3);
  check('nothing played yet', empty.standings[0].played, 0);
  check('organiser is flagged as owner', empty.isOwner, true);

  // ---- a stranger can read but not change ----
  check(
    'a non-organiser cannot add a team',
    (
      await rival.session.fetch(`/api/tournaments/${t.tournamentId}/teams`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Intruders' }),
      })
    ).status,
    403,
  );
  const asRival = await rival.session.json(`/api/tournaments/${t.tournamentId}`);
  check('but they can read the table', asRival.standings.length, 3);
  check('and are not flagged as owner', asRival.isOwner, false);

  // ---- play a match inside the tournament ----
  /** teamA bats first and scores aRuns; teamB replies with bRuns. */
  async function play(
    homeId: string,
    homeName: string,
    awayId: string,
    awayName: string,
    aRuns: number,
    bRuns: number,
  ): Promise<string> {
    const res = await S.fetch('/api/matches', {
      method: 'POST',
      body: JSON.stringify({
        overs: 2,
        teamAName: homeName,
        teamBName: awayName,
        teamAPlayers: [
          { name: `${homeName} Cap`, username: organiser.username },
          { name: 'Guest H' },
          { name: 'Guest H2' },
        ],
        teamBPlayers: [
          { name: `${awayName} Cap`, username: rival.username },
          { name: 'Guest A' },
          { name: 'Guest A2' },
        ],
        tossWinner: 'A',
        tossDecision: 'BAT',
        tournamentId: t.tournamentId,
        tournamentTeamAId: homeId,
        tournamentTeamBId: awayId,
      }),
    });
    if (res.status !== 201) throw new Error(`create failed: ${res.status} ${await res.text()}`);
    const { matchId, scorerToken } = await res.json();
    const socket = await connect(matchId, cookie, scorerToken);

    for (let i = 0; i < 12; i++) {
      const ack = await emit(socket, 'ball:add', {
        matchId,
        opId: `${matchId}-1-${i}`,
        ball: ball({ batRuns: i < aRuns ? 1 : 0, strikerId: 'a1', nonStrikerId: 'a2', bowlerId: 'b1' }),
      });
      if (!ack?.ok) throw new Error(`i1 ball ${i}: ${JSON.stringify(ack)}`);
    }
    const s2 = await emit(socket, 'innings:start2', { matchId, opId: `${matchId}-s2` });
    if (!s2?.ok) throw new Error(`start2: ${JSON.stringify(s2)}`);
    for (let i = 0; i < 12; i++) {
      const ack = await emit(socket, 'ball:add', {
        matchId,
        opId: `${matchId}-2-${i}`,
        ball: ball({ batRuns: i < bRuns ? 1 : 0, strikerId: 'b1', nonStrikerId: 'b2', bowlerId: 'a1' }),
      });
      if (!ack?.ok && ack?.code !== 'INNINGS_OVER') throw new Error(`i2 ball ${i}: ${JSON.stringify(ack)}`);
      if (ack?.code === 'INNINGS_OVER') break;
    }
    await sleep(250);
    socket.disconnect();
    return matchId;
  }

  // Reds thrash Greens 12-2; Blues edge Greens 6-5. Both win once.
  await play(reds.id, 'Reds', greens.id, 'Greens', 12, 2);
  await play(blues.id, 'Blues', greens.id, 'Greens', 6, 5);

  const table = (await S.json(`/api/tournaments/${t.tournamentId}`)).standings;
  const row = (id: string) => table.find((r: any) => r.teamId === id);

  check('reds won one', row(reds.id).won, 1);
  check('blues won one', row(blues.id).won, 1);
  check('greens lost two', row(greens.id).lost, 2);
  check('greens played two', row(greens.id).played, 2);
  check('a win is two points', row(reds.id).points, 2);
  check('greens have none', row(greens.id).points, 0);

  // Equal points, so net run rate separates them — and Reds won by more.
  check('level on points', row(reds.id).points === row(blues.id).points, true);
  check('reds ahead on net run rate', row(reds.id).nrr > row(blues.id).nrr, true);
  check('table is sorted, reds first', table[0].teamId, reds.id);
  check('greens are bottom', table[2].teamId, greens.id);
  check('greens net run rate is negative', row(greens.id).nrr < 0, true);

  // ---- leaderboards ----
  const detail = await S.json(`/api/tournaments/${t.tournamentId}`);
  check('two matches listed', detail.matches.length, 2);
  const topBat = detail.leaderboards.batting[0];
  check('a leaderboard was produced', Boolean(topBat), true);
  check(
    'the organiser batted in both matches as one row',
    detail.leaderboards.batting.find((r: any) => r.username === organiser.username)?.matches,
    2,
  );

  // ---- a team that has played cannot be removed ----
  check(
    'removing a team with matches is refused',
    (
      await S.fetch(`/api/tournaments/${t.tournamentId}/teams/${greens.id}`, { method: 'DELETE' })
    ).status,
    409,
  );

  // ---- but an unplayed team can be added and removed ----
  const added = await S.fetch(`/api/tournaments/${t.tournamentId}/teams`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Yellows' }),
  });
  check('a new team can be added', added.status, 201);
  const yellow = (await added.json()).team;
  check(
    'duplicate team names are refused',
    (
      await S.fetch(`/api/tournaments/${t.tournamentId}/teams`, {
        method: 'POST',
        body: JSON.stringify({ name: 'yellows' }),
      })
    ).status,
    409,
  );
  check(
    'an unplayed team can be removed',
    (
      await S.fetch(`/api/tournaments/${t.tournamentId}/teams/${yellow.id}`, { method: 'DELETE' })
    ).status,
    200,
  );

  // ---- the toss decides which tournament team is "teamA" ----
  // Reds win the toss and BOWL, so Blues bat first: the match's teamA must be
  // mapped to Blues, not to the team typed first.
  const res = await S.fetch('/api/matches', {
    method: 'POST',
    body: JSON.stringify({
      overs: 2,
      teamAName: 'Reds',
      teamBName: 'Blues',
      teamAPlayers: [{ name: 'R', username: organiser.username }, { name: 'g' }],
      teamBPlayers: [{ name: 'B', username: rival.username }, { name: 'g' }],
      tossWinner: 'A',
      tossDecision: 'BOWL',
      tournamentId: t.tournamentId,
      tournamentTeamAId: reds.id,
      tournamentTeamBId: blues.id,
    }),
  });
  check('match created with a bowl-first toss', res.status, 201);
  const after = await S.json(`/api/tournaments/${t.tournamentId}`);
  const newest = after.matches[after.matches.length - 1];
  check('batting-first side is Blues', newest.teamAName, 'Blues');
  check('and it maps to the Blues tournament team', newest.teamAId, blues.id);

  report('tournament checks');
}

main().catch((err) => {
  console.error('\ncrashed:', err);
  process.exit(1);
});
