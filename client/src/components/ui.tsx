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

export function ConnectionBar({ conn, pending }: { conn: string; pending: number }) {
  if (conn === 'online' && pending === 0) return null;
  const offline = conn !== 'online';
  return (
    <div
      className={`px-4 py-2 text-center text-xs font-medium ${
        offline ? 'bg-live/20 text-live' : 'bg-accent/15 text-accent'
      }`}
    >
      {offline
        ? pending > 0
          ? `Offline — ${pending} ball${pending === 1 ? '' : 's'} saved, will sync when you reconnect`
          : 'Offline — reconnecting…'
        : `Syncing ${pending} change${pending === 1 ? '' : 's'}…`}
    </div>
  );
}

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-[min(92vw,26rem)]">
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
