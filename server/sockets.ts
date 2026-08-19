import type { Server, Socket } from 'socket.io';
import crypto from 'node:crypto';
import { MatchModel, applyCore, toCore, type MatchDoc } from './models/Match';
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

// ---- Per-match serialization ----
// Two writes landing concurrently would both read the same version and one
// would silently clobber the other. The same promise-chain idiom the original
// app used for its IndexedDB queue, applied to match documents.
const chains = new Map<string, Promise<unknown>>();

function withMatchLock<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(matchId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(
    matchId,
    next.then(
      () => {},
      () => {},
    ),
  );
  void next.finally(() => {
    if (chains.get(matchId) === next) chains.delete(matchId);
  });
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

/** Full authoritative state to everyone in the room — never a delta, because an
 *  edit, delete or undo can make the score go DOWN and a delta cannot say that.
 *  Scorers get the whole ball log; viewers get the tail plus complete cards. */
async function broadcast(io: Server, core: MatchCore): Promise<void> {
  const viewer = viewerView(core);
  const scorer = scorerView(core);
  const sockets = await io.in(room(core.matchId)).fetchSockets();
  for (const socket of sockets) {
    socket.emit('match:state', socket.data.role === 'scorer' ? scorer : viewer);
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

      const doc = await MatchModel.findOne({ matchId }).lean();
      if (!doc) return next(new Error('MATCH_NOT_FOUND'));

      socket.data.matchId = matchId;
      socket.data.role =
        typeof auth.scorerToken === 'string' &&
        auth.scorerToken.length > 0 &&
        safeEqual(hashToken(auth.scorerToken), String(doc.scorerTokenHash))
          ? 'scorer'
          : 'viewer';
      next();
    } catch (err) {
      next(new Error('AUTH_FAILED'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const matchId: string = socket.data.matchId;
    const role: string = socket.data.role;
    socket.join(room(matchId));

    // A viewer joining mid-innings, joining after the match ended, or a scorer
    // reconnecting all take this one path — there is no separate catch-up code.
    try {
      const doc = await MatchModel.findOne({ matchId });
      if (doc) {
        const core = toCore(doc as MatchDoc);
        socket.emit('match:state', role === 'scorer' ? scorerView(core) : viewerView(core));
      }
    } catch {
      socket.emit('match:error', { code: 'LOAD_FAILED', message: 'Could not load the match' });
    }

    socket.emit('match:role', { role });

    const write =
      (mutate: Mutator) =>
      async (payload: any, ack?: (r: unknown) => void) => {
        if (role !== 'scorer') {
          const res = { ok: false, code: 'FORBIDDEN' };
          ack?.(res);
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

          ack?.({ ok: true, version: core.version });
          await broadcast(io, core);
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
      socket.emit('match:state', role === 'scorer' ? scorerView(core) : viewerView(core));
      ack?.({ ok: true, version: core.version });
    });
  });
}
