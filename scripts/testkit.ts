// Shared helpers for the end-to-end suites.
//
// Node's fetch has no cookie jar, and the session is an httpOnly cookie, so
// every suite needs to capture Set-Cookie and send it back. Doing that once here
// keeps the suites about behaviour rather than plumbing.

export const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3100';

export class Session {
  private cookies = new Map<string, string>();

  get cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  capture(res: Response): void {
    // getSetCookie() keeps multiple Set-Cookie headers separate; a plain get()
    // would join them and mangle any cookie containing a comma.
    const raw = (res.headers as any).getSetCookie?.() ?? [];
    for (const line of raw as string[]) {
      const pair = line.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '' || /Expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };
    const jar = this.cookieHeader;
    if (jar) headers.Cookie = jar;
    const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
    this.capture(res);
    return res;
  }

  json<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    return this.fetch(path, init).then((r) => r.json() as Promise<T>);
  }

  clear(): void {
    this.cookies.clear();
  }
}

let userSeq = 0;

/** Creates and signs in a throwaway account, returning its live session. */
export async function signedInUser(prefix = 'e2e'): Promise<{
  session: Session;
  username: string;
  password: string;
  user: { id: string; username: string; displayName: string };
}> {
  const session = new Session();
  // Unique per run so repeated runs never collide on the username index.
  const username = `${prefix}${Date.now().toString(36)}${userSeq++}`.toLowerCase().slice(0, 20);
  const password = 'test-password-123';
  const res = await session.fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ username, displayName: `Test ${username}`, password }),
  });
  if (res.status !== 201) {
    throw new Error(`signup failed (${res.status}): ${await res.text()}`);
  }
  const { user } = await res.json();
  return { session, username, password, user };
}

export function makeChecker() {
  let passed = 0;
  const failures: string[] = [];

  function check(label: string, actual: unknown, expected: unknown) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
      passed++;
      console.log(`  ok   ${label}`);
    } else {
      failures.push(`${label} — expected ${e}, got ${a}`);
      console.log(`  FAIL ${label} — expected ${e}, got ${a}`);
    }
  }

  function report(what: string): void {
    console.log('');
    if (failures.length === 0) {
      console.log(`  PASS — all ${passed} ${what} passed\n`);
      process.exit(0);
    }
    console.log(`  ${passed} passed, ${failures.length} FAILED\n`);
    for (const f of failures) console.log(`  - ${f}`);
    console.log('');
    process.exit(1);
  }

  return { check, report };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
