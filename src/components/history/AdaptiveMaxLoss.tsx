import React from 'react';
import type { VerifiedMaxLoss } from '../../services/adaptiveLearningApi';

export const AdaptiveMaxLoss: React.FC<{ metric?: VerifiedMaxLoss | null }> = ({ metric }) => {
  const values = [
    ['TEST 3', metric?.test3],
    ['TEST 7', metric?.test7],
    ['TEST 9', metric?.test9],
  ] as const;
  return (
    <section aria-labelledby="verified-max-loss" className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 id="verified-max-loss" className="text-xs font-mono font-bold tracking-wider text-[#35B978]">VERIFIED MAX LOSS</h2>
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#8D9B95]">Independent · Read-only</span>
      </div>
      <p className="text-[11px] text-[#8D9B95] mb-3">Statistical metric reconstructed from verified available history and predictions. It is separate from Adaptive checkpoint counters.</p>
      <dl className="grid grid-cols-3 gap-3 text-xs font-mono">
        {values.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B]/60">
            <dt className="text-[#8D9B95]">{label}</dt>
            <dd className="font-extrabold text-[#E7B93F]">{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
      {metric && (
        <div className="mt-3 text-xs text-[#8D9B95] space-y-1">
          <p>Coverage: <strong className="text-[#E7B93F]">{metric.coverage === 'partial' ? 'Partial' : 'Complete within reported scope'}</strong> — this is not a global or all-time verification claim.</p>
          {metric.coverage === 'partial' && <p>Historical input is unavailable for part of the scope; no missing values were inferred.</p>}
          {metric.knownThrough && <p>Known through: {metric.knownThrough}</p>}
          {metric.firstMissingHistoryPeriod && <p>Missing history: {metric.firstMissingHistoryPeriod} → {metric.lastMissingHistoryPeriod}</p>}
          {metric.calculationStatus === 'calculating' && <p>Updating independent historical metrics…</p>}
        </div>
      )}
      {!metric && <p className="mt-3 text-xs text-[#8D9B95]">Verified Max Loss is unavailable until the independent read-only calculation is received.</p>}
    </section>
  );
};
