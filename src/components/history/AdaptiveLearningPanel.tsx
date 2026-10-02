/**
 * AdaptiveLearningPanel — Main Decision Engine (7-signal weighted ensemble)
 *
 * Inputs:  Tests 1, 2, 3, 5, 6, 7, 8
 * Learner: Adaptive Learning Multi-Signal Decision Engine
 */

import React, { useState, useMemo } from 'react';
import { CheckCircle2, XCircle, Brain, RotateCcw, TrendingUp, ShieldCheck } from 'lucide-react';
import type { AdaptiveResult, AdaptiveHistoryRow } from '../../hooks/useAdaptiveLearning';
import { SIGNAL_LABELS } from '../../hooks/useAdaptiveLearning';
import type { RealGameSchedule } from '../../types/result';
import { CollapsibleCard } from '../common/CollapsibleCard';

interface Props {
  data: AdaptiveResult;
  /** Live feed schedule — used only for the active-round countdown if available. */
  activeSchedule?: RealGameSchedule | null;
}

// ─── Accent colours per signal index [T2,T3,T5,T6,T7] ─────────────────────
// Indexed against SIGNAL_LABELS, so the order here must match it exactly.
const SIGNAL_COLORS = [
  '#60A5FA', // T2 blue
  '#35B978', // T3 green
  '#A78BFA', // T5 violet
  '#F59E0B', // T6 orange
  '#34D399', // T7 teal (external prediction)
];

// ─── Small sub-components ────────────────────────────────────────────────────

