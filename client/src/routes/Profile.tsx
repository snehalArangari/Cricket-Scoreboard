import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { oversDisplay } from '@shared/engine';
import { useAuth } from '../hooks/useAuth';
import { Panel, Screen } from '../components/ui';

interface CareerStats {
  user: { id: string; username: string; displayName: string };
  matches: number;
  won: number;
  lost: number;
  tied: number;
  batting: {
    innings: number;
    runs: number;
    balls: number;
    fours: number;
    sixes: number;
    notOuts: number;
    highScore: number;
    highScoreNotOut: boolean;
    average: number | null;
    strikeRate: number;
    fifties: number;
    hundreds: number;
  };
  bowling: {
    innings: number;
    balls: number;
    runs: number;
    wickets: number;
    maidens: number;
    best: { wickets: number; runs: number } | null;
    average: number | null;
    economy: number;
    strikeRate: number | null;
    threeWicketHauls: number;
    fiveWicketHauls: number;
  };
  recent: Array<{
    matchId: string;
    playedAt: string;
    status: string;
    teamName: string;
    opponent: string;
    runs: number;
    balls: number;
    out: boolean;
    wickets: number;
    runsConceded: number;
    bowlingBalls: number;
    result: 'won' | 'lost' | 'tied' | 'in-progress';
  }>;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-2 py-2 text-center">
      <div className={`font-display text-xl font-bold tnum ${accent ? 'text-accent' : 'text-ink-50'}`}>
        {value}
      </div>
      <div className="text-[10px] font-medium tracking-[0.12em] text-ink-500 uppercase">{label}</div>
    </div>
  );
}

const RESULT_TONE: Record<string, string> = {
  won: 'text-good',
  lost: 'text-live',
  tied: 'text-ink-300',
  'in-progress': 'text-accent',
};

