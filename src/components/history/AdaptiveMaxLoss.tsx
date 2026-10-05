import React from 'react';
import type { AdaptiveSnapshot } from '../../services/adaptiveLearningApi';

type MaxLoss = Pick<AdaptiveSnapshot, 'test3MaxLoss' | 'test7MaxLoss' | 'test9MaxLoss'>;

export const AdaptiveMaxLoss: React.FC<{ data: MaxLoss | null }> = ({ data }) => {
  const values = [
    ['TEST 3', data?.test3MaxLoss],
    ['TEST 7', data?.test7MaxLoss],
    ['TEST 9', data?.test9MaxLoss],
  ] as const;
  return (
    <section aria-labelledby="adaptive-max-loss" className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
      <h2 id="adaptive-max-loss" className="text-xs font-mono font-bold tracking-wider text-[#35B978] mb-3">MAX LOSS</h2>
      <dl className="grid grid-cols-3 gap-3 text-xs font-mono">
        {values.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B]/60">
            <dt className="text-[#8D9B95]">{label}</dt>
            <dd className="font-extrabold text-[#E7B93F]">{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
};
