import type { Player } from '@shared/types';

/**
 * Never blocking: it opens with a sensible default already applied, so
 * dismissing it always leaves the scorer able to carry on. Standing on a field
 * with a bowler running in is the wrong moment for a modal you must answer.
 */
export default function PlayerPicker({
  title,
  players,
  selectedId,
  disabledIds = [],
  noteFor,
  onPick,
  onClose,
}: {
  title: string;
  players: Player[];
  selectedId?: string | null;
  disabledIds?: string[];
  noteFor?: (p: Player) => string | undefined;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div
        className="max-h-[70dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t border-pitch-600 bg-pitch-900 p-4 safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-bold tracking-wide text-ink-50 uppercase">
            {title}
          </h3>
          <button onClick={onClose} className="px-2 text-sm text-ink-300">
            Close
          </button>
        </div>

        <div className="space-y-1.5">
          {players.map((p) => {
            const disabled = disabledIds.includes(p.id);
            const note = noteFor?.(p);
            return (
              <button
                key={p.id}
                disabled={disabled}
                onClick={() => {
                  onPick(p.id);
                  onClose();
                }}
                className={`pressable flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm ${
                  p.id === selectedId
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-pitch-600 bg-pitch-800 text-ink-50'
                } ${disabled ? 'pointer-events-none opacity-30' : ''}`}
              >
                <span>{p.name}</span>
                {note && <span className="text-xs text-ink-500">{note}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
