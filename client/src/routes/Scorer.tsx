import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Ball, Delivery, Player } from '@shared/types';
import { oversDisplay } from '@shared/engine';
import { useMatch } from '../hooks/useMatch';
import { loadScorerToken } from '../lib/api';
import { Btn, ConnectionBar, Panel, Screen, Toast } from '../components/ui';
import { ScoreHero, ThisOver, activeInnings } from '../components/Scoreboard';
import { Scorecards } from '../components/Cards';
import BallComposer, { type ComposerDraft } from '../components/BallComposer';
import PlayerPicker from '../components/PlayerPicker';

const EMPTY_DRAFT: ComposerDraft = { delivery: 'NORMAL', batRuns: 0, wicket: null };

export default function Scorer() {
  const { matchId = '' } = useParams();
  const token = useMemo(() => loadScorerToken(matchId), [matchId]);
  const {
    state,
    role,
    conn,
    notice,
    fatal,
    hydrated,
    pending,
    dismissNotice,
    addBall,
    editBall,
    deleteBall,
    undo,
    startInnings2,
  } = useMatch(matchId, token);

  const [bowlerId, setBowlerId] = useState<string | null>(null);
  const [picker, setPicker] = useState<'bowler' | 'striker' | 'nonStriker' | null>(null);
  const [composer, setComposer] = useState<{ mode: 'new' | 'edit'; index?: number } | null>(null);
  const [draft, setDraft] = useState<ComposerDraft>(EMPTY_DRAFT);
  const [copied, setCopied] = useState(false);
  // The engine derives who is at the crease from the last ball and auto-picks the
  // next batter in squad order. This lets the scorer override that for the NEXT
  // delivery — choosing a different incoming batter, or fixing who took strike.
  const [override, setOverride] = useState<{ strikerId?: string; nonStrikerId?: string }>({});
  const lastOverFlag = useRef(false);

  const view = state ? activeInnings(state) : null;
  const innings = view?.innings;
  const battingTeam = view?.battingTeam;
  const bowlingTeam = view?.bowlingTeam;

  const byId = (team: Player[] | undefined, id: string | null | undefined) =>
    team?.find((p) => p.id === id);
  const striker = byId(battingTeam?.players, override.strikerId ?? innings?.strikerId);
  const nonStriker = byId(battingTeam?.players, override.nonStrikerId ?? innings?.nonStrikerId);
  const bowler = byId(bowlingTeam?.players, bowlerId) ?? byId(bowlingTeam?.players, innings?.lastBowlerId);

  // Default the bowler once the match loads.
  useEffect(() => {
    if (!bowlingTeam) return;
    if (bowlerId && bowlingTeam.players.some((p) => p.id === bowlerId)) return;
    setBowlerId(innings?.lastBowlerId ?? bowlingTeam.players[0]?.id ?? null);
  }, [bowlingTeam, bowlerId, innings?.lastBowlerId]);

  // Prompt for a new bowler when an over completes — but never block on it.
  useEffect(() => {
    const need = innings?.needNewBowler ?? false;
    if (need && !lastOverFlag.current && state?.status !== 'complete') setPicker('bowler');
    lastOverFlag.current = need;
  }, [innings?.needNewBowler, state?.status]);

  const live = state?.status === 'innings1' || state?.status === 'innings2';
  const canScore = Boolean(live && striker && nonStriker && bowler);

  function record(delivery: Delivery, batRuns: number, wicket: Ball['wicket'] = null) {
    if (!canScore || !striker || !nonStriker || !bowler) return;
    addBall({
      delivery,
      batRuns,
      strikerId: striker.id,
      nonStrikerId: nonStriker.id,
      bowlerId: bowler.id,
      wicket,
    });
    // The override applies to one delivery only — after that the engine's own
    // rotation takes over again.
    setOverride({});
  }

  function openComposer(mode: 'new' | 'edit', index?: number) {
    if (mode === 'edit' && index !== undefined && innings) {
      const ball = innings.events[index];
      if (!ball) return;
      setDraft({ delivery: ball.delivery, batRuns: ball.batRuns, wicket: ball.wicket });
    } else {
      setDraft(EMPTY_DRAFT);
    }
    setComposer({ mode, index });
  }

  function saveComposer() {
    if (!composer || !view) return;
    if (composer.mode === 'new') {
      record(draft.delivery, draft.batRuns, draft.wicket);
    } else if (composer.index !== undefined && innings) {
      const original = innings.events[composer.index];
      if (original) {
        editBall(view.key, composer.index, {
          ...original,
          delivery: draft.delivery,
          batRuns: draft.batRuns,
          wicket: draft.wicket,
        });
      }
    }
    setComposer(null);
  }

  async function share() {
    const url = `${location.origin}/live/${matchId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Watch live', text: 'Follow the score live', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard needs a secure context; show the URL so it can be copied by hand.
      window.prompt('Copy this link:', url);
    }
  }

  if (fatal === 'MATCH_NOT_FOUND') {
    return (
      <Screen>
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <h1 className="font-display text-2xl font-bold">Match not found</h1>
          <p className="mt-2 text-sm text-ink-300">
            This match id does not exist. It may have been created on another server.
          </p>
          <a href="/" className="mt-6 inline-block text-sm text-accent">
            Start a new match
          </a>
        </div>
      </Screen>
    );
  }

  if (!state) {
    return (
      <Screen>
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <div className="font-display text-lg text-ink-300">
            {hydrated ? 'Connecting to the match…' : 'Loading…'}
          </div>
          <p className="mt-2 text-xs text-ink-500">
            If the server has been idle it can take up to a minute to wake up.
          </p>
        </div>
      </Screen>
    );
  }

  const readOnly = role !== 'scorer';

  return (
    <Screen>
      <div className="mx-auto w-full max-w-md pb-8">
        <ConnectionBar conn={conn} pending={pending} />

        {readOnly && (
          <div className="bg-extra/15 px-4 py-2 text-center text-xs text-extra">
            You are viewing this match read-only — the scoring device holds the key.
          </div>
        )}

        <ScoreHero state={state} />

        {/* On-field */}
        {live && (
          <div className="grid grid-cols-3 gap-1.5 px-4 py-3">
            <OnFieldPill
              label="Striker"
              name={striker?.name ?? '—'}
              detail={statLine(innings, striker?.id)}
              accent
              onClick={readOnly ? undefined : () => setPicker('striker')}
            />
            <OnFieldPill
              label="Non-striker"
              name={nonStriker?.name ?? '—'}
              detail={statLine(innings, nonStriker?.id)}
              onClick={readOnly ? undefined : () => setPicker('nonStriker')}
            />
            <OnFieldPill
              label="Bowler"
              name={bowler?.name ?? '—'}
              detail={bowlLine(innings, bowler?.id)}
              onClick={readOnly ? undefined : () => setPicker('bowler')}
            />
          </div>
        )}

        {/* Innings break */}
        {state.status === 'innings1-complete' && !readOnly && (
          <div className="px-4 py-3">
            <Btn variant="primary" className="w-full py-4" onClick={startInnings2}>
              Start {state.setup.teamB.name}'s innings →
            </Btn>
          </div>
        )}

        {/* Scoring pads */}
        {live && !readOnly && (
          <div className="px-4">
            <div className="mb-2 grid grid-cols-3 gap-2">
              {[0, 1, 2, 3, 4, 6].map((n) => (
                <button
                  key={n}
                  disabled={!canScore}
                  onClick={() => record('NORMAL', n)}
                  className={`pressable rounded-xl border py-5 font-display text-3xl font-extrabold tnum disabled:opacity-30 ${
                    n === 4 || n === 6
                      ? 'border-accent/50 bg-accent/12 text-accent'
                      : 'border-pitch-600 bg-pitch-800 text-ink-50'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>

            <div className="mb-2 grid grid-cols-4 gap-2">
              <PadBtn label="Wicket" tone="live" disabled={!canScore} onClick={() => {
                setDraft({
                  delivery: 'NORMAL',
                  batRuns: 0,
                  wicket: { outBatterId: striker?.id ?? '', creditBowler: true },
                });
                setComposer({ mode: 'new' });
              }} />
              <PadBtn label="Wide" tone="extra" disabled={!canScore} onClick={() => record('WIDE', 0)} />
              <PadBtn label="No ball" tone="extra" disabled={!canScore} onClick={() => record('NO_BALL', 0)} />
              <PadBtn label="Dead" tone="mute" disabled={!canScore} onClick={() => record('DEAD_BALL', 0)} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Btn variant="ghost" onClick={undo}>
                ↩ Undo
              </Btn>
              <Btn variant="ghost" disabled={!canScore} onClick={() => openComposer('new')}>
                ✎ Custom ball
              </Btn>
            </div>
          </div>
        )}

        {/* This over */}
        {innings && (
          <div className="mt-4 px-4">
            <Panel title="This over">
              <ThisOver
                innings={innings}
                onEdit={readOnly ? undefined : (i) => openComposer('edit', i)}
              />
            </Panel>
          </div>
        )}

        {/* Share */}
        <div className="mt-3 px-4">
          <Btn variant="default" className="w-full" onClick={share}>
            {copied ? '✓ Link copied' : '⤴ Share live link'}
          </Btn>
          <p className="mt-1.5 text-center text-[11px] text-ink-500">
            Anyone with the link can watch. Only this device can score.
          </p>
        </div>

        {/* Cards */}
        {view && battingTeam && bowlingTeam && (
          <div className="mt-4 px-4">
            <Scorecards
              innings={view.innings}
              battingLabel={battingTeam.name}
              bowlingLabel={bowlingTeam.name}
            />
          </div>
        )}

        {/* First innings card once the chase is on */}
        {(state.status === 'innings2' || state.status === 'complete') && (
          <div className="mt-3 px-4">
            <Scorecards
              innings={state.innings1}
              battingLabel={`${state.setup.teamA.name} (1st innings)`}
              bowlingLabel={state.setup.teamB.name}
            />
          </div>
        )}
      </div>

      {composer && (
        <BallComposer
          draft={draft}
          setDraft={setDraft}
          striker={striker}
          nonStriker={nonStriker}
          mode={composer.mode}
          onSave={saveComposer}
          onDelete={
            composer.mode === 'edit' && composer.index !== undefined && view
              ? () => {
                  deleteBall(view.key, composer.index!);
                  setComposer(null);
                }
              : undefined
          }
          onClose={() => setComposer(null)}
        />
      )}

      {picker === 'bowler' && bowlingTeam && (
        <PlayerPicker
          title="Who is bowling?"
          players={bowlingTeam.players}
          selectedId={bowlerId}
          noteFor={(p) => (p.id === innings?.lastBowlerId ? 'bowled last over' : undefined)}
          onPick={setBowlerId}
          onClose={() => setPicker(null)}
        />
      )}

      {(picker === 'striker' || picker === 'nonStriker') && battingTeam && innings && (
        <PlayerPicker
          title={picker === 'striker' ? 'Who is on strike?' : 'Who is at the other end?'}
          players={battingTeam.players}
          selectedId={picker === 'striker' ? striker?.id : nonStriker?.id}
          disabledIds={[
            ...innings.batting.filter((c) => c.out).map((c) => c.playerId),
            (picker === 'striker' ? nonStriker?.id : striker?.id) ?? '',
          ].filter(Boolean)}
          noteFor={(p) => {
            const c = innings.batting.find((x) => x.playerId === p.id);
            return c?.batted ? `${c.runs} (${c.balls})` : 'yet to bat';
          }}
          onPick={(id) =>
            setOverride((prev) =>
              picker === 'striker' ? { ...prev, strikerId: id } : { ...prev, nonStrikerId: id },
            )
          }
          onClose={() => setPicker(null)}
        />
      )}

      {notice && <Toast message={notice} onDismiss={dismissNotice} />}
    </Screen>
  );
}

