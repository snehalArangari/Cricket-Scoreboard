import { useState } from 'react';
import type { Ball, Delivery, Player, Wicket } from '@shared/types';
import { DELIVERY_LABEL, batterRunsFor, extrasFor, teamRunsFor } from '@shared/engine';
import { Btn } from './ui';

const DELIVERIES: Delivery[] = ['NORMAL', 'WIDE', 'NO_BALL', 'DEAD_BALL'];

export interface ComposerDraft {
  delivery: Delivery;
  batRuns: number;
  wicket: Wicket | null;
}

/**
 * One sheet for every awkward delivery. Because delivery type, runs and wicket
 * are independent, this covers a no-ball hit for six, a stumping off a wide and
 * a run-out on the second run of a no-ball without any special cases.
 */
export default function BallComposer({
  draft,
  setDraft,
  striker,
  nonStriker,
  mode,
  onSave,
  onDelete,
  onClose,
}: {
  draft: ComposerDraft;
  setDraft: (d: ComposerDraft) => void;
  striker: Player | undefined;
  nonStriker: Player | undefined;
  mode: 'new' | 'edit';
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const preview: Ball = {
    id: 'preview',
    delivery: draft.delivery,
    batRuns: draft.batRuns,
    strikerId: striker?.id ?? '',
    nonStrikerId: nonStriker?.id ?? '',
    bowlerId: '',
    wicket: draft.wicket,
  };
  const total = teamRunsFor(preview);
  const toBatter = batterRunsFor(preview);
  const asExtras = extrasFor(preview);

  const setWicketOn = (on: boolean) => {
    setDraft({
      ...draft,
      wicket: on ? { outBatterId: striker?.id ?? '', creditBowler: true } : null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl border-t border-pitch-600 bg-pitch-900 p-4 safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-bold tracking-wide text-ink-50 uppercase">
            {mode === 'edit' ? 'Edit ball' : 'Custom ball'}
          </h3>
          <button onClick={onClose} className="px-2 text-sm text-ink-300">
            Close
          </button>
        </div>

        {/* Delivery */}
        <div className="mb-3 grid grid-cols-4 gap-1.5">
          {DELIVERIES.map((d) => (
            <button
              key={d}
              onClick={() => setDraft({ ...draft, delivery: d })}
              className={`pressable rounded-lg border px-1 py-2 text-xs font-semibold ${
                draft.delivery === d
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-pitch-600 bg-pitch-800 text-ink-300'
              }`}
            >
              {DELIVERY_LABEL[d]}
            </button>
          ))}
        </div>

        {/* Runs */}
        <div className="mb-3">
          <div className="mb-1.5 font-display text-xs font-semibold tracking-[0.14em] text-ink-300 uppercase">
            Runs run / hit
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => setDraft({ ...draft, batRuns: n })}
                className={`pressable rounded-lg border py-2 font-display text-base font-bold tnum ${
                  draft.batRuns === n
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-pitch-600 bg-pitch-800 text-ink-50'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Btn
              variant="ghost"
              className="flex-1 py-1.5"
              onClick={() => setDraft({ ...draft, batRuns: Math.max(0, draft.batRuns - 1) })}
            >
              −
            </Btn>
            <span className="font-display text-sm tnum text-ink-300">{draft.batRuns}</span>
            <Btn
              variant="ghost"
              className="flex-1 py-1.5"
              onClick={() => setDraft({ ...draft, batRuns: Math.min(12, draft.batRuns + 1) })}
            >
              +
            </Btn>
          </div>
        </div>

        {/* Wicket */}
        <div className="mb-3 rounded-xl border border-pitch-700 bg-pitch-850 p-3">
          <label className="flex items-center justify-between">
            <span className="font-display text-sm font-semibold tracking-wide text-ink-50 uppercase">
              Wicket
            </span>
            <input
              type="checkbox"
              checked={draft.wicket !== null}
              onChange={(e) => setWicketOn(e.target.checked)}
              className="h-5 w-5 accent-[#ff3b5c]"
            />
          </label>

          {draft.wicket && (
            <div className="mt-3 space-y-2">
              <div className="text-[10px] font-semibold tracking-[0.14em] text-ink-500 uppercase">
                Who is out?
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[striker, nonStriker].map((p, i) =>
                  p ? (
                    <button
                      key={p.id}
                      onClick={() =>
                        setDraft({ ...draft, wicket: { ...draft.wicket!, outBatterId: p.id } })
                      }
                      className={`pressable rounded-lg border px-2 py-2 text-xs font-semibold ${
                        draft.wicket!.outBatterId === p.id
                          ? 'border-live bg-live/15 text-live'
                          : 'border-pitch-600 bg-pitch-800 text-ink-300'
                      }`}
                    >
                      {p.name}
                      <span className="ml-1 text-ink-500">{i === 0 ? '(striker)' : '(non-str)'}</span>
                    </button>
                  ) : null,
                )}
              </div>

              <label className="mt-1 flex items-center justify-between rounded-lg border border-pitch-600 bg-pitch-800 px-3 py-2">
                <span className="text-xs text-ink-300">
                  Run out / not the bowler's wicket
                </span>
                <input
                  type="checkbox"
                  checked={!draft.wicket.creditBowler}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      wicket: { ...draft.wicket!, creditBowler: !e.target.checked },
                    })
                  }
                  className="h-5 w-5 accent-[#2dd4ff]"
                />
              </label>
            </div>
          )}
        </div>

        {/* Live preview of what this ball actually does */}
        <div className="mb-3 rounded-xl border border-pitch-700 bg-pitch-950 px-3 py-2.5 text-xs text-ink-300">
          <span className="font-bold text-ink-50">{total}</span> to the total
          {toBatter > 0 && (
            <>
              {' · '}
              <span className="text-accent">{toBatter}</span> to {striker?.name ?? 'the batter'}
            </>
          )}
          {asExtras > 0 && (
            <>
              {' · '}
              <span className="text-extra">{asExtras}</span> extras
            </>
          )}
          {draft.delivery === 'NORMAL' ? ' · counts as a ball' : ' · not a legal ball'}
          {draft.wicket && <span className="text-live"> · wicket</span>}
        </div>

        <div className="flex gap-2">
          {mode === 'edit' && onDelete && (
            <Btn
              variant="danger"
              className="flex-1"
              onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
            >
              {confirmDelete ? 'Tap again to delete' : 'Delete ball'}
            </Btn>
          )}
          <Btn variant="primary" className="flex-1 py-3.5" onClick={onSave}>
            {mode === 'edit' ? 'Save changes' : 'Add ball'}
          </Btn>
        </div>
      </div>
    </div>
  );
}
