export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The session lives in an httpOnly cookie, so every call must send it.
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function signup(input: {
  username: string;
  displayName: string;
  password: string;
}): Promise<{ user: PublicUser }> {
  return post('/api/auth/signup', input);
}

export function login(input: { username: string; password: string }): Promise<{ user: PublicUser }> {
  return post('/api/auth/login', input);
}

export function logout(): Promise<{ ok: boolean }> {
  return post('/api/auth/logout', {});
}

/** Resolves to null when there is no valid session — not an error. */
export async function fetchMe(): Promise<PublicUser | null> {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (res.status === 401) return null;
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return (data.user as PublicUser) ?? null;
}

export async function searchUsers(q: string): Promise<PublicUser[]> {
  if (q.trim().length < 2) return [];
  const res = await fetch(`/api/auth/users/search?q=${encodeURIComponent(q.trim())}`, {
    credentials: 'same-origin',
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return (data.users as PublicUser[]) ?? [];
}

export async function lookupUser(username: string): Promise<PublicUser | null> {
  const res = await fetch(`/api/auth/users/${encodeURIComponent(username.trim().toLowerCase())}`, {
    credentials: 'same-origin',
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return (data.user as PublicUser) ?? null;
}
