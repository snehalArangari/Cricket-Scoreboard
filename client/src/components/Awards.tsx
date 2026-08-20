import { Link } from 'react-router-dom';
import { computeAwards, type PlayerAward } from '@shared/awards';
import { oversDisplay } from '@shared/engine';
import type { MatchState } from '@shared/types';
import { Panel } from './ui';

function battingLine(a: PlayerAward): string | null {
  if (!a.batted) return null;
  return `${a.runs}${a.out ? '' : '*'} (${a.balls})`;
}

function bowlingLine(a: PlayerAward): string | null {
  if (!a.bowled) return null;
  return `${a.wickets}/${a.runsConceded} (${oversDisplay(a.bowlingBalls)})`;
}

function PlayerName({ award }: { award: PlayerAward }) {
  // Registered players link to their profile; guests are just text.
  if (award.username) {
    return (
      <Link to={`/players/${award.username}`} className="text-ink-50 underline-offset-2 hover:underline">
        {award.name}
      </Link>
    );
  }
  return <span className="text-ink-50">{award.name}</span>;
}

function AwardRow({
  label,
  award,
  tone = 'default',
}: {
  label: string;
  award: PlayerAward | null;
  tone?: 'hero' | 'default';
}) {
  if (!award) return null;
  const lines = [battingLine(award), bowlingLine(award)].filter(Boolean).join('  ·  ');
  const hero = tone === 'hero';

  return (
    <div
      className={`px-4 py-3 ${hero ? 'border-b border-pitch-700 bg-accent/8' : 'border-b border-pitch-800 last:border-0'}`}
    >
      <div
        className={`text-[10px] font-bold tracking-[0.14em] uppercase ${hero ? 'text-accent' : 'text-ink-500'}`}
      >
        {label}
      </div>
      <div className={`mt-0.5 ${hero ? 'font-display text-lg font-bold' : 'text-sm'}`}>
        <PlayerName award={award} />
        <span className="ml-2 text-xs text-ink-500">{award.teamName}</span>
      </div>
      {lines && <div className="font-display text-xs tnum text-ink-300">{lines}</div>}
    </div>
  );
}

/**
 * Shown live as well as at the end — a "leading performer" mid-match is useful,
 * and it is the same calculation either way, so calling it something different
 * is the only honest change.
 */
export default function Awards({ state }: { state: MatchState }) {
  const awards = computeAwards(state);
  if (!awards.playerOfTheMatch) return null;

  const { playerOfTheMatch, bestBatter, bestBowler } = awards;
  const dedupe = (a: PlayerAward | null) =>
    a && a.playerId !== playerOfTheMatch.playerId ? a : null;

  return (
    <Panel title={awards.final ? 'Awards' : 'Leading so far'}>
      <AwardRow
        label={awards.final ? 'Player of the match' : 'Leading performer'}
        award={playerOfTheMatch}
        tone="hero"
      />
      <AwardRow label="Best batting" award={dedupe(bestBatter)} />
      <AwardRow label="Best bowling" award={dedupe(bestBowler)} />

      {awards.ranked.length > 1 && (
        <details className="border-t border-pitch-800">
          <summary className="cursor-pointer px-4 py-2 text-[11px] text-ink-500">
            Impact ranking
          </summary>
          <ul className="pb-2">
            {awards.ranked.slice(0, 8).map((a, i) => (
              <li key={a.playerId} className="flex items-center justify-between px-4 py-1.5 text-xs">
                <span className="min-w-0 truncate">
                  <span className="mr-2 text-ink-500">{i + 1}</span>
                  <PlayerName award={a} />
                </span>
                <span className="shrink-0 font-display tnum text-ink-300">
                  {Math.round(a.weighted)}
                </span>
              </li>
            ))}
          </ul>
          <p className="px-4 pb-3 text-[10px] leading-relaxed text-ink-500">
            Impact is runs-equivalent: 1 per run, +1 a four, +2 a six, 25 a wicket, 10 a maiden,
            plus strike-rate and economy bonuses once a player has faced 10 balls or bowled 2
            overs. The winning side is weighted 10% higher.
          </p>
        </details>
      )}
    </Panel>
  );
}
