/**
 * AdditionalSignalsPanel — Tests 5, 6, 7, 8  (corrected implementation)
 *
 * ROOT CAUSE OF PREVIOUS BUG
 * ──────────────────────────
 * The WinGo 30S period string format is:
 *   YYYYMMDD  HHMMSS  SEQ3
 *   20260928  100050  486
 *
 * The HHMMSS portion (pos 8–13) is the *session start time*, shared by
 * every round in a single WinGo session.  It is NOT a unique per-round
 * draw timestamp.  All 100+ rounds in a session therefore showed:
 *   10:00:50, 10:00:50, 10:00:50 …
 *
 * FIX
 * ───
 * Test 5  — Uses the ISO completedAt timestamp from RealGameRecord
 *            (unique per round).  If completedAt is not present or
 *            every round shares the same HH:MM:SS value (non-unique),
 *            Test 5 is marked UNAVAILABLE.
 *
 * Tests 6–8 — Use the last 7 characters of the period string parsed as
 *             an integer.  This gives the sequential round number that
 *             increments with every round:
 *               20260928100050486 → last7 = "0050486" → 50486
 *               20260928100050487 → last7 = "0050487" → 50487
 *             Produces unique, monotonically-increasing round IDs.
 */

import React, { useState } from 'react';
import { CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { CollapsibleCard } from '../common/CollapsibleCard';
import { compareIssuesAsc } from '../../context/RealHistoryContext';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BigSmall = 'Big' | 'Small';

export interface TimeTestDetail {
  period: string;
  /** For Test 5: HH parsed from completedAt */
  hour: number;
  /** For Test 5: MM parsed from completedAt; for Tests 6-8: 0 (unused) */
  minute: number;
  /** For Test 5: SS parsed from completedAt; for Tests 6-8: 0 (unused) */
  second: number;
  predictionNumber: number;
  predictedSize: BigSmall;
  actual: number;
  actualSize: BigSmall;
  isHit: boolean;
  noSignal?: boolean;
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
  latestPrediction: BigSmall | null;
  /** If true, this test cannot produce valid data — show a notice */
  unavailable?: boolean;
  unavailableReason?: string;
}


// ─── Input type (extended from RoundEntry to carry completedAt) ───────────────

export interface RoundEntryForTests {
  period: string;
  number: number;
  /** ISO timestamp from RealGameRecord.completedAt — present only for realLive source */
  completedAt?: string;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function toBigSmall(n: number): BigSmall {
  return n >= 5 ? 'Big' : 'Small';
}

/**
 * Extract the sequential round number from a period string.
 * Uses the last 7 characters to avoid IEEE 754 precision loss on 17-digit ints.
 * For short period strings (≤7 chars), uses the full string.
 *
 * Examples:
 *   "20260928100050486" → parseInt("0050486", 10) = 50486
 *   "20260928100050487" → parseInt("0050487", 10) = 50487
 *   "0051268"           → parseInt("0051268", 10) = 51268
 */
function roundNumberFromPeriod(period: string): number | null {
  const tail = period.length > 7 ? period.slice(-7) : period;
  const n = parseInt(tail, 10);
  return isNaN(n) ? null : n;
}


function streakStats(details: TimeTestDetail[]) {
  if (details.length === 0) {
    return { currentHitStreak: 0, currentMissStreak: 0, longestHitStreak: 0, longestMissStreak: 0 };
  }
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
  return {
    currentHitStreak: last ? runLen : 0,
    currentMissStreak: !last ? runLen : 0,
    longestHitStreak: longestHit,
    longestMissStreak: longestMiss,
  };
}

function sortedAscending(dataset: RoundEntryForTests[]): RoundEntryForTests[] {
  return [...dataset].sort((a, b) => compareIssuesAsc(a.period, b.period));
}



// ─── Test 5 — Digit Mix Formula ───────────────────────────────────────────────
// R = roundNumber (last 7 digits of period string)
// P = previous round's actual numeric result (anti-leakage: sorted[i-1])
//
// digitSum  = sum of individual digits of R
// firstDigit = first digit of R (i.e. Math.floor(R / 10^(digits-1)))
// lastDigit  = R % 10
//
// predictionNumber = (digitSum*3 + P*2 + firstDigit + lastDigit) % 10
// 0–4 → SMALL, 5–9 → BIG

function digitSumOf(n: number): number {
  let s = 0;
  let x = Math.abs(n);
  if (x === 0) return 0;
  while (x > 0) { s += x % 10; x = Math.floor(x / 10); }
  return s;
}

function firstDigitOf(n: number): number {
  let x = Math.abs(n);
  while (x >= 10) x = Math.floor(x / 10);
  return x;
}

export function computeTest5(dataset: RoundEntryForTests[]): TimeTestResult {
  const sorted = sortedAscending(dataset);
  let hits = 0;
  const details: TimeTestDetail[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const prev = sorted[i - 1];
    const roundNum = roundNumberFromPeriod(item.period);
    if (roundNum === null) continue;

    const dSum = digitSumOf(roundNum);
    const fDigit = firstDigitOf(roundNum);
    const lDigit = roundNum % 10;
    const P = prev.number;

    const predNum = (dSum * 3 + P * 2 + fDigit + lDigit) % 10;
    const predictedSize = toBigSmall(predNum);
    const actualSize = toBigSmall(item.number);
    const isHit = predictedSize === actualSize;
    if (isHit) hits++;

    details.push({
      period: item.period,
      hour: 0,
      minute: 0,
      second: 0,
      predictionNumber: predNum,
      predictedSize,
      actual: item.number,
      actualSize,
      isHit,
      extra: { roundNumber: roundNum, digitSum: dSum, firstDigit: fDigit, lastDigit: lDigit, prevResult: P },
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

/** Compute simple moving average over last `n` states (Big=1, Small=0). 
 *  Only uses sorted[0..i-1] — never includes current round. */
function smaWindow(sorted: RoundEntryForTests[], i: number, n: number): number | null {
  if (i < n) return null;
  let sum = 0;
  for (let k = i - n; k < i; k++) sum += sorted[k].number >= 5 ? 1 : 0;
  return sum / n;
}

// ─── Test 6 — Simple Moving Average (SMA-10 official) ────────────────────────
// Encode: Big=1, Small=0
// SMA = avg(prev N states)  — never includes current round (anti-leakage)
// Official signal: SMA-10.  SMA=0.5 or unavailable → NO SIGNAL (excluded from accuracy)

export function computeTest6(
  dataset: RoundEntryForTests[]
): TimeTestResult & { smaValues: { sma5: number | null; sma10: number | null; sma20: number | null } } {
  const sorted = sortedAscending(dataset);
  let hits = 0;
  let total = 0;
  const details: TimeTestDetail[] = [];
  let finalSmaValues = { sma5: null as number | null, sma10: null as number | null, sma20: null as number | null };

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const sma5Val  = smaWindow(sorted, i, 5);
    const sma10Val = smaWindow(sorted, i, 10);
    const sma20Val = smaWindow(sorted, i, 20);
    finalSmaValues = { sma5: sma5Val, sma10: sma10Val, sma20: sma20Val };

    const actualSize: BigSmall = toBigSmall(item.number);
    const noSignal = sma10Val === null || sma10Val === 0.5;
    let predictedSize: BigSmall = 'Big';
    let predNum = 0;
    let isHit = false;

    if (!noSignal && sma10Val !== null) {
      predictedSize = sma10Val > 0.5 ? 'Big' : 'Small';
      predNum = Math.round(sma10Val * 10);
      isHit = predictedSize === actualSize;
      hits++;
      total++;
    }

    details.push({
      period: item.period,
      hour: 0, minute: 0, second: 0,
      predictionNumber: predNum,
      predictedSize,
      actual: item.number,
      actualSize,
      isHit,
      noSignal,
      extra: {
        sma5:  sma5Val  !== null ? Math.round(sma5Val  * 1000) / 10 : -1,
        sma10: sma10Val !== null ? Math.round(sma10Val * 1000) / 10 : -1,
        sma20: sma20Val !== null ? Math.round(sma20Val * 1000) / 10 : -1,
      },
    });
  }

  const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
  const validDetails = details.filter((d) => !d.noSignal);
  return {
    hits, total, accuracy, details,
    ...streakStats(validDetails),
    latestPrediction: validDetails.length > 0 ? validDetails[validDetails.length - 1].predictedSize : null,
    smaValues: finalSmaValues,
  };
}

// ─── Test 7 — WingoAI External Signal ────────────────────────────────────────
// Source: https://server.wingoaibot.com/signals/current?room=30sec&type=standard
//
// The backend collector fetches the WingoAI signal each polling cycle and stores
// it in Supabase (wingo_t7_signals).  The frontend reads those stored signals via
// GET /api/real/t7-signals and passes them here as a Map<period_id → WingoAIT7Signal>.
//
// Rules:
//  · Only periods where a stored signal exists are evaluated.
//  · signal 'BIG'   → predictedSize = 'Big'
//  · signal 'SMALL' → predictedSize = 'Small'
//  · Periods with no stored signal → noSignal = true (excluded from accuracy & Test 4)
//
// Authentication: The Bearer token is STORED ONLY IN THE BACKEND COLLECTOR ENV.
// It is NEVER sent to the frontend, logged, or stored in Supabase.

export interface WingoAIT7Signal {
  period_id: string;
  signal: 'BIG' | 'SMALL';
  confidence: number | null;
  fetched_at: string;
}

export function computeTest7(
  dataset: RoundEntryForTests[],
  t7Signals?: Map<string, WingoAIT7Signal>
): TimeTestResult {
  const sorted = sortedAscending(dataset);
  let hits = 0;
  let total = 0;
  const details: TimeTestDetail[] = [];

  // If no signals have been fetched yet, return an unavailable result
  if (!t7Signals || t7Signals.size === 0) {
    return {
      hits: 0,
      total: 0,
      accuracy: 0,
      details: [],
      currentHitStreak: 0,
      currentMissStreak: 0,
      longestHitStreak: 0,
      longestMissStreak: 0,
      latestPrediction: null,
      unavailable: true,
      unavailableReason: 'WingoAI signals not yet available — backend collector will populate them as new rounds settle.',
    };
  }

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const stored = t7Signals.get(item.period);

    const actualSize: BigSmall = toBigSmall(item.number);

    if (!stored) {
      // No signal recorded for this period — mark noSignal, exclude from accuracy
      details.push({
        period: item.period,
        hour: 0, minute: 0, second: 0,
        predictionNumber: 0,
        predictedSize: 'Big',   // placeholder, irrelevant — noSignal=true
        actual: item.number,
        actualSize,
        isHit: false,
        noSignal: true,
        extra: { source: 'WingoAI', signal: 'N/A', confidence: -1 },
      });
      continue;
    }

    const predictedSize: BigSmall = stored.signal === 'BIG' ? 'Big' : 'Small';
    const isHit = predictedSize === actualSize;
    if (isHit) hits++;
    total++;

    details.push({
      period: item.period,
      hour: 0, minute: 0, second: 0,
      predictionNumber: stored.signal === 'BIG' ? 7 : 3,  // representative placeholder numbers
      predictedSize,
      actual: item.number,
      actualSize,
      isHit,
      noSignal: false,
      extra: {
        source: 'WingoAI',
        signal: stored.signal,
        confidence: stored.confidence !== null ? stored.confidence : -1,
      },
    });
  }

  const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
  const validDetails = details.filter((d) => !d.noSignal);
  return {
    hits, total, accuracy, details,
    ...streakStats(validDetails),
    latestPrediction: validDetails.length > 0 ? validDetails[validDetails.length - 1].predictedSize : null,
  };
}

// ─── Test 8 — Round ID + Current Streak ──────────────────────────────────────
// predictionNumber = (roundNumber + streak) % 10
// streak = consecutive BIG or SMALL run length BEFORE this round (from sorted[0..i-1])

export function computeTest8(dataset: RoundEntryForTests[]): TimeTestResult {
  const sorted = sortedAscending(dataset);
  let hits = 0;
  const details: TimeTestDetail[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const roundNum = roundNumberFromPeriod(item.period);
    if (roundNum === null) continue;

    // Streak: count backward from i-1 — only previously-known results
    const prevSize = sorted[i - 1].number >= 5 ? 'Big' : 'Small';
    let streak = 1;
    for (let j = i - 2; j >= 0; j--) {
      if ((sorted[j].number >= 5 ? 'Big' : 'Small') === prevSize) streak++;
      else break;
    }

    const predNum = (roundNum + streak) % 10;
    const predictedSize = toBigSmall(predNum);
    const actualSize = toBigSmall(item.number);
    const isHit = predictedSize === actualSize;
    if (isHit) hits++;
    details.push({
      period: item.period,
      hour: 0,
      minute: 0,
      second: 0,
      predictionNumber: predNum,
      predictedSize,
      actual: item.number,
      actualSize,
      isHit,
      extra: { roundNumber: roundNum, streak },
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
      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold border"
        style={{ backgroundColor: `${accentColor}15`, color: accentColor, borderColor: `${accentColor}40` }}>
        T{testNum}
      </span>
      <span className="text-[#8D9B95] w-36 shrink-0 truncate">{label}</span>
      <span className="flex-1 text-[#8D9B95] text-[10px] truncate">{formula}</span>
      {result.unavailable ? (
        <span className="w-14 text-right text-[10px] text-[#F04444] font-mono">N/A</span>
      ) : pred ? (
        <span className={`w-14 text-right font-bold ${pred === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
          {pred.toUpperCase()}
        </span>
      ) : (
        <span className="w-14 text-right text-[#8D9B95]">—</span>
      )}
      <span className={`w-12 text-right font-bold ${
        result.unavailable ? 'text-[#8D9B95]' :
        aboveBaseline ? 'text-[#35B978]' :
        result.total === 0 ? 'text-[#8D9B95]' : 'text-[#F04444]'
      }`}>
        {result.unavailable ? 'N/A' : result.total > 0 ? `${acc}%` : '—'}
      </span>
    </div>
  );
}

interface DetailTableProps {
  result: TimeTestResult;
  showTime?: boolean;
  extraHeaders: string[];
  extraCells: (row: TimeTestDetail) => React.ReactNode[];
}

function DetailTable({ result, showTime = false, extraHeaders, extraCells }: DetailTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#1E3A2B]/60">
      <table className="w-full text-left text-xs font-mono">
        <thead className="bg-[#06130F] text-[#8D9B95] uppercase text-[10px]">
          <tr>
            <th className="py-2.5 px-3">Period</th>
            {showTime && <th className="py-2.5 px-3">Draw Time (UTC)</th>}
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
              {showTime && (
                <td className="py-1.5 px-3 text-gray-400">
                  {String(row.hour).padStart(2, '0')}:{String(row.minute).padStart(2, '0')}:{String(row.second).padStart(2, '0')}
                </td>
              )}
              {extraCells(row).map((cell, j) => (
                <td key={j} className="py-1.5 px-3 text-gray-400">{cell}</td>
              ))}
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
                {row.noSignal ? (
                  <span className="text-[#8D9B95] text-[10px] font-mono">NO SIGNAL</span>
                ) : row.isHit ? (
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
              <td colSpan={4 + extraHeaders.length + (showTime ? 1 : 0)} className="py-6 text-center text-[#8D9B95]">
                No data available.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

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
  test6: TimeTestResult & { smaValues: { sma5: number | null; sma10: number | null; sma20: number | null } };
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
        <div className="flex items-center gap-3 pb-1 text-[10px] font-mono text-[#8D9B95] uppercase tracking-wider border-b border-[#1E3A2B]/40">
          <span className="w-8 shrink-0">Test</span>
          <span className="w-36 shrink-0">Name</span>
          <span className="flex-1">Formula</span>
          <span className="w-14 text-right">Latest</span>
          <span className="w-12 text-right">Acc%</span>
        </div>
        <SignalRow testNum={5} label="Digit Mix" formula="(dSum×3+P×2+first+last)%10 → B/S" result={test5} accentColor={ACCENT_COLORS[0]} />
        <SignalRow testNum={6} label="SMA-10" formula="avg(prev 10 states)>0.5→BIG, <0.5→SML" result={test6} accentColor={ACCENT_COLORS[1]} />
        <SignalRow testNum={7} label="WingoAI Signal" formula="External API signal: BIG→Big · SMALL→Small" result={test7} accentColor={ACCENT_COLORS[2]} />
        <SignalRow testNum={8} label="Round ID + Streak" formula="(roundNum+streak)%10 → B/S" result={test8} accentColor={ACCENT_COLORS[3]} />
      </div>

      {/* ── Toggle details ────────────────────────────────────────────────── */}
      <button
        onClick={() => setShowDetails((v) => !v)}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[#06130F] border border-[#1E3A2B] text-xs font-mono text-[#8D9B95] hover:text-[#F5F5F5] hover:border-[#35B978]/40 transition-colors cursor-pointer"
      >
        {showDetails ? <><ChevronUp className="w-3.5 h-3.5" /> Hide Details</> : <><ChevronDown className="w-3.5 h-3.5" /> View Details</>}
      </button>

      {/* ── Detailed sub-panels ───────────────────────────────────────────── */}
      {showDetails && (
        <div className="space-y-4">

          {/* Test 5 */}
          <CollapsibleCard id="test5_detail" variant="subcard"
            title={<span className="font-mono text-xs font-bold text-[#35B978]">Test 5 — Digit Mix Formula</span>}
            subtitle={`${test5.total} predictions · ${test5.accuracy}% accuracy · Cur Hit: ${test5.currentHitStreak} · Cur Miss: ${test5.currentMissStreak}`}
          >
            <div className="space-y-3">
              {/* Formula reference box */}
              <div className="p-3 rounded-lg bg-[#071A14] border border-[#1E3A2B] text-[11px] font-mono text-[#8D9B95] space-y-0.5">
                <span className="text-[#35B978] font-bold block">Formula</span>
                <span>R = round ID (last 7 digits of period)</span>
                <span className="block">predNum = (digitSum(R)×3 + P×2 + firstDigit(R) + lastDigit(R)) % 10</span>
                <span className="block text-[#8D9B95]">P = previous round's actual result · 0–4→SMALL · 5–9→BIG</span>
              </div>
              <StreakMini result={test5} />
              <DetailTable result={test5}
                extraHeaders={['Round #', 'Digit Sum', 'Prev']}
                extraCells={(row) => [
                  row.extra?.roundNumber ?? '—',
                  row.extra?.digitSum ?? '—',
                  row.extra?.prevResult ?? '—',
                ]}
              />
            </div>
          </CollapsibleCard>

          <CollapsibleCard id="test6_detail" variant="subcard"
            title={<span className="font-mono text-xs font-bold text-[#60A5FA]">Test 6 — Simple Moving Average (SMA-10)</span>}
            subtitle={`${test6.total} predictions · ${test6.accuracy}% accuracy · Cur Hit: ${test6.currentHitStreak} · Cur Miss: ${test6.currentMissStreak}`}
          >
            <div className="space-y-3">
              {/* SMA Window Analysis */}
              <div className="p-3 rounded-lg bg-[#071A14] border border-[#1E3A2B] space-y-2">
                <span className="text-[10px] font-mono uppercase font-bold text-[#8D9B95] tracking-wider block">SMA Window Analysis (latest round)</span>
                <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                  {(([
                    { label: 'SMA-5',     val: test6.smaValues?.sma5  ?? null },
                    { label: 'SMA-10 ✓',  val: test6.smaValues?.sma10 ?? null },
                    { label: 'SMA-20',    val: test6.smaValues?.sma20 ?? null },
                  ] as { label: string; val: number | null }[]) ).map(({ label, val }) => {
                    const pct = val !== null ? Math.round(val * 1000) / 10 : null;
                    const noSig = pct === null || pct === 50;
                    return (
                      <div key={label} className="p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B]/60 text-center">
                        <span className="text-[10px] text-[#8D9B95] block">{label}</span>
                        <span className={`text-sm font-bold ${noSig ? 'text-[#8D9B95]' : (pct ?? 0) > 50 ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                          {pct !== null ? `${pct}%` : '—'}
                        </span>
                        <span className="text-[9px] text-[#8D9B95] block">
                          {noSig ? 'NO SIGNAL' : (pct ?? 0) > 50 ? 'BIG' : 'SMALL'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-[#8D9B95] font-sans">Official signal: SMA-10. When SMA-10 = 50% the round is marked NO SIGNAL and excluded from accuracy and Test 4.</p>
              </div>
              <StreakMini result={test6} />
              <DetailTable result={test6}
                extraHeaders={['SMA-5', 'SMA-10', 'SMA-20']}
                extraCells={(row) => [
                  row.extra?.sma5  !== undefined && Number(row.extra.sma5)  !== -1 ? `${row.extra.sma5}%`  : '—',
                  row.extra?.sma10 !== undefined && Number(row.extra.sma10) !== -1 ? `${row.extra.sma10}%` : '—',
                  row.extra?.sma20 !== undefined && Number(row.extra.sma20) !== -1 ? `${row.extra.sma20}%` : '—',
                ]}
              />
            </div>
          </CollapsibleCard>

          {/* Test 7 */}
          <CollapsibleCard id="test7_detail" variant="subcard"
            title={<span className="font-mono text-xs font-bold text-[#F59E0B]">Test 7 — WingoAI Signal</span>}
            subtitle={test7.unavailable
              ? 'Awaiting WingoAI signals from backend collector...'
              : `${test7.total} predictions · ${test7.accuracy}% accuracy · Cur Hit: ${test7.currentHitStreak} · Cur Miss: ${test7.currentMissStreak}`}
          >
            <div className="space-y-3">
              {/* Source info box */}
              <div className="p-3 rounded-lg bg-[#071A14] border border-[#1E3A2B] text-[11px] font-mono text-[#8D9B95] space-y-1">
                <span className="text-[#F59E0B] font-bold block">Source: WingoAI External API</span>
                <span className="block">signal = BIG → prediction = Big · signal = SMALL → prediction = Small</span>
                <span className="block text-[#8D9B95]">
                  Signals are fetched every ~30s by the backend collector and stored in Supabase.
                  Rounds without a stored signal are marked NO SIGNAL and excluded from accuracy and Test 4.
                  Confidence is the provider's reported value — independently verified by actual HIT/MISS performance.
                </span>
              </div>
              {test7.unavailable ? (
                <div className="p-3 rounded-lg bg-[#071A14] border border-[#F59E0B]/30 text-[11px] font-mono text-[#F59E0B]">
                  {test7.unavailableReason}
                </div>
              ) : (
                <>
                  <StreakMini result={test7} />
                  <DetailTable result={test7}
                    extraHeaders={['Signal', 'Confidence']}
                    extraCells={(row) => [
                      row.noSignal ? '—' : String(row.extra?.signal ?? '—'),
                      row.noSignal || Number(row.extra?.confidence) === -1 ? '—' : `${row.extra?.confidence}%`,
                    ]}
                  />
                </>
              )}
            </div>
          </CollapsibleCard>

          {/* Test 8 */}
          <CollapsibleCard id="test8_detail" variant="subcard"
            title={<span className="font-mono text-xs font-bold text-[#A78BFA]">Test 8 — Round ID + Current Streak</span>}
            subtitle={`${test8.total} predictions · ${test8.accuracy}% accuracy · Cur Hit: ${test8.currentHitStreak} · Cur Miss: ${test8.currentMissStreak}`}
          >
            <div className="space-y-3">
              <StreakMini result={test8} />
              <DetailTable result={test8}
                extraHeaders={['Round #', 'Streak']}
                extraCells={(row) => [row.extra?.roundNumber ?? '—', row.extra?.streak ?? '—']}
              />
            </div>
          </CollapsibleCard>

        </div>
      )}

      {/* Disclaimer */}
      <p className="text-[10px] text-[#8D9B95] font-sans">
        ⚠ Test 5 uses the actual draw timestamp from the server (if available and unique per round). Tests 6–8 use the sequential round ID as the temporal variable. All predictions are generated before the actual result is known. Past accuracy does not imply future predictability.
      </p>
    </div>
  );
};
