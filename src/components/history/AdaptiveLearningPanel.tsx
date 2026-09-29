/**
 * AdaptiveLearningPanel — Test 4 UI (v3: 7-signal model)
 *
 * Inputs:  Tests 1, 2, 3, 5, 6, 7, 8
 * Learner: Test 4 (weighted ensemble, online weight update)
 */

import React, { useState, useMemo } from 'react';
import { CheckCircle2, XCircle, Brain, RotateCcw, TrendingUp } from 'lucide-react';
import type { Test4Result, Test4HistoryRow } from '../../hooks/useAdaptiveLearning';
import { SIGNAL_LABELS } from '../../hooks/useAdaptiveLearning';
import { CollapsibleCard } from '../common/CollapsibleCard';

interface Props {
  data: Test4Result & { resetLearning: () => void };
}

// ─── Accent colours per signal index [T1,T2,T3,T5,T6,T7,T8] ─────────────────
const SIGNAL_COLORS = [
  '#E7B93F', // T1 amber
  '#60A5FA', // T2 blue
  '#35B978', // T3 green
  '#A78BFA', // T5 violet
  '#F59E0B', // T6 orange
  '#34D399', // T7 teal
  '#F472B6', // T8 pink
];

// ─── Small sub-components ────────────────────────────────────────────────────

