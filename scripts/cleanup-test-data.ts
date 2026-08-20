// Removes accounts and matches created by the end-to-end suites.
//
//   npx tsx scripts/cleanup-test-data.ts            # dry run — lists, deletes nothing
//   npx tsx scripts/cleanup-test-data.ts --delete   # actually removes them
//
// Deliberately conservative: it matches on the display names the test harness
// and the browser drivers set, NOT on username prefixes. A prefix like "cap" or
// "hero" could easily belong to a real person, and deleting somebody's account
// because their handle started with the wrong three letters would be far worse
// than leaving a few test rows behind.

import path from 'node:path';
import mongoose from 'mongoose';
import { UserModel } from '../server/models/User';
import { MatchModel } from '../server/models/Match';

try {
  process.loadEnvFile(path.resolve(process.cwd(), '.env'));
} catch {
  /* rely on the real environment */
}

const URI = process.env.MONGODB_URI ?? '';
if (!URI) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

const APPLY = process.argv.includes('--delete');

/** Every account the harness creates is named "Test <username>". */
const HARNESS_NAME = /^Test [a-z0-9_]+$/;

/** The display names used by the browser drivers, spelled out in full. */
const DRIVER_NAMES = new Set([
  'UI Tester',
  'A Fan',
  'Team Captain',
  'Opponent Captain',
  'Sam Captain',
  'Ravi Opponent',
  'A Watcher',
  'Live Captain',
  'Live Opponent',
  'Live Watcher',
]);

function isTestAccount(displayName: string): boolean {
  return HARNESS_NAME.test(displayName) || DRIVER_NAMES.has(displayName);
}

async function main() {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 15000 });
  console.log(`\nConnected. Mode: ${APPLY ? 'DELETE' : 'dry run'}\n`);

  const users = await UserModel.find({}).lean();
  const doomed = users.filter((u) => isTestAccount(String(u.displayName)));
  const keep = users.filter((u) => !isTestAccount(String(u.displayName)));

  console.log(`accounts: ${users.length} total, ${doomed.length} look like test data\n`);

  if (keep.length > 0) {
    console.log('KEEPING these accounts:');
    for (const u of keep) console.log(`  @${u.username}  "${u.displayName}"`);
    console.log('');
  }

  if (doomed.length === 0) {
    console.log('Nothing to remove.\n');
    await mongoose.disconnect();
    return;
  }

  const ids = doomed.map((u) => u._id);
  // A match goes only if BOTH its creator and every registered player are test
  // accounts — a real player's match must never be collateral damage.
  const matches = await MatchModel.find({
    $or: [
      { ownerUserId: { $in: ids } },
      { 'setup.teamA.players.userId': { $in: ids } },
      { 'setup.teamB.players.userId': { $in: ids } },
    ],
  }).lean();

  const doomedIds = new Set(ids.map(String));
  const safeToDelete: string[] = [];
  const spared: string[] = [];
  for (const m of matches as any[]) {
    const playerIds = [
      ...(m.setup?.teamA?.players ?? []),
      ...(m.setup?.teamB?.players ?? []),
    ]
      .map((p: any) => p?.userId)
      .filter(Boolean)
      .map(String);
    const owner = m.ownerUserId ? String(m.ownerUserId) : null;
    const allTest =
      (owner === null || doomedIds.has(owner)) && playerIds.every((id) => doomedIds.has(id));
    if (allTest) safeToDelete.push(m.matchId);
    else spared.push(m.matchId);
  }

  console.log(`matches touching those accounts: ${matches.length}`);
  console.log(`  removable (all participants are test accounts): ${safeToDelete.length}`);
  if (spared.length > 0) {
    console.log(`  SPARED (a real player took part): ${spared.join(', ')}`);
  }
  console.log('');

  if (!APPLY) {
    console.log(`Dry run. Re-run with --delete to remove ${doomed.length} accounts`);
    console.log(`and ${safeToDelete.length} matches.\n`);
    await mongoose.disconnect();
    return;
  }

  const m = await MatchModel.deleteMany({ matchId: { $in: safeToDelete } });
  const u = await UserModel.deleteMany({ _id: { $in: ids } });
  console.log(`Deleted ${m.deletedCount} matches and ${u.deletedCount} accounts.\n`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('cleanup failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
