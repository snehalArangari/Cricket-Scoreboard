import type { ReactNode } from 'react';
import type { Ball } from '@shared/types';
import { ballChipLabel, countsAsWicket } from '@shared/engine';

export function Panel({
  children,
  className = '',
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <section
      className={`rounded-card border border-pitch-700 bg-pitch-850 overflow-hidden ${className}`}
    >
      {(title || action) && (
        <header className="flex items-center justify-between px-4 pt-3 pb-2">
          {title && (
            <h2 className="font-display text-sm font-bold tracking-[0.14em] text-ink-300 uppercase">
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Btn({
  children,
  onClick,
  variant = 'default',
  disabled,
  className = '',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  const styles: Record<string, string> = {
    default: 'bg-pitch-800 border-pitch-600 text-ink-50 hover:bg-pitch-700',
    primary: 'bg-accent border-accent text-pitch-950 font-bold hover:brightness-110',
    danger: 'bg-live/15 border-live/50 text-live hover:bg-live/25',
    ghost: 'bg-transparent border-pitch-700 text-ink-300 hover:text-ink-50 hover:border-pitch-600',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`pressable rounded-xl border px-4 py-3 text-sm ${styles[variant]} disabled:opacity-35 disabled:pointer-events-none ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-display text-xs font-semibold tracking-[0.14em] text-ink-300 uppercase">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

const inputBase =
  'w-full rounded-xl border border-pitch-600 bg-pitch-900 px-3 py-2.5 text-ink-50 ' +
  'placeholder:text-ink-500 outline-none focus:border-accent focus:ring-1 focus:ring-accent';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} ${props.className ?? ''}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputBase} resize-y ${props.className ?? ''}`} />;
}

/** A single delivery, coloured by what happened. */
export function BallChip({ ball, onClick }: { ball: Ball; onClick?: () => void }) {
  const wicket = countsAsWicket(ball);
  const extra = ball.delivery === 'WIDE' || ball.delivery === 'NO_BALL';
  const boundary = ball.delivery !== 'DEAD_BALL' && (ball.batRuns === 4 || ball.batRuns === 6);

  let tone = 'border-pitch-600 bg-pitch-800 text-ink-300';
  if (wicket) tone = 'border-live/60 bg-live/20 text-live';
  else if (extra) tone = 'border-extra/50 bg-extra/15 text-extra';
  else if (boundary) tone = 'border-accent/50 bg-accent/15 text-accent';
  else if (ball.batRuns > 0) tone = 'border-pitch-600 bg-pitch-800 text-ink-50';

  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      onClick={onClick}
      className={`inline-flex min-w-9 shrink-0 items-center justify-center rounded-lg border px-2 py-1.5 font-display text-sm font-bold tnum ${tone} ${
        onClick ? 'pressable cursor-pointer' : ''
      }`}
    >
      {ballChipLabel(ball)}
    </Tag>
  );
}

/**
 * Fixed to the bottom, deliberately.
 *
 * These messages appear and disappear as the connection changes. In the normal
 * document flow that reflows everything below them, so the scoreboard jumps
 * down and back up mid-over — precisely when the scorer is trying to hit a
 * button. Fixed positioning takes them out of flow, so the scoring pad never
 * moves under your thumb.
 *
 * The "syncing" state is gone entirely: the optimistic apply already shows the
 * ball the instant it is tapped, so announcing a write that has already been
 * reflected on screen was pure noise. Only genuinely actionable states remain.
 */
export function StatusBar({
  conn,
  pending,
  role,
  readOnlyExpected = false,
}: {
  conn: string;
  pending: number;
  role: 'owner' | 'scorer' | 'viewer';
  /** True on the watch page, where being read-only is the whole point and
   *  saying so would just be clutter. */
  readOnlyExpected?: boolean;
}) {
  const offline = conn !== 'online';

  let tone: string;
  let message: string;

  if (offline) {
    tone = 'border-live/50 bg-live/20 text-live';
    message = readOnlyExpected
      ? 'Reconnecting to the live feed…'
      : pending > 0
        ? `Offline — ${pending} ball${pending === 1 ? '' : 's'} saved, syncing when you reconnect`
        : 'Offline — reconnecting…';
  } else if (role === 'viewer' && !readOnlyExpected) {
    tone = 'border-extra/40 bg-extra/15 text-extra';
    message = 'Read-only — ask the match creator to invite you';
  } else if (role === 'scorer' && !readOnlyExpected) {
    tone = 'border-pitch-600 bg-pitch-850 text-ink-500';
    message = 'Scoring as an invited scorer';
  } else {
    return null; // owner, online: nothing worth saying
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className={`w-full max-w-md rounded-lg border px-3 py-1.5 text-center text-[11px] ${tone}`}>
        {message}
      </div>
    </div>
  );
}

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  // Sits above the status bar so the two never overlap.
  return (
    <div className="fixed inset-x-0 bottom-12 z-50 mx-auto w-[min(92vw,26rem)] px-3">
      <button
        onClick={onDismiss}
        className="w-full rounded-xl border border-live/50 bg-pitch-800 px-4 py-3 text-left text-sm text-ink-50 shadow-lg"
      >
        {message}
        <span className="ml-2 text-ink-500">tap to dismiss</span>
      </button>
    </div>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-pitch-950 text-ink-50">{children}</div>;
}
