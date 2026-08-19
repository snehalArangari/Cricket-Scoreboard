import { useState } from 'react';
import type { MatchState } from '@shared/types';
import { oversDisplay } from '@shared/engine';
import { Btn } from './ui';

function InningsLine({
  teamName,
  runs,
  wickets,
  legalBalls,
  winner,
}: {
  teamName: string;
  runs: number;
  wickets: number;
  legalBalls: number;
  winner: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-pitch-700 py-2 last:border-0">
      <span className={`text-sm ${winner ? 'font-semibold text-ink-50' : 'text-ink-300'}`}>
        {teamName}
        {winner && <span className="ml-1.5 text-accent">▸</span>}
      </span>
      <span className="font-display text-lg font-bold tnum text-ink-50">
        {runs}/{wickets}
        <span className="ml-1.5 text-xs font-medium text-ink-500">({oversDisplay(legalBalls)})</span>
      </span>
    </div>
  );
}

/**
 * The end of a match is also the start of the next one — most sides play again
 * with the same squads, so re-typing every name would be busywork. Swapping who
 * bats first is offered as the default because that is the usual arrangement.
 */
export default function ResultPanel({
  state,
  onRematch,
  onNewMatch,
  busy,
  error,
}: {
  state: MatchState;
  onRematch: (swapSides: boolean) => void;
  onNewMatch: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [confirming, setConfirming] = useState<null | boolean>(null);
  const { teamA, teamB } = state.setup;

  return (
    <div className="px-4 py-3">
      <div className="rounded-card border border-accent/40 bg-accent/8 p-4">
        <div className="text-[10px] font-bold tracking-[0.16em] text-accent uppercase">
          Match complete
        </div>
        <h2 className="mt-0.5 mb-3 font-display text-xl font-extrabold text-ink-50">
          {state.resultText}
        </h2>

        <div className="mb-4 rounded-xl border border-pitch-700 bg-pitch-950/60 px-3">
          <InningsLine
            teamName={teamA.name}
            runs={state.innings1.runs}
            wickets={state.innings1.wickets}
            legalBalls={state.innings1.legalBalls}
            winner={state.winner === 'A'}
          />
          <InningsLine
            teamName={teamB.name}
            runs={state.innings2.runs}
            wickets={state.innings2.wickets}
            legalBalls={state.innings2.legalBalls}
            winner={state.winner === 'B'}
          />
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-live/50 bg-live/10 px-3 py-2 text-xs text-live">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Btn
            variant="primary"
            className="w-full py-3.5"
            disabled={busy}
            onClick={() => (confirming === true ? onRematch(true) : setConfirming(true))}
          >
            {busy && confirming === true
              ? 'Creating…'
              : confirming === true
                ? `Confirm — ${teamB.name} bat first`
                : '↻ Rematch, swap sides'}
          </Btn>
          <Btn
            variant="default"
            className="w-full"
            disabled={busy}
            onClick={() => (confirming === false ? onRematch(false) : setConfirming(false))}
          >
            {busy && confirming === false
              ? 'Creating…'
              : confirming === false
                ? `Confirm — ${teamA.name} bat first`
                : '↻ Rematch, same order'}
          </Btn>
          <Btn variant="ghost" className="w-full" disabled={busy} onClick={onNewMatch}>
            New match from scratch
          </Btn>
        </div>

        <p className="mt-3 text-center text-[11px] text-ink-500">
          A rematch keeps both squads and the over count, and gets a fresh share link.
          This scorecard stays available at its own link.
        </p>
      </div>
    </div>
  );
}