function statLine(innings: ReturnType<typeof activeInnings>['innings'] | undefined, id?: string) {
  const card = innings?.batting.find((c) => c.playerId === id);
  if (!card) return '';
  return `${card.runs} (${card.balls})`;
}

function bowlLine(innings: ReturnType<typeof activeInnings>['innings'] | undefined, id?: string) {
  const card = innings?.bowling.find((c) => c.playerId === id);
  if (!card) return '';
  return `${oversDisplay(card.legalBalls)}-${card.maidens}-${card.runs}-${card.wickets}`;
}

function OnFieldPill({
  label,
  name,
  detail,
  accent,
  onClick,
}: {
  label: string;
  name: string;
  detail: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`pressable rounded-xl border px-2.5 py-2 text-left ${
        accent ? 'border-accent/40 bg-accent/8' : 'border-pitch-700 bg-pitch-850'
      }`}
    >
      <div className="text-[9px] font-semibold tracking-[0.12em] text-ink-500 uppercase">{label}</div>
      <div className="truncate text-xs font-semibold text-ink-50">{name}</div>
      <div className="font-display text-xs tnum text-ink-300">{detail || '—'}</div>
    </Tag>
  );
}

function PadBtn({
  label,
  tone,
  onClick,
  disabled,
}: {
  label: string;
  tone: 'live' | 'extra' | 'mute';
  onClick: () => void;
  disabled?: boolean;
}) {
  const tones = {
    live: 'border-live/50 bg-live/12 text-live',
    extra: 'border-extra/40 bg-extra/12 text-extra',
    mute: 'border-pitch-600 bg-pitch-800 text-ink-300',
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`pressable rounded-xl border py-3.5 text-xs font-bold tracking-wide uppercase disabled:opacity-30 ${tones[tone]}`}
    >
      {label}
    </button>
  );
}

