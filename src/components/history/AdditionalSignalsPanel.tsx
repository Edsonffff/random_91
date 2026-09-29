/**
 * AdditionalSignalsPanel — Tests 5, 6, 7, 8
 *
 * Displays a compact "Additional Signals" card with four time-based formula
 * evaluations.  Each test's prediction is generated from information that was
 * available BEFORE the round's actual result was known (anti-leakage).
 *
 * Timestamp source: parsed directly from the 17-character period string.
 * Format: YYYYMMDDHHMMSS + 3-digit sequence  (e.g. 20260928100050486)
 *                         ^^^^^^^^^^ = 10:00:50
 */

import React, { useState } from 'react';
import { CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { CollapsibleCard } from '../common/CollapsibleCard';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BigSmall = 'Big' | 'Small';

export interface TimeTestDetail {
  period: string;
  hour: number;
  minute: number;
  second: number;
  predictionNumber: number;
  predictedSize: BigSmall;
  actual: number;
  actualSize: BigSmall;
  isHit: boolean;
  // test-specific extra fields (optional)
  extra?: Record<string, number | string>;
}

export interface TimeTestResult {
  hits: number;
  total: number;
  accuracy: number;
  details: TimeTestDetail[];
  currentHitStreak: number;
  currentMissStreak: number;
  longestHitStreak: number;
  longestMissStreak: number;
  // latest prediction (last detail row's predicted size)
  latestPrediction: BigSmall | null;
}

export interface MinuteBucket {
  label: string;
  hits: number;
  total: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse hour/min/sec from the 17-char period string.
 *  Format: YYYYMMDDHHMMSS + 3-digit seq (indices 0-based)
 *  YY=0-3  MM=4-5  DD=6-7  HH=8-9  mm=10-11  ss=12-13  seq=14-16
 */
export function parsePeriodTime(period: string): { hour: number; minute: number; second: number } | null {
  if (!period || period.length < 14) return null;
  const hour = parseInt(period.slice(8, 10), 10);
  const minute = parseInt(period.slice(10, 12), 10);
  const second = parseInt(period.slice(12, 14), 10);
  if (isNaN(hour) || isNaN(minute) || isNaN(second)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  return { hour, minute, second };
}

function toBigSmall(n: number): BigSmall {
  return n >= 5 ? 'Big' : 'Small';
}

function streakStats(details: TimeTestDetail[]) {
  if (details.length === 0) return { currentHitStreak: 0, currentMissStreak: 0, longestHitStreak: 0, longestMissStreak: 0 };
  let longestHit = 0, longestMiss = 0, runLen = 1;
  for (let i = 1; i < details.length; i++) {
    if (details[i].isHit === details[i - 1].isHit) {
      runLen++;
    } else {
      if (details[i - 1].isHit) longestHit = Math.max(longestHit, runLen);
      else longestMiss = Math.max(longestMiss, runLen);
      runLen = 1;
    }
  }
  if (details[details.length - 1].isHit) longestHit = Math.max(longestHit, runLen);
  else longestMiss = Math.max(longestMiss, runLen);
  const last = details[details.length - 1].isHit;
  return { currentHitStreak: last ? runLen : 0, currentMissStreak: !last ? runLen : 0, longestHitStreak: longestHit, longestMissStreak: longestMiss };
}

// ─── Test computations (pure functions — called via useMemo in consumer) ──────

export interface RoundEntryForTests {
  period: string;
  number: number;
}

/**
 * TEST 5 — Time-of-Day Modulo
 * predictionNumber = (h*3600 + m*60 + s) % 10
 */
export function computeTest5(dataset: RoundEntryForTests[]): TimeTestResult {
  let hits = 0;
  const details: TimeTestDetail[] = [];

  for (const item of dataset) {
    const t = parsePeriodTime(item.period);
    if (!t) continue;
    const totalSeconds = t.hour * 3600 + t.minute * 60 + t.second;
    const predNum = totalSeconds % 10;
    const predictedSize = toBigSmall(predNum);
    const actualSize = toBigSmall(item.number);
    const isHit = predictedSize === actualSize;
    if (isHit) hits++;
    details.push({
      period: item.period,
      hour: t.hour,
      minute: t.minute,
      second: t.second,
      predictionNumber: predNum,
      predictedSize,
      actual: item.number,
      actualSize,
      isHit,
      extra: { totalSeconds },
    });
  }

  const total = details.length;
  const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
  return {
    hits, total, accuracy, details,
    ...streakStats(details),
    latestPrediction: details.length > 0 ? details[details.length - 1].predictedSize : null,
  };
}

/**
 * TEST 6 — Minute Modulo
 * predictionNumber = minute % 10
 */
export function computeTest6(dataset: RoundEntryForTests[]): TimeTestResult & { minuteBuckets: MinuteBucket[] } {
  let hits = 0;
  const details: TimeTestDetail[] = [];
  const bucketHits = new Array(6).fill(0);
  const bucketTotal = new Array(6).fill(0);

  for (const item of dataset) {
    const t = parsePeriodTime(item.period);
    if (!t) continue;
    const predNum = t.minute % 10;
    const predictedSize = toBigSmall(predNum);
    const actualSize = toBigSmall(item.number);
    const isHit = predictedSize === actualSize;
    if (isHit) hits++;
    details.push({
      period: item.period,
      hour: t.hour,
      minute: t.minute,
      second: t.second,
      predictionNumber: predNum,
      predictedSize,
      actual: item.number,
      actualSize,
      isHit,
      extra: { minuteModulo: predNum },
    });
    const bucketIdx = Math.floor(t.minute / 10);
    if (bucketIdx >= 0 && bucketIdx < 6) {
      bucketTotal[bucketIdx]++;
      if (isHit) bucketHits[bucketIdx]++;
    }
  }

  const BUCKET_LABELS = ['00–09', '10–19', '20–29', '30–39', '40–49', '50–59'];
  const minuteBuckets: MinuteBucket[] = BUCKET_LABELS.map((label, i) => ({
    label,
    hits: bucketHits[i],
    total: bucketTotal[i],
  }));

  const total = details.length;
  const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
  return {
    hits, total, accuracy, details, minuteBuckets,
    ...streakStats(details),
    latestPrediction: details.length > 0 ? details[details.length - 1].predictedSize : null,
  };
}

/**
 * TEST 7 — Time + Previous Result
 * timeValue = h*60 + m
 * predictionNumber = (timeValue + previousActualNumber) % 10
 *
 * The previous result is always known BEFORE the current prediction is made.
 * This function processes dataset in the order it arrives (expected chronological ascending).
 * Dataset is sorted ascending inside the function for safety.
 */
export function computeTest7(dataset: RoundEntryForTests[]): TimeTestResult {
  const sorted = [...dataset].sort((a, b) => {
    try {
      const diff = BigInt(a.period) - BigInt(b.period);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    } catch {
      return a.period.localeCompare(b.period, undefined, { numeric: true });
    }
  });

  let hits = 0;
  const details: TimeTestDetail[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const prev = sorted[i - 1];
    const t = parsePeriodTime(item.period);
    if (!t) continue;
    const timeValue = t.hour * 60 + t.minute;
    const prevNumber = prev.number;
    const predNum = (timeValue + prevNumber) % 10;
    const predictedSize = toBigSmall(predNum);
    const actualSize = toBigSmall(item.number);
    const isHit = predictedSize === actualSize;
    if (isHit) hits++;
    details.push({
      period: item.period,
      hour: t.hour,
      minute: t.minute,
      second: t.second,
      predictionNumber: predNum,
      predictedSize,
      actual: item.number,
      actualSize,
      isHit,
      extra: { timeValue, prevNumber },
    });
  }

  const total = details.length;
  const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
  return {
    hits, total, accuracy, details,
    ...streakStats(details),
    latestPrediction: details.length > 0 ? details[details.length - 1].predictedSize : null,
  };
}

/**
 * TEST 8 — Time + Current Streak
 * timeValue = h*60 + m
 * streak = length of the current Big/Small consecutive run BEFORE this round
 * predictionNumber = (timeValue + streak) % 10
 *
 * The streak is calculated only from results already known before the prediction.
 */
export function computeTest8(dataset: RoundEntryForTests[]): TimeTestResult {
  const sorted = [...dataset].sort((a, b) => {
    try {
      const diff = BigInt(a.period) - BigInt(b.period);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    } catch {
      return a.period.localeCompare(b.period, undefined, { numeric: true });
    }
  });

  let hits = 0;
  const details: TimeTestDetail[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const t = parsePeriodTime(item.period);
    if (!t) continue;

    // Calculate streak of PREVIOUS results (indices 0..i-1), counting back from i-1
    const prevSize = sorted[i - 1].number >= 5 ? 'Big' : 'Small';
    let streak = 1;
    for (let j = i - 2; j >= 0; j--) {
      const jSize = sorted[j].number >= 5 ? 'Big' : 'Small';
      if (jSize === prevSize) streak++;
      else break;
    }

    const timeValue = t.hour * 60 + t.minute;
    const predNum = (timeValue + streak) % 10;
    const predictedSize = toBigSmall(predNum);
    const actualSize = toBigSmall(item.number);
    const isHit = predictedSize === actualSize;
    if (isHit) hits++;
    details.push({
      period: item.period,
      hour: t.hour,
      minute: t.minute,
      second: t.second,
      predictionNumber: predNum,
      predictedSize,
      actual: item.number,
      actualSize,
      isHit,
      extra: { timeValue, streak },
    });
  }

  const total = details.length;
  const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
  return {
    hits, total, accuracy, details,
    ...streakStats(details),
    latestPrediction: details.length > 0 ? details[details.length - 1].predictedSize : null,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SignalRowProps {
  testNum: number;
  label: string;
  formula: string;
  result: TimeTestResult;
  accentColor: string;
}

function SignalRow({ testNum, label, formula, result, accentColor }: SignalRowProps) {
  const pred = result.latestPrediction;
  const acc = result.accuracy;
  const aboveBaseline = acc >= 50;
  return (
    <div className="flex items-center gap-3 py-2 border-b border-[#1E3A2B]/40 last:border-0 text-xs font-mono">
      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold border`}
        style={{ backgroundColor: `${accentColor}15`, color: accentColor, borderColor: `${accentColor}40` }}>
        T{testNum}
      </span>
      <span className="text-[#8D9B95] w-36 shrink-0 truncate">{label}</span>
      <span className="flex-1 text-[#8D9B95] text-[10px] truncate">{formula}</span>
      {pred ? (
        <span className={`w-14 text-right font-bold ${pred === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
          {pred.toUpperCase()}
        </span>
      ) : (
        <span className="w-14 text-right text-[#8D9B95]">—</span>
      )}
      <span className={`w-12 text-right font-bold ${aboveBaseline ? 'text-[#35B978]' : result.total === 0 ? 'text-[#8D9B95]' : 'text-[#F04444]'}`}>
        {result.total > 0 ? `${acc}%` : '—'}
      </span>
    </div>
  );
}

interface DetailTableProps {
  result: TimeTestResult;
  testNum: number;
  extraHeaders?: string[];
  extraCells?: (row: TimeTestDetail) => React.ReactNode[];
}

function DetailTable({ result, testNum: _testNum, extraHeaders = [], extraCells }: DetailTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#1E3A2B]/60">
      <table className="w-full text-left text-xs font-mono">
        <thead className="bg-[#06130F] text-[#8D9B95] uppercase text-[10px]">
          <tr>
            <th className="py-2.5 px-3">Period</th>
            <th className="py-2.5 px-3">Time</th>
            {extraHeaders.map((h) => <th key={h} className="py-2.5 px-3">{h}</th>)}
            <th className="py-2.5 px-3">Pred # → Size</th>
            <th className="py-2.5 px-3">Actual → Size</th>
            <th className="py-2.5 px-3 text-right">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1E3A2B]/40">
          {[...result.details].reverse().map((row, i) => (
            <tr key={i} className="hover:bg-[#06130F]/80">
              <td className="py-1.5 px-3 text-gray-300">{row.period.slice(-7)}</td>
              <td className="py-1.5 px-3 text-gray-400">
                {String(row.hour).padStart(2,'0')}:{String(row.minute).padStart(2,'0')}:{String(row.second).padStart(2,'0')}
              </td>
              {extraCells ? extraCells(row).map((cell, j) => (
                <td key={j} className="py-1.5 px-3 text-gray-400">{cell}</td>
              )) : null}
              <td className="py-1.5 px-3">
                <span className="text-gray-400">{row.predictionNumber}</span>
                <span className="text-[#8D9B95] mx-1">→</span>
                <span className={`font-bold ${row.predictedSize === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                  {row.predictedSize.toUpperCase()}
                </span>
              </td>
              <td className="py-1.5 px-3">
                <span className="text-gray-400">{row.actual}</span>
                <span className="text-[#8D9B95] mx-1">→</span>
                <span className={`font-bold ${row.actualSize === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                  {row.actualSize.toUpperCase()}
                </span>
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
          {result.details.length === 0 && (
            <tr>
              <td colSpan={5 + extraHeaders.length} className="py-6 text-center text-[#8D9B95]">
                No data. Timestamp must be derivable from the period string.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Streak mini-display ──────────────────────────────────────────────────────

function StreakMini({ result }: { result: TimeTestResult }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
      {[
        { label: 'Cur Hit', val: result.currentHitStreak, color: 'text-[#35B978]' },
        { label: 'Cur Miss', val: result.currentMissStreak, color: 'text-[#F04444]' },
        { label: 'Lng Hit', val: result.longestHitStreak, color: 'text-[#35B978]' },
        { label: 'Lng Miss', val: result.longestMissStreak, color: 'text-[#F04444]' },
      ].map(({ label, val, color }) => (
        <div key={label} className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60 text-center">
          <span className="text-[10px] text-[#8D9B95] block">{label}</span>
          <span className={`text-base font-extrabold ${color}`}>{val}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface AdditionalSignalsPanelProps {
  test5: TimeTestResult;
  test6: TimeTestResult & { minuteBuckets: MinuteBucket[] };
  test7: TimeTestResult;
  test8: TimeTestResult;
}

export const AdditionalSignalsPanel: React.FC<AdditionalSignalsPanelProps> = ({
  test5,
  test6,
  test7,
  test8,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const ACCENT_COLORS = ['#35B978', '#60A5FA', '#F59E0B', '#A78BFA'];

  return (
    <div className="space-y-3">
      {/* ── Compact summary rows ─────────────────────────────────────────── */}
      <div className="space-y-0.5">
        {/* header */}
        <div className="flex items-center gap-3 pb-1 text-[10px] font-mono text-[#8D9B95] uppercase tracking-wider border-b border-[#1E3A2B]/40">
          <span className="w-8 shrink-0">Test</span>
          <span className="w-36 shrink-0">Name</span>
          <span className="flex-1">Formula</span>
          <span className="w-14 text-right">Latest</span>
          <span className="w-12 text-right">Acc%</span>
        </div>
        <SignalRow testNum={5} label="Time-of-Day" formula="(H×3600+M×60+S)%10 → B/S" result={test5} accentColor={ACCENT_COLORS[0]} />
        <SignalRow testNum={6} label="Minute" formula="(Minute)%10 → B/S" result={test6} accentColor={ACCENT_COLORS[1]} />
        <SignalRow testNum={7} label="Time + Previous" formula="(H×60+M+prevResult)%10 → B/S" result={test7} accentColor={ACCENT_COLORS[2]} />
        <SignalRow testNum={8} label="Time + Streak" formula="(H×60+M+streak)%10 → B/S" result={test8} accentColor={ACCENT_COLORS[3]} />
      </div>

      {/* ── Toggle details button ────────────────────────────────────────── */}
      <button
        onClick={() => setShowDetails((v) => !v)}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[#06130F] border border-[#1E3A2B] text-xs font-mono text-[#8D9B95] hover:text-[#F5F5F5] hover:border-[#35B978]/40 transition-colors cursor-pointer"
      >
        {showDetails ? <><ChevronUp className="w-3.5 h-3.5" /> Hide Details</> : <><ChevronDown className="w-3.5 h-3.5" /> View Details</>}
      </button>

      {/* ── Detailed sub-panels (toggle) ─────────────────────────────────── */}
      {showDetails && (
        <div className="space-y-4">

          {/* Test 5 */}
          <CollapsibleCard id="test5_detail" variant="subcard"
            title={<span className="font-mono text-xs font-bold text-[#35B978]">Test 5 — Time-of-Day Modulo</span>}
            subtitle={`${test5.total} predictions · ${test5.accuracy}% accuracy · Cur Hit: ${test5.currentHitStreak} · Cur Miss: ${test5.currentMissStreak}`}
          >
            <div className="space-y-3">
              <StreakMini result={test5} />
              <DetailTable result={test5} testNum={5}
                extraHeaders={['Total Secs']}
                extraCells={(row) => [row.extra?.totalSeconds ?? '—']}
              />
            </div>
          </CollapsibleCard>

          {/* Test 6 */}
          <CollapsibleCard id="test6_detail" variant="subcard"
            title={<span className="font-mono text-xs font-bold text-[#60A5FA]">Test 6 — Minute Modulo</span>}
            subtitle={`${test6.total} predictions · ${test6.accuracy}% accuracy · Cur Hit: ${test6.currentHitStreak} · Cur Miss: ${test6.currentMissStreak}`}
          >
            <div className="space-y-3">
              <StreakMini result={test6} />
              {/* Minute buckets */}
              <div className="p-3 rounded-lg bg-[#071A14] border border-[#1E3A2B] space-y-2">
                <span className="text-[10px] font-mono uppercase font-bold text-[#8D9B95] tracking-wider block">Minute Bucket Accuracy</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
                  {test6.minuteBuckets.map((b) => {
                    const pct = b.total > 0 ? Math.round((b.hits / b.total) * 100) : null;
                    return (
                      <div key={b.label} className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60">
                        <span className="text-[10px] text-[#8D9B95] block">{b.label}</span>
                        <span className={`font-bold text-sm ${pct !== null && pct >= 50 ? 'text-[#35B978]' : pct !== null ? 'text-[#F04444]' : 'text-[#8D9B95]'}`}>
                          {pct !== null ? `${pct}%` : '—'}
                        </span>
                        <span className="text-[10px] text-[#8D9B95] block">{b.hits}/{b.total}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <DetailTable result={test6} testNum={6}
                extraHeaders={['Min%10']}
                extraCells={(row) => [row.extra?.minuteModulo ?? '—']}
              />
            </div>
          </CollapsibleCard>

          {/* Test 7 */}
          <CollapsibleCard id="test7_detail" variant="subcard"
            title={<span className="font-mono text-xs font-bold text-[#F59E0B]">Test 7 — Time + Previous Result</span>}
            subtitle={`${test7.total} predictions · ${test7.accuracy}% accuracy · Cur Hit: ${test7.currentHitStreak} · Cur Miss: ${test7.currentMissStreak}`}
          >
            <div className="space-y-3">
              <StreakMini result={test7} />
              <DetailTable result={test7} testNum={7}
                extraHeaders={['TimeVal', 'PrevNum']}
                extraCells={(row) => [row.extra?.timeValue ?? '—', row.extra?.prevNumber ?? '—']}
              />
            </div>
          </CollapsibleCard>

          {/* Test 8 */}
          <CollapsibleCard id="test8_detail" variant="subcard"
            title={<span className="font-mono text-xs font-bold text-[#A78BFA]">Test 8 — Time + Current Streak</span>}
            subtitle={`${test8.total} predictions · ${test8.accuracy}% accuracy · Cur Hit: ${test8.currentHitStreak} · Cur Miss: ${test8.currentMissStreak}`}
          >
            <div className="space-y-3">
              <StreakMini result={test8} />
              <DetailTable result={test8} testNum={8}
                extraHeaders={['TimeVal', 'Streak']}
                extraCells={(row) => [row.extra?.timeValue ?? '—', row.extra?.streak ?? '—']}
              />
            </div>
          </CollapsibleCard>

        </div>
      )}

      {/* Disclaimer */}
      <p className="text-[10px] text-[#8D9B95] font-sans">
        ⚠ Tests 5–8 use time-of-day signals derived from the period timestamp. All predictions are generated before the actual result is known. Past accuracy does not imply future predictability.
      </p>
    </div>
  );
};
