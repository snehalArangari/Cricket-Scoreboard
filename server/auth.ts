import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { UserModel, toPublicUser, type PublicUser } from './models/User';

export const COOKIE_NAME = 'cricket_session';
const TOKEN_TTL = '30d';

/**
 * The signing secret. If JWT_SECRET is unset we generate a random one at boot so
 * the app still runs — but every restart then invalidates all sessions, which is
 * why it warns loudly. On a real deployment this MUST be set.
 */
const SECRET: string =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16
    ? process.env.JWT_SECRET
    : (() => {
        console.warn(
          '[auth] JWT_SECRET is not set — using a random secret. Everyone will be logged out on every restart.',
        );
        return crypto.randomBytes(32).toString('hex');
      })();

export interface TokenPayload {
  sub: string; // user id
  username: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET);
    if (typeof decoded === 'string') return null;
    const sub = decoded.sub;
    const username = (decoded as any).username;
    if (typeof sub !== 'string' || typeof username !== 'string') return null;
    return { sub, username };
  } catch {
    return null;
  }
}

/**
 * The token rides in an httpOnly cookie rather than localStorage: script on the
 * page cannot read it, so an XSS bug cannot walk off with a 30-day session. It is
 * also sent automatically on the Socket.IO handshake, which means the websocket
 * needs no token plumbing of its own.
 */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Secure in production; plain http on a LAN during development would drop it.
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Pulls a session token out of a cookie header, or the Authorization header. */
export function tokenFromRequest(req: {
  cookies?: Record<string, string>;
  headers: Record<string, unknown>;
}): string | null {
  const fromCookie = req.cookies?.[COOKIE_NAME];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

/** Parses a raw Cookie header — the Socket.IO handshake has no cookie parser. */
export function tokenFromCookieHeader(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

/** Attaches req.user when a valid session is present. Never rejects. */
export async function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = tokenFromRequest(req as any);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      try {
        const doc = await UserModel.findById(payload.sub).lean();
        // A token for a deleted account must not authenticate anything.
        if (doc) req.user = toPublicUser(doc);
      } catch {
        /* leave req.user unset */
      }
    }
  }
  next();
}

/** Rejects anything without a valid session. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Sign in to continue' });
    return;
  }
  next();
}
