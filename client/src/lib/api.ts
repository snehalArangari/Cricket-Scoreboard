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
