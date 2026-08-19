import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyBall,
  deleteBallAt,
  deriveMatchState,
  editBallAt,
  startSecondInnings,
  undoLastBall,
} from '@shared/engine';
import type {
  Ball,
  InningsKey,
  MatchCore,
  MatchState,
  ScorerRole,
  ScorerSummary,
} from '@shared/types';
import { getSocket } from '../lib/socket';
import { idbLoad, idbSave } from '../lib/idb';
import { uid } from '../lib/uid';

export type PendingOp =
  | { kind: 'add'; opId: string; ball: Ball }
  | { kind: 'edit'; opId: string; inningsKey: InningsKey; index: number; ball: Ball }
  | { kind: 'delete'; opId: string; inningsKey: InningsKey; index: number }
  | { kind: 'undo'; opId: string }
  | { kind: 'start2'; opId: string };

export type ConnState = 'connecting' | 'online' | 'offline';

interface Cached {
  serverState: MatchState;
  outbox: PendingOp[];
}

/** A broadcast carries everything needed to rebuild the core the engine wants. */
function coreFromState(s: MatchState): MatchCore {
  return {
    matchId: s.matchId,
    setup: s.setup,
    innings1: { events: s.innings1.events },
    innings2: { events: s.innings2.events },
    innings2Started: s.innings2Started,
    status: s.status,
    winner: s.winner,
    resultText: s.resultText,
    version: s.version,
  };
}

function replay(core: MatchCore, ops: PendingOp[]): MatchCore {
  let c = core;
  for (const op of ops) {
    switch (op.kind) {
      case 'add':
        c = applyBall(c, op.ball);
        break;
      case 'edit':
        c = editBallAt(c, op.inningsKey, op.index, op.ball);
        break;
      case 'delete':
        c = deleteBallAt(c, op.inningsKey, op.index);
        break;
      case 'undo':
        c = undoLastBall(c);
        break;
      case 'start2':
        c = startSecondInnings(c);
        break;
    }
  }
  return c;
}

function emitFor(op: PendingOp, matchId: string): { event: string; payload: unknown } {
  switch (op.kind) {
    case 'add':
      return { event: 'ball:add', payload: { matchId, opId: op.opId, ball: op.ball } };
    case 'edit':
      return {
        event: 'ball:edit',
        payload: { matchId, opId: op.opId, inningsKey: op.inningsKey, index: op.index, ball: op.ball },
      };
    case 'delete':
      return {
        event: 'ball:delete',
        payload: { matchId, opId: op.opId, inningsKey: op.inningsKey, index: op.index },
      };
    case 'undo':
      return { event: 'match:undo', payload: { matchId, opId: op.opId } };
    case 'start2':
      return { event: 'innings:start2', payload: { matchId, opId: op.opId } };
  }
}

/**
 * The reconciliation rule, and the only one:
 *
 *     displayed state = server state + locally replayed pending ops
 *
 * The local view is never mutated independently, so it is recomputed from
 * scratch on every change. Divergence from the server is therefore structurally
 * impossible rather than merely unlikely.
 */
