// Authentication boundaries, against a running server.
//   npx tsx scripts/e2e-auth.ts

import { io } from 'socket.io-client';
import { BASE, Session, makeChecker, signedInUser } from './testkit';

const { check, report } = makeChecker();

/** Connects a socket carrying (or not carrying) a session cookie. */
function connect(matchId: string, cookie: string, scorerToken?: string): Promise<'ok' | string> {
  return new Promise((resolve) => {
    const socket = io(BASE, {
      auth: { matchId, scorerToken },
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: cookie ? { Cookie: cookie } : {},
    });
    const done = (r: 'ok' | string) => {
      socket.disconnect();
      resolve(r);
    };
    const t = setTimeout(() => done('TIMEOUT'), 15000);
    socket.on('connect', () => {
      clearTimeout(t);
      done('ok');
    });
    socket.on('connect_error', (e: Error) => {
      clearTimeout(t);
      done(e.message);
    });
  });
}

async function main() {
  console.log(`\nAuthentication against ${BASE}\n`);

  const anon = new Session();

  // ---- signup validation ----
  check(
    'username too short is rejected',
    (
      await anon.fetch('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ username: 'ab', displayName: 'A', password: 'longenough1' }),
      })
    ).status,
    400,
  );
  check(
    'username with bad characters is rejected',
    (
      await anon.fetch('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ username: 'Bad User!', displayName: 'A', password: 'longenough1' }),
      })
    ).status,
    400,
  );
  check(
    'short password is rejected',
    (
      await anon.fetch('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ username: 'validname', displayName: 'A', password: 'short' }),
      })
    ).status,
    400,
  );

  // ---- signup succeeds and starts a session ----
  const alice = await signedInUser('alice');
  check('signup returns the user', alice.user.username, alice.username);
  check('signup sets a session cookie', alice.session.cookieHeader.includes('cricket_session'), true);

  const me = await alice.session.json('/api/auth/me');
  check('/me returns the signed-in user', me.user.username, alice.username);

  // ---- the password hash must never leave the server ----
  check('user payload has no password hash', 'passwordHash' in me.user, false);
  check('user payload has no password', 'password' in me.user, false);

  // ---- duplicate usernames ----
  const dup = await new Session().fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      username: alice.username,
      displayName: 'Impostor',
      password: 'another-password-1',
    }),
  });
  check('duplicate username is refused', dup.status, 409);

  // ---- login ----
  const fresh = new Session();
  const good = await fresh.fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: alice.username, password: alice.password }),
  });
  check('login with the right password succeeds', good.status, 200);
  check('login sets a session cookie', fresh.cookieHeader.includes('cricket_session'), true);

  const wrongPw = await new Session().fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: alice.username, password: 'not-the-password' }),
  });
  check('wrong password is refused', wrongPw.status, 401);

  const noUser = await new Session().fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'nobody_at_all_xyz', password: 'not-the-password' }),
  });
  check('unknown user is refused', noUser.status, 401);
  // Identical wording, so responses cannot be used to discover which usernames exist.
  check(
    'unknown user and wrong password are indistinguishable',
    (await noUser.json()).message,
    (await wrongPw.json()).message,
  );

  // ---- anonymous access is refused everywhere it matters ----
  check('/me without a session is 401', (await anon.fetch('/api/auth/me')).status, 401);
  check(
    'creating a match without a session is 401',
    (
      await anon.fetch('/api/matches', {
        method: 'POST',
        body: JSON.stringify({
          overs: 5,
          teamAName: 'A',
          teamBName: 'B',
          teamAPlayers: ['x', 'y'],
          teamBPlayers: ['p', 'q'],
        }),
      })
    ).status,
    401,
  );
  check(
    'searching users without a session is 401',
    (await anon.fetch('/api/auth/users/search?q=ali')).status,
    401,
  );

  // ---- a signed-in user can create a match ----
  const created = await alice.session.fetch('/api/matches', {
    method: 'POST',
    body: JSON.stringify({
      overs: 5,
      teamAName: 'Alpha',
      teamBName: 'Beta',
      teamAPlayers: ['x', 'y'],
      teamBPlayers: ['p', 'q'],
      tossWinner: 'A',
      tossDecision: 'BAT',
    }),
  });
  check('signed-in user can create a match', created.status, 201);
  const { matchId, scorerToken } = await created.json();

  check(
    'reading a match without a session is 401',
    (await anon.fetch(`/api/matches/${matchId}`)).status,
    401,
  );
  check(
    'reading a match with a session works',
    (await alice.session.fetch(`/api/matches/${matchId}`)).status,
    200,
  );

  // ---- sockets require a session too ----
  check('socket without a session is refused', await connect(matchId, ''), 'UNAUTHENTICATED');
  check(
    'socket with a session connects',
    await connect(matchId, alice.session.cookieHeader, scorerToken),
    'ok',
  );
  // Any signed-in account may WATCH; scoring rights still come from the token.
  const bob = await signedInUser('bob');
  check(
    'another signed-in user may watch',
    await connect(matchId, bob.session.cookieHeader),
    'ok',
  );

  // ---- user lookup for the squad builder ----
  const found = await alice.session.json(
    `/api/auth/users/search?q=${alice.username.slice(0, 4)}`,
  );
  check('username search finds the account', Array.isArray(found.users) && found.users.length > 0, true);
  const exact = await alice.session.json(`/api/auth/users/${alice.username}`);
  check('exact username lookup works', exact.user.username, alice.username);
  check(
    'lookup of a missing username is 404',
    (await alice.session.fetch('/api/auth/users/definitely_not_here')).status,
    404,
  );

  // ---- logout ----
  const out = await alice.session.fetch('/api/auth/logout', { method: 'POST' });
  check('logout succeeds', out.status, 200);
  check('session no longer works after logout', (await alice.session.fetch('/api/auth/me')).status, 401);

  report('authentication checks');
}

main().catch((err) => {
  console.error('\ncrashed:', err);
  process.exit(1);
});
