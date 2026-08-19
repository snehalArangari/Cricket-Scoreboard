import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMatchRequest, saveScorerToken } from '../lib/api';
import { Btn, Field, Panel, Screen, TextArea, TextInput } from '../components/ui';

function defaultSquad(count: number): string {
  return Array.from({ length: count }, (_, i) => `Player ${i + 1}`).join('\n');
}

export default function Setup() {
  const navigate = useNavigate();
  const [teamAName, setTeamAName] = useState('Team A');
  const [teamBName, setTeamBName] = useState('Team B');
  const [overs, setOvers] = useState('10');
  const [squadA, setSquadA] = useState(defaultSquad(11));
  const [squadB, setSquadB] = useState(defaultSquad(11));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linesA = squadA.split('\n').filter((s) => s.trim().length > 0);
  const linesB = squadB.split('\n').filter((s) => s.trim().length > 0);
  const valid = linesA.length >= 2 && linesB.length >= 2 && Number(overs) >= 1;

  async function start() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { matchId, scorerToken } = await createMatchRequest({
        overs: Number(overs),
        teamAName,
        teamBName,
        teamAPlayers: linesA,
        teamBPlayers: linesB,
      });
      saveScorerToken(matchId, scorerToken);
      navigate(`/score/${matchId}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the match');
      setBusy(false);
    }
  }

  return (
    <Screen>
      <div className="mx-auto w-full max-w-md px-4 py-6">
        <header className="mb-6">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-50">
            CRICKET <span className="text-accent">LIVE</span>
          </h1>
          <p className="mt-1 text-sm text-ink-300">
            Score from your phone. Share one link and anyone can watch it live.
          </p>
        </header>

        <div className="space-y-4">
          <Panel className="p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Team A (bats first)">
                <TextInput
                  value={teamAName}
                  onChange={(e) => setTeamAName(e.target.value)}
                  placeholder="Team A"
                />
              </Field>
              <Field label="Team B">
                <TextInput
                  value={teamBName}
                  onChange={(e) => setTeamBName(e.target.value)}
                  placeholder="Team B"
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Overs per innings">
                <TextInput
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={200}
                  value={overs}
                  onChange={(e) => setOvers(e.target.value)}
                />
              </Field>
            </div>
          </Panel>

          <Panel className="p-4">
            <Field
              label={`${teamAName || 'Team A'} squad`}
              hint={`One name per line · ${linesA.length} player${linesA.length === 1 ? '' : 's'}`}
            >
              <TextArea rows={6} value={squadA} onChange={(e) => setSquadA(e.target.value)} />
            </Field>
          </Panel>

          <Panel className="p-4">
            <Field
              label={`${teamBName || 'Team B'} squad`}
              hint={`One name per line · ${linesB.length} player${linesB.length === 1 ? '' : 's'}`}
            >
              <TextArea rows={6} value={squadB} onChange={(e) => setSquadB(e.target.value)} />
            </Field>
          </Panel>

          {error && (
            <div className="rounded-xl border border-live/50 bg-live/10 px-4 py-3 text-sm text-live">
              {error}
            </div>
          )}

          <Btn variant="primary" onClick={start} disabled={!valid || busy} className="w-full py-4">
            {busy ? 'Creating match…' : 'Start match'}
          </Btn>

          <p className="pb-6 text-center text-xs text-ink-500">
            The names are pre-filled so you can start immediately — edit them any time before the
            first ball.
          </p>
        </div>
      </div>
    </Screen>
  );
}
