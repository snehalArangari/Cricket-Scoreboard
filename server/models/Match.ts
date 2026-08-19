import mongoose, { Schema } from 'mongoose';
import type { MatchCore } from '../../shared/types';

// `id: false` disables Mongoose's built-in `id` virtual so our own real `id`
// field on players and balls survives round-tripping untouched.
const subOpts = { _id: false as const, id: false as const };

const PlayerSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
  },
  subOpts,
);

const TeamSchema = new Schema(
  {
    name: { type: String, required: true },
    players: { type: [PlayerSchema], default: [] },
  },
  subOpts,
);

const WicketSchema = new Schema(
  {
    outBatterId: { type: String, required: true },
    creditBowler: { type: Boolean, default: false },
  },
  subOpts,
);

const BallSchema = new Schema(
  {
    id: { type: String, required: true },
    delivery: {
      type: String,
      enum: ['NORMAL', 'WIDE', 'NO_BALL', 'DEAD_BALL'],
      required: true,
    },
    batRuns: { type: Number, default: 0, min: 0, max: 12 },
    strikerId: { type: String, default: '' },
    nonStrikerId: { type: String, default: '' },
    bowlerId: { type: String, default: '' },
    wicket: { type: WicketSchema, default: null },
  },
  subOpts,
);

const InningsSchema = new Schema(
  {
    events: { type: [BallSchema], default: [] },
  },
  subOpts,
);

/** A co-scorer the owner has invited. Only the token HASH is ever stored, so a
 *  database dump cannot be replayed to gain write access. */
const CoScorerSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    tokenHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: null },
    // Revoked rather than deleted, so the owner keeps a record of who had access.
    revokedAt: { type: Date, default: null },
  },
  subOpts,
);

const MatchSchema = new Schema(
  {
    matchId: { type: String, required: true, unique: true, index: true },
    /** The creator's token. Grants scoring AND the right to invite. */
    scorerTokenHash: { type: String, required: true },
    coScorers: { type: [CoScorerSchema], default: [] },
    setup: {
      overs: { type: Number, required: true },
      teamA: { type: TeamSchema, required: true },
      teamB: { type: TeamSchema, required: true },
    },
    innings1: { type: InningsSchema, default: () => ({ events: [] }) },
    innings2: { type: InningsSchema, default: () => ({ events: [] }) },
    innings2Started: { type: Boolean, default: false },
    /** Recently applied operation ids, newest last, capped. Makes a replayed
     *  undo/edit/delete from the offline outbox a no-op the way a repeated
     *  ball id already is. */
    recentOpIds: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['innings1', 'innings1-complete', 'innings2', 'complete'],
      default: 'innings1',
    },
    winner: { type: String, enum: ['A', 'B', 'TIE', null], default: null },
    resultText: { type: String, default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const MatchModel = mongoose.model('Match', MatchSchema);

export type MatchDoc = mongoose.HydratedDocument<
  mongoose.InferSchemaType<typeof MatchSchema>
>;

/** Strips Mongo bookkeeping and returns the plain domain object the engine wants. */
export function toCore(doc: MatchDoc): MatchCore {
  const raw = doc.toObject({ depopulate: true, flattenObjectIds: true }) as any;
  return {
    matchId: raw.matchId,
    setup: raw.setup,
    innings1: { events: raw.innings1?.events ?? [] },
    innings2: { events: raw.innings2?.events ?? [] },
    innings2Started: Boolean(raw.innings2Started),
    status: raw.status,
    winner: raw.winner ?? null,
    resultText: raw.resultText ?? null,
    version: raw.version ?? 0,
  };
}

/** Writes the engine's output back onto the document. */
export function applyCore(doc: MatchDoc, core: MatchCore): void {
  doc.set('innings1', { events: core.innings1.events });
  doc.set('innings2', { events: core.innings2.events });
  doc.set('innings2Started', core.innings2Started);
  doc.set('status', core.status);
  doc.set('winner', core.winner);
  doc.set('resultText', core.resultText);
  doc.set('version', core.version);
}
