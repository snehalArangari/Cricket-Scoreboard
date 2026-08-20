import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Ball, Delivery, InningsKey, Player } from '@shared/types';
import { groupIntoOvers, isLegalDelivery, nextBatterPositions, oversDisplay } from '@shared/engine';
import { useMatch } from '../hooks/useMatch';
import {
  consumeInviteToken,
  createMatchRequest,
  loadScorerToken,
  saveScorerToken,
} from '../lib/api';
import ResultPanel from '../components/ResultPanel';
import ScorerManager from '../components/ScorerManager';
import Awards from '../components/Awards';
import { Btn, Panel, Screen, StatusBar, Toast } from '../components/ui';
import { ScoreHero, ThisOver, activeInnings } from '../components/Scoreboard';
import { Scorecards } from '../components/Cards';
import BallComposer, { type ComposerDraft } from '../components/BallComposer';
import PlayerPicker from '../components/PlayerPicker';
import { NewBatterGate, NewBowlerGate, OpeningGate } from '../components/InningsGate';

const EMPTY_DRAFT: ComposerDraft = { delivery: 'NORMAL', batRuns: 0, wicket: null };

export default function Scorer() {
  const { matchId = '' } = useParams();
  const navigate = useNavigate();
  // An invite arrives as #t=<token>. Claim it before the socket connects, so
  // the handshake presents it and the server grants scoring rights straight away.
  const token = useMemo(() => {
    consumeInviteToken(matchId);
    return loadScorerToken(matchId);
  }, [matchId]);
  const {
    state,
    role,
    mayScore,
    isOwner,
    scorers,
    setScorers,
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

  // Who is on the field is CHOSEN, not guessed. Openers are picked before the
  // first ball, a new batter after each wicket, and a new bowler each over.
  //
  // Every one of these carries the innings (and over, or ball) it belongs to, so
  // it invalidates ITSELF when the match moves on. An effect that cleared them
  // on an innings change looked equivalent but was not: the derived innings can
  // flip briefly while an operation is in flight, and each flip wiped a
  // selection the scorer had already made, re-opening the gate underneath them.
  const [openers, setOpeners] = useState<{
    key: InningsKey;
    strikerId: string;
    nonStrikerId: string;
  } | null>(null);
  const [bowlerChoice, setBowlerChoice] = useState<{
    key: InningsKey;
    overIndex: number;
    id: string;
  } | null>(null);
  const [incoming, setIncoming] = useState<{ afterBallId: string; id: string } | null>(null);
  const [swappedFor, setSwappedFor] = useState<string | null>(null);

  const [picker, setPicker] = useState<'bowler' | null>(null);
  const [composer, setComposer] = useState<{ mode: 'new' | 'edit'; index?: number } | null>(null);
  const [draft, setDraft] = useState<ComposerDraft>(EMPTY_DRAFT);
  const [copied, setCopied] = useState(false);
  const [rematchBusy, setRematchBusy] = useState(false);
  const [rematchError, setRematchError] = useState<string | null>(null);

  const view = state ? activeInnings(state) : null;
  const innings = view?.innings;
  const battingTeam = view?.battingTeam;
  const bowlingTeam = view?.bowlingTeam;
  const inningsKey = view?.key;

  const events = innings?.events ?? [];
  const legalBalls = innings?.legalBalls ?? 0;
  const overIndex = Math.floor(legalBalls / 6); // the over now being bowled, 0-based
  const lastBall = events.length > 0 ? events[events.length - 1] : null;
  const live = state?.status === 'innings1' || state?.status === 'innings2';

  // If the current over is already under way, the bowler is recoverable from the
  // ball log — so a page refresh mid-over does not re-ask.
  const overGroups = groupIntoOvers(events);
  const lastGroup = overGroups.length > 0 ? overGroups[overGroups.length - 1] : [];
  const lastGroupComplete = lastGroup.filter((b) => isLegalDelivery(b.delivery)).length === 6;
  const currentOverBalls = lastGroupComplete ? [] : lastGroup;
  const bowlerFromLog = currentOverBalls.find((b) => b.delivery !== 'DEAD_BALL')?.bowlerId ?? null;
  // A choice only counts for the innings and over it was made in.
  const bowlerId =
    bowlerChoice && bowlerChoice.key === inningsKey && bowlerChoice.overIndex === overIndex
      ? bowlerChoice.id
      : bowlerFromLog;

  // The batter chosen to replace the one dismissed by the most recent ball.
  const incomingId = lastBall && incoming?.afterBallId === lastBall.id ? incoming.id : null;

  // Anyone who has not yet been to the crease.
  const seen = new Set<string>();
  for (const b of events) {
    if (b.delivery === 'DEAD_BALL') continue;
    seen.add(b.strikerId);
    seen.add(b.nonStrikerId);
  }
  const availableBatters = (battingTeam?.players ?? []).filter((p) => !seen.has(p.id));

  // Positions for the next delivery.
  const openersForInnings = openers && openers.key === inningsKey ? openers : null;

  let strikerId: string | null = null;
  let nonStrikerId: string | null = null;
  if (events.length === 0) {
    strikerId = openersForInnings?.strikerId ?? null;
    nonStrikerId = openersForInnings?.nonStrikerId ?? null;
  } else if (lastBall) {
    const pos = nextBatterPositions(
      lastBall.strikerId,
      lastBall.nonStrikerId,
      lastBall,
      legalBalls > 0 && legalBalls % 6 === 0,
      incomingId,
    );
    strikerId = pos.strikerId;
    nonStrikerId = pos.nonStrikerId;
  }
  // The swap applies to the next delivery only, identified by the ball it
  // follows ('start' before the first one).
  const swapAnchor = lastBall ? lastBall.id : `start:${inningsKey}`;
  const swapped = swappedFor === swapAnchor;
  if (swapped) [strikerId, nonStrikerId] = [nonStrikerId, strikerId];

  const byId = (team: Player[] | undefined, id: string | null) =>
    id ? team?.find((p) => p.id === id) : undefined;
  const striker = byId(battingTeam?.players, strikerId);
  const nonStriker = byId(battingTeam?.players, nonStrikerId);
  const bowler = byId(bowlingTeam?.players, bowlerId);

  // ---- The gates. Scoring is blocked until each is answered. ----
  const needOpeners = Boolean(live && events.length === 0 && !openersForInnings);
  const needNewBatter = Boolean(
    live && !needOpeners && lastBall?.wicket && !incomingId && availableBatters.length > 0,
  );
  const needNewBowler = Boolean(live && !needOpeners && !needNewBatter && !bowlerId);
  const gated = needOpeners || needNewBatter || needNewBowler;
  const canScore = Boolean(live && !gated && striker && nonStriker && bowler);

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
    setSwappedFor(null);
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

  /** Starts a fresh match reusing both squads and the over count. */
  async function rematch(swapSides: boolean) {
    if (!state || rematchBusy) return;
    setRematchBusy(true);
    setRematchError(null);
    const { teamA, teamB, overs } = state.setup;
    // "Swap sides" means whoever chased last time bats first this time.
    const first = swapSides ? teamB : teamA;
    const second = swapSides ? teamA : teamB;
    try {
      const created = await createMatchRequest({
        overs,
        teamAName: first.name,
        teamBName: second.name,
        // Carry the account links across, or a rematch would quietly demote
        // every registered player to a guest and lose their stats.
        teamAPlayers: first.players.map((p) => ({ name: p.name, username: p.username ?? null })),
        teamBPlayers: second.players.map((p) => ({ name: p.name, username: p.username ?? null })),
      });
      saveScorerToken(created.matchId, created.scorerToken);
      navigate(`/score/${created.matchId}`, { replace: false });
    } catch (err) {
      setRematchError(err instanceof Error ? err.message : 'Could not start the rematch');
      setRematchBusy(false);
    }
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

  if (!state || !view || !innings || !battingTeam || !bowlingTeam) {
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

  const readOnly = !mayScore;
  const outName =
    lastBall?.wicket
      ? battingTeam.players.find((p) => p.id === lastBall.wicket!.outBatterId)?.name ?? 'The batter'
      : '';

  return (
    <Screen>
      {/* pb-16 is constant, so the fixed status bar never covers the last row
          and never shifts the layout when it appears. */}
      <div className="mx-auto w-full max-w-md pb-16">
        <ScoreHero state={state} />

        {/* ---- Gates ---- */}
        {!readOnly && needOpeners && (
          <OpeningGate
            teamName={battingTeam.name}
            batters={battingTeam.players}
            bowlers={bowlingTeam.players}
            innings={innings}
            onConfirm={({ strikerId: s, nonStrikerId: ns, bowlerId: b }) => {
              setOpeners({ key: view.key, strikerId: s, nonStrikerId: ns });
              setBowlerChoice({ key: view.key, overIndex: 0, id: b });
            }}
          />
        )}

        {!readOnly && needNewBatter && (
          <NewBatterGate
            outName={outName}
            available={availableBatters}
            innings={innings}
            onConfirm={(id) => setIncoming({ afterBallId: lastBall!.id, id })}
          />
        )}

        {!readOnly && needNewBowler && (
          <NewBowlerGate
            overNumber={overIndex + 1}
            bowlers={bowlingTeam.players}
            previousBowlerId={innings.lastBowlerId}
            innings={innings}
            onConfirm={(id) => setBowlerChoice({ key: view.key, overIndex, id })}
          />
        )}

        {/* ---- Result + rematch ---- */}
        {state.status === 'complete' && !readOnly && (
          <ResultPanel
            state={state}
            busy={rematchBusy}
            error={rematchError}
            onRematch={rematch}
            onNewMatch={() => navigate('/')}
          />
        )}

        {state.status === 'complete' && (
          <div className="mt-3 px-4">
            <Awards state={state} />
          </div>
        )}

        {/* ---- On field ---- */}
        {live && !gated && (
          <div className="px-4 py-3">
            <div className="grid grid-cols-3 gap-1.5">
              <OnFieldPill
                label="Striker"
                name={striker?.name ?? '—'}
                detail={batLine(innings, striker?.id)}
                accent
              />
              <OnFieldPill
                label="Non-striker"
                name={nonStriker?.name ?? '—'}
                detail={batLine(innings, nonStriker?.id)}
              />
              <OnFieldPill
                label="Bowler"
                name={bowler?.name ?? '—'}
                detail={bowlLine(innings, bowler?.id)}
                onClick={readOnly ? undefined : () => setPicker('bowler')}
              />
            </div>
            {!readOnly && (
              <button
                onClick={() => setSwappedFor((cur) => (cur === swapAnchor ? null : swapAnchor))}
                className={`pressable mt-1.5 w-full rounded-lg border py-1.5 text-[11px] ${
                  swapped
                    ? 'border-accent/50 bg-accent/12 text-accent'
                    : 'border-pitch-700 bg-pitch-850 text-ink-500'
                }`}
              >
                ⇄ Swap strike {swapped && '(applied to next ball)'}
              </button>
            )}
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
                  className={`pressable rounded-xl border py-5 font-display text-3xl font-extrabold tnum disabled:opacity-25 ${
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
              <PadBtn
                label="Wicket"
                tone="live"
                disabled={!canScore}
                onClick={() => {
                  setDraft({
                    delivery: 'NORMAL',
                    batRuns: 0,
                    wicket: { outBatterId: striker?.id ?? '', creditBowler: true },
                  });
                  setComposer({ mode: 'new' });
                }}
              />
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

        <div className="mt-4 px-4">
          <Panel title="This over">
            <ThisOver innings={innings} onEdit={readOnly ? undefined : (i) => openComposer('edit', i)} />
          </Panel>
        </div>

        <div className="mt-3 px-4">
          <Btn variant="default" className="w-full" onClick={share}>
            {copied ? '✓ Link copied' : '⤴ Share live link'}
          </Btn>
          <p className="mt-1.5 text-center text-[11px] text-ink-500">
            Anyone with this link can watch, but not score.
          </p>
        </div>

        {/* Inviting co-scorers is the creator's privilege alone. */}
        {isOwner && (
          <div className="mt-3 px-4">
            <ScorerManager
              matchId={matchId}
              token={token}
              scorers={scorers}
              onRefresh={setScorers}
            />
          </div>
        )}

        <div className="mt-4 px-4">
          <Scorecards
            innings={innings}
            battingLabel={battingTeam.name}
            bowlingLabel={bowlingTeam.name}
          />
        </div>

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
            composer.mode === 'edit' && composer.index !== undefined
              ? () => {
                  deleteBall(view.key, composer.index!);
                  setComposer(null);
                }
              : undefined
          }
          onClose={() => setComposer(null)}
        />
      )}

      {picker === 'bowler' && (
        <PlayerPicker
          title="Change the bowler"
          players={bowlingTeam.players}
          selectedId={bowlerId}
          noteFor={(p) => (p.id === innings.lastBowlerId ? 'bowled last over' : bowlLine(innings, p.id))}
          onPick={(id) => setBowlerChoice({ key: view.key, overIndex, id })}
          onClose={() => setPicker(null)}
        />
      )}

      <StatusBar conn={conn} pending={pending} role={role} />
      {notice && <Toast message={notice} onDismiss={dismissNotice} />}
    </Screen>
  );
}

function batLine(innings: ReturnType<typeof activeInnings>['innings'], id?: string) {
  const card = innings.batting.find((c) => c.playerId === id);
  return card ? `${card.runs} (${card.balls})` : '';
}

function bowlLine(innings: ReturnType<typeof activeInnings>['innings'], id?: string) {
  const card = innings.bowling.find((c) => c.playerId === id);
  if (!card || !card.bowled) return '';
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
      className={`pressable rounded-xl border py-3.5 text-xs font-bold tracking-wide uppercase disabled:opacity-25 ${tones[tone]}`}
    >
      {label}
    </button>
  );
}
