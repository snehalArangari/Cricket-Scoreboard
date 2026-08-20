import type { LeaderRow, Standing, TournamentTeam } from '@shared/tournament';

export interface TournamentSummary {
  tournamentId: string;
  name: string;
  teams: TournamentTeam[];
  createdAt?: string;
}

export interface TournamentDetail {
  tournamentId: string;
  name: string;
  isOwner: boolean;
  teams: TournamentTeam[];
  points: { win: number; tie: number; loss: number };
  standings: Standing[];
  leaderboards: { batting: LeaderRow[]; bowling: LeaderRow[] };
  matches: Array<{
    matchId: string;
    teamAId: string;
    teamBId: string;
    status: string;
    resultText: string | null;
    teamAName: string;
    teamBName: string;
    innings1: { runs: number; wickets: number; legalBalls: number };
    innings2: { runs: number; wickets: number; legalBalls: number };
  }>;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).message ?? (body as any).error ?? `Failed (${res.status})`);
  return body as T;
}

export function listTournaments(): Promise<{ tournaments: TournamentSummary[] }> {
  return call('/api/tournaments');
}

export function createTournament(name: string, teams: string[]): Promise<TournamentSummary> {
  return call('/api/tournaments', { method: 'POST', body: JSON.stringify({ name, teams }) });
}

export function getTournament(id: string): Promise<TournamentDetail> {
  return call(`/api/tournaments/${encodeURIComponent(id)}`);
}

export function addTeam(id: string, name: string): Promise<{ teams: TournamentTeam[] }> {
  return call(`/api/tournaments/${encodeURIComponent(id)}/teams`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function removeTeam(id: string, teamId: string): Promise<{ teams: TournamentTeam[] }> {
  return call(`/api/tournaments/${encodeURIComponent(id)}/teams/${encodeURIComponent(teamId)}`, {
    method: 'DELETE',
  });
}
