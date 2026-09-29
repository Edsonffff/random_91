/**
 * SignalSummaryPanel — All-8-Tests Vote Summary
 *
 * Shows BIG/SMALL signals from every test, counts votes, and shows the majority.
 * No majority is declared on a 4–4 tie.
 */

import React from 'react';

type BigSmall = 'Big' | 'Small';

interface SignalEntry {
  testNum: number;
  label: string;
  prediction: BigSmall | null;
}

interface Props {
  signals: SignalEntry[];
}

export const SignalSummaryPanel: React.FC<Props> = ({ signals }) => {
  const available = signals.filter((s) => s.prediction !== null);
  const bigVotes = available.filter((s) => s.prediction === 'Big').length;
  const smallVotes = available.filter((s) => s.prediction === 'Small').length;
  const total = available.length;

  const hasMajority = total > 0 && bigVotes !== smallVotes;
  const majority: BigSmall | null = hasMajority ? (bigVotes > smallVotes ? 'Big' : 'Small') : null;
  const bigPct = total > 0 ? Math.round((bigVotes / total) * 100) : 0;
  const smallPct = total > 0 ? Math.round((smallVotes / total) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* ── Individual signal grid ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {signals.map((s) => (
          <div key={s.testNum}
            className="p-2 rounded-lg bg-[#020806] border border-[#1E3A2B]/60 flex items-center justify-between gap-2 text-xs font-mono">
            <span className="text-[#8D9B95] text-[10px]">Test {s.testNum}</span>
            {s.prediction ? (
              <span className={`font-bold ${s.prediction === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                {s.prediction.toUpperCase()}
              </span>
            ) : (
              <span className="text-[#8D9B95]">—</span>
            )}
          </div>
        ))}
      </div>

      {/* ── Vote tally ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-[#071A14] border border-[#E7B93F]/30 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="font-bold text-[#E7B93F]">BIG</span>
            <span className="text-[#F5F5F5] font-bold">{bigVotes} / {total}</span>
            <span className="text-[#E7B93F] font-bold">{total > 0 ? `${bigPct}%` : '—'}</span>
          </div>
          <div className="h-2 rounded bg-[#1E3A2B] overflow-hidden">
            <div className="h-full bg-[#E7B93F] rounded transition-all duration-500" style={{ width: `${bigPct}%` }} />
          </div>
        </div>
        <div className="p-3 rounded-lg bg-[#071A14] border border-[#60A5FA]/30 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="font-bold text-[#60A5FA]">SMALL</span>
            <span className="text-[#F5F5F5] font-bold">{smallVotes} / {total}</span>
            <span className="text-[#60A5FA] font-bold">{total > 0 ? `${smallPct}%` : '—'}</span>
          </div>
          <div className="h-2 rounded bg-[#1E3A2B] overflow-hidden">
            <div className="h-full bg-[#60A5FA] rounded transition-all duration-500" style={{ width: `${smallPct}%` }} />
          </div>
        </div>
      </div>

      {/* ── Majority verdict ──────────────────────────────────────────────── */}
      <div className={`p-3 rounded-xl border text-center text-sm font-mono font-bold tracking-wide ${
        total === 0
          ? 'bg-[#06130F] border-[#1E3A2B] text-[#8D9B95]'
          : majority === 'Big'
          ? 'bg-[#E7B93F]/10 border-[#E7B93F]/40 text-[#E7B93F]'
          : majority === 'Small'
          ? 'bg-[#60A5FA]/10 border-[#60A5FA]/40 text-[#60A5FA]'
          : 'bg-[#F04444]/10 border-[#F04444]/30 text-[#F04444]'
      }`}>
        {total === 0
          ? 'No data yet'
          : majority
          ? `MAJORITY SIGNAL: ${majority.toUpperCase()} (${Math.max(bigVotes, smallVotes)}/${total})`
          : `NO MAJORITY — TIE (${bigVotes} BIG : ${smallVotes} SMALL)`}
      </div>

      <p className="text-[10px] text-[#8D9B95] font-sans">
        ⚠ This majority signal reflects the last evaluated prediction from each test — it is not a recommendation to bet. Past patterns have no guaranteed predictive power over future independent draws.
      </p>
    </div>
  );
};
