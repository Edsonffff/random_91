/**
 * AdaptiveLearningPanel — Test 4 UI
 *
 * Renders the complete Test 4 dashboard including:
 *  - Current model prediction & probability bars
 *  - Live accuracy dashboard
 *  - Learned weights with progress bars
 *  - Rolling performance windows
 *  - Baseline comparison (with disclaimer)
 *  - Learning history table (scrollable, all rows)
 *  - Reset control with confirmation dialog
 */

import React, { useState, useMemo } from 'react';
import { CheckCircle2, XCircle, Brain, RotateCcw, TrendingUp } from 'lucide-react';
import type { Test4Result } from '../../hooks/useAdaptiveLearning';
import { CollapsibleCard } from '../common/CollapsibleCard';

interface Props {
  data: Test4Result & { resetLearning: () => void };
}

// ─── Small sub-components ────────────────────────────────────────────────────

function WeightBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(value * 1000) / 10; // one decimal
  const barWidth = Math.round(value * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-[#8D9B95]">{label}</span>
        <span className={`font-bold ${color}`}>{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-[#020806] border border-[#1E3A2B]/60 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500`}
          style={{ width: `${barWidth}%`, backgroundColor: color.includes('amber') ? '#E7B93F' : color.includes('blue') ? '#60A5FA' : '#35B978' }}
        />
      </div>
    </div>
  );
}

function StatBox({ label, value, sub, color = 'text-[#F5F5F5]' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B]/60 text-center">
      <span className="text-[10px] text-[#8D9B95] block mb-0.5 font-mono uppercase">{label}</span>
      <span className={`text-base font-extrabold font-mono ${color}`}>{value}</span>
      {sub && <span className="text-[10px] text-[#8D9B95] block mt-0.5">{sub}</span>}
    </div>
  );
}

function RollingRow({ label, hits, total }: { label: string; hits: number; total: number }) {
  const pct = total > 0 ? Math.round((hits / total) * 100) : 0;
  const aboveBaseline = pct > 50;
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#1E3A2B]/40 last:border-0 text-xs font-mono">
      <span className="text-[#8D9B95]">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-[#F5F5F5]">{hits} / {total}</span>
        <span className={`font-bold w-12 text-right ${aboveBaseline ? 'text-[#35B978]' : total === 0 ? 'text-[#8D9B95]' : 'text-[#F04444]'}`}>
          {total > 0 ? `${pct}%` : '—'}
        </span>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export const AdaptiveLearningPanel: React.FC<Props> = ({ data }) => {
  const [confirmReset, setConfirmReset] = useState(false);

  const {
    history,
    totalPredictions,
    totalHits,
    totalMisses,
    accuracyPct,
    currentHitStreak,
    currentMissStreak,
    longestHitStreak,
    longestMissStreak,
    w1,
    w2,
    w3,
    dominantSignal,
    last20,
    last50,
    last100,
    resetLearning,
  } = data;

  // The "current prediction" shown is the model's forecast for the NEXT period.
  // We show the last row of history as the most recently evaluated prediction.
  const lastRow = history.length > 0 ? history[history.length - 1] : null;

  // Sorted descending for the table (newest first)
  const historyDesc = useMemo(() => [...history].reverse(), [history]);

  const handleReset = () => {
    resetLearning();
    setConfirmReset(false);
  };

  const diff = accuracyPct - 50;
  const diffStr = diff >= 0 ? `+${diff.toFixed(1)}pp` : `${diff.toFixed(1)}pp`;

  return (
    <div className="space-y-4">

      {/* ── Header info bar ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
        <div>
          <span className="font-mono font-bold text-xs text-[#F5F5F5]">
            Adaptive Weight Ensemble: w₁·T1 + w₂·T2 + w₃·T3
          </span>
          <p className="text-[11px] text-[#8D9B95] mt-0.5">
            Learns which test signal has been more reliable and adjusts its vote weight accordingly. Evaluated out-of-sample — no future data used.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <div>
            <span className="text-[#8D9B95] block text-[10px]">BIG/SMALL HIT RATE:</span>
            <span className={`text-base font-bold ${accuracyPct >= 50 ? 'text-[#35B978]' : 'text-[#F04444]'}`}>
              {accuracyPct}% ({totalHits} / {totalPredictions})
            </span>
          </div>
          <div>
            <span className="text-[#8D9B95] block text-[10px]">RANDOM BASELINE:</span>
            <span className="text-base font-bold text-[#8D9B95]">50.0%</span>
          </div>
        </div>
      </div>

      {/* ── Row 1: Dashboard ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Current model state */}
        <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-3">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-[#E7B93F]" />
            <span className="text-xs font-mono font-bold text-[#F5F5F5] uppercase tracking-wider">
              Model Dashboard
            </span>
          </div>

          {/* Most recent prediction evaluated */}
          {lastRow && (
            <div className="p-3 rounded-lg bg-[#020806] border border-[#1E3A2B]/60">
              <span className="text-[10px] text-[#8D9B95] uppercase font-mono block mb-1.5">
                Last Evaluated Prediction (Period {lastRow.period.slice(-6)})
              </span>
              <div className="flex items-center gap-3">
                <span className={`text-2xl font-extrabold font-mono ${lastRow.t4pred === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                  {lastRow.t4pred.toUpperCase()}
                </span>
                <div className="flex-1 space-y-1 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-[#8D9B95]">BIG</span>
                    <span className="text-[#E7B93F] font-bold">{lastRow.probBig.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 rounded bg-[#1E3A2B] overflow-hidden">
                    <div className="h-full bg-[#E7B93F] rounded" style={{ width: `${lastRow.probBig}%` }} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#8D9B95]">SMALL</span>
                    <span className="text-[#60A5FA] font-bold">{lastRow.probSmall.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 rounded bg-[#1E3A2B] overflow-hidden">
                    <div className="h-full bg-[#60A5FA] rounded" style={{ width: `${lastRow.probSmall}%` }} />
                  </div>
                </div>
                <div>
                  {lastRow.isHit ? (
                    <span className="inline-flex items-center gap-1 text-[#35B978] font-bold text-xs">
                      <CheckCircle2 className="w-4 h-4" /> HIT
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[#F04444] font-bold text-xs">
                      <XCircle className="w-4 h-4" /> MISS
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {totalPredictions === 0 && (
            <div className="p-3 rounded-lg bg-[#020806] border border-[#1E3A2B]/60 text-center text-[#8D9B95] text-xs font-mono">
              No rounds available yet. Switch to Real Live Feed and wait for data.
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatBox label="Predictions" value={totalPredictions} />
            <StatBox label="Hits" value={totalHits} color="text-[#35B978]" />
            <StatBox label="Misses" value={totalMisses} color="text-[#F04444]" />
            <StatBox label="Accuracy" value={`${accuracyPct}%`} color={accuracyPct >= 50 ? 'text-[#35B978]' : 'text-[#F04444]'} />
          </div>

          {/* Streaks */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatBox label="Cur Hit Str" value={currentHitStreak} color="text-[#35B978]" />
            <StatBox label="Cur Miss Str" value={currentMissStreak} color="text-[#F04444]" />
            <StatBox label="Lng Hit Str" value={longestHitStreak} color="text-[#35B978]" />
            <StatBox label="Lng Miss Str" value={longestMissStreak} color="text-[#F04444]" />
          </div>
        </div>

        {/* Learned weights + rolling performance */}
        <div className="space-y-4">
          {/* Weights */}
          <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#E7B93F]" />
                <span className="text-xs font-mono font-bold text-[#F5F5F5] uppercase tracking-wider">
                  Learned Weights
                </span>
              </div>
              <span className="text-[10px] font-mono text-[#8D9B95]">
                Most influential: Test {dominantSignal}
              </span>
            </div>

            <div className="space-y-2.5">
              <WeightBar
                label="Test 1 (Period Digit Sum)"
                value={w1}
                color={dominantSignal === 1 ? 'text-[#E7B93F]' : 'text-[#8D9B95]'}
              />
              <WeightBar
                label="Test 2 (Linear Recurrence)"
                value={w2}
                color={dominantSignal === 2 ? 'text-[#E7B93F]' : 'text-[#8D9B95]'}
              />
              <WeightBar
                label="Test 3 (Alternating Flip)"
                value={w3}
                color={dominantSignal === 3 ? 'text-[#E7B93F]' : 'text-[#8D9B95]'}
              />
            </div>

            <p className="text-[10px] text-[#8D9B95] font-sans">
              Weights update after every settled round. Weights always sum to 100% and never become negative.
            </p>
          </div>

          {/* Baseline comparison */}
          <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-2">
            <span className="text-[10px] font-mono uppercase font-bold text-[#8D9B95] tracking-wider block">
              Baseline Comparison
            </span>
            <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
              <div className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60">
                <span className="text-[10px] text-[#8D9B95] block">Adaptive Model</span>
                <span className={`text-base font-bold ${accuracyPct >= 50 ? 'text-[#35B978]' : 'text-[#F04444]'}`}>
                  {accuracyPct}.0%
                </span>
              </div>
              <div className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60">
                <span className="text-[10px] text-[#8D9B95] block">Random</span>
                <span className="text-base font-bold text-[#8D9B95]">50.0%</span>
              </div>
              <div className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60">
                <span className="text-[10px] text-[#8D9B95] block">Difference</span>
                <span className={`text-base font-bold ${diff >= 0 ? 'text-[#35B978]' : 'text-[#F04444]'}`}>
                  {totalPredictions > 0 ? diffStr : '—'}
                </span>
              </div>
            </div>
            <p className="text-[10px] text-[#8D9B95] font-sans pt-1">
              ⚠ Past accuracy does not imply future predictability. WinGo results are server-controlled; no client-side model can guarantee future outcomes.
            </p>
          </div>
        </div>
      </div>

      {/* ── Rolling Performance ───────────────────────────────────────────── */}
      <CollapsibleCard
        id="test4_rolling_perf"
        variant="subcard"
        title={<span className="font-mono text-xs font-bold text-[#F5F5F5]">Recent Performance (Rolling Windows)</span>}
        subtitle="Hit rate over the most recent N predictions"
      >
        <div className="space-y-0.5">
          <RollingRow label="Last 20 predictions" hits={last20.hits} total={last20.total} />
          <RollingRow label="Last 50 predictions" hits={last50.hits} total={last50.total} />
          <RollingRow label="Last 100 predictions" hits={last100.hits} total={last100.total} />
          <RollingRow label="All predictions" hits={totalHits} total={totalPredictions} />
        </div>
      </CollapsibleCard>

      {/* ── Learning History Table ────────────────────────────────────────── */}
      <CollapsibleCard
        id="test4_history_table"
        variant="subcard"
        title={<span className="font-mono text-xs font-bold text-[#F5F5F5]">Learning History Table</span>}
        subtitle={`${totalPredictions} evaluated rounds — Test 4 prediction was generated BEFORE actual was known`}
      >
        <div className="overflow-x-auto rounded-lg border border-[#1E3A2B]/60">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#06130F] text-[#8D9B95] uppercase text-[10px]">
              <tr>
                <th className="py-2.5 px-3">Period</th>
                <th className="py-2.5 px-3">Test 1</th>
                <th className="py-2.5 px-3">Test 2</th>
                <th className="py-2.5 px-3">Test 3</th>
                <th className="py-2.5 px-3">Test 4</th>
                <th className="py-2.5 px-3">Actual</th>
                <th className="py-2.5 px-3 text-right">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E3A2B]/40">
              {historyDesc.map((row, i) => (
                <tr key={i} className="hover:bg-[#06130F]/80">
                  <td className="py-1.5 px-3 text-gray-300">{row.period.slice(-7)}</td>
                  <td className={`py-1.5 px-3 font-medium ${row.t1pred === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                    {row.t1pred}
                  </td>
                  <td className={`py-1.5 px-3 font-medium ${row.t2pred === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                    {row.t2pred}
                  </td>
                  <td className={`py-1.5 px-3 font-medium ${row.t3pred === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                    {row.t3pred}
                  </td>
                  <td className={`py-1.5 px-3 font-bold ${row.t4pred === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                    {row.t4pred}
                  </td>
                  <td className={`py-1.5 px-3 font-bold ${row.actual === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                    {row.actual}
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    {row.isHit ? (
                      <span className="inline-flex items-center gap-1 text-[#35B978] font-bold">
                        <CheckCircle2 className="w-3 h-3" /> HIT
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[#F04444]">
                        <XCircle className="w-3 h-3" /> MISS
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {historyDesc.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-[#8D9B95]">
                    No learning history yet. Data will appear once rounds are available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleCard>

      {/* ── Reset control ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
        <div>
          <span className="text-xs font-mono font-bold text-[#F5F5F5]">Reset Learning</span>
          <p className="text-[11px] text-[#8D9B95] mt-0.5">
            Restores equal weights (33.3% each) and clears model memory. WinGo result history is preserved.
          </p>
        </div>
        {!confirmReset ? (
          <button
            onClick={() => setConfirmReset(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F04444]/10 hover:bg-[#F04444]/20 text-[#F04444] border border-[#F04444]/30 font-mono text-xs font-bold transition-all cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Learning
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#F04444] font-mono">Confirm reset?</span>
            <button
              onClick={handleReset}
              className="px-3 py-1.5 rounded-lg bg-[#F04444] text-white font-mono text-xs font-bold cursor-pointer hover:bg-[#d63030] transition-colors"
            >
              Yes, Reset
            </button>
            <button
              onClick={() => setConfirmReset(false)}
              className="px-3 py-1.5 rounded-lg bg-[#1E3A2B] text-[#8D9B95] font-mono text-xs cursor-pointer hover:text-[#F5F5F5] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="p-3 rounded-xl bg-[#071A14] border border-[#E7B93F]/20 text-[11px] text-[#8D9B95] font-sans">
        <span className="text-[#E7B93F] font-bold">ℹ Statistical Disclaimer: </span>
        Test 4 is an empirical backtesting engine evaluated on historical data only. It does{' '}
        <strong>not</strong> predict future WinGo results. The random coin-flip baseline is 50.0%. Any
        observed accuracy above or below 50% is consistent with expected statistical variance and does not
        imply predictive power over future independent draws.
      </div>
    </div>
  );
};
