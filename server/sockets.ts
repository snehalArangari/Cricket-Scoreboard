import type { Server, Socket } from 'socket.io';
import crypto from 'node:crypto';
import { MatchModel, applyCore, toCore, type MatchDoc } from './models/Match';
import { tokenFromCookieHeader, verifyToken } from './auth';
import {
  applyBall,
  deleteBallAt,
  deriveMatchState,
  editBallAt,
  startSecondInnings,
  undoLastBall,
} from '../shared/engine';
import type {
  Ball,
  BallAddPayload,
  BallDeletePayload,
  BallEditPayload,
  InningsKey,
  MatchCore,
  MatchState,
  ScorerRole,
  ScorerSummary,
  SimplePayload,
} from '../shared/types';

const VIEWER_EVENT_TAIL = 30;
const MAX_RECENT_OPS = 120;

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export class AppError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

/**
 * Resolves a token to a role. The creator's token grants 'owner' (score plus
 * invite); a live co-scorer token grants 'scorer' (score only); anything else,
 * including a revoked token, is a plain viewer.
 */
export function resolveRole(
  doc: { scorerTokenHash?: unknown; coScorers?: unknown },
  token: unknown,
): { role: ScorerRole; coScorerId: string | null } {
  if (typeof token !== 'string' || token.length === 0) {
    return { role: 'viewer', coScorerId: null };
  }
  const hash = hashToken(token);
  if (safeEqual(hash, String(doc.scorerTokenHash ?? ''))) {
    return { role: 'owner', coScorerId: null };
  }
  const list = Array.isArray(doc.coScorers) ? doc.coScorers : [];
  for (const co of list as any[]) {
    if (co?.revokedAt) continue;
    if (safeEqual(hash, String(co?.tokenHash ?? ''))) {
      return { role: 'scorer', coScorerId: String(co.id) };
    }
  }
  return { role: 'viewer', coScorerId: null };
}

export function canWrite(role: ScorerRole): boolean {
  return role === 'owner' || role === 'scorer';
}

// Which scorers are currently connected, per match. In-memory and therefore
// per-instance — accurate on the single instance the free tier gives us, and
// only ever used to decorate the owner's list.
const presence = new Map<string, Map<string, number>>();

function presenceKey(role: ScorerRole, coScorerId: string | null): string | null {
  if (role === 'owner') return 'owner';
  if (role === 'scorer' && coScorerId) return coScorerId;
  return null;
}

export function onlineScorerIds(matchId: string): string[] {
  return [...(presence.get(matchId)?.keys() ?? [])];
}

function addPresence(matchId: string, key: string) {
  const map = presence.get(matchId) ?? new Map<string, number>();
  map.set(key, (map.get(key) ?? 0) + 1);
  presence.set(matchId, map);
}

function dropPresence(matchId: string, key: string) {
  const map = presence.get(matchId);
  if (!map) return;
  const next = (map.get(key) ?? 1) - 1;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
  if (map.size === 0) presence.delete(matchId);
}

// ---- Per-match serialization ----
// Two writes landing concurrently would both read the same version and one
// would silently clobber the other. The same promise-chain idiom the original
// app used for its IndexedDB queue, applied to match documents.
const chains = new Map<string, Promise<unknown>>();

function withMatchLock<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(matchId) ?? Promise.resolve();
  const next = prev.then(fn, fn);

  // `settled` swallows the outcome so the chain continues after a rejected
  // operation. Everything internal must hang off THIS, not off `next`:
  // next.finally() returns a promise that rejects whenever next rejects, and
  // nothing was handling it — so every legitimately refused ball (an innings
  // already over, say) surfaced as an unhandled rejection.
  const settled: Promise<void> = next.then(
    () => {},
    () => {},
  );
  chains.set(matchId, settled);
  void settled.finally(() => {
    if (chains.get(matchId) === settled) chains.delete(matchId);
  });

  // The caller still gets the real promise, and still handles the error.
  return next;
}

