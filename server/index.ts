import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import { dbLastError, dbState, isDbConnected, startDb } from './db';
import { MatchModel, toCore, type MatchDoc } from './models/Match';
import {
  broadcastScorers,
  hashToken,
  kickRevoked,
  registerSocketHandlers,
  resolveRole,
  scorerSummaries,
  scorerView,
  viewerView,
} from './sockets';
import { createMatch, validateSetup } from '../shared/engine';
import { attachUser, requireAuth } from './auth';
import { authRouter } from './routes/authRoutes';
import { UserModel } from './models/User';
import { registeredCount } from '../shared/engine';

// Node's built-in .env loader — no dotenv dependency. Absent file is fine.
try {
  process.loadEnvFile(path.resolve(process.cwd(), '.env'));
} catch {
  /* no .env — real environment variables are being used instead */
}

// __dirname does not exist in ESM; this is the equivalent.
const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(here, '..', 'client', 'dist');

const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI ?? '';

// Unambiguous alphabet — no 0/O/1/I/L, because these get read aloud and typed in.
const ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function shortId(length = 6): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
// Attaches req.user when a session cookie is present. Never rejects on its own —
// routes opt into requireAuth so /api/health stays reachable for monitoring.
app.use(attachUser);

// ---- API (registered BEFORE the static handler and the SPA fallback) ----

// Reports enough to diagnose a deployment without shell access — in particular
// whether MONGODB_URI reached the process at all, which separates "env var not
// set" from "set but the database is refusing us". The URI itself is never
// echoed, only whether it exists.
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    db: isDbConnected(),
    dbState: dbState(),
    uriConfigured: Boolean(MONGODB_URI),
    dbError: dbLastError(),
    time: new Date().toISOString(),
  });
});

function requireDb(res: express.Response): boolean {
  if (isDbConnected()) return true;
  res.status(503).json({ error: 'DB_UNAVAILABLE', message: 'Database is not connected yet' });
  return false;
}

app.use('/api/auth', authRouter);

/** Bulk-resolves claimed usernames to real accounts. Unknown handles are simply
 *  dropped, so an unrecognised name becomes a guest rather than an error. */
async function resolveSquads(
  entries: unknown[],
): Promise<Map<string, { id: string; username: string; displayName: string }>> {
  const handles = new Set<string>();
  for (const raw of entries) {
    if (typeof raw === 'string' || !raw) continue;
    const handle = String((raw as any).username ?? '').trim().toLowerCase();
    if (handle) handles.add(handle);
  }
  const out = new Map<string, { id: string; username: string; displayName: string }>();
  if (handles.size === 0) return out;
  const docs = await UserModel.find({ username: { $in: [...handles] } }).lean();
  for (const d of docs) {
    out.set(String(d.username), {
      id: String(d._id),
      username: String(d.username),
      displayName: String(d.displayName),
    });
  }
  return out;
}

app.post('/api/matches', requireAuth, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const body = req.body ?? {};
    const rawA = Array.isArray(body.teamAPlayers) ? body.teamAPlayers : [];
    const rawB = Array.isArray(body.teamBPlayers) ? body.teamBPlayers : [];

    // Resolve every claimed username against the database HERE. A client could
    // otherwise post any userId it liked and quietly attach a stranger's account
    // — and therefore their career stats — to a match they never played.
    const resolved = await resolveSquads([...rawA, ...rawB]);
    const attach = (entries: unknown[]) =>
      entries.map((raw) => {
        const entry = typeof raw === 'string' ? { name: raw } : (raw as any);
        const handle = String(entry?.username ?? '').trim().toLowerCase();
        const hit = handle ? resolved.get(handle) : undefined;
        return {
          name: String(entry?.name ?? hit?.displayName ?? ''),
          username: hit ? hit.username : null,
          userId: hit ? hit.id : null,
        };
      });

    const setup = validateSetup({
      overs: Number(body.overs),
      teamAName: String(body.teamAName ?? ''),
      teamBName: String(body.teamBName ?? ''),
      teamAPlayers: attach(rawA),
      teamBPlayers: attach(rawB),
      tossWinner: body.tossWinner === 'A' || body.tossWinner === 'B' ? body.tossWinner : null,
      tossDecision:
        body.tossDecision === 'BAT' || body.tossDecision === 'BOWL' ? body.tossDecision : null,
    });

    // At least one registered player per side, so every match is anchored to
    // real accounts and its stats have somewhere to land.
    if (registeredCount(setup.teamA) < 1 || registeredCount(setup.teamB) < 1) {
      res.status(400).json({
        error: 'NEED_REGISTERED_PLAYER',
        message: 'Each team needs at least one registered player — add someone by username',
      });
      return;
    }

    // Retry on the astronomically unlikely id collision rather than 500.
    let matchId = shortId();
    for (let i = 0; i < 5; i++) {
      if (!(await MatchModel.exists({ matchId }))) break;
      matchId = shortId();
    }

    const scorerToken = crypto.randomBytes(24).toString('base64url');
    const core = createMatch(matchId, setup);

    await MatchModel.create({
      ...core,
      scorerTokenHash: hashToken(scorerToken),
      ownerUserId: req.user!.id,
    });

    // The token is returned exactly once, here, and never leaves the server again.
    res.status(201).json({ matchId, scorerToken });
  } catch (err) {
    console.error('[api] create match failed:', err);
    res.status(500).json({ error: 'CREATE_FAILED', message: 'Could not create the match' });
  }
});

