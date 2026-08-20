import mongoose, { Schema } from 'mongoose';

const subOpts = { _id: false as const, id: false as const };

const TeamSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
  },
  subOpts,
);

const TournamentSchema = new Schema(
  {
    tournamentId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Round-robin is the only format for now; the field exists so adding
    // knockouts later does not need a migration.
    format: { type: String, enum: ['round-robin'], default: 'round-robin' },
    teams: { type: [TeamSchema], default: [] },
    points: {
      win: { type: Number, default: 2 },
      tie: { type: Number, default: 1 },
      loss: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

export const TournamentModel = mongoose.model('Tournament', TournamentSchema);
export type TournamentDoc = mongoose.HydratedDocument<
  mongoose.InferSchemaType<typeof TournamentSchema>
>;