// ---- Views ----

export function scorerView(core: MatchCore): MatchState {
  return deriveMatchState(core);
}

/** Viewers get complete, authoritative totals and cards but only the tail of the
 *  raw ball log — the part the UI actually renders. At 100 viewers this is the
 *  difference between ~6 KB and ~35 KB per broadcast. */
export function viewerView(core: MatchCore): MatchState {
  const full = deriveMatchState(core);
  return {
    ...full,
    innings1: { ...full.innings1, events: full.innings1.events.slice(-VIEWER_EVENT_TAIL) },
    innings2: { ...full.innings2, events: full.innings2.events.slice(-VIEWER_EVENT_TAIL) },
  };
}

function room(matchId: string): string {
  return `match:${matchId}`;
}

/** The co-scorer list as the owner sees it. Tokens are never included. */
export function scorerSummaries(doc: any, matchId: string): ScorerSummary[] {
  const online = new Set(onlineScorerIds(matchId));
  const list = Array.isArray(doc?.coScorers) ? doc.coScorers : [];
  return list.map((c: any) => ({
    id: String(c.id),
    name: String(c.name),
    revoked: Boolean(c.revokedAt),
    createdAt: new Date(c.createdAt ?? Date.now()).toISOString(),
    lastSeenAt: c.lastSeenAt ? new Date(c.lastSeenAt).toISOString() : null,
    online: online.has(String(c.id)),
  }));
}

/** Pushes the scorer list to owners only — nobody else may see it. */
async function notifyScorers(io: Server, matchId: string): Promise<void> {
  try {
    const doc = await MatchModel.findOne({ matchId }).lean();
    if (!doc) return;
    const scorers = scorerSummaries(doc, matchId);
    const ownerOnline = onlineScorerIds(matchId).includes('owner');
    const sockets = await io.in(room(matchId)).fetchSockets();
    for (const s of sockets) {
      if (s.data.role === 'owner') s.emit('match:scorers', { scorers, ownerOnline });
    }
  } catch {
    /* presence decoration only — never worth failing a connection over */
  }
}

/** Called from the REST layer after an invite or a revoke. */
export function broadcastScorers(io: Server, matchId: string): void {
  void notifyScorers(io, matchId);
}

/** Force-disconnects sockets whose co-scorer access has just been revoked. */
export async function kickRevoked(io: Server, matchId: string, coScorerId: string): Promise<void> {
  const sockets = await io.in(room(matchId)).fetchSockets();
  for (const s of sockets) {
    if (s.data.coScorerId === coScorerId) {
      s.emit('match:error', { code: 'REVOKED', message: 'Your scoring access was removed' });
      s.disconnect(true);
    }
  }
}

/** Full authoritative state to everyone in the room — never a delta, because an
 *  edit, delete or undo can make the score go DOWN and a delta cannot say that.
 *  Scorers get the whole ball log; viewers get the tail plus complete cards. */
async function broadcast(io: Server, core: MatchCore): Promise<void> {
  const viewer = viewerView(core);
  const scorer = scorerView(core);
  const sockets = await io.in(room(core.matchId)).fetchSockets();
  for (const socket of sockets) {
    socket.emit('match:state', canWrite(socket.data.role) ? scorer : viewer);
  }
}

// ---- Handlers ----

type Mutator = (core: MatchCore, payload: any) => MatchCore;

const opBallAdd: Mutator = (core, p: BallAddPayload) => {
  const ball = sanitizeBall(p?.ball);
  if (!ball) throw new AppError('BAD_BALL', 'Malformed ball');
  const next = applyBall(core, ball);
  if (next === core) {
    // Either a replay (fine) or the innings is closed (not fine).
    const known = [...core.innings1.events, ...core.innings2.events].some((b) => b.id === ball.id);
    if (!known) throw new AppError('INNINGS_OVER', 'That innings is already over');
  }
  return next;
};

