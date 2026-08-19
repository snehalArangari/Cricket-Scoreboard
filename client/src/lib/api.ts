export interface CreateMatchInput {
  overs: number;
  teamAName: string;
  teamBName: string;
  teamAPlayers: string[];
  teamBPlayers: string[];
}

export interface CreateMatchResult {
  matchId: string;
  scorerToken: string;
}

export async function createMatchRequest(input: CreateMatchInput): Promise<CreateMatchResult> {
  const res = await fetch('/api/matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

// ---- Co-scorers (owner-only endpoints) ----

import type { ScorerSummary } from '@shared/types';

async function ownerFetch<T>(
  path: string,
  token: string | undefined,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-scorer-token': token } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function listScorers(matchId: string, token?: string): Promise<{ scorers: ScorerSummary[] }> {
  return ownerFetch(`/api/matches/${matchId}/scorers`, token);
}

export function inviteScorer(
  matchId: string,
  token: string | undefined,
  name: string,
): Promise<{ id: string; name: string; token: string }> {
  return ownerFetch(`/api/matches/${matchId}/scorers`, token, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function revokeScorer(
  matchId: string,
  token: string | undefined,
  scorerId: string,
): Promise<{ ok: boolean; scorers: ScorerSummary[] }> {
  return ownerFetch(`/api/matches/${matchId}/scorers/${scorerId}`, token, { method: 'DELETE' });
}

export function inviteUrl(matchId: string, token: string): string {
  // The token rides in the hash fragment, which browsers never send to the
  // server — so it stays out of access logs, proxies and Referer headers.
  return `${location.origin}/score/${matchId}#t=${token}`;
}

/**
 * Picks an invite token out of the URL, stores it for this match, and strips it
 * from the address bar so it is not left sitting in history or shoulder-surfed.
 */
export function consumeInviteToken(matchId: string): void {
  const hash = location.hash;
  if (!hash.startsWith('#t=')) return;
  const token = hash.slice(3).trim();
  if (!token) return;
  saveScorerToken(matchId, token);
  history.replaceState(null, '', location.pathname + location.search);
}

// ---- Scorer token storage ----
// Kept per match so one device can score several matches.

const tokenKey = (matchId: string) => `cricket:scorer:${matchId}`;

export function saveScorerToken(matchId: string, token: string): void {
  try {
    localStorage.setItem(tokenKey(matchId), token);
  } catch {
    /* private mode — the in-memory token still works for this session */
  }
}

export function loadScorerToken(matchId: string): string | undefined {
  try {
    return localStorage.getItem(tokenKey(matchId)) ?? undefined;
  } catch {
    return undefined;
  }
}