function WeightBar({ label, value, color, isDominant }: { label: string; value: number; color: string; isDominant: boolean }) {
  const pct = Math.round(value * 1000) / 10;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs font-mono">
        <span className={isDominant ? 'text-[#F5F5F5] font-bold' : 'text-[#8D9B95]'}>{label}</span>
        <span className="font-bold" style={{ color }}>{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-[#020806] border border-[#1E3A2B]/60 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.round(value * 100)}%`, backgroundColor: color }}
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
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#1E3A2B]/40 last:border-0 text-xs font-mono">
      <span className="text-[#8D9B95]">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-[#F5F5F5]">{hits} / {total}</span>
        <span className={`font-bold w-12 text-right ${pct > 50 ? 'text-[#35B978]' : total === 0 ? 'text-[#8D9B95]' : 'text-[#F04444]'}`}>
          {total > 0 ? `${pct}%` : '—'}
        </span>
      </div>
    </div>
  );
}

function SigCell({ pred }: { pred: 'Big' | 'Small' | null }) {
  if (!pred) return <td className="py-1.5 px-2 text-[#8D9B95] text-center">—</td>;
  return (
    <td className={`py-1.5 px-2 font-medium text-center ${pred === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
      {pred === 'Big' ? 'B' : 'S'}
    </td>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

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
    weights,
    dominantSignalIndex,
    last20,
    last50,
    last100,
    last250,
    lastSignalAgreement,
    resetLearning,
  } = data;

  const lastRow: Test4HistoryRow | null = history.length > 0 ? history[history.length - 1] : null;
  const historyDesc = useMemo(() => [...history].reverse(), [history]);

  const handleReset = () => { resetLearning(); setConfirmReset(false); };

  const diff = accuracyPct - 50;
  const diffStr = diff >= 0 ? `+${diff.toFixed(1)}pp` : `${diff.toFixed(1)}pp`;

  return (
    <div className="space-y-4">

      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
        <div>
          <span className="font-mono font-bold text-xs text-[#F5F5F5]">
            7-Signal Adaptive Ensemble: Σ wₙ·Tₙ  (n ∈ 1,2,3,5,6,7,8)
          </span>
          <p className="text-[11px] text-[#8D9B95] mt-0.5">
            Learns which of the 7 signals has been most reliable. Weights update after every round. Evaluated out-of-sample — no future data used.
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

      {/* ── Row 1: Dashboard + Weights ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Left: model state */}
        <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-3">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-[#E7B93F]" />
            <span className="text-xs font-mono font-bold text-[#F5F5F5] uppercase tracking-wider">Model Dashboard</span>
          </div>

          {/* Last evaluated */}
          {lastRow && (
            <div className="p-3 rounded-lg bg-[#020806] border border-[#1E3A2B]/60">
              <span className="text-[10px] text-[#8D9B95] uppercase font-mono block mb-1.5">
                Last Evaluated (Period {lastRow.period.slice(-7)})
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
              <p className="text-[10px] text-[#8D9B95] mt-1.5 font-mono">
                Signals used: {lastRow.signalsAvailable} / 7
              </p>
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
            <StatBox label="Cur Hit" value={currentHitStreak} color="text-[#35B978]" />
            <StatBox label="Cur Miss" value={currentMissStreak} color="text-[#F04444]" />
            <StatBox label="Lng Hit" value={longestHitStreak} color="text-[#35B978]" />
            <StatBox label="Lng Miss" value={longestMissStreak} color="text-[#F04444]" />
          </div>

          {/* Signal agreement */}
          <div className="p-3 rounded-lg bg-[#020806] border border-[#1E3A2B]/60">
            <span className="text-[10px] text-[#8D9B95] uppercase font-mono block mb-1.5 tracking-wider">
              Signal Agreement (last round)
            </span>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-[#E7B93F] font-bold">BIG {lastSignalAgreement.bigVotes}</span>
              <span className="text-[#8D9B95]">vs</span>
              <span className="text-[#60A5FA] font-bold">SMALL {lastSignalAgreement.smallVotes}</span>
              <span className="text-[#8D9B95]">of {lastSignalAgreement.total}</span>
              {lastSignalAgreement.majority ? (
                <span className={`ml-auto font-bold ${lastSignalAgreement.majority === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                  → {lastSignalAgreement.majority.toUpperCase()}
                </span>
              ) : (
                <span className="ml-auto text-[#8D9B95]">TIE</span>
              )}
            </div>
          </div>
        </div>

        {/* Right: weights + baseline */}
        <div className="space-y-4">

          {/* Learned weights */}
          <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#E7B93F]" />
                <span className="text-xs font-mono font-bold text-[#F5F5F5] uppercase tracking-wider">
                  Learned Signal Weights
                </span>
              </div>
              <span className="text-[10px] font-mono text-[#8D9B95]">
                Dominant: {SIGNAL_LABELS[dominantSignalIndex]}
              </span>
            </div>
            <div className="space-y-2">
              {SIGNAL_LABELS.map((label, i) => (
                <WeightBar
                  key={label}
                  label={label}
                  value={weights[i] ?? INITIAL_WEIGHT_DISPLAY}
                  color={SIGNAL_COLORS[i]}
                  isDominant={i === dominantSignalIndex}
                />
              ))}
            </div>
            <p className="text-[10px] text-[#8D9B95] font-sans">
              Weights update after every settled round and always sum to 100%. Missing signals (e.g. T5–T8 for early rounds) are temporarily excluded per round.
            </p>
          </div>

          {/* Baseline comparison */}
          <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-2">
            <span className="text-[10px] font-mono uppercase font-bold text-[#8D9B95] tracking-wider block">
              Baseline Comparison
            </span>
            <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
              <div className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60">
                <span className="text-[10px] text-[#8D9B95] block">Adaptive T4</span>
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
              ⚠ Past accuracy does not imply future predictability.
            </p>
          </div>
        </div>
      </div>

      {/* ── Rolling Performance ─────────────────────────────────────────── */}
      <CollapsibleCard
        id="test4_rolling_perf"
        variant="subcard"
        title={<span className="font-mono text-xs font-bold text-[#F5F5F5]">Recent Performance (Rolling Windows)</span>}
        subtitle="Hit rate over the most recent N predictions"
      >
        <div className="space-y-0.5">
          <RollingRow label="Last 20 predictions"  hits={last20.hits}  total={last20.total} />
          <RollingRow label="Last 50 predictions"  hits={last50.hits}  total={last50.total} />
          <RollingRow label="Last 100 predictions" hits={last100.hits} total={last100.total} />
          <RollingRow label="Last 250 predictions" hits={last250.hits} total={last250.total} />
          <RollingRow label="All predictions"      hits={totalHits}    total={totalPredictions} />
        </div>
      </CollapsibleCard>

      {/* ── Learning History Table ──────────────────────────────────────── */}
      <CollapsibleCard
        id="test4_history_table"
        variant="subcard"
        title={<span className="font-mono text-xs font-bold text-[#F5F5F5]">Learning History Table</span>}
        subtitle={`${totalPredictions} evaluated rounds — Test 4 prediction generated BEFORE actual was known`}
      >
        <div className="overflow-x-auto rounded-lg border border-[#1E3A2B]/60">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#06130F] text-[#8D9B95] uppercase text-[10px]">
              <tr>
                <th className="py-2.5 px-3">Period</th>
                <th className="py-2.5 px-2 text-center">T1</th>
                <th className="py-2.5 px-2 text-center">T2</th>
                <th className="py-2.5 px-2 text-center">T3</th>
                <th className="py-2.5 px-2 text-center">T5</th>
                <th className="py-2.5 px-2 text-center">T6</th>
                <th className="py-2.5 px-2 text-center">T7</th>
                <th className="py-2.5 px-2 text-center">T8</th>
                <th className="py-2.5 px-2 text-center text-[#C94DDA]">T4</th>
                <th className="py-2.5 px-2 text-center">Actual</th>
                <th className="py-2.5 px-3 text-right">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E3A2B]/40">
              {historyDesc.map((row, i) => (
                <tr key={i} className="hover:bg-[#06130F]/80">
                  <td className="py-1.5 px-3 text-gray-300">{row.period.slice(-7)}</td>
                  <SigCell pred={row.t1pred} />
                  <SigCell pred={row.t2pred} />
                  <SigCell pred={row.t3pred} />
                  <SigCell pred={row.t5pred} />
                  <SigCell pred={row.t6pred} />
                  <SigCell pred={row.t7pred} />
                  <SigCell pred={row.t8pred} />
                  <td className={`py-1.5 px-2 font-bold text-center ${row.t4pred === 'Big' ? 'text-[#C94DDA]' : 'text-[#A855F7]'}`}>
                    {row.t4pred === 'Big' ? 'B' : 'S'}
                  </td>
                  <td className={`py-1.5 px-2 font-bold text-center ${row.actual === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                    {row.actual === 'Big' ? 'B' : 'S'}
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
                  <td colSpan={11} className="py-6 text-center text-[#8D9B95]">
                    No learning history yet. Data will appear once rounds are available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-[#8D9B95] font-sans mt-2">
          B = BIG · S = SMALL · — = signal not available for this round · T4 column is the weighted prediction made BEFORE the actual result was known.
        </p>
      </CollapsibleCard>

      {/* ── Reset control ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
        <div>
          <span className="text-xs font-mono font-bold text-[#F5F5F5]">Reset Learning</span>
          <p className="text-[11px] text-[#8D9B95] mt-0.5">
            Restores equal weights (1/7 each) and clears model memory. WinGo result history is preserved.
          </p>
        </div>
        {!confirmReset ? (
          <button
            onClick={() => setConfirmReset(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F04444]/10 hover:bg-[#F04444]/20 text-[#F04444] border border-[#F04444]/30 font-mono text-xs font-bold transition-all cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#F04444] font-mono">Confirm reset?</span>
            <button onClick={handleReset} className="px-3 py-1.5 rounded-lg bg-[#F04444] text-white font-mono text-xs font-bold cursor-pointer hover:bg-[#d63030] transition-colors">
              Yes, Reset
            </button>
            <button onClick={() => setConfirmReset(false)} className="px-3 py-1.5 rounded-lg bg-[#1E3A2B] text-[#8D9B95] font-mono text-xs cursor-pointer hover:text-[#F5F5F5] transition-colors">
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="p-3 rounded-xl bg-[#071A14] border border-[#E7B93F]/20 text-[11px] text-[#8D9B95] font-sans">
        <span className="text-[#E7B93F] font-bold">ℹ Statistical Disclaimer: </span>
        Test 4 is an empirical backtesting engine. It does{' '}
        <strong>not</strong> predict future WinGo results. The random coin-flip baseline is 50.0%. Any
        observed accuracy above or below 50% is consistent with expected statistical variance.
      </div>

    </div>
  );
};

// fallback display constant (never referenced by logic)
const INITIAL_WEIGHT_DISPLAY = 1 / 7;
