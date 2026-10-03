import React from 'react';
import type { Cpl3Row } from '../../experimental/cpl3LossStreakBreaker';
import { CPL3_CONFIGS, cpl3Metrics } from '../../experimental/cpl3LossStreakBreaker';

interface Props {
  rows: Cpl3Row[];
  activeRow?: Cpl3Row | null;
}

export const ExperimentalTest9Panel: React.FC<Props> = ({ rows, activeRow }) => {
  const metrics = cpl3Metrics(rows);
  const config = CPL3_CONFIGS.find((item) => item.name === 'context-8-cap-3')!;
  const latest = activeRow ?? rows.at(-1) ?? null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs font-mono">
        <div className="p-2 rounded bg-[#020806] border border-[#A78BFA]/40 text-center">
          <span className="text-[10px] text-[#8D9B95] block">Config</span>
          <span className="text-[#A78BFA] font-bold">{config.name}</span>
        </div>
        <div className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60 text-center">
          <span className="text-[10px] text-[#8D9B95] block">Coverage</span>
          <span className="text-[#35B978] font-bold">{Math.round(metrics.coverage * 100)}%</span>
        </div>
        <div className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60 text-center">
          <span className="text-[10px] text-[#8D9B95] block">Longest Loss</span>
          <span className="text-[#F04444] font-bold">{metrics.longestLossStreak}</span>
        </div>
        <div className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60 text-center">
          <span className="text-[10px] text-[#8D9B95] block">Loss Episodes</span>
          <span className="text-[#F5F5F5] font-bold">{metrics.lossStreakCount}</span>
        </div>
        <div className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60 text-center">
          <span className="text-[10px] text-[#8D9B95] block">Drawdown</span>
          <span className="text-[#F5F5F5] font-bold">{metrics.maximumDrawdown}</span>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-[#071A14] border border-[#A78BFA]/30 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-[10px] text-[#8D9B95] uppercase font-mono block">Test 9 — CPL-3 Loss-Streak Breaker</span>
          <span className="text-xs text-[#8D9B95] font-sans">Frozen context-8-cap-3; CPL-1 probabilities feed the final decision.</span>
        </div>
        <div className="text-right font-mono">
          <span className="text-[10px] text-[#8D9B95] block">Current prediction</span>
          <span className={`text-xl font-black ${latest?.prediction === 'BIG' ? 'text-[#E7B93F]' : latest?.prediction === 'SMALL' ? 'text-[#60A5FA]' : 'text-[#8D9B95]'}`}>
            {latest?.prediction ?? '—'}
          </span>
          {latest && <span className="text-[10px] text-[#8D9B95] block">Prior loss streak: {latest.priorLossStreak}</span>}
        </div>
      </div>
    </div>
  );
};
