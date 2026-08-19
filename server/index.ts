import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import { connectDb, isDbConnected } from './db';
import { MatchModel, toCore, type MatchDoc } from './models/Match';
import { hashToken, registerSocketHandlers, scorerView, viewerView } from './sockets';
import { createMatch, validateSetup } from '../shared/engine';

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

// ---- API (registered BEFORE the static handler and the SPA fallback) ----

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: isDbConnected(), time: new Date().toISOString() });
});

function requireDb(res: express.Response): boolean {
  if (isDbConnected()) return true;
  res.status(503).json({ error: 'DB_UNAVAILABLE', message: 'Database is not connected yet' });
  return false;
}

app.post('/api/matches', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const body = req.body ?? {};
    const setup = validateSetup({
      overs: Number(body.overs),
      teamAName: String(body.teamAName ?? ''),
      teamBName: String(body.teamBName ?? ''),
      teamAPlayers: Array.isArray(body.teamAPlayers) ? body.teamAPlayers.map(String) : [],
      teamBPlayers: Array.isArray(body.teamBPlayers) ? body.teamBPlayers.map(String) : [],
    });

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
    });

    // The token is returned exactly once, here, and never leaves the server again.
    res.status(201).json({ matchId, scorerToken });
  } catch (err) {
    console.error('[api] create match failed:', err);
    res.status(500).json({ error: 'CREATE_FAILED', message: 'Could not create the match' });
  }
});

app.get('/api/matches/:matchId', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const doc = (await MatchModel.findOne({ matchId: req.params.matchId })) as MatchDoc | null;
    if (!doc) {
      res.status(404).json({ error: 'MATCH_NOT_FOUND' });
      return;
    }
    const core = toCore(doc);
    const token = req.get('x-scorer-token');
    const isScorer =
      typeof token === 'string' &&
      token.length > 0 &&
      hashToken(token) === String(doc.get('scorerTokenHash'));
    res.json(isScorer ? scorerView(core) : viewerView(core));
  } catch (err) {
    console.error('[api] fetch match failed:', err);
    res.status(500).json({ error: 'FETCH_FAILED' });
  }
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

async function start(): Promise<void> {
  if (!MONGODB_URI) {
    console.warn('[server] MONGODB_URI is not set — the API will return 503 until it is.');
  } else {
    try {
      await connectDb(MONGODB_URI);
    } catch (err) {
      // Serve the app anyway so the failure is visible in the UI rather than
      // being a process that refuses to boot.
      console.error('[server] MongoDB connection failed:', (err as Error).message);
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] client build: ${hasBuild ? CLIENT_DIST : 'not built (dev mode)'}`);
  });
}

void start();
