import type { DerivedInnings } from '@shared/types';
import { oversDisplay } from '@shared/engine';
import { Panel } from './ui';

const th = 'px-2 py-1.5 text-[10px] font-semibold tracking-[0.1em] text-ink-500 uppercase';
const td = 'px-2 py-2 text-sm tnum';

export function BattingTable({ innings }: { innings: DerivedInnings }) {
  const rows = innings.batting.filter((c) => c.batted);
  if (rows.length === 0) {
    return <div className="px-4 pb-4 text-sm text-ink-500">Nobody has batted yet.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem]">
        <thead>
          <tr className="border-b border-pitch-700">
            <th className={`${th} text-left`}>Batter</th>
            <th className={`${th} text-right`}>R</th>
            <th className={`${th} text-right`}>B</th>
            <th className={`${th} text-right`}>4s</th>
            <th className={`${th} text-right`}>6s</th>
            <th className={`${th} text-right`}>SR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const onStrike = c.playerId === innings.strikerId && !c.out;
            const atCrease = !c.out && (c.playerId === innings.strikerId || c.playerId === innings.nonStrikerId);
            return (
              <tr key={c.playerId} className="border-b border-pitch-800/60 last:border-0">
                <td className={`${td} text-left`}>
                  <span className={atCrease ? 'text-ink-50' : 'text-ink-300'}>{c.name}</span>
                  {onStrike && <span className="ml-1 text-accent">*</span>}
                  {c.out && <span className="ml-2 text-[10px] tracking-wide text-live">OUT</span>}
                </td>
                <td className={`${td} text-right font-bold`}>{c.runs}</td>
                <td className={`${td} text-right text-ink-300`}>{c.balls}</td>
                <td className={`${td} text-right text-ink-300`}>{c.fours}</td>
                <td className={`${td} text-right text-ink-300`}>{c.sixes}</td>
                <td className={`${td} text-right text-ink-300`}>{c.strikeRate.toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function BowlingTable({ innings }: { innings: DerivedInnings }) {
  const rows = innings.bowling.filter((c) => c.bowled);
  if (rows.length === 0) {
    return <div className="px-4 pb-4 text-sm text-ink-500">Nobody has bowled yet.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem]">
        <thead>
          <tr className="border-b border-pitch-700">
            <th className={`${th} text-left`}>Bowler</th>
            <th className={`${th} text-right`}>O</th>
            <th className={`${th} text-right`}>M</th>
            <th className={`${th} text-right`}>R</th>
            <th className={`${th} text-right`}>W</th>
            <th className={`${th} text-right`}>Econ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.playerId} className="border-b border-pitch-800/60 last:border-0">
              <td className={`${td} text-left text-ink-300`}>{c.name}</td>
              <td className={`${td} text-right`}>{oversDisplay(c.legalBalls)}</td>
              <td className={`${td} text-right text-ink-300`}>{c.maidens}</td>
              <td className={`${td} text-right`}>{c.runs}</td>
              <td className={`${td} text-right font-bold text-accent`}>{c.wickets}</td>
              <td className={`${td} text-right text-ink-300`}>{c.economy.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Scorecards({
  innings,
  battingLabel,
  bowlingLabel,
}: {
  innings: DerivedInnings;
  battingLabel: string;
  bowlingLabel: string;
}) {
  return (
    <div className="space-y-3">
      <Panel title={`${battingLabel} — batting`}>
        <BattingTable innings={innings} />
      </Panel>
      <Panel title={`${bowlingLabel} — bowling`}>
        <BowlingTable innings={innings} />
      </Panel>
    </div>
  );
}
