import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createTournament, listTournaments, type TournamentSummary } from '../lib/tournaments';
import { Btn, Field, Panel, Screen, TextArea, TextInput } from '../components/ui';

export default function Tournaments() {
  const navigate = useNavigate();
  const [list, setList] = useState<TournamentSummary[] | null>(null);
  const [name, setName] = useState('');
  const [teams, setTeams] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void listTournaments()
      .then((r) => setList(r.tournaments))
      .catch(() => setList([]));
  }, []);

  const teamNames = teams
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const t = await createTournament(name.trim(), teamNames);
      navigate(`/tournaments/${t.tournamentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the tournament');
      setBusy(false);
    }
  }

  return (
    <Screen>
      <div className="mx-auto w-full max-w-md px-4 py-6 pb-16">
        <header className="mb-5 flex items-center justify-between">
          <h1 className="font-display text-2xl font-extrabold text-ink-50">Tournaments</h1>
          <Link
            to="/"
            className="pressable rounded-lg border border-pitch-700 px-2.5 py-1.5 text-[11px] text-ink-300"
          >
            New match
          </Link>
        </header>

        {!creating && (
          <Btn variant="primary" className="mb-4 w-full py-3.5" onClick={() => setCreating(true)}>
            + Create a tournament
          </Btn>
        )}

        {creating && (
          <Panel className="mb-4 p-4">
            <div className="space-y-3">
              <Field label="Tournament name">
                <TextInput
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sunday League"
                />
              </Field>
              <Field
                label="Teams"
                hint={`One per line · ${teamNames.length} team${teamNames.length === 1 ? '' : 's'} — you can add more later`}
              >
                <TextArea
                  rows={5}
                  value={teams}
                  onChange={(e) => setTeams(e.target.value)}
                  placeholder={'Reds\nBlues\nGreens'}
                />
              </Field>
              {error && (
                <div className="rounded-xl border border-live/50 bg-live/10 px-3 py-2 text-sm text-live">
                  {error}
                </div>
              )}
              <div className="flex gap-2">
                <Btn variant="ghost" className="flex-1" onClick={() => setCreating(false)}>
                  Cancel
                </Btn>
                <Btn
                  variant="primary"
                  className="flex-1"
                  disabled={!name.trim() || busy}
                  onClick={create}
                >
                  {busy ? 'Creating…' : 'Create'}
                </Btn>
              </div>
            </div>
          </Panel>
        )}

        {list === null ? (
          <p className="py-10 text-center text-sm text-ink-500">Loading…</p>
        ) : list.length === 0 ? (
          <Panel className="p-6 text-center">
            <p className="text-sm text-ink-300">No tournaments yet.</p>
            <p className="mt-1 text-xs text-ink-500">
              Create one to get a points table across several matches.
            </p>
          </Panel>
        ) : (
          <Panel>
            <ul className="divide-y divide-pitch-800">
              {list.map((t) => (
                <li key={t.tournamentId}>
                  <Link
                    to={`/tournaments/${t.tournamentId}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-pitch-800"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink-50">{t.name}</span>
                      <span className="text-[11px] text-ink-500">
                        {t.teams.length} team{t.teams.length === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="text-ink-500">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </Screen>
  );
}
