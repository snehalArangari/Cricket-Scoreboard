import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { oversDisplay } from '@shared/engine';
import { useMatch } from '../hooks/useMatch';
import { Panel, Screen, StatusBar } from '../components/ui';
import { ScoreHero, ThisOver, activeInnings } from '../components/Scoreboard';
import { BattingTable, BowlingTable } from '../components/Cards';

/**
 * Read-only by construction: it connects with no scorer token, so the server
 * marks the socket a viewer and rejects every write. There are no controls to
 * hide, which is why there is no client-side security theatre here.
 */
export default function Viewer() {
  const { matchId = '' } = useParams();
  const { state, conn, fatal } = useMatch(matchId);
  const [tab, setTab] = useState<'batting' | 'bowling'>('batting');

  if (fatal === 'MATCH_NOT_FOUND') {
    return (
      <Screen>
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <h1 className="font-display text-2xl font-bold">Match not found</h1>
          <p className="mt-2 text-sm text-ink-300">
            Check the link — this match id does not exist.
          </p>
        </div>
      </Screen>
    );
  }

  if (!state) {
    return (
      <Screen>
        <div className="mx-auto max-w-md px-4 py-16">
          {/* Skeleton, not a spinner — a free server can take ~1 min to wake. */}
          <div className="hero-wash rounded-card border border-pitch-700 p-6">
            <div className="mb-4 h-3 w-28 animate-pulse rounded bg-pitch-700" />
            <div className="h-16 w-48 animate-pulse rounded bg-pitch-700" />
            <div className="mt-4 h-3 w-36 animate-pulse rounded bg-pitch-800" />
          </div>
          <p className="mt-6 text-center text-sm text-ink-300">
            Waking up the scoreboard…
          </p>
          <p className="mt-1 text-center text-xs text-ink-500">
            The first load of the day can take up to a minute.
          </p>
        </div>
      </Screen>
    );
  }

  const view = activeInnings(state);
  const { innings, battingTeam, bowlingTeam } = view;
  const striker = innings.batting.find((c) => c.playerId === innings.strikerId);
  const nonStriker = innings.batting.find((c) => c.playerId === innings.nonStrikerId);
  const bowler = innings.bowling.find((c) => c.playerId === innings.lastBowlerId);
  const live = state.status === 'innings1' || state.status === 'innings2';

  return (
    <Screen>
      <div className="mx-auto w-full max-w-md pb-16 lg:max-w-3xl">
        <ScoreHero state={state} big />

        {/* Broadcast lower-third: who is at the crease right now */}
        {live && (
          <div className="border-b border-pitch-700 bg-pitch-900 px-5 py-3">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              {striker && (
                <span className="text-sm">
                  <span className="text-ink-50">{striker.name}</span>
                  <span className="text-accent">*</span>{' '}
                  <span className="font-display tnum text-ink-300">
                    {striker.runs} ({striker.balls})
                  </span>
                </span>
              )}
              {nonStriker && (
                <span className="text-sm">
                  <span className="text-ink-300">{nonStriker.name}</span>{' '}
                  <span className="font-display tnum text-ink-500">
                    {nonStriker.runs} ({nonStriker.balls})
                  </span>
                </span>
              )}
              {bowler && (
                <span className="ml-auto text-sm">
                  <span className="text-ink-300">{bowler.name}</span>{' '}
                  <span className="font-display tnum text-ink-500">
                    {oversDisplay(bowler.legalBalls)}-{bowler.maidens}-{bowler.runs}-
                    {bowler.wickets}
                  </span>
                </span>
              )}
            </div>
          </div>
        )}

        <div className="px-4 pt-4">
          <Panel title="Recent balls">
            <ThisOver innings={innings} />
          </Panel>
        </div>

        {/* Scorecard */}
        <div className="mt-4 px-4">
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            {(['batting', 'bowling'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`pressable rounded-xl border py-2.5 font-display text-sm font-bold tracking-wide uppercase ${
                  tab === t
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-pitch-700 bg-pitch-850 text-ink-300'
                }`}
              >
                {t === 'batting' ? battingTeam.name : bowlingTeam.name}
              </button>
            ))}
          </div>
          <Panel>
            {tab === 'batting' ? (
              <BattingTable innings={innings} />
            ) : (
              <BowlingTable innings={innings} />
            )}
          </Panel>
        </div>

        {/* First innings summary once the chase is under way */}
        {(state.status === 'innings2' || state.status === 'complete') && (
          <div className="mt-3 px-4">
            <Panel title={`${state.setup.teamA.name} — 1st innings`}>
              <div className="px-4 pb-3 font-display text-2xl font-bold tnum">
                {state.innings1.runs}/{state.innings1.wickets}
                <span className="ml-2 text-sm text-ink-300">
                  ({oversDisplay(state.innings1.legalBalls)} ov)
                </span>
              </div>
              <BattingTable innings={state.innings1} />
            </Panel>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-ink-500">
          Live scoring · updates automatically
        </p>
      </div>

      <StatusBar conn={conn} pending={0} role="viewer" readOnlyExpected />
    </Screen>
  );
}
