import type { DerivedInnings, MatchState, Team } from '@shared/types';
import { oversDisplay } from '@shared/engine';
import { BallChip } from './ui';

/** Which innings the scoreboard should be showing right now. */
export function activeInnings(state: MatchState): {
  innings: DerivedInnings;
  battingTeam: Team;
  bowlingTeam: Team;
  key: 'innings1' | 'innings2';
} {
  const second = state.status === 'innings2' || state.status === 'complete';
  return second
    ? {
        innings: state.innings2,
        battingTeam: state.setup.teamB,
        bowlingTeam: state.setup.teamA,
        key: 'innings2',
      }
    : {
        innings: state.innings1,
        battingTeam: state.setup.teamA,
        bowlingTeam: state.setup.teamB,
        key: 'innings1',
      };
}

export function runRate(runs: number, legalBalls: number): number {
  return legalBalls > 0 ? runs / (legalBalls / 6) : 0;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="font-display text-lg font-bold tnum text-ink-50">{value}</div>
      <div className="text-[10px] font-medium tracking-[0.14em] text-ink-500 uppercase">{label}</div>
    </div>
  );
}

export function LiveBadge({ live }: { live: boolean }) {
  if (!live) return null;
  return (
    <span className="glow-live inline-flex items-center gap-1.5 rounded-full bg-live/15 px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] text-live uppercase">
      <span className="animate-pulse-live h-1.5 w-1.5 rounded-full bg-live" />
      Live
    </span>
  );
}

export function ScoreHero({ state, big = false }: { state: MatchState; big?: boolean }) {
  const { innings, battingTeam } = activeInnings(state);
  const live = state.status === 'innings1' || state.status === 'innings2';
  const crr = runRate(innings.runs, innings.legalBalls);

  const scoreSize = big
    ? 'text-[clamp(3.5rem,17vw,9rem)]'
    : 'text-[clamp(3rem,14vw,5.5rem)]';

  return (
    <div className="hero-wash border-b border-pitch-700 px-5 pt-4 pb-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-sm font-bold tracking-[0.12em] text-ink-300 uppercase">
          {battingTeam.name}
        </span>
        <LiveBadge live={live} />
      </div>

      <div className="flex items-end gap-3">
        <div
          className={`glow-score font-display leading-[0.85] font-extrabold tnum text-ink-50 ${scoreSize}`}
        >
          {innings.runs}
          <span className="text-ink-500">/</span>
          {innings.wickets}
        </div>
        <div className="pb-2 font-display text-lg font-semibold tnum text-ink-300">
          ({oversDisplay(innings.legalBalls)}
          <span className="text-ink-500">/{state.setup.overs}</span>)
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-pitch-700 bg-pitch-950/50 py-2.5">
        <Stat label="Run rate" value={crr.toFixed(2)} />
        <Stat label="Extras" value={String(innings.extras)} />
        <Stat
          label="Overs left"
          value={String(Math.max(0, state.setup.overs - Math.ceil(innings.legalBalls / 6)))}
        />
      </div>

      <ChaseStrip state={state} />
    </div>
  );
}

export function ChaseStrip({ state }: { state: MatchState }) {
  if (state.status === 'innings1') return null;

  if (state.status === 'complete') {
    return (
      <div className="mt-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-center">
        <div className="font-display text-base font-bold text-accent">{state.resultText}</div>
      </div>
    );
  }

  if (state.status === 'innings1-complete') {
    return (
      <div className="mt-3 rounded-xl border border-pitch-600 bg-pitch-950/60 px-4 py-3 text-center">
        <div className="font-display text-sm font-semibold tracking-wide text-ink-300">
          INNINGS BREAK · {state.setup.teamB.name} need{' '}
          <span className="text-accent">{state.target}</span> to win
        </div>
      </div>
    );
  }

  const need = state.runsRequired ?? 0;
  const balls = state.ballsRemaining ?? 0;
  const rrr = balls > 0 ? need / (balls / 6) : 0;

  return (
    <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-accent/30 bg-accent/8 py-2.5">
      <Stat label="Target" value={String(state.target ?? 0)} />
      <Stat label="Need" value={`${need} off ${balls}`} />
      <Stat label="Req. rate" value={balls > 0 ? rrr.toFixed(2) : '—'} />
    </div>
  );
}

/** The current over as chips. onEdit is only wired up for the scorer. */
export function ThisOver({
  innings,
  onEdit,
}: {
  innings: DerivedInnings;
  onEdit?: (index: number) => void;
}) {
  const events = innings.events;
  if (events.length === 0) {
    return (
      <div className="px-4 pb-4 text-sm text-ink-500">No balls bowled yet.</div>
    );
  }

  // Walk back to the start of the over currently in progress.
  let startIndex = events.length;
  let legal = 0;
  while (startIndex > 0) {
    const ball = events[startIndex - 1];
    if (ball.delivery === 'NORMAL') {
      if (legal === 6) break;
      legal++;
    }
    startIndex--;
    if (legal === 6) break;
  }
  const current = events.slice(startIndex);
  const baseIndex = startIndex;

  return (
    <div className="flex flex-wrap gap-1.5 px-4 pb-4">
      {current.map((ball, i) => (
        <BallChip
          key={ball.id}
          ball={ball}
          onClick={onEdit ? () => onEdit(baseIndex + i) : undefined}
        />
      ))}
    </div>
  );
}
