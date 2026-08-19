import { useEffect, useState } from 'react';
import type { ScorerSummary } from '@shared/types';
import { inviteScorer, inviteUrl, listScorers, revokeScorer } from '../lib/api';
import { Btn, Panel, TextInput } from './ui';

/**
 * Only the match creator sees this. Each invited person gets their own link, so
 * access can be withdrawn from one person without disturbing anyone else — which
 * a single shared password could never do.
 */
export default function ScorerManager({
  matchId,
  token,
  scorers,
  onRefresh,
}: {
  matchId: string;
  token: string | undefined;
  scorers: ScorerSummary[];
  onRefresh: (list: ScorerSummary[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown once, immediately after inviting — the server only keeps a hash.
  const [fresh, setFresh] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    listScorers(matchId, token)
      .then((r) => onRefresh(r.scorers))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load scorers'));
    // onRefresh is stable enough for this one-shot load on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matchId, token]);

  const active = scorers.filter((s) => !s.revoked);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await inviteScorer(matchId, token, trimmed);
      setFresh({ name: created.name, url: inviteUrl(matchId, created.token) });
      setName('');
      const r = await listScorers(matchId, token);
      onRefresh(r.scorers);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not invite');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await revokeScorer(matchId, token, id);
      onRefresh(r.scorers);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove');
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this invite link:', url);
    }
  }

  return (
    <Panel
      title={`Scorers${active.length > 0 ? ` · ${active.length + 1}` : ''}`}
      action={
        <button onClick={() => setOpen((o) => !o)} className="text-xs text-accent">
          {open ? 'Hide' : 'Manage'}
        </button>
      }
    >
      {!open ? (
        <p className="px-4 pb-3 text-xs text-ink-500">
          You are the only one who can invite others to score this match.
        </p>
      ) : (
        <div className="px-4 pb-4">
          <div className="mb-3 flex items-center justify-between rounded-lg border border-accent/30 bg-accent/8 px-3 py-2">
            <span className="text-sm text-ink-50">You</span>
            <span className="text-[10px] font-bold tracking-[0.12em] text-accent uppercase">
              Creator
            </span>
          </div>

          {active.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {active.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-lg border border-pitch-700 bg-pitch-900 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink-50">{s.name}</span>
                    <span className="text-[10px] text-ink-500">
                      {s.online ? (
                        <span className="text-good">● scoring now</span>
                      ) : s.lastSeenAt ? (
                        `last seen ${new Date(s.lastSeenAt).toLocaleTimeString()}`
                      ) : (
                        'not opened yet'
                      )}
                    </span>
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => remove(s.id)}
                    className="pressable shrink-0 rounded-lg border border-live/40 px-2.5 py-1.5 text-[11px] text-live disabled:opacity-40"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-1.5">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Name of the person"
              maxLength={40}
            />
            <Btn variant="primary" disabled={busy || !name.trim()} onClick={add}>
              {busy ? '…' : 'Invite'}
            </Btn>
          </div>

          {error && (
            <div className="mt-2 rounded-lg border border-live/50 bg-live/10 px-3 py-2 text-xs text-live">
              {error}
            </div>
          )}

          {fresh && (
            <div className="mt-3 rounded-lg border border-good/40 bg-good/10 p-3">
              <div className="text-xs text-ink-50">
                Invite link for <span className="font-semibold">{fresh.name}</span>
              </div>
              <code className="mt-1.5 block truncate rounded bg-pitch-950 px-2 py-1.5 text-[10px] text-ink-300">
                {fresh.url}
              </code>
              <div className="mt-2 flex gap-1.5">
                <Btn variant="default" className="flex-1 py-2" onClick={() => copy(fresh.url)}>
                  {copied ? '✓ Copied' : 'Copy link'}
                </Btn>
                <Btn variant="ghost" className="py-2" onClick={() => setFresh(null)}>
                  Done
                </Btn>
              </div>
              <p className="mt-2 text-[10px] text-ink-500">
                Send this to {fresh.name} only. It is shown once — if it is lost, remove them and
                invite again.
              </p>
            </div>
          )}

          <p className="mt-3 text-[11px] text-ink-500">
            Anyone you invite can score, but cannot invite others or remove anyone. Removing
            someone disconnects them immediately.
          </p>
        </div>
      )}
    </Panel>
  );
}