app.get('/api/matches/:matchId', requireAuth, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const doc = (await MatchModel.findOne({ matchId: req.params.matchId })) as MatchDoc | null;
    if (!doc) {
      res.status(404).json({ error: 'MATCH_NOT_FOUND' });
      return;
    }
    const core = toCore(doc);
    // Invited co-scorers get the full ball log, same as the creator.
    const { role } = resolveRole(doc.toObject(), req.get('x-scorer-token'));
    res.json(role === 'viewer' ? viewerView(core) : scorerView(core));
  } catch (err) {
    console.error('[api] fetch match failed:', err);
    res.status(500).json({ error: 'FETCH_FAILED' });
  }
});

// ---- Co-scorers. Every route here is owner-only. ----

/** Loads the match and rejects unless the caller holds the CREATOR's token. */
async function requireOwner(
  req: express.Request,
  res: express.Response,
): Promise<MatchDoc | null> {
  if (!requireDb(res)) return null;
  const doc = (await MatchModel.findOne({ matchId: req.params.matchId })) as MatchDoc | null;
  if (!doc) {
    res.status(404).json({ error: 'MATCH_NOT_FOUND' });
    return null;
  }
  const { role } = resolveRole(doc.toObject(), req.get('x-scorer-token'));
  if (role !== 'owner') {
    // Deliberately the same response whether the caller is an invited scorer or
    // a stranger — only the creator gets to know anything about this list.
    res.status(403).json({ error: 'OWNER_ONLY', message: 'Only the match creator can do this' });
    return null;
  }
  return doc;
}

app.get('/api/matches/:matchId/scorers', async (req, res) => {
  const doc = await requireOwner(req, res);
  if (!doc) return;
  res.json({ scorers: scorerSummaries(doc.toObject(), doc.get('matchId')) });
});

app.post('/api/matches/:matchId/scorers', async (req, res) => {
  const doc = await requireOwner(req, res);
  if (!doc) return;

  const name = String(req.body?.name ?? '').trim().slice(0, 40);
  if (!name) {
    res.status(400).json({ error: 'NAME_REQUIRED', message: 'Give this person a name' });
    return;
  }
  const existing = (doc.get('coScorers') as any[]) ?? [];
  if (existing.filter((c) => !c.revokedAt).length >= 10) {
    res.status(400).json({ error: 'TOO_MANY', message: 'Up to 10 co-scorers at a time' });
    return;
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const id = shortId(8);
  existing.push({ id, name, tokenHash: hashToken(token), createdAt: new Date(), revokedAt: null });
  doc.set('coScorers', existing);
  await doc.save();

  broadcastScorers(io, doc.get('matchId'));
  // The token is returned exactly once. It is stored only as a hash, so it can
  // never be shown again — if the link is lost, revoke and re-invite.
  res.status(201).json({ id, name, token });
});

app.delete('/api/matches/:matchId/scorers/:scorerId', async (req, res) => {
  const doc = await requireOwner(req, res);
  if (!doc) return;

  const list = ((doc.get('coScorers') as any[]) ?? []).map((c) =>
    c.id === req.params.scorerId && !c.revokedAt ? { ...c, revokedAt: new Date() } : c,
  );
  doc.set('coScorers', list);
  await doc.save();

  await kickRevoked(io, doc.get('matchId'), req.params.scorerId);
  broadcastScorers(io, doc.get('matchId'));
  res.json({ ok: true, scorers: scorerSummaries(doc.toObject(), doc.get('matchId')) });
});

// ---- Static SPA ----
// index:false so express.static never short-circuits "/" ahead of the fallback.
const hasBuild = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));
if (hasBuild) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
}

// SPA fallback, LAST. Deliberately app.use() with no path rather than
// app.get('*') — the wildcard form throws at boot on Express 5's path-to-regexp,
// while this form behaves identically on Express 4 and 5.
app.use((req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  if (!hasBuild) {
    res
      .status(503)
      .type('text/plain')
      .send('Client bundle not built yet. Run `npm run build`, or use the Vite dev server.');
    return;
  }
  res.sendFile(path.join(CLIENT_DIST, 'index.html'));
});

const server = http.createServer(app);

// No CORS block at all — the client is served from this same origin in
// production, and proxied through Vite in development.
const io = new Server(server, {
  pingInterval: 20000,
  pingTimeout: 25000,
  maxHttpBufferSize: 2e5,
});

registerSocketHandlers(io);

// A database problem must never stop the web server from coming up — otherwise
// the only symptom is a container that will not boot, with nothing to inspect.
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection:', reason);
});

if (!MONGODB_URI) {
  console.warn('[server] MONGODB_URI is not set — the API will return 503 until it is.');
} else {
  startDb(MONGODB_URI); // connects in the background and retries
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on port ${PORT}`);
  console.log(`[server] client build: ${hasBuild ? CLIENT_DIST : 'not built (dev mode)'}`);
});