const opBallEdit: Mutator = (core, p: BallEditPayload) => {
  const ball = sanitizeBall(p?.ball);
  if (!ball) throw new AppError('BAD_BALL', 'Malformed ball');
  const key = normalizeKey(p?.inningsKey);
  return editBallAt(core, key, Number(p?.index), ball);
};

const opBallDelete: Mutator = (core, p: BallDeletePayload) => {
  const key = normalizeKey(p?.inningsKey);
  return deleteBallAt(core, key, Number(p?.index));
};

const opUndo: Mutator = (core) => {
  const next = undoLastBall(core);
  if (next === core) throw new AppError('NOTHING_TO_UNDO', 'Nothing left to undo');
  return next;
};

const opStart2: Mutator = (core) => {
  const next = startSecondInnings(core);
  if (next === core) throw new AppError('BAD_STATE', 'The first innings is not finished');
  return next;
};

function normalizeKey(key: unknown): InningsKey {
  return key === 'innings2' ? 'innings2' : 'innings1';
}

/** Never trust a client payload — the ball is what drives every derived total. */
function sanitizeBall(raw: any): Ball | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) return null;
  const delivery = raw.delivery;
  if (!['NORMAL', 'WIDE', 'NO_BALL', 'DEAD_BALL'].includes(delivery)) return null;
  const batRuns = Number(raw.batRuns);
  if (!Number.isInteger(batRuns) || batRuns < 0 || batRuns > 12) return null;

  let wicket: Ball['wicket'] = null;
  if (raw.wicket && typeof raw.wicket === 'object') {
    if (typeof raw.wicket.outBatterId !== 'string') return null;
    wicket = {
      outBatterId: raw.wicket.outBatterId,
      creditBowler: Boolean(raw.wicket.creditBowler),
    };
  }

  return {
    id: raw.id,
    delivery,
    batRuns,
    strikerId: String(raw.strikerId ?? ''),
    nonStrikerId: String(raw.nonStrikerId ?? ''),
    bowlerId: String(raw.bowlerId ?? ''),
    wicket,
  };
}

