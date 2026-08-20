// Squads built from registered usernames, against a running server.
//   npx tsx scripts/e2e-squads.ts

import { makeChecker, signedInUser } from './testkit';

const { check, report } = makeChecker();

async function main() {
  console.log(`\nSquads and registered players\n`);

  const owner = await signedInUser('cap');
  const mate = await signedInUser('mate');
  const rival = await signedInUser('rival');

  const create = (body: unknown) =>
    owner.session.fetch('/api/matches', { method: 'POST', body: JSON.stringify(body) });

  const base = {
    overs: 5,
    teamAName: 'Reds',
    teamBName: 'Blues',
    tossWinner: 'A',
    tossDecision: 'BAT',
  };

  // ---- the rule: each side needs at least one registered player ----
  const noneRegistered = await create({
    ...base,
    teamAPlayers: [{ name: 'Guest One' }, { name: 'Guest Two' }],
    teamBPlayers: [{ name: 'Guest Three' }, { name: 'Guest Four' }],
  });
  check('all-guest squads are refused', noneRegistered.status, 400);
  check(
    'refusal explains why',
    (await noneRegistered.json()).error,
    'NEED_REGISTERED_PLAYER',
  );

  const onlyOneSide = await create({
    ...base,
    teamAPlayers: [{ name: owner.user.displayName, username: owner.username }, { name: 'Guest' }],
    teamBPlayers: [{ name: 'Guest Three' }, { name: 'Guest Four' }],
  });
  check('one registered side is still refused', onlyOneSide.status, 400);

  // ---- one registered player per side is enough; guests fill the rest ----
  const ok = await create({
    ...base,
    teamAPlayers: [
      { name: owner.user.displayName, username: owner.username },
      { name: 'Guest Keeper' },
      { name: 'Guest Allrounder' },
    ],
    teamBPlayers: [
      { name: rival.user.displayName, username: rival.username },
      { name: 'Guest Opener' },
    ],
  });
  check('one registered player per side is accepted', ok.status, 201);
  const { matchId } = await ok.json();

  const state = await owner.session.json(`/api/matches/${matchId}`);
  const a = state.setup.teamA.players;
  const b = state.setup.teamB.players;

  check('registered slot keeps its username', a[0].username, owner.username);
  check('registered slot gets a userId', typeof a[0].userId === 'string', true);
  check('guest slot has no username', a[1].username, null);
  check('guest slot has no userId', a[1].userId, null);
  check('guests still occupy real slots', a.length, 3);
  check('slot ids are unchanged by all this', a[1].id, 'a2');
  check('other side resolved too', b[0].username, rival.username);

  // ---- SECURITY: a client cannot claim an account it does not own ----
  // The payload below asserts a userId belonging to somebody else. The server
  // must ignore what the client says and resolve the username itself.
  const forged = await create({
    ...base,
    teamAPlayers: [
      { name: 'Impostor', username: mate.username, userId: '0123456789abcdef01234567' },
      { name: 'Guest' },
    ],
    teamBPlayers: [{ name: rival.user.displayName, username: rival.username }, { name: 'Guest' }],
  });
  check('match with a forged userId is still created', forged.status, 201);
  const forgedState = await owner.session.json(`/api/matches/${(await forged.json()).matchId}`);
  check(
    'the forged userId is ignored',
    forgedState.setup.teamA.players[0].userId === '0123456789abcdef01234567',
    false,
  );
  check(
    'the real account for that username is used instead',
    forgedState.setup.teamA.players[0].username,
    mate.username,
  );

  // ---- an unknown username degrades to a guest rather than erroring ----
  const unknown = await create({
    ...base,
    teamAPlayers: [
      { name: owner.user.displayName, username: owner.username },
      { name: 'Ghost', username: 'no_such_user_anywhere' },
    ],
    teamBPlayers: [{ name: rival.user.displayName, username: rival.username }, { name: 'Guest' }],
  });
  check('unknown username does not break creation', unknown.status, 201);
  const unknownState = await owner.session.json(`/api/matches/${(await unknown.json()).matchId}`);
  check(
    'unknown username becomes a guest',
    unknownState.setup.teamA.players[1].userId,
    null,
  );

  report('squad checks');
}

main().catch((err) => {
  console.error('\ncrashed:', err);
  process.exit(1);
});
