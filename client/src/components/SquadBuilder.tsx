import { useEffect, useRef, useState } from 'react';
import { searchUsers, type PublicUser } from '../lib/auth';
import { Btn, TextInput } from './ui';

export interface SquadSlot {
  name: string;
  /** Present only for a registered account. Guests carry just a name. */
  username?: string | null;
}

/**
 * A squad is a mix: registered accounts added by their unique username, whose
 * stats accrue to a real profile, plus plain names for anyone without an account.
 * Insisting everybody sign up would block a match on the day it is played.
 */
export default function SquadBuilder({
  teamName,
  slots,
  onChange,
  minRegistered = 1,
}: {
  teamName: string;
  slots: SquadSlot[];
  onChange: (next: SquadSlot[]) => void;
  minRegistered?: number;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [guestName, setGuestName] = useState('');
  const seq = useRef(0);

  const registered = slots.filter((s) => s.username).length;
  const taken = new Set(slots.map((s) => s.username).filter(Boolean) as string[]);

  // Debounced so a fast typist does not fire a request per keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const token = ++seq.current;
    const timer = setTimeout(() => {
      void searchUsers(q).then((users) => {
        // Drop results from a query the user has already typed past.
        if (token !== seq.current) return;
        setResults(users);
        setSearching(false);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function addUser(u: PublicUser) {
    if (taken.has(u.username)) return;
    onChange([...slots, { name: u.displayName, username: u.username }]);
    setQuery('');
    setResults([]);
  }

  function addGuest() {
    const name = guestName.trim();
    if (!name) return;
    onChange([...slots, { name }]);
    setGuestName('');
  }

  function remove(index: number) {
    onChange(slots.filter((_, i) => i !== index));
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-display text-xs font-semibold tracking-[0.14em] text-ink-300 uppercase">
          {teamName} squad
        </span>
        <span className={`text-[11px] ${registered >= minRegistered ? 'text-ink-500' : 'text-live'}`}>
          {slots.length} player{slots.length === 1 ? '' : 's'} · {registered} registered
        </span>
      </div>

      {slots.length > 0 && (
        <ul className="mb-2 space-y-1">
          {slots.map((s, i) => (
            <li
              key={`${s.username ?? 'guest'}-${i}`}
              className="flex items-center justify-between rounded-lg border border-pitch-700 bg-pitch-900 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink-50">{s.name}</span>
                <span className="text-[10px] text-ink-500">
                  {s.username ? (
                    <span className="text-accent">@{s.username}</span>
                  ) : (
                    'guest — stats will not be saved to a profile'
                  )}
                </span>
              </span>
              <button
                onClick={() => remove(i)}
                className="pressable shrink-0 rounded-lg border border-pitch-600 px-2 py-1 text-[11px] text-ink-300"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {registered < minRegistered && (
        <p className="mb-2 rounded-lg border border-live/40 bg-live/10 px-3 py-2 text-[11px] text-live">
          Add at least {minRegistered} registered player by username.
        </p>
      )}

      {/* Registered player search */}
      <div className="relative">
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value.toLowerCase())}
          placeholder="Add by username…"
          autoCapitalize="none"
          autoCorrect="off"
        />
        {query.trim().length >= 2 && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-pitch-600 bg-pitch-850 shadow-lg">
            {searching && <div className="px-3 py-2 text-xs text-ink-500">Searching…</div>}
            {!searching && results.length === 0 && (
              <div className="px-3 py-2 text-xs text-ink-500">
                No player with that username. Add them as a guest below.
              </div>
            )}
            {results.map((u) => {
              const already = taken.has(u.username);
              return (
                <button
                  key={u.id}
                  disabled={already}
                  onClick={() => addUser(u)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-pitch-800 disabled:opacity-40"
                >
                  <span className="text-ink-50">{u.displayName}</span>
                  <span className="text-xs text-accent">
                    {already ? 'already added' : `@${u.username}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Guest */}
      <div className="mt-2 flex gap-1.5">
        <TextInput
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addGuest()}
          placeholder="…or add a guest by name"
        />
        <Btn variant="default" onClick={addGuest} disabled={!guestName.trim()}>
          Add
        </Btn>
      </div>
    </div>
  );
}