export function registerSocketHandlers(io: Server): void {
  // Auth in the HANDSHAKE, not in a join event. Socket.IO replays `auth` on every
  // reconnect and flushes its send buffer the instant `connect` fires — if auth
  // were a separate event, buffered balls would race ahead of it and be rejected.
  io.use(async (socket, next) => {
    try {
      const auth = (socket.handshake.auth ?? {}) as { matchId?: string; scorerToken?: string };
      const matchId = typeof auth.matchId === 'string' ? auth.matchId.trim() : '';
      if (!matchId) return next(new Error('NO_MATCH_ID'));

      // Watching requires an account too, so the session cookie sent with the
      // handshake must be valid before anything else is considered.
      const session = verifyToken(tokenFromCookieHeader(socket.handshake.headers.cookie) ?? '');
      if (!session) return next(new Error('UNAUTHENTICATED'));

      const doc = await MatchModel.findOne({ matchId }).lean();
      if (!doc) return next(new Error('MATCH_NOT_FOUND'));

      const { role, coScorerId } = resolveRole(doc, auth.scorerToken);
      socket.data.matchId = matchId;
      socket.data.role = role;
      socket.data.coScorerId = coScorerId;
      socket.data.userId = session.sub;
      socket.data.username = session.username;
      next();
    } catch (err) {
      next(new Error('AUTH_FAILED'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const matchId: string = socket.data.matchId;
    const role: ScorerRole = socket.data.role;
    const coScorerId: string | null = socket.data.coScorerId;
    socket.join(room(matchId));

    const pKey = presenceKey(role, coScorerId);
    if (pKey) {
      addPresence(matchId, pKey);
      void notifyScorers(io, matchId);
      socket.on('disconnect', () => {
        dropPresence(matchId, pKey);
        void notifyScorers(io, matchId);
      });
      if (coScorerId) {
        void MatchModel.updateOne(
          { matchId, 'coScorers.id': coScorerId },
          { $set: { 'coScorers.$.lastSeenAt': new Date() } },
        ).catch(() => {});
      }
    }

    socket.emit('match:role', { role });

    const write =
      (mutate: Mutator) =>
      async (payload: any, ack?: (r: unknown) => void) => {
        if (!canWrite(role)) {
          ack?.({ ok: false, code: 'FORBIDDEN' });
          socket.emit('match:error', { code: 'FORBIDDEN', message: 'Read-only viewer' });
          return;
        }
        try {
          const core = await withMatchLock(matchId, async () => {
            const doc = (await MatchModel.findOne({ matchId })) as MatchDoc | null;
            if (!doc) throw new AppError('MATCH_NOT_FOUND');

            const opId = typeof payload?.opId === 'string' ? payload.opId : null;
            const recent: string[] = (doc.get('recentOpIds') as string[]) ?? [];
            if (opId && recent.includes(opId)) {
              // An exact replay from the offline outbox. Re-broadcast, change nothing.
              return toCore(doc);
            }

            const before = toCore(doc);
            const after = mutate(before, payload);
            if (after === before) return before;

            applyCore(doc, { ...after, version: before.version + 1 });
            if (opId) {
              const nextRecent = [...recent, opId].slice(-MAX_RECENT_OPS);
              doc.set('recentOpIds', nextRecent);
            }
            await doc.save();
            return toCore(doc);
          });

          // Broadcast BEFORE acking. The client drops an operation from its
          // pending outbox when the ack arrives, so if the ack landed first the
          // UI would briefly fall back to the pre-operation state — a visible
          // flicker, and around the innings break it flips the derived innings
          // long enough to wipe the scorer's on-field selections.
          // Both packets travel the same socket, so this ordering holds.
          await broadcast(io, core);
          ack?.({ ok: true, version: core.version });
        } catch (err) {
          const code = err instanceof AppError ? err.code : 'SERVER_ERROR';
          const message = err instanceof Error ? err.message : 'Unexpected error';
          ack?.({ ok: false, code, message });
          socket.emit('match:error', { code, message });
          if (!(err instanceof AppError)) console.error('[socket] write failed:', err);
        }
      };

    socket.on('ball:add', write(opBallAdd));
    socket.on('ball:edit', write(opBallEdit));
    socket.on('ball:delete', write(opBallDelete));
    socket.on('match:undo', write(opUndo));
    socket.on('innings:start2', write(opStart2));

    socket.on('match:resync', async (_p: SimplePayload, ack?: (r: unknown) => void) => {
      const doc = (await MatchModel.findOne({ matchId })) as MatchDoc | null;
      if (!doc) return ack?.({ ok: false, code: 'MATCH_NOT_FOUND' });
      const core = toCore(doc);
      socket.emit('match:state', canWrite(role) ? scorerView(core) : viewerView(core));
      ack?.({ ok: true, version: core.version });
    });

    // Sending the opening state is deliberately the LAST thing, and everything
    // above it is synchronous.
    //
    // Socket.IO drops an event that arrives before its handler exists — it does
    // not queue. Loading the match first meant a client emitting the instant
    // 'connect' fired raced a database round trip, and anything sent inside that
    // window vanished with no ack and no error. A scorer tapping a run the
    // moment the page connects would simply lose the ball.
    //
    // A viewer joining mid-innings, joining after the match ended, and a scorer
    // reconnecting all still take this one path.
    try {
      const doc = await MatchModel.findOne({ matchId });
      if (doc) {
        const core = toCore(doc as MatchDoc);
        socket.emit('match:state', canWrite(role) ? scorerView(core) : viewerView(core));
      }
    } catch {
      socket.emit('match:error', { code: 'LOAD_FAILED', message: 'Could not load the match' });
    }
  });
}
