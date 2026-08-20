import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { oversDisplay } from '@shared/engine';
import { addTeam, getTournament, removeTeam, type TournamentDetail } from '../lib/tournaments';
import { Btn, Panel, Screen, TextInput } from '../components/ui';

const th = 'px-2 py-1.5 text-[10px] font-semibold tracking-[0.1em] text-ink-500 uppercase';
const td = 'px-2 py-2 text-sm tnum';

function nrrText(n: number | null): string {
  if (n === null) return '—';
  // A leading + makes a positive net run rate readable at a glance.
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

export default function Tournament() {
  const { tournamentId = '' } = useParams();
  const [data, setData] = useState<TournamentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'table' | 'batting' | 'bowling' | 'matches'>('table');
  const [newTeam, setNewTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);

  const load = useCallback(() => {
    void getTournament(tournamentId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load'));
  }, [tournamentId]);

  useEffect(load, [load]);

  async function add() {
    if (!newTeam.trim() || busy) return;
    setBusy(true);
    setTeamError(null);
    try {
      await addTeam(tournamentId, newTeam.trim());
      setNewTeam('');
      load();
    } catch (e) {
      setTeamError(e instanceof Error ? e.message : 'Could not add');
    } finally {
      setBusy(false);
    }
  }

  async function drop(teamId: string) {
    setBusy(true);
    setTeamError(null);
    try {
      await removeTeam(tournamentId, teamId);
      load();
    } catch (e) {
      setTeamError(e instanceof Error ? e.message : 'Could not remove');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Screen>
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <h1 className="font-display text-2xl font-bold">{error}</h1>
          <Link to="/tournaments" className="mt-6 inline-block text-sm text-accent">
            All tournaments
          </Link>
        </div>
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen>
        <div className="mx-auto max-w-md px-4 py-20 text-center text-sm text-ink-500">Loading…</div>
      </Screen>
    );
  }

  const played = data.standings.reduce((n, s) => n + s.played, 0);

  return (
    <Screen>
      <div className="mx-auto w-full max-w-md px-4 py-6 pb-16 lg:max-w-2xl">
        <header className="mb-4 flex items-start justify-between">
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-extrabold text-ink-50">
              {data.name}
            </h1>
            <p className="text-xs text-ink-500">
              {data.teams.length} teams · {played / 2} match{played / 2 === 1 ? '' : 'es'} played ·{' '}
              {data.points.win} for a win
            </p>
          </div>
          <Link
            to="/tournaments"
            className="pressable shrink-0 rounded-lg border border-pitch-700 px-2.5 py-1.5 text-[11px] text-ink-300"
          >
            Back
          </Link>
        </header>

        <div className="mb-3 grid grid-cols-4 gap-1.5">
          {(['table', 'batting', 'bowling', 'matches'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pressable rounded-lg border py-2 font-display text-[11px] font-bold tracking-wide uppercase ${
                tab === t
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-pitch-700 bg-pitch-850 text-ink-300'
              }`}
            >
              {t === 'table' ? 'Points' : t}
            </button>
          ))}
        </div>

        {tab === 'table' && (
          <Panel>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[24rem]">
                <thead>
                  <tr className="border-b border-pitch-700">
                    <th className={`${th} text-left`}>Team</th>
                    <th className={`${th} text-right`}>P</th>
                    <th className={`${th} text-right`}>W</th>
                    <th className={`${th} text-right`}>L</th>
                    <th className={`${th} text-right`}>T</th>
                    <th className={`${th} text-right`}>Pts</th>
                    <th className={`${th} text-right`}>NRR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.standings.map((s, i) => (
                    <tr key={s.teamId} className="border-b border-pitch-800/60 last:border-0">
                      <td className={`${td} text-left`}>
                        <span className="mr-2 text-ink-500">{i + 1}</span>
                        <span className="text-ink-50">{s.teamName}</span>
                      </td>
                      <td className={`${td} text-right text-ink-300`}>{s.played}</td>
                      <td className={`${td} text-right text-ink-300`}>{s.won}</td>
                      <td className={`${td} text-right text-ink-300`}>{s.lost}</td>
                      <td className={`${td} text-right text-ink-300`}>{s.tied}</td>
                      <td className={`${td} text-right font-bold text-accent`}>{s.points}</td>
                      <td
                        className={`${td} text-right ${
                          (s.nrr ?? 0) > 0 ? 'text-good' : (s.nrr ?? 0) < 0 ? 'text-live' : 'text-ink-300'
                        }`}
                      >
                        {nrrText(s.nrr)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-pitch-700 px-4 py-2 text-[10px] text-ink-500">
              Ranked on points, then net run rate. A side bowled out is charged its full quota of
              overs, so collapsing quickly cannot flatter a run rate.
            </p>
          </Panel>
        )}

        {tab === 'batting' && (
          <Panel title="Most runs">
            {data.leaderboards.batting.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-ink-500">No completed matches yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[22rem]">
                  <thead>
                    <tr className="border-b border-pitch-700">
                      <th className={`${th} text-left`}>Player</th>
                      <th className={`${th} text-right`}>M</th>
                      <th className={`${th} text-right`}>Runs</th>
                      <th className={`${th} text-right`}>4s</th>
                      <th className={`${th} text-right`}>6s</th>
                      <th className={`${th} text-right`}>S/R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.leaderboards.batting.map((r) => (
                      <tr key={r.playerId} className="border-b border-pitch-800/60 last:border-0">
                        <td className={`${td} text-left`}>
                          {r.username ? (
                            <Link to={`/players/${r.username}`} className="text-ink-50 hover:underline">
                              {r.name}
                            </Link>
                          ) : (
                            <span className="text-ink-300">{r.name}</span>
                          )}
                        </td>
                        <td className={`${td} text-right text-ink-300`}>{r.matches}</td>
                        <td className={`${td} text-right font-bold text-accent`}>{r.runs}</td>
                        <td className={`${td} text-right text-ink-300`}>{r.fours}</td>
                        <td className={`${td} text-right text-ink-300`}>{r.sixes}</td>
                        <td className={`${td} text-right text-ink-300`}>{r.strikeRate.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}

        {tab === 'bowling' && (
          <Panel title="Most wickets">
            {data.leaderboards.bowling.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-ink-500">No completed matches yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[22rem]">
                  <thead>
                    <tr className="border-b border-pitch-700">
                      <th className={`${th} text-left`}>Player</th>
                      <th className={`${th} text-right`}>M</th>
                      <th className={`${th} text-right`}>Ov</th>
                      <th className={`${th} text-right`}>Runs</th>
                      <th className={`${th} text-right`}>Wkts</th>
                      <th className={`${th} text-right`}>Econ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.leaderboards.bowling.map((r) => (
                      <tr key={r.playerId} className="border-b border-pitch-800/60 last:border-0">
                        <td className={`${td} text-left`}>
                          {r.username ? (
                            <Link to={`/players/${r.username}`} className="text-ink-50 hover:underline">
                              {r.name}
                            </Link>
                          ) : (
                            <span className="text-ink-300">{r.name}</span>
                          )}
                        </td>
                        <td className={`${td} text-right text-ink-300`}>{r.matches}</td>
                        <td className={`${td} text-right text-ink-300`}>
                          {oversDisplay(r.bowlingBalls)}
                        </td>
                        <td className={`${td} text-right text-ink-300`}>{r.runsConceded}</td>
                        <td className={`${td} text-right font-bold text-accent`}>{r.wickets}</td>
                        <td className={`${td} text-right text-ink-300`}>{r.economy.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}

        {tab === 'matches' && (
          <Panel title="Matches">
            {data.matches.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-ink-500">
                No matches yet. Start one from the new-match screen and pick this tournament.
              </p>
            ) : (
              <ul className="divide-y divide-pitch-800">
                {data.matches.map((m) => (
                  <li key={m.matchId}>
                    <Link
                      to={`/live/${m.matchId}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-pitch-800"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink-50">
                          {m.teamAName} <span className="text-ink-500">v</span> {m.teamBName}
                        </span>
                        <span
                          className={`text-[11px] ${m.status === 'complete' ? 'text-ink-500' : 'text-accent'}`}
                        >
                          {m.resultText ?? (m.status === 'complete' ? 'complete' : 'in progress')}
                        </span>
                      </span>
                      <span className="shrink-0 text-right font-display text-xs tnum text-ink-300">
                        <span className="block">
                          {m.innings1.runs}/{m.innings1.wickets}
                        </span>
                        <span className="block text-ink-500">
                          {m.innings2.runs}/{m.innings2.wickets}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {data.isOwner && (
          <Panel className="mt-3 p-4" title="Teams">
            <ul className="mb-2 space-y-1">
              {data.teams.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between rounded-lg border border-pitch-700 bg-pitch-900 px-3 py-2"
                >
                  <span className="text-sm text-ink-50">{t.name}</span>
                  <button
                    disabled={busy}
                    onClick={() => drop(t.id)}
                    className="pressable rounded-lg border border-live/40 px-2 py-1 text-[11px] text-live disabled:opacity-40"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {teamError && (
              <div className="mb-2 rounded-lg border border-live/50 bg-live/10 px-3 py-2 text-xs text-live">
                {teamError}
              </div>
            )}
            <div className="flex gap-1.5">
              <TextInput
                value={newTeam}
                onChange={(e) => setNewTeam(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                placeholder="Add a team"
              />
              <Btn variant="default" disabled={busy || !newTeam.trim()} onClick={add}>
                Add
              </Btn>
            </div>
            <p className="mt-2 text-[10px] text-ink-500">
              A team that has already played cannot be removed — its results are part of everyone
              else's standings.
            </p>
          </Panel>
        )}
      </div>
    </Screen>
  );
}
