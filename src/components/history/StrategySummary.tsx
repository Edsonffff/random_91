import React, { useMemo } from 'react';
import type { TestResult } from '../../types/result';
import { Target, TrendingUp, Zap, PieChart } from 'lucide-react';
import { CollapsibleCard } from '../common/CollapsibleCard';

interface StrategySummaryProps {
  results: TestResult[];
}

export const StrategySummary: React.FC<StrategySummaryProps> = ({ results }) => {
  const stats = useMemo(() => {
    const total = results.length;
    if (total === 0) {
      return {
        total: 0,
        bigCount: 0,
        smallCount: 0,
        bigPct: 0,
        smallPct: 0,
        redCount: 0,
        greenCount: 0,
        violetCount: 0,
        evenCount: 0,
        oddCount: 0,
        numFrequencies: Array(10).fill(0),
      };
    }

    let bigCount = 0;
    let smallCount = 0;
    let redCount = 0;
    let greenCount = 0;
    let violetCount = 0;
    let evenCount = 0;
    let oddCount = 0;
    const numFrequencies = Array(10).fill(0);

    results.forEach((r) => {
      if (r.size === 'Big') bigCount++;
      else smallCount++;

      if (r.colors.includes('red')) redCount++;
      if (r.colors.includes('green')) greenCount++;
      if (r.colors.includes('violet')) violetCount++;

      if (r.winningNumber % 2 === 0) evenCount++;
      else oddCount++;

      if (r.winningNumber >= 0 && r.winningNumber <= 9) {
        numFrequencies[r.winningNumber]++;
      }
    });

    return {
      total,
      bigCount,
      smallCount,
      bigPct: Math.round((bigCount / total) * 100),
      smallPct: Math.round((smallCount / total) * 100),
      redCount,
      greenCount,
      violetCount,
      evenCount,
      oddCount,
      numFrequencies,
    };
  }, [results]);

  return (
    <div className="space-y-6">
      {/* 4 Overview Mini-Cards */}
      <CollapsibleCard
        id="strategy_overview_section"
        title={
          <div className="flex items-center gap-2">
            <PieChart className="w-4 h-4 text-[#E7B93F]" />
            <h3 className="text-sm font-bold text-[#F5F5F5] uppercase tracking-wider">
              Strategy Overview & Distribution
            </h3>
          </div>
        }
        subtitle="Size ratio, color distribution, parity, and simulation state"
        headerRight={
          <span className="text-xs font-mono text-[#8D9B95]">
            {stats.total} total draws analyzed
          </span>
        }
        bodyClassName="p-5 sm:p-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Big vs Small */}
          <div className="p-5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
            <div className="flex items-center justify-between text-xs text-[#8D9B95] uppercase font-semibold">
              <span>Size Distribution</span>
              <PieChart className="w-4 h-4 text-[#E7B93F]" />
            </div>
            <div className="mt-3 flex items-baseline justify-between font-mono">
              <div>
                <span className="text-xl font-bold text-[#E7B93F]">{stats.bigPct}%</span>
                <span className="text-xs text-[#8D9B95] ml-1">Big ({stats.bigCount})</span>
              </div>
              <div>
                <span className="text-xl font-bold text-[#35B978]">{stats.smallPct}%</span>
                <span className="text-xs text-[#8D9B95] ml-1">Small ({stats.smallCount})</span>
              </div>
            </div>
            {/* Progress bar */}
            <div className="w-full h-1.5 bg-[#020806] rounded-full overflow-hidden mt-3 flex">
              <div
                className="bg-[#E7B93F] h-full"
                style={{ width: `${stats.bigPct}%` }}
              />
              <div
                className="bg-[#35B978] h-full"
                style={{ width: `${stats.smallPct}%` }}
              />
            </div>
          </div>

          {/* Color Frequencies */}
          <div className="p-5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
            <div className="flex items-center justify-between text-xs text-[#8D9B95] uppercase font-semibold">
              <span>Color Split</span>
              <Target className="w-4 h-4 text-[#35B978]" />
            </div>
            <div className="mt-3 flex items-center justify-between font-mono text-xs">
              <span className="text-[#35B978] font-bold">
                ● Green: {stats.greenCount}
              </span>
              <span className="text-[#F04444] font-bold">
                ● Red: {stats.redCount}
              </span>
              <span className="text-[#C94DDA] font-bold">
                ● Violet: {stats.violetCount}
              </span>
            </div>
            <p className="text-[11px] text-[#8D9B95] mt-3">
              Violet appears with 0 (Red) and 5 (Green)
            </p>
          </div>

          {/* Parity (Even vs Odd) */}
          <div className="p-5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
            <div className="flex items-center justify-between text-xs text-[#8D9B95] uppercase font-semibold">
              <span>Parity Spread</span>
              <TrendingUp className="w-4 h-4 text-[#E7B93F]" />
            </div>
            <div className="mt-3 flex items-baseline justify-between font-mono">
              <div>
                <span className="text-lg font-bold text-[#F5F5F5]">{stats.evenCount}</span>
                <span className="text-xs text-[#8D9B95] ml-1">Even</span>
              </div>
              <div>
                <span className="text-lg font-bold text-[#F5F5F5]">{stats.oddCount}</span>
                <span className="text-xs text-[#8D9B95] ml-1">Odd</span>
              </div>
            </div>
            <p className="text-[11px] text-[#8D9B95] mt-3">
              Calculated across {stats.total} test draws
            </p>
          </div>

          {/* Active Pattern Verification */}
          <div className="p-5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
            <div className="flex items-center justify-between text-xs text-[#8D9B95] uppercase font-semibold">
              <span>Simulation State</span>
              <Zap className="w-4 h-4 text-[#35B978]" />
            </div>
            <div className="mt-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#35B978]/15 text-[#35B978] text-xs font-semibold border border-[#35B978]/30">
                ● DETERMINISTIC
              </span>
            </div>
            <p className="text-[11px] text-[#8D9B95] mt-3">
              Synthetic rule evaluation is active
            </p>
          </div>
        </div>
      </CollapsibleCard>

      {/* Number Frequency Grid */}
      <CollapsibleCard
        id="digit_frequency_section"
        title={
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-[#35B978]" />
            <h3 className="text-sm font-bold tracking-tight text-[#F5F5F5] uppercase">
              Digit Occurrence Frequency (0–9)
            </h3>
          </div>
        }
        subtitle="Individual single-digit hit counts and percentage distribution"
        headerRight={
          <span className="text-xs font-mono text-[#8D9B95]">
            Total Samples: {stats.total}
          </span>
        }
        bodyClassName="p-5 sm:p-6"
      >
        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-3">
          {stats.numFrequencies.map((freq, num) => {
            const isZero = num === 0;
            const isFive = num === 5;
            const isEven = num % 2 === 0;
            const colorBorder = isZero || isFive ? 'border-[#C94DDA]/40' : isEven ? 'border-[#F04444]/40' : 'border-[#35B978]/40';

            return (
              <div
                key={num}
                className={`p-3 rounded-xl bg-[#06130F] border ${colorBorder} text-center space-y-1.5`}
              >
                <div className="text-lg font-bold font-mono text-[#F5F5F5]">
                  {num}
                </div>
                <div className="text-xs font-mono font-semibold text-[#E7B93F]">
                  {freq} <span className="text-[10px] text-[#8D9B95]">hits</span>
                </div>
                <div className="text-[10px] text-[#8D9B95]">
                  {stats.total > 0 ? Math.round((freq / stats.total) * 100) : 0}%
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleCard>
    </div>
  );
};