function WeightBar({ label, value, color, isDominant }: { label: string; value: number; color: string; isDominant: boolean }) {
  const pct = Math.round(value * 1000) / 10;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs font-mono">
        <span className={isDominant ? 'text-[#F5F5F5] font-bold flex items-center gap-1' : 'text-[#8D9B95]'}>
          {label} {isDominant && <span className="text-[9px] px-1 py-0.2 bg-[#E7B93F]/20 text-[#E7B93F] rounded">LEADER</span>}
        </span>
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
  if (!pred) return <td className="py-1.5 px-2 text-[#8D9B95] text-center font-mono">—</td>;
  return (
    <td className={`py-1.5 px-2 font-mono font-bold text-center ${pred === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
      {pred === 'Big' ? 'B' : 'S'}
    </td>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const AdaptiveLearningPanel: React.FC<Props> = ({ data, activeSchedule }) => {
  const [confirmReset, setConfirmReset] = useState(false);

  const {
    history,
    activePrediction,
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

  const lastRow: AdaptiveHistoryRow | null = history.length > 0 ? history[history.length - 1] : null;
  const historyDesc = useMemo(() => [...history].reverse(), [history]);

  const handleReset = () => { resetLearning(false); setConfirmReset(false); };

  const diff = accuracyPct - 50;
  const diffStr = diff >= 0 ? `+${diff.toFixed(1)}pp` : `${diff.toFixed(1)}pp`;

  return (
    <div className="space-y-5">

      {/* ── Prominent Decision Hero Box ──────────────────────────────────── */}
      <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-[#0B2117] via-[#06140F] to-[#020806] border-2 border-[#35B978]/40 shadow-2xl relative overflow-hidden">
        {/* Glow accent */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#35B978]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E3A2B]/60 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-1 rounded-md text-[10px] font-mono font-extrabold uppercase tracking-wider bg-[#35B978]/20 text-[#35B978] border border-[#35B978]/50 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> MAIN DECISION SYSTEM
              </span>
              <span className="text-xs text-[#8D9B95] font-mono">
                Real-Time Weighted Multi-Signal Ensemble
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-[10px] text-[#8D9B95] uppercase">{SIGNAL_LABELS.length} Signals Active:</span>
              <span className="text-[#F5F5F5] font-bold">
                {SIGNAL_LABELS.map((l) => l.replace('Test ', 'T')).join(', ')}
              </span>
            </div>
          </div>

          {/* Central Decision Display */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
            {/* Left: Huge Final Decision */}
            <div className="p-4 rounded-xl bg-[#020806]/80 border border-[#1E3A2B] text-center space-y-1">
              <span className="text-[11px] font-mono font-bold text-[#8D9B95] tracking-widest uppercase block">
                FINAL DECISION
              </span>
              {lastRow ? (
                <div className="py-2">
                  <span className={`text-4xl sm:text-5xl font-black font-mono tracking-tight drop-shadow-md ${
                    lastRow.adaptiveDecision === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'
                  }`}>
                    {lastRow.adaptiveDecision.toUpperCase()}
                  </span>
                  <span className="text-xs font-mono text-[#8D9B95] block mt-1">
                    Period {lastRow.period.slice(-7)} · Decision before result
                  </span>
                </div>
              ) : (
                <div className="py-4 text-[#8D9B95] font-mono text-sm">
                  Awaiting First Evaluated Round
                </div>
              )}

              {lastRow && (
                <div className="pt-1">
                  {lastRow.isHit ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#35B978]/20 text-[#35B978] border border-[#35B978]/40 font-mono text-xs font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5" /> OUTCOME: HIT
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F04444]/20 text-[#F04444] border border-[#F04444]/40 font-mono text-xs font-bold">
                      <XCircle className="w-3.5 h-3.5" /> OUTCOME: MISS
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Middle: Confidence & Weighted Distribution */}
            <div className="p-4 rounded-xl bg-[#020806]/80 border border-[#1E3A2B] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-[#8D9B95] uppercase tracking-wider">
                  Weighted Vote Distribution
                </span>
                <span className="text-[10px] font-mono text-[#35B978]">
                  {lastRow
                    ? `${lastRow.signalsAvailable} of ${SIGNAL_LABELS.length} signals voting`
                    : `${SIGNAL_LABELS.length} signals configured`}
                </span>
              </div>

              {lastRow ? (
                <div className="space-y-2 font-mono">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#E7B93F]">BIG: {lastRow.probBig.toFixed(1)}%</span>
                    <span className="font-bold text-[#60A5FA]">SMALL: {lastRow.probSmall.toFixed(1)}%</span>
                  </div>
                  <div className="h-3 rounded-full bg-[#071A14] border border-[#1E3A2B] overflow-hidden flex">
                    <div className="h-full bg-[#E7B93F] transition-all duration-500" style={{ width: `${lastRow.probBig}%` }} />
                    <div className="h-full bg-[#60A5FA] transition-all duration-500" style={{ width: `${lastRow.probSmall}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-[#8D9B95] pt-0.5">
                    <span>Weights normalized to 100%</span>
                    <span>Decision boundary: 50.0%</span>
                  </div>
                </div>
              ) : (
                <div className="py-6 text-center text-[#8D9B95] font-mono text-xs">
                  Awaiting active round inputs
                </div>
              )}
            </div>

            {/* Right: Key Decision Engine Performance */}
            <div className="p-4 rounded-xl bg-[#020806]/80 border border-[#1E3A2B] grid grid-cols-2 gap-2 text-center font-mono">
              <div className="p-2 rounded-lg bg-[#071A14] border border-[#1E3A2B]/50 col-span-2">
                <span className="text-[10px] text-[#8D9B95] block uppercase font-bold">Overall Accuracy</span>
                <span className={`text-xl font-extrabold ${accuracyPct >= 50 ? 'text-[#35B978]' : 'text-[#F04444]'}`}>
                  {accuracyPct}%
                </span>
                <span className="text-[10px] text-[#8D9B95] block mt-0.5 font-sans">
                  {totalHits} hits / {totalPredictions} predictions ({diffStr})
                </span>
              </div>
              <div className="p-2 rounded-lg bg-[#071A14] border border-[#1E3A2B]/50">
                <span className="text-[10px] text-[#8D9B95] block uppercase">Cur Streak</span>
                <span className={`text-sm font-bold ${currentHitStreak > 0 ? 'text-[#35B978]' : currentMissStreak > 0 ? 'text-[#F04444]' : 'text-[#8D9B95]'}`}>
                  {currentHitStreak > 0 ? `${currentHitStreak} HIT` : currentMissStreak > 0 ? `${currentMissStreak} MISS` : '—'}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-[#071A14] border border-[#1E3A2B]/50">
                <span className="text-[10px] text-[#8D9B95] block uppercase">Lng Miss</span>
                <span className="text-sm font-bold text-[#F04444]">
                  {longestMissStreak}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── NEXT ACTIVE PREDICTION (decision before the active round's result) ── */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#071A14] border border-[#E7B93F]/40 shadow-lg space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E3A2B]/60 pb-2.5">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#E7B93F]" />
            <span className="text-xs font-mono font-black uppercase tracking-wider text-[#F5F5F5]">
              Adaptive Final Result
            </span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#E7B93F]/15 text-[#E7B93F] border border-[#E7B93F]/30 uppercase font-bold">
            Status: Decision before result
          </span>
        </div>

        {activePrediction ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
              <StatBox label="Period" value={activePrediction.period.slice(-7)} />
              <StatBox
                label="Result"
                value={activePrediction.decision.toUpperCase()}
                color={activePrediction.decision === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}
              />
              <StatBox label="Weighted BIG" value={`${activePrediction.probBig.toFixed(1)}%`} color="text-[#E7B93F]" />
              <StatBox label="Weighted SMALL" value={`${activePrediction.probSmall.toFixed(1)}%`} color="text-[#60A5FA]" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] font-mono">
              <span className="text-[#8D9B95]">
                Signals voting:{' '}
                <span className="text-[#35B978] font-bold">
                  {activePrediction.signalsAvailable} / {SIGNAL_LABELS.length}
                </span>
              </span>
              <span className="text-[#8D9B95]">
                Actual: <span className="text-[#8D9B95] font-bold">PENDING</span>
              </span>
              {activeSchedule && (
                <span className="text-[#35B978] font-bold">
                  Next round in {Math.max(0, activeSchedule.remainingSeconds)}s
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="py-4 text-center text-[#8D9B95] font-mono text-xs">
            Awaiting the active period from the live feed…
          </div>
        )}
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
                Signals used: {lastRow.signalsAvailable} / {SIGNAL_LABELS.length}
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
              Weights update after every settled round and always sum to 100%. Missing signals (e.g. T5–T7 for early rounds) are temporarily excluded per round.
            </p>
          </div>

          {/* Baseline comparison */}
          <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-2">
            <span className="text-[10px] font-mono uppercase font-bold text-[#8D9B95] tracking-wider block">
              Baseline Comparison
            </span>
            <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
              <div className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60">
                <span className="text-[10px] text-[#8D9B95] block">Adaptive Engine</span>
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
        id="adaptive_rolling_perf"
        variant="subcard"
        title={<span className="font-mono text-xs font-bold text-[#F5F5F5]">Recent Performance (Rolling Windows)</span>}
        subtitle="Hit rate over the most recent N decisions"
      >
        <div className="space-y-0.5">
          <RollingRow label="Last 20 decisions"  hits={last20.hits}  total={last20.total} />
          <RollingRow label="Last 50 decisions"  hits={last50.hits}  total={last50.total} />
          <RollingRow label="Last 100 decisions" hits={last100.hits} total={last100.total} />
          <RollingRow label="Last 250 decisions" hits={last250.hits} total={last250.total} />
          <RollingRow label="All decisions"      hits={totalHits}    total={totalPredictions} />
        </div>
      </CollapsibleCard>

      {/* ── Learning History Table ──────────────────────────────────────── */}
      <CollapsibleCard
        id="adaptive_history_table"
        variant="subcard"
        title={<span className="font-mono text-xs font-bold text-[#F5F5F5]">Adaptive Decision History Table</span>}
        subtitle={`${totalPredictions} evaluated rounds — final decision generated BEFORE actual was known`}
      >
        <div className="overflow-x-auto rounded-lg border border-[#1E3A2B]/60">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#06130F] text-[#8D9B95] uppercase text-[10px]">
              <tr>
                <th className="py-2.5 px-3">Period</th>
                <th className="py-2.5 px-2 text-center">T2</th>
                <th className="py-2.5 px-2 text-center">T3</th>
                <th className="py-2.5 px-2 text-center">T5</th>
                <th className="py-2.5 px-2 text-center">T6</th>
                <th className="py-2.5 px-2 text-center">T7</th>
                <th className="py-2.5 px-3 text-center text-[#35B978] font-bold">DECISION</th>
                <th className="py-2.5 px-2 text-center">Actual</th>
                <th className="py-2.5 px-3 text-right">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E3A2B]/40">
              {historyDesc.map((row, i) => (
                <tr key={i} className="hover:bg-[#06130F]/80">
                  <td className="py-1.5 px-3 text-gray-300">{row.period.slice(-7)}</td>
                  <SigCell pred={row.t2pred} />
                  <SigCell pred={row.t3pred} />
                  <SigCell pred={row.t5pred} />
                  <SigCell pred={row.t6pred} />
                  <SigCell pred={row.t7pred} />
                  <td className={`py-1.5 px-3 font-bold text-center ${row.adaptiveDecision === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                    {row.adaptiveDecision.toUpperCase()}
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
          B = BIG · S = SMALL · — = signal not available for this round · DECISION column is the weighted multi-signal decision generated BEFORE the actual result was known.
        </p>
      </CollapsibleCard>

      {/* ── Reset Model State ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
        <div>
          <span className="text-xs font-mono font-bold text-[#F5F5F5]">Reset Learned Weights</span>
          <p className="text-[11px] text-[#8D9B95] mt-0.5">
            Restores equal initial weights (1/{SIGNAL_LABELS.length} each) and clears online weight adaptation.
          </p>
        </div>
        {!confirmReset ? (
          <button
            onClick={() => setConfirmReset(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E7B93F]/10 hover:bg-[#E7B93F]/20 text-[#E7B93F] border border-[#E7B93F]/30 font-mono text-xs font-bold transition-all cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset Weights
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#E7B93F] font-mono">Reset weights to equal?</span>
            <button onClick={handleReset} className="px-3 py-1.5 rounded-lg bg-[#E7B93F] text-[#020806] font-mono text-xs font-bold cursor-pointer hover:bg-[#c99f30] transition-colors">
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
        Adaptive Learning is an empirical multi-signal decision engine. It does{' '}
        <strong>not</strong> guarantee future WinGo results. The random coin-flip baseline is 50.0%. Any
        observed accuracy above or below 50% is consistent with expected statistical variance.
      </div>

    </div>
  );
};

// Fallback display constant (never referenced by logic). Derived from the
// signal list so it stays correct when the number of signals changes.
const INITIAL_WEIGHT_DISPLAY = 1 / SIGNAL_LABELS.length;
