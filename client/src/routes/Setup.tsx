import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createMatchRequest, saveScorerToken } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { Btn, Field, Panel, Screen, TextInput } from '../components/ui';
import SquadBuilder, { type SquadSlot } from '../components/SquadBuilder';
import { listTournaments, type TournamentSummary } from '../lib/tournaments';

export default function Setup() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [teamAName, setTeamAName] = useState('Team A');
  const [teamBName, setTeamBName] = useState('Team B');
  const [overs, setOvers] = useState('10');
  // The creator is put into team A automatically — they are registered by
  // definition, so the "one registered player per side" rule is half-satisfied
  // before they touch anything.
  const [squadA, setSquadA] = useState<SquadSlot[]>([]);
  const [squadB, setSquadB] = useState<SquadSlot[]>([]);
  const seeded = useRef(false);
  const [tossWinner, setTossWinner] = useState<'A' | 'B' | null>(null);
  const [tossDecision, setTossDecision] = useState<'BAT' | 'BOWL' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [tournamentId, setTournamentId] = useState('');
  const [tTeamA, setTTeamA] = useState('');
  const [tTeamB, setTTeamB] = useState('');

  // Seed the creator into team A: they are registered by definition, so half the
  // "one registered player per side" rule is met before they touch anything.
  useEffect(() => {
    if (seeded.current || !user) return;
    seeded.current = true;
    setSquadA([{ name: user.displayName, username: user.username }]);
  }, [user]);

  useEffect(() => {
    void listTournaments()
      .then((r) => setTournaments(r.tournaments))
      .catch(() => setTournaments([]));
  }, []);

  const chosen = tournaments.find((t) => t.tournamentId === tournamentId) ?? null;

  // Picking a tournament team also names the side, so the scoreboard and the
  // points table can never disagree about who played.
  function pickTeam(side: 'A' | 'B', teamId: string) {
    const team = chosen?.teams.find((t) => t.id === teamId);
    if (side === 'A') {
      setTTeamA(teamId);
      if (team) setTeamAName(team.name);
    } else {
      setTTeamB(teamId);
      if (team) setTeamBName(team.name);
    }
  }

  const nameA = teamAName.trim() || 'Team A';
  const nameB = teamBName.trim() || 'Team B';

  const regA = squadA.filter((s) => s.username).length;
  const regB = squadB.filter((s) => s.username).length;
  const tossDone = tossWinner !== null && tossDecision !== null;
  const enoughPlayers = squadA.length >= 2 && squadB.length >= 2;
  const enoughRegistered = regA >= 1 && regB >= 1;
  const tournamentOk = !tournamentId || (tTeamA !== '' && tTeamB !== '' && tTeamA !== tTeamB);
  const valid =
    enoughPlayers && enoughRegistered && Number(overs) >= 1 && tossDone && tournamentOk;

  // The winner bats first if they chose to bat, otherwise the other side does.
  const battingFirst =
    !tossDone
      ? null
      : tossWinner === 'A'
        ? tossDecision === 'BAT'
          ? nameA
          : nameB
        : tossDecision === 'BAT'
          ? nameB
          : nameA;

  async function start() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { matchId, scorerToken } = await createMatchRequest({
        overs: Number(overs),
        teamAName,
        teamBName,
        teamAPlayers: squadA,
        teamBPlayers: squadB,
        tossWinner,
        tossDecision,
        tournamentId: tournamentId || null,
        tournamentTeamAId: tournamentId ? tTeamA : null,
        tournamentTeamBId: tournamentId ? tTeamB : null,
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
          <div className="mb-3 flex items-center justify-between">
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-50">
              CRICKET <span className="text-accent">LIVE</span>
            </h1>
            {user && (
              <div className="flex shrink-0 gap-1.5">
                <Link
                  to="/tournaments"
                  className="pressable rounded-lg border border-pitch-700 px-2.5 py-1.5 text-[11px] text-ink-300"
                >
                  Tournaments
                </Link>
                <Link
                  to={`/players/${user.username}`}
                  className="pressable rounded-lg border border-pitch-700 px-2.5 py-1.5 text-[11px] text-ink-300"
                >
                  My stats
                </Link>
                <button
                  onClick={() => void logout()}
                  className="pressable rounded-lg border border-pitch-700 px-2.5 py-1.5 text-[11px] text-ink-300"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
          {user && (
            <p className="text-xs text-ink-500">
              Signed in as <span className="text-accent">@{user.username}</span>
            </p>
          )}
          <p className="mt-1 text-sm text-ink-300">
            Score from your phone. Share one link and anyone can watch it live.
          </p>
        </header>

        <div className="space-y-4">
          {tournaments.length > 0 && (
            <Panel className="p-4">
              <Field label="Part of a tournament?" hint="Optional — results feed its points table">
                <select
                  value={tournamentId}
                  onChange={(e) => {
                    setTournamentId(e.target.value);
                    setTTeamA('');
                    setTTeamB('');
                  }}
                  className="w-full rounded-xl border border-pitch-600 bg-pitch-900 px-3 py-2.5 text-ink-50 outline-none focus:border-accent"
                >
                  <option value="">Standalone match</option>
                  {tournaments.map((t) => (
                    <option key={t.tournamentId} value={t.tournamentId}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>

              {chosen && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {(['A', 'B'] as const).map((side) => (
                    <Field key={side} label={side === 'A' ? 'Team A is' : 'Team B is'}>
                      <select
                        value={side === 'A' ? tTeamA : tTeamB}
                        onChange={(e) => pickTeam(side, e.target.value)}
                        className="w-full rounded-xl border border-pitch-600 bg-pitch-900 px-3 py-2.5 text-ink-50 outline-none focus:border-accent"
                      >
                        <option value="">Choose…</option>
                        {chosen.teams.map((t) => (
                          <option
                            key={t.id}
                            value={t.id}
                            disabled={t.id === (side === 'A' ? tTeamB : tTeamA)}
                          >
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                </div>
              )}
            </Panel>
          )}

          <Panel className="p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Team A">
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
            <SquadBuilder teamName={nameA} slots={squadA} onChange={setSquadA} />
          </Panel>

          <Panel className="p-4">
            <SquadBuilder teamName={nameB} slots={squadB} onChange={setSquadB} />
          </Panel>

          {/* Toss — decides who bats first, so it is required before starting. */}
          <Panel className="p-4">
            <div className="mb-1.5 font-display text-xs font-semibold tracking-[0.14em] text-ink-300 uppercase">
              Who won the toss?
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              {(['A', 'B'] as const).map((side) => (
                <button
                  key={side}
                  onClick={() => setTossWinner(side)}
                  className={`pressable truncate rounded-xl border px-3 py-3 text-sm font-semibold ${
                    tossWinner === side
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-pitch-600 bg-pitch-800 text-ink-300'
                  }`}
                >
                  {side === 'A' ? nameA : nameB}
                </button>
              ))}
            </div>

            <div className="mb-1.5 font-display text-xs font-semibold tracking-[0.14em] text-ink-300 uppercase">
              They chose to
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['BAT', 'BOWL'] as const).map((d) => (
                <button
                  key={d}
                  disabled={!tossWinner}
                  onClick={() => setTossDecision(d)}
                  className={`pressable rounded-xl border px-3 py-3 text-sm font-semibold disabled:opacity-30 ${
                    tossDecision === d
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-pitch-600 bg-pitch-800 text-ink-300'
                  }`}
                >
                  {d === 'BAT' ? '🏏 Bat' : '⚾ Bowl'}
                </button>
              ))}
            </div>

            {battingFirst && (
              <p className="mt-3 rounded-lg border border-pitch-700 bg-pitch-950/60 px-3 py-2 text-center text-xs text-ink-300">
                <span className="text-ink-50">{battingFirst}</span> bat first
              </p>
            )}
          </Panel>

          {error && (
            <div className="rounded-xl border border-live/50 bg-live/10 px-4 py-3 text-sm text-live">
              {error}
            </div>
          )}

          <Btn variant="primary" onClick={start} disabled={!valid || busy} className="w-full py-4">
            {busy
              ? 'Creating match…'
              : !enoughPlayers
                ? 'Add at least 2 players per team'
                : !enoughRegistered
                  ? 'Each team needs a registered player'
                  : !tossDone
                    ? 'Record the toss to continue'
                    : !tournamentOk
                      ? 'Pick both tournament teams'
                      : 'Start match'}
          </Btn>

          <p className="pb-6 text-center text-xs text-ink-500">
            Registered players get their runs and wickets saved to their profile. Guests are
            scored the same way, but their stats stay with this match.
          </p>
        </div>
      </div>
    </Screen>
  );
}
