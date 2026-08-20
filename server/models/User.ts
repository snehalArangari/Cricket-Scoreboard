import mongoose, { Schema } from 'mongoose';
import crypto from 'node:crypto';

/**
 * Passwords are hashed with scrypt from node:crypto — deliberately no bcrypt or
 * argon2 dependency. Both would be another package to keep current, and argon2
 * needs a native build that free hosts often make awkward. scrypt is memory-hard,
 * in the standard library, and needs no maintenance.
 */
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N — the work factor

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST }, (err, derived) => {
      if (err) return reject(err);
      resolve(`scrypt$${SCRYPT_COST}$${salt}$${derived.toString('hex')}`);
    });
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve) => {
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'scrypt') return resolve(false);
    const cost = Number(parts[1]);
    const salt = parts[2];
    const expected = Buffer.from(parts[3], 'hex');
    crypto.scrypt(password, salt, expected.length, { N: cost }, (err, derived) => {
      if (err) return resolve(false);
      // Constant-time, so a wrong password cannot be narrowed down by timing.
      resolve(derived.length === expected.length && crypto.timingSafeEqual(derived, expected));
    });
  });
}

/** Usernames are the public handle used to add someone to a squad. */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

const UserSchema = new Schema(
  {
    // Stored lowercase so lookups are unambiguous; `displayName` keeps the
    // capitalisation the person actually wants shown.
    username: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const UserModel = mongoose.model('User', UserSchema);
export type UserDoc = mongoose.HydratedDocument<mongoose.InferSchemaType<typeof UserSchema>>;

/** The only shape of a user that ever leaves the server. */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
}

export function toPublicUser(doc: any): PublicUser {
  return {
    id: String(doc._id),
    username: String(doc.username),
    displayName: String(doc.displayName),
  };
}
