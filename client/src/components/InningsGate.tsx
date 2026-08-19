import { useState } from 'react';
import type { DerivedInnings, Player } from '@shared/types';
import { oversDisplay } from '@shared/engine';
import { Btn } from './ui';
import PlayerPicker from './PlayerPicker';

/**
 * The gates that must be answered before scoring can continue: who is opening,
 * who comes in after a wicket, and who bowls the next over. Nothing is guessed
 * from squad order — a scorer standing at the boundary knows who walked out,
 * and the app should ask rather than assume.
 */

function SelectRow({
  label,
  value,
  placeholder,
  onOpen,
}: {
  label: string;
  value: string | undefined;
  placeholder: string;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="pressable flex w-full items-center justify-between rounded-xl border border-pitch-600 bg-pitch-900 px-3 py-3 text-left"
    >
      <span className="text-[10px] font-semibold tracking-[0.14em] text-ink-500 uppercase">
        {label}
      </span>
      <span className={`text-sm ${value ? 'text-ink-50' : 'text-ink-500'}`}>
        {value ?? placeholder}
        <span className="ml-2 text-ink-500">▾</span>
      </span>
    </button>
  );
}

function GatePanel({
  eyebrow,
  title,
  children,
  onConfirm,
  confirmLabel,
  ready,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  onConfirm: () => void;
  confirmLabel: string;
  ready: boolean;
}) {
  return (
    <div className="px-4 py-3">
      <div className="rounded-card border border-accent/40 bg-accent/8 p-4">
        <div className="text-[10px] font-bold tracking-[0.16em] text-accent uppercase">
          {eyebrow}
        </div>
        <h2 className="mt-0.5 mb-3 font-display text-lg font-bold text-ink-50">{title}</h2>
        <div className="space-y-2">{children}</div>
        <Btn
          variant="primary"
          className="mt-3 w-full py-3.5"
          disabled={!ready}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Btn>
      </div>
    </div>
  );
}

function battingNote(innings: DerivedInnings, id: string): string | undefined {
  const c = innings.batting.find((x) => x.playerId === id);
  if (!c?.batted) return 'yet to bat';
  return c.out ? 'out' : `${c.runs} (${c.balls})`;
}

function bowlingNote(innings: DerivedInnings, id: string): string | undefined {
  const c = innings.bowling.find((x) => x.playerId === id);
  if (!c?.bowled) return undefined;
  return `${oversDisplay(c.legalBalls)}-${c.maidens}-${c.runs}-${c.wickets}`;
}

/** Start of an innings: both openers and the bowler who will start. */
export function OpeningGate({
  teamName,
  batters,
  bowlers,
  innings,
  onConfirm,
}: {
  teamName: string;
  batters: Player[];
  bowlers: Player[];
  innings: DerivedInnings;
  onConfirm: (v: { strikerId: string; nonStrikerId: string; bowlerId: string }) => void;
}) {
  const [strikerId, setStrikerId] = useState<string>();
  const [nonStrikerId, setNonStrikerId] = useState<string>();
  const [bowlerId, setBowlerId] = useState<string>();
  const [picking, setPicking] = useState<'striker' | 'nonStriker' | 'bowler' | null>(null);

  const name = (id?: string) =>
    [...batters, ...bowlers].find((p) => p.id === id)?.name;
  const ready = Boolean(strikerId && nonStrikerId && bowlerId);

  return (
    <>
      <GatePanel
        eyebrow="Start of innings"
        title={`${teamName} to bat`}
        ready={ready}
        confirmLabel={ready ? 'Start scoring' : 'Choose all three'}
        onConfirm={() => onConfirm({ strikerId: strikerId!, nonStrikerId: nonStrikerId!, bowlerId: bowlerId! })}
      >
        <SelectRow
          label="Striker"
          value={name(strikerId)}
          placeholder="Choose batter"
          onOpen={() => setPicking('striker')}
        />
        <SelectRow
          label="Non-striker"
          value={name(nonStrikerId)}
          placeholder="Choose batter"
          onOpen={() => setPicking('nonStriker')}
        />
        <SelectRow
          label="Opening bowler"
          value={name(bowlerId)}
          placeholder="Choose bowler"
          onOpen={() => setPicking('bowler')}
        />
      </GatePanel>

      {picking === 'striker' && (
        <PlayerPicker
          title="Who is on strike?"
          players={batters}
          selectedId={strikerId}
          disabledIds={nonStrikerId ? [nonStrikerId] : []}
          onPick={setStrikerId}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === 'nonStriker' && (
        <PlayerPicker
          title="Who is at the other end?"
          players={batters}
          selectedId={nonStrikerId}
          disabledIds={strikerId ? [strikerId] : []}
          onPick={setNonStrikerId}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === 'bowler' && (
        <PlayerPicker
          title="Who bowls the first over?"
          players={bowlers}
          selectedId={bowlerId}
          onPick={setBowlerId}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}

/** A wicket has fallen — who walks in. */
export function NewBatterGate({
  outName,
  available,
  innings,
  onConfirm,
}: {
  outName: string;
  available: Player[];
  innings: DerivedInnings;
  onConfirm: (id: string) => void;
}) {
  const [id, setId] = useState<string>();
  const [picking, setPicking] = useState(false);
  const name = available.find((p) => p.id === id)?.name;

  return (
    <>
      <GatePanel
        eyebrow="Wicket"
        title={`${outName} is out`}
        ready={Boolean(id)}
        confirmLabel={id ? 'Continue' : 'Choose the next batter'}
        onConfirm={() => onConfirm(id!)}
      >
        <SelectRow
          label="Next batter"
          value={name}
          placeholder="Choose batter"
          onOpen={() => setPicking(true)}
        />
      </GatePanel>

      {picking && (
        <PlayerPicker
          title="Who comes in?"
          players={available}
          selectedId={id}
          noteFor={(p) => battingNote(innings, p.id)}
          onPick={setId}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

/** The over is done — who bowls the next one. */
export function NewBowlerGate({
  overNumber,
  bowlers,
  previousBowlerId,
  innings,
  onConfirm,
}: {
  overNumber: number;
  bowlers: Player[];
  previousBowlerId: string | null;
  innings: DerivedInnings;
  onConfirm: (id: string) => void;
}) {
  const [id, setId] = useState<string>();
  const [picking, setPicking] = useState(false);
  const name = bowlers.find((p) => p.id === id)?.name;

  return (
    <>
      <GatePanel
        eyebrow={overNumber === 1 ? 'First over' : `End of over ${overNumber - 1}`}
        title={`Who bowls over ${overNumber}?`}
        ready={Boolean(id)}
        confirmLabel={id ? 'Continue' : 'Choose a bowler'}
        onConfirm={() => onConfirm(id!)}
      >
        <SelectRow
          label="Bowler"
          value={name}
          placeholder="Choose bowler"
          onOpen={() => setPicking(true)}
        />
        {previousBowlerId && (
          <p className="px-1 text-[11px] text-ink-500">
            A bowler cannot bowl two overs in a row, so last over's bowler is greyed out.
          </p>
        )}
      </GatePanel>

      {picking && (
        <PlayerPicker
          title={`Over ${overNumber}`}
          players={bowlers}
          selectedId={id}
          // The one genuine cricket rule worth enforcing here — it is never
          // legal, so allowing it would only ever record a wrong scorecard.
          disabledIds={previousBowlerId ? [previousBowlerId] : []}
          noteFor={(p) =>
            p.id === previousBowlerId ? 'bowled last over' : bowlingNote(innings, p.id)
          }
          onPick={setId}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
