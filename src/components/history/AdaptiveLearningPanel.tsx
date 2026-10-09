/**
 * AdaptiveLearningPanel — Main Decision Engine (active-signal weighted ensemble)
 *
 * Inputs: Tests 3, 7, 9 — computed by the phone-side engine.
 */

import React from 'react';
import { CheckCircle2, XCircle, Brain, TrendingUp, ShieldCheck } from 'lucide-react';
import { useServerAdaptiveLearning } from '../../hooks/useServerAdaptiveLearning';
import type { AdaptiveApiState } from '../../services/adaptiveLearningApi';
import type { RealGameSchedule } from '../../types/result';
import { CollapsibleCard } from '../common/CollapsibleCard';

interface Props {
  /** Live feed schedule — used only for the active-round countdown if available. */
  activeSchedule?: RealGameSchedule | null;
  /** Share the page's compact subscription with its verified Max Loss section. */
  serverState?: AdaptiveApiState;
}

// ─── Accent colours per signal index [T3,T7,T9] ─────────────────────
// Indexed against SIGNAL_LABELS, so the order here must match it exactly.
const SIGNAL_COLORS = [
  '#35B978', // T3 green
  '#34D399', // T7 teal (external prediction)
  '#A78BFA', // T9 violet (CPL-3)
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

function AdaptiveCheckpointMaxLoss({ data }: { data: NonNullable<AdaptiveApiState['data']> }) {
  const values = [
    ['TEST 3', data.test3MaxLoss],
    ['TEST 7', data.test7MaxLoss],
    ['TEST 9', data.test9MaxLoss],
  ] as const;
  return (
    <section aria-labelledby="adaptive-checkpoint-max-loss" className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 id="adaptive-checkpoint-max-loss" className="text-xs font-mono font-bold tracking-wider text-[#A78BFA]">ADAPTIVE CHECKPOINT COUNTERS</h2>
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#8D9B95]">Replay state · Not verified Max Loss</span>
      </div>
      <p className="text-[11px] text-[#8D9B95] mb-3">These values belong to the Adaptive replay checkpoint. They are not the independent historical Verified Max Loss metric below.</p>
      <dl className="grid grid-cols-3 gap-3 text-xs font-mono">
        {values.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B]/60">
            <dt className="text-[#8D9B95]">{label}</dt>
            <dd className="font-extrabold text-[#A78BFA]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const AdaptiveLearningPanel: React.FC<Props> = ({ serverState, ...props }) => {
  return serverState
    ? <AdaptiveLearningPanelContent {...props} serverState={serverState} />
    : <ConnectedAdaptiveLearningPanel {...props} />;
};

const ConnectedAdaptiveLearningPanel: React.FC<Props> = (props) => {
  const serverState = useServerAdaptiveLearning();
  return <AdaptiveLearningPanelContent {...props} serverState={serverState} />;
};

const AdaptiveLearningPanelContent: React.FC<Props & { serverState: AdaptiveApiState }> = ({ activeSchedule, serverState }) => {
  const { data, status, stale, error } = serverState;

  if (status === 'PENDING_RESULT') {
    const gap = serverState.maxLoss?.firstMissingHistoryPeriod && serverState.maxLoss.lastMissingHistoryPeriod
      ? `Historical input is unavailable for this range. Historical gap: ${serverState.maxLoss.firstMissingHistoryPeriod} → ${serverState.maxLoss.lastMissingHistoryPeriod}.`
      : 'Historical input is unavailable for part of the verified scope.';
    return (
      <div role="status" aria-live="polite" className="p-5 rounded-xl bg-[#06130F] border border-[#E7B93F]/50 text-sm text-[#E7B93F]">
        <p>Adaptive Learning status: Waiting for finalized actual result</p>
        <p className="mt-1 text-xs">Pending period: {serverState.pendingPeriod}</p>
        <p className="mt-2 text-xs text-[#8D9B95]">Adaptive will retry this exact period until its actual result is finalized. It will not learn from the pending result.</p>
        <p className="mt-1 text-xs text-[#8D9B95]">{gap}</p>
        <p className="mt-2 text-xs text-[#8D9B95]">Verified Max Loss is an independent read-only metric and must not be interpreted as Adaptive checkpoint state.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div role="status" aria-live="polite" className="p-5 rounded-xl bg-[#06130F] border border-[#1E3A2B] text-sm text-[#8D9B95]">
        {status === 'loading' ? 'Loading Adaptive Learning from the phone server…' : error}
        {status === 'error' && <p className="mt-2 text-xs">Retrying automatically every 5 seconds.</p>}
      </div>
    );
  }

  const {
    finalDecision,
    activePrediction,
    signals,
    adaptiveRequiredSignals,
    adaptiveOptionalSignals,
    t7AvailableForAdaptive,
    adaptiveBlocked,
    adaptiveWeights,
    adaptiveDominantSignalIndex,
    totalPredictions,
    totalHits,
    totalMisses,
    accuracyPct,
    currentHitStreak,
    currentMissStreak,
    longestHitStreak,
    longestMissStreak,
    last20,
    last50,
    last100,
    last250,
    lastSignalAgreement,
  } = data;

  const lastRow = data.latestEvaluation;
  const visibleHistory = lastRow ? [lastRow] : [];
  const currentDecision = activePrediction?.decision ?? finalDecision;
  const currentPeriod = activePrediction?.period ?? lastRow?.period;
  const currentVote = activePrediction ?? lastRow;
  const live = status === 'ready';
  // The existing weight display remains the T3/T9 adaptive-weight view; T7 is
  // now admitted as the third eligible signal without changing those weights.
  const requiredSignalLabels = ['Test 3', 'Test 9'];

  const diff = accuracyPct - 50;
  const diffStr = diff >= 0 ? `+${diff.toFixed(1)}pp` : `${diff.toFixed(1)}pp`;

  return (
    <div className="space-y-5">
      <AdaptiveCheckpointMaxLoss data={data} />
      <div role="status" className="p-3 rounded-xl bg-[#06130F] border border-[#1E3A2B] text-xs font-mono text-[#8D9B95]">
        <span className="text-[#35B978] font-bold">Adaptive requires at least two of T3, T7, and T9.</span>{' '}
        Signals are matched to the exact period; fewer than two finalized signals are permanently skipped.
        <span className="block mt-1">Optional: {adaptiveOptionalSignals.join(', ')} · T7 available for Adaptive: {t7AvailableForAdaptive ? 'yes' : 'no'} · blocked: {adaptiveBlocked ? 'yes' : 'no'}</span>
      </div>
      <div role="status" aria-live="polite" className={`p-3 rounded-xl border text-xs font-mono ${live ? 'border-[#1E3A2B] text-[#8D9B95]' : 'border-[#E7B93F]/50 text-[#E7B93F]'}`}>
        {error ? `${error} Showing the last known server snapshot; retrying automatically.`
          : stale ? 'Server checkpoint is stale or its clock is out of sync. Showing the last known snapshot.'
          : 'Live phone-side Adaptive Learning · refreshes approximately every 5 seconds'}
        <span className="block mt-1">Checkpoint: {new Date(data.checkpointAt).toLocaleString()}{stale && error ? ' · STALE' : ''}</span>
      </div>

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
                <span className="text-[10px] text-[#8D9B95] uppercase">Required Signals:</span>
                <span className="text-[#F5F5F5] font-bold">
                 {adaptiveRequiredSignals.join(', ')}
                </span>
            </div>
          </div>

          {/* Central Decision Display */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
            {/* Left: Huge Final Decision */}
            <div className="p-4 rounded-xl bg-[#020806]/80 border border-[#1E3A2B] text-center space-y-1">
              <span className="text-[11px] font-mono font-bold text-[#8D9B95] tracking-widest uppercase block">
                {live ? 'CURRENT DECISION' : 'LAST KNOWN DECISION'}
              </span>
              {currentDecision ? (
                <div className="py-2">
                  <span className={`text-4xl sm:text-5xl font-black font-mono tracking-tight drop-shadow-md ${
                    currentDecision === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'
                  }`}>
                    {currentDecision.toUpperCase()}
                  </span>
                  <span className="text-xs font-mono text-[#8D9B95] block mt-1">
                    Period {currentPeriod?.slice(-7) ?? '—'} · {activePrediction ? 'Decision before result' : 'Latest evaluated decision'}
                  </span>
                </div>
              ) : (
                <div className="py-4 text-[#8D9B95] font-mono text-sm">
                  Awaiting First Evaluated Round
                </div>
              )}

              {!activePrediction && lastRow && (
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
                  {currentVote
                    ? `${currentVote.signalsAvailable} of ${adaptiveRequiredSignals.length} required signals voting`
                    : `${adaptiveRequiredSignals.length} required signals configured`}
                </span>
              </div>

              {currentVote ? (
                <div className="space-y-2 font-mono">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#E7B93F]">BIG: {currentVote.probBig.toFixed(1)}%</span>
                    <span className="font-bold text-[#60A5FA]">SMALL: {currentVote.probSmall.toFixed(1)}%</span>
                  </div>
                  <div className="h-3 rounded-full bg-[#071A14] border border-[#1E3A2B] overflow-hidden flex">
                    <div className="h-full bg-[#E7B93F] transition-all duration-500" style={{ width: `${currentVote.probBig}%` }} />
                    <div className="h-full bg-[#60A5FA] transition-all duration-500" style={{ width: `${currentVote.probSmall}%` }} />
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
            Status: {live ? 'Decision before result' : 'Last known snapshot'}
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
                  {activePrediction.signalsAvailable} / {adaptiveRequiredSignals.length}
                </span>
              </span>
              <span className="text-[#8D9B95]">
                Actual: <span className="text-[#8D9B95] font-bold">PENDING</span>
              </span>
              {live && activeSchedule?.currentIssue === activePrediction.period && (
                <span className="text-[#35B978] font-bold">
                  Next round in {Math.max(0, activeSchedule.remainingSeconds)}s
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="py-4 text-center text-[#8D9B95] font-mono text-xs">
            Awaiting an active prediction from the phone server…
          </div>
        )}
        {signals && (
          <div className="grid grid-cols-3 gap-2 font-mono">
            {[signals.t3pred, signals.t9pred].map((prediction, index) => (
              <StatBox key={requiredSignalLabels[index]} label={`${requiredSignalLabels[index]} (required)`} value={prediction?.toUpperCase() ?? 'NO SIGNAL'} />
            ))}
            <StatBox label="Test 7 (independent)" value={signals.t7pred?.toUpperCase() ?? 'NO SIGNAL'} />
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
                 Required signals used: {lastRow.signalsAvailable} / {adaptiveRequiredSignals.length}
              </p>
            </div>
          )}

          {totalPredictions === 0 && (
            <div className="p-3 rounded-lg bg-[#020806] border border-[#1E3A2B]/60 text-center text-[#8D9B95] text-xs font-mono">
              No evaluated rounds reported by the phone server yet.
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
                Dominant: {requiredSignalLabels[adaptiveDominantSignalIndex]}
              </span>
            </div>
            <div className="space-y-2">
              {requiredSignalLabels.map((label, i) => (
                <WeightBar
                  key={label}
                  label={label}
                  value={adaptiveWeights[i]}
                  color={SIGNAL_COLORS[i === 0 ? 0 : 2]}
                  isDominant={i === adaptiveDominantSignalIndex}
                />
              ))}
            </div>
            <p className="text-[10px] text-[#8D9B95] font-sans">
               T3 and T9 weights update after every settled round and sum to 100%. T7 has no Adaptive weight and remains independent.
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
                  {accuracyPct.toFixed(1)}%
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
        subtitle={`Latest evaluation from ${totalPredictions} evaluated rounds — full history stays on the server`}
      >
        <div className="overflow-x-auto rounded-lg border border-[#1E3A2B]/60">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#06130F] text-[#8D9B95] uppercase text-[10px]">
              <tr>
                <th className="py-2.5 px-3">Period</th>
                <th className="py-2.5 px-2 text-center">T3</th>
                <th className="py-2.5 px-2 text-center">T7</th>
                <th className="py-2.5 px-2 text-center">T9</th>
                <th className="py-2.5 px-3 text-center text-[#35B978] font-bold">DECISION</th>
                <th className="py-2.5 px-2 text-center">Actual</th>
                <th className="py-2.5 px-3 text-right">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E3A2B]/40">
              {visibleHistory.map((row, i) => (
                <tr key={i} className="hover:bg-[#06130F]/80">
                  <td className="py-1.5 px-3 text-gray-300">{row.period.slice(-7)}</td>
                  <SigCell pred={row.t3pred} />
                  <SigCell pred={row.t7pred} />
                  <SigCell pred={row.t9pred} />
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
              {visibleHistory.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-[#8D9B95]">
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

      <div className="p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B] text-xs text-[#8D9B95]">
        Learned weights and model resets are managed on the phone server.
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
