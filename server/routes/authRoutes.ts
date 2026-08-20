import { Router } from 'express';
import {
  USERNAME_RE,
  UserModel,
  hashPassword,
  toPublicUser,
  verifyPassword,
} from '../models/User';
import { clearSessionCookie, requireAuth, setSessionCookie, signToken } from '../auth';
import { isDbConnected } from '../db';

export const authRouter = Router();

function dbReady(res: any): boolean {
  if (isDbConnected()) return true;
  res.status(503).json({ error: 'DB_UNAVAILABLE', message: 'Database is not connected yet' });
  return false;
}

authRouter.post('/signup', async (req, res) => {
  if (!dbReady(res)) return;
  try {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const displayName = String(req.body?.displayName ?? '').trim() || username;
    const password = String(req.body?.password ?? '');

    if (!USERNAME_RE.test(username)) {
      res.status(400).json({
        error: 'BAD_USERNAME',
        message: '3–20 characters, using lowercase letters, numbers or underscore',
      });
      return;
    }
    if (password.length < 8) {
      res
        .status(400)
        .json({ error: 'WEAK_PASSWORD', message: 'Use at least 8 characters' });
      return;
    }
    if (displayName.length > 40) {
      res.status(400).json({ error: 'BAD_NAME', message: 'Display name is too long' });
      return;
    }

    if (await UserModel.exists({ username })) {
      res.status(409).json({ error: 'TAKEN', message: 'That username is already taken' });
      return;
    }

    const doc = await UserModel.create({
      username,
      displayName,
      passwordHash: await hashPassword(password),
      lastLoginAt: new Date(),
    });

    const user = toPublicUser(doc);
    setSessionCookie(res, signToken({ sub: user.id, username: user.username }));
    res.status(201).json({ user });
  } catch (err: any) {
    // A duplicate can still slip through between the check and the insert.
    if (err?.code === 11000) {
      res.status(409).json({ error: 'TAKEN', message: 'That username is already taken' });
      return;
    }
    console.error('[auth] signup failed:', err);
    res.status(500).json({ error: 'SIGNUP_FAILED', message: 'Could not create the account' });
  }
});

authRouter.post('/login', async (req, res) => {
  if (!dbReady(res)) return;
  try {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');

    const doc = await UserModel.findOne({ username }).select('+passwordHash');
    // Identical response whether the user is missing or the password is wrong,
    // so this cannot be used to discover which usernames exist.
    const ok = doc ? await verifyPassword(password, String(doc.get('passwordHash'))) : false;
    if (!doc || !ok) {
      res.status(401).json({ error: 'BAD_CREDENTIALS', message: 'Wrong username or password' });
      return;
    }

    doc.set('lastLoginAt', new Date());
    await doc.save();

    const user = toPublicUser(doc.toObject());
    setSessionCookie(res, signToken({ sub: user.id, username: user.username }));
    res.json({ user });
  } catch (err) {
    console.error('[auth] login failed:', err);
    res.status(500).json({ error: 'LOGIN_FAILED', message: 'Could not sign in' });
  }
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }
  res.json({ user: req.user });
});

/** Username lookup for the squad builder. Auth required — the user directory is
 *  not public. Returns only what is needed to pick someone. */
authRouter.get('/users/search', requireAuth, async (req, res) => {
  if (!dbReady(res)) return;
  const q = String(req.query.q ?? '').trim().toLowerCase();
  if (q.length < 2) {
    res.json({ users: [] });
    return;
  }
  // Escape the query so a user cannot inject regex syntax.
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const docs = await UserModel.find({ username: { $regex: `^${safe}` } })
    .limit(10)
    .lean();
  res.json({ users: docs.map(toPublicUser) });
});

/** Exact-username lookup, for adding someone to a squad by handle. */
authRouter.get('/users/:username', requireAuth, async (req, res) => {
  if (!dbReady(res)) return;
  const doc = await UserModel.findOne({
    username: String(req.params.username).trim().toLowerCase(),
  }).lean();
  if (!doc) {
    res.status(404).json({ error: 'NO_SUCH_USER', message: 'No player with that username' });
    return;
  }
  res.json({ user: toPublicUser(doc) });
});