export function useMatch(matchId: string, scorerToken?: string) {
  const [serverState, setServerState] = useState<MatchState | null>(null);
  const [outbox, setOutbox] = useState<PendingOp[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [role, setRole] = useState<ScorerRole>('viewer');
  const [scorers, setScorers] = useState<ScorerSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const versionRef = useRef(-1);
  const cacheKey = `match:${matchId}`;

  // Paint from the local cache immediately, before the socket is up.
  useEffect(() => {
    let alive = true;
    void idbLoad<Cached>(cacheKey).then((cached) => {
      if (!alive || !cached) {
        if (alive) setHydrated(true);
        return;
      }
      if (cached.serverState && cached.serverState.version > versionRef.current) {
        versionRef.current = cached.serverState.version;
        setServerState(cached.serverState);
        setOutbox(cached.outbox ?? []);
      }
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [cacheKey]);

  useEffect(() => {
    const socket = getSocket(matchId, scorerToken);

    const onState = (payload: MatchState) => {
      // Drop stale or out-of-order broadcasts outright.
      if (payload.version <= versionRef.current) return;
      versionRef.current = payload.version;
      setServerState(payload);

      // Convergence that does not depend on acks arriving: any queued ball the
      // server has already recorded is done, however it got there.
      setOutbox((prev) =>
        prev.filter((op) => {
          if (op.kind !== 'add') return true;
          const known =
            payload.innings1.events.some((b) => b.id === op.ball.id) ||
            payload.innings2.events.some((b) => b.id === op.ball.id);
          return !known;
        }),
      );
    };

    const onConnect = () => {
      setConn('online');
      setFatal(null);
    };
    const onDisconnect = () => setConn('offline');
    const onConnectError = (err: Error) => {
      setConn('offline');
      if (err.message === 'MATCH_NOT_FOUND') setFatal('MATCH_NOT_FOUND');
      else if (err.message === 'NO_MATCH_ID') setFatal('NO_MATCH_ID');
    };
    const onRole = (payload: { role: ScorerRole }) => setRole(payload.role);
    const onScorers = (payload: { scorers: ScorerSummary[] }) => setScorers(payload.scorers ?? []);
    const onError = (payload: { code: string; message: string }) => {
      setNotice(payload.message);
      // Access withdrawn mid-match: drop to viewer rather than leaving dead
      // buttons that silently fail.
      if (payload.code === 'REVOKED') setRole('viewer');
    };

    socket.on('match:state', onState);
    socket.on('match:role', onRole);
    socket.on('match:scorers', onScorers);
    socket.on('match:error', onError);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    if (socket.connected) setConn('online');

    return () => {
      socket.off('match:state', onState);
      socket.off('match:role', onRole);
      socket.off('match:scorers', onScorers);
      socket.off('match:error', onError);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      // Deliberately NOT socket.disconnect() — the socket is module-scoped and
      // outlives this component, so tearing it down here would kill it on every
      // StrictMode remount.
    };
  }, [matchId, scorerToken]);

  const state = useMemo(() => {
    if (!serverState) return null;
    if (outbox.length === 0) return serverState;
    return deriveMatchState(replay(coreFromState(serverState), outbox));
  }, [serverState, outbox]);

  // Cache after every settled change.
  useEffect(() => {
    if (!serverState) return;
    void idbSave(cacheKey, { serverState, outbox } satisfies Cached);
  }, [cacheKey, serverState, outbox]);

  const send = useCallback(
    (op: PendingOp) => {
      setOutbox((prev) => [...prev, op]);
      const socket = getSocket(matchId, scorerToken);
      const { event, payload } = emitFor(op, matchId);
      // While offline this is buffered by socket.io and flushed on reconnect —
      // after handshake auth, so it can never arrive unauthenticated.
      socket.emit(event, payload, (ack: { ok: boolean; message?: string } | undefined) => {
        setOutbox((prev) => prev.filter((o) => o.opId !== op.opId));
        if (ack && !ack.ok) setNotice(ack.message ?? 'That action was rejected');
      });
    },
    [matchId, scorerToken],
  );

  const addBall = useCallback((ball: Omit<Ball, 'id'>) => {
    send({ kind: 'add', opId: uid(), ball: { ...ball, id: uid() } });
  }, [send]);

  const editBall = useCallback(
    (inningsKey: InningsKey, index: number, ball: Ball) => {
      send({ kind: 'edit', opId: uid(), inningsKey, index, ball });
    },
    [send],
  );

  const deleteBall = useCallback(
    (inningsKey: InningsKey, index: number) => {
      send({ kind: 'delete', opId: uid(), inningsKey, index });
    },
    [send],
  );

  const undo = useCallback(() => send({ kind: 'undo', opId: uid() }), [send]);
  const startInnings2 = useCallback(() => send({ kind: 'start2', opId: uid() }), [send]);

  return {
    state,
    role,
    /** Owners and invited co-scorers may both write; viewers may not. */
    mayScore: role === 'owner' || role === 'scorer',
    isOwner: role === 'owner',
    scorers,
    setScorers,
    conn,
    notice,
    fatal,
    hydrated,
    pending: outbox.length,
    dismissNotice: () => setNotice(null),
    addBall,
    editBall,
    deleteBall,
    undo,
    startInnings2,
  };
}
