import mongoose from 'mongoose';

let started = false;
let lastError: string | null = null;

const STATE_NAMES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export function dbState(): string {
  return STATE_NAMES[mongoose.connection.readyState] ?? 'unknown';
}

export function dbLastError(): string | null {
  return lastError;
}

/**
 * Connects in the background and KEEPS RETRYING.
 *
 * Two reasons this is not a single awaited connect at boot:
 *
 *  - The commonest deployment failure is an Atlas IP allow-list that does not
 *    include the host. With a one-shot connect the process would sit there
 *    permanently broken even after the allow-list is fixed, and only a manual
 *    redeploy would recover it. Retrying means it heals itself.
 *  - The web server must come up regardless, so the failure is visible in the
 *    UI and in /api/health rather than as a container that refuses to boot.
 */
export function startDb(uri: string): void {
  if (started) return;
  started = true;

  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    lastError = null;
    console.log('[db] connected to MongoDB');
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('[db] disconnected — the driver will try to recover');
  });
  // Without this listener a driver error can surface as an unhandled rejection
  // and take the entire web server down with it.
  mongoose.connection.on('error', (err: Error) => {
    lastError = err.message;
    console.error('[db] connection error:', err.message);
  });

  void attempt(uri, 0);
}

async function attempt(uri: string, tries: number): Promise<void> {
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
    });
  } catch (err) {
    lastError = (err as Error).message;
    // Back off to 30s and stay there — a fixed allow-list should be picked up
    // within half a minute without anyone redeploying.
    const delay = Math.min(30000, 2000 * 2 ** Math.min(tries, 4));
    console.error(
      `[db] connect failed: ${lastError} — retrying in ${Math.round(delay / 1000)}s`,
    );
    setTimeout(() => void attempt(uri, tries + 1), delay);
  }
}