export default function Profile() {
  const { username = '' } = useParams();
  const { user, logout } = useAuth();
  const [stats, setStats] = useState<CareerStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setStats(null);
    setError(null);
    void fetch(`/api/auth/users/${encodeURIComponent(username)}/stats`, {
      credentials: 'same-origin',
    })
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 404) {
          setError('No player with that username');
          return;
        }
        if (!r.ok) {
          setError('Could not load this profile');
          return;
        }
        setStats(await r.json());
      })
      .catch(() => alive && setError('Could not load this profile'));
    return () => {
      alive = false;
    };
  }, [username]);

  const isMe = user?.username === username.toLowerCase();

  if (error) {
    return (
      <Screen>
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <h1 className="font-display text-2xl font-bold">{error}</h1>
          <Link to="/" className="mt-6 inline-block text-sm text-accent">
            Back to matches
          </Link>
        </div>
      </Screen>
    );
  }

  if (!stats) {
    return (
      <Screen>
        <div className="mx-auto max-w-md px-4 py-20 text-center text-sm text-ink-500">
          Loading profile…
        </div>
      </Screen>
    );
  }

  const { batting: bat, bowling: bowl } = stats;
  const num = (n: number | null, digits = 2) => (n === null ? '—' : n.toFixed(digits));

  return (
    <Screen>
      <div className="mx-auto w-full max-w-md px-4 py-6 pb-16">
        <header className="mb-5">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <h1 className="truncate font-display text-2xl font-extrabold text-ink-50">
                {stats.user.displayName}
              </h1>
              <p className="text-sm text-accent">@{stats.user.username}</p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Link
                to="/"
                className="pressable rounded-lg border border-pitch-700 px-2.5 py-1.5 text-[11px] text-ink-300"
              >
                Matches
              </Link>
              {isMe && (
                <button
                  onClick={() => void logout()}
                  className="pressable rounded-lg border border-pitch-700 px-2.5 py-1.5 text-[11px] text-ink-300"
                >
                  Sign out
                </button>
              )}
            </div>
          </div>
        </header>

        {stats.matches === 0 ? (
          <Panel className="p-6 text-center">
            <p className="text-sm text-ink-300">No matches yet.</p>
            <p className="mt-1 text-xs text-ink-500">
              Stats appear here once {isMe ? 'you play' : 'they play'} in a match while added by
              username.
            </p>
          </Panel>
        ) : (
          <div className="space-y-3">
            <Panel>
              <div className="grid grid-cols-4 divide-x divide-pitch-700">
                <Stat label="Matches" value={String(stats.matches)} />
                <Stat label="Won" value={String(stats.won)} accent />
                <Stat label="Lost" value={String(stats.lost)} />
                <Stat label="Tied" value={String(stats.tied)} />
              </div>
            </Panel>

            <Panel title="Batting">
              <div className="grid grid-cols-4 divide-x divide-pitch-700 border-b border-pitch-700">
                <Stat label="Runs" value={String(bat.runs)} accent />
                <Stat
                  label="High"
                  value={`${bat.highScore}${bat.highScoreNotOut && bat.highScore > 0 ? '*' : ''}`}
                />
                <Stat label="Average" value={num(bat.average)} />
                <Stat label="S/R" value={bat.strikeRate.toFixed(1)} />
              </div>
              <div className="grid grid-cols-4 divide-x divide-pitch-700">
                <Stat label="Innings" value={String(bat.innings)} />
                <Stat label="Balls" value={String(bat.balls)} />
                <Stat label="4s" value={String(bat.fours)} />
                <Stat label="6s" value={String(bat.sixes)} />
              </div>
              {(bat.fifties > 0 || bat.hundreds > 0 || bat.notOuts > 0) && (
                <div className="border-t border-pitch-700 px-4 py-2 text-[11px] text-ink-500">
                  {bat.hundreds > 0 && <span className="mr-3">{bat.hundreds}× 100</span>}
                  {bat.fifties > 0 && <span className="mr-3">{bat.fifties}× 50</span>}
                  {bat.notOuts > 0 && <span>{bat.notOuts} not out</span>}
                </div>
              )}
            </Panel>

            <Panel title="Bowling">
              <div className="grid grid-cols-4 divide-x divide-pitch-700 border-b border-pitch-700">
                <Stat label="Wickets" value={String(bowl.wickets)} accent />
                <Stat
                  label="Best"
                  value={bowl.best && bowl.best.wickets > 0 ? `${bowl.best.wickets}/${bowl.best.runs}` : '—'}
                />
                <Stat label="Average" value={num(bowl.average)} />
                <Stat label="Econ" value={bowl.economy.toFixed(2)} />
              </div>
              <div className="grid grid-cols-4 divide-x divide-pitch-700">
                <Stat label="Overs" value={oversDisplay(bowl.balls)} />
                <Stat label="Runs" value={String(bowl.runs)} />
                <Stat label="Maidens" value={String(bowl.maidens)} />
                <Stat label="S/R" value={num(bowl.strikeRate, 1)} />
              </div>
              {(bowl.threeWicketHauls > 0 || bowl.fiveWicketHauls > 0) && (
                <div className="border-t border-pitch-700 px-4 py-2 text-[11px] text-ink-500">
                  {bowl.fiveWicketHauls > 0 && <span className="mr-3">{bowl.fiveWicketHauls}× 5w</span>}
                  {bowl.threeWicketHauls > 0 && <span>{bowl.threeWicketHauls}× 3w</span>}
                </div>
              )}
            </Panel>

            <Panel title="Recent matches">
              <ul className="divide-y divide-pitch-800">
                {stats.recent.map((m) => (
                  <li key={m.matchId}>
                    <Link
                      to={`/live/${m.matchId}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-pitch-800"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink-50">
                          {m.teamName} <span className="text-ink-500">v</span> {m.opponent}
                        </span>
                        <span className={`text-[11px] ${RESULT_TONE[m.result]}`}>
                          {m.result === 'in-progress' ? 'in progress' : m.result}
                        </span>
                      </span>
                      <span className="shrink-0 text-right font-display text-xs tnum text-ink-300">
                        {(m.balls > 0 || m.runs > 0) && (
                          <span className="block">
                            {m.runs}
                            {!m.out && '*'} ({m.balls})
                          </span>
                        )}
                        {m.bowlingBalls > 0 && (
                          <span className="block text-ink-500">
                            {m.wickets}/{m.runsConceded}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        )}
      </div>
    </Screen>
  );
}
