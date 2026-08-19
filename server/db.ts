import mongoose from 'mongoose';

let connected = false;

export async function connectDb(uri: string): Promise<void> {
  if (connected) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
  });
  connected = true;
  console.log('[db] connected to MongoDB');
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
