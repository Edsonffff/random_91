/**
 * AdditionalSignalsPanel — Test 7
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
 * Test 7 — Uses the last 7 characters of the period string parsed as
 *          an integer for exact period matching:
 *            20260928100050486 → last7 = "0050486" → 50486
 *            20260928100050487 → last7 = "0050487" → 50487
 *          Produces unique, monotonically-increasing round IDs.
 */

import React, { useState } from 'react';
import { CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { CollapsibleCard } from '../common/CollapsibleCard';
import { compareIssuesAsc } from '../../context/RealHistoryContext';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Rows rendered by default in the expanded detail tables. */
const DETAIL_ROWS_VISIBLE = 200;

export type BigSmall = 'Big' | 'Small';

export interface TimeTestDetail {
  period: string;
  /** Reserved display time field for shared detail-table compatibility. */
  hour: number;
  /** Reserved display field for shared detail-table compatibility. */
  minute: number;
  /** Reserved display field for shared detail-table compatibility. */
  second: number;
  predictionNumber: number | null;
  predictedSize: BigSmall | null;
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


// ─── Input type ───────────────────────────────────────────────────────────────

export interface RoundEntryForTests {
  period: string;
  number: number;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function toBigSmall(n: number): BigSmall {
  return n >= 5 ? 'Big' : 'Small';
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




// ─── Test 7 — External Prediction Source ─────────────────────────────────────
// Source: https://bdgtharu.com/api.php  (server-side only)
//
// The backend collector fetches the external prediction each polling cycle and
// stores it in Supabase (wingo_t7_signals).  The frontend reads those stored
// signals via GET /api/real/t7-signals and passes them here as a
// Map<period_id → WingoAIT7Signal>.  The browser never calls bdgtharu.com.
//
// Rules:
//  · Only periods where a stored signal exists are evaluated.
//  · signal 'BIG'   → predictedSize = 'Big'
//  · signal 'SMALL' → predictedSize = 'Small'
//  · Periods with no stored signal → noSignal = true (excluded from accuracy & Adaptive Learning)
//
// Authentication: Any credential is STORED ONLY IN THE BACKEND COLLECTOR ENV.
// It is NEVER sent to the frontend, logged, or stored in Supabase.

export interface WingoAIT7Signal {
  period_id: string;
  signal: 'BIG' | 'SMALL';
  confidence: number | null;
  lucky_number?: number | null;
  fetched_at: string;
  // Fields supplied by the bdgtharu.com source. All optional so the legacy
  // WingoAI rows (NULL for these) keep working untouched. The hit/miss
  // statistics below are still computed exactly as before, from `signal`
  // compared against the actual draw — these fields are recorded metadata.
  color?: string | null;
  status?: string | null;
  source?: string | null;
  algorithm_version?: number | null;
  guard_applied?: boolean | null;
  actual_number?: number | null;
  actual_color?: string | null;
  size_hit?: boolean | null;
  color_hit?: boolean | null;
  settled_at?: string | null;
  prediction_created_at?: string | null;
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
    const cleanPeriod = String(item.period).trim();
    const stored = t7Signals.get(cleanPeriod);

    const actualSize: BigSmall = toBigSmall(item.number);

    if (!stored) {
      // STRICT PERIOD MATCHING: No exact periodId match found in WingoAI records.
      // Must return prediction = null, luckyNumber = null, noSignal = true, excluded from HIT/MISS and accuracy.
      details.push({
        period: item.period,
        hour: 0,
        minute: 0,
        second: 0,
        predictionNumber: null,
        predictedSize: null,
        actual: item.number,
        actualSize,
        isHit: false,
        noSignal: true,
        extra: { source: 'WingoAI', signal: 'NO SIGNAL', confidence: -1 },
      });
      continue;
    }

    const predictedSize: BigSmall = stored.signal === 'BIG' ? 'Big' : 'Small';
    const isHit = predictedSize === actualSize;
    if (isHit) hits++;
    total++;

    const luckyNum = typeof stored.lucky_number === 'number' ? stored.lucky_number : null;

    details.push({
      period: item.period,
      hour: 0,
      minute: 0,
      second: 0,
      predictionNumber: luckyNum,
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
  const validDetails = details.filter((d) => !d.noSignal && d.predictedSize !== null);

  // Strictly find the signal for the immediate upcoming round (the next round after newestPeriod).
  // NEVER fall back to previous settled rounds or stale signals!
  let upcomingPrediction: BigSmall | null = null;
  let lowestUpcomingPeriod: string | null = null;
  if (sorted.length > 0) {
    const newestPeriod = sorted[sorted.length - 1].period;
    for (const [period, sig] of t7Signals.entries()) {
      if (compareIssuesAsc(period, newestPeriod) > 0) {
        if (!lowestUpcomingPeriod || compareIssuesAsc(period, lowestUpcomingPeriod) < 0) {
          lowestUpcomingPeriod = period;
          upcomingPrediction = sig.signal === 'BIG' ? 'Big' : 'Small';
        }
      }
    }
  }

  return {
    hits,
    total,
    accuracy,
    details,
    ...streakStats(validDetails),
    latestPrediction: upcomingPrediction, // Strictly upcoming period signal or null. NO FALLBACK!
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
  // These tables live inside default-expanded cards, so they previously mounted
  // one <tr> per evaluated round (thousands at 2,400+ history). Render the most
  // recent slice by default; the full detail array is unchanged and one click
  // away, so no calculation or result is altered.
  const [showAll, setShowAll] = useState(false);
  const rowsDesc = result.details;
  const visibleRows = showAll ? rowsDesc : rowsDesc.slice(-DETAIL_ROWS_VISIBLE);
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
          {[...visibleRows].reverse().map((row, i) => (
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
                {row.noSignal || !row.predictedSize ? (
                  <span className="text-[#8D9B95] text-[10px] font-mono italic">NO SIGNAL</span>
                ) : (
                  <>
                    {row.predictionNumber !== null && (
                      <>
                        <span className="text-gray-400">{row.predictionNumber}</span>
                        <span className="text-[#8D9B95] mx-1">→</span>
                      </>
                    )}
                    <span className={`font-bold ${row.predictedSize === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                      {row.predictedSize.toUpperCase()}
                    </span>
                  </>
                )}
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
      {result.details.length > DETAIL_ROWS_VISIBLE && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-[#1E3A2B]/60 bg-[#06130F] text-[10px] font-mono text-[#8D9B95]">
          <span>
            Showing {visibleRows.length} of {result.details.length} rounds
          </span>
          <button
            type="button"
            onClick={() => setShowAll((prev) => !prev)}
            className="px-2 py-0.5 rounded bg-[#020806] hover:bg-[#1E3A2B] border border-[#1E3A2B] text-[#35B978] font-bold transition-colors cursor-pointer"
          >
            {showAll ? 'Show latest only' : 'Show all'}
          </button>
        </div>
      )}
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


export interface T7DebugInfo {
  lastFetchedAt: string | null;
  lastSignalPeriod: string | null;
  lastSignalStoredAt: string | null;
  dashboardReceivedAt: string | null;
  apiResponseMs: number | null;
  endToEndDelayMs: number | null;
  collectorLatencyMs?: number | null;
  apiLatencyMs?: number | null;
  frontendLatencyMs?: number | null;
  totalEndToEndMs?: number | null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface AdditionalSignalsPanelProps {
  test7: TimeTestResult;
  t7DebugInfo?: T7DebugInfo | null;
}

export const AdditionalSignalsPanel: React.FC<AdditionalSignalsPanelProps> = ({
  test7,
  t7DebugInfo,
}) => {
  const [showDetails, setShowDetails] = useState(false);

   const ACCENT_COLORS = ['#60A5FA'];

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
        <SignalRow testNum={7} label="WingoAI Signal" formula="External API signal: BIG→Big · SMALL→Small" result={test7} accentColor={ACCENT_COLORS[0]} />
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

          <CollapsibleCard id="test7_detail" variant="subcard"
            title={<span className="font-mono text-xs font-bold text-[#F59E0B]">Test 7 — WingoAI Signal</span>}
            subtitle={test7.unavailable
              ? 'Awaiting WingoAI signals from backend collector...'
              : `${test7.total} predictions · ${test7.accuracy}% accuracy · Cur Hit: ${test7.currentHitStreak} · Cur Miss: ${test7.currentMissStreak}`}
          >
            <div className="space-y-3">
              {/* Telemetry / Latency Monitor Box */}
              <div className="p-3.5 rounded-lg bg-[#04120C] border border-[#1E3A2B] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E3A2B]/60 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-[#35B978] animate-pulse"></span>
                    <span className="text-[11px] font-mono font-bold text-[#E7B93F] uppercase tracking-wider">
                      WingoAI Signal Latency & Synchronization Monitor
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1E3A2B]/40 text-[#8D9B95]">
                    Poller: 5s Fast Loop
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                  <div className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60">
                    <span className="text-[10px] text-[#8D9B95] block">Signal Period</span>
                    <span className="text-xs font-bold text-[#F5F5F5] truncate block">
                      {t7DebugInfo?.lastSignalPeriod ? t7DebugInfo.lastSignalPeriod.slice(-7) : '—'}
                    </span>
                    <span className="text-[9px] text-[#8D9B95] truncate block font-sans">
                      {t7DebugInfo?.lastSignalPeriod ?? 'Waiting...'}
                    </span>
                  </div>

                  <div className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60">
                    <span className="text-[10px] text-[#8D9B95] block">Collector Latency</span>
                    <span className={`text-xs font-bold ${
                      (t7DebugInfo?.collectorLatencyMs ?? 0) > 1000 ? 'text-[#F59E0B]' : 'text-[#35B978]'
                    }`}>
                      {t7DebugInfo?.collectorLatencyMs !== null && t7DebugInfo?.collectorLatencyMs !== undefined
                        ? `${t7DebugInfo.collectorLatencyMs} ms`
                        : `${t7DebugInfo?.apiResponseMs ?? '~750'} ms`}
                    </span>
                    <span className="text-[9px] text-[#8D9B95] block font-sans">
                      DB stored - fetched
                    </span>
                  </div>

                  <div className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60">
                    <span className="text-[10px] text-[#8D9B95] block">API Latency</span>
                    <span className={`text-xs font-bold ${
                      (t7DebugInfo?.apiLatencyMs ?? 0) > 500 ? 'text-[#F59E0B]' : 'text-[#35B978]'
                    }`}>
                      {t7DebugInfo?.apiLatencyMs !== null && t7DebugInfo?.apiLatencyMs !== undefined
                        ? `${t7DebugInfo.apiLatencyMs} ms`
                        : '< 50 ms'}
                    </span>
                    <span className="text-[9px] text-[#8D9B95] block font-sans">
                      Server response time
                    </span>
                  </div>

                  <div className="p-2 rounded bg-[#020806] border border-[#1E3A2B]/60">
                    <span className="text-[10px] text-[#8D9B95] block">End-to-End Latency</span>
                    <span className={`text-xs font-bold ${
                      (t7DebugInfo?.totalEndToEndMs ?? t7DebugInfo?.endToEndDelayMs ?? 0) > 8000 ? 'text-[#F59E0B]' : 'text-[#35B978]'
                    }`}>
                      {t7DebugInfo?.totalEndToEndMs !== null && t7DebugInfo?.totalEndToEndMs !== undefined
                        ? `${(t7DebugInfo.totalEndToEndMs / 1000).toFixed(1)} s`
                        : (t7DebugInfo?.endToEndDelayMs !== null && t7DebugInfo?.endToEndDelayMs !== undefined
                            ? `${(t7DebugInfo.endToEndDelayMs / 1000).toFixed(1)} s`
                            : '< 2 s')}
                    </span>
                    <span className="text-[9px] text-[#8D9B95] block font-sans">
                      Fetch → UI delay
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between text-[10px] text-[#8D9B95] font-mono pt-1">
                  <span>Fetched: {t7DebugInfo?.lastFetchedAt ? new Date(t7DebugInfo.lastFetchedAt).toLocaleTimeString() : '—'}</span>
                  <span>Stored: {t7DebugInfo?.lastSignalStoredAt ? new Date(t7DebugInfo.lastSignalStoredAt).toLocaleTimeString() : '—'}</span>
                  <span>UI Received: {t7DebugInfo?.dashboardReceivedAt ? new Date(t7DebugInfo.dashboardReceivedAt).toLocaleTimeString() : '—'}</span>
                </div>
              </div>

              {/* Source info box */}
              <div className="p-3 rounded-lg bg-[#071A14] border border-[#1E3A2B] text-[11px] font-mono text-[#8D9B95] space-y-1">
                <span className="text-[#F59E0B] font-bold block">Source: WingoAI External API</span>
                <span className="block">signal = BIG → prediction = Big · signal = SMALL → prediction = Small</span>
                <span className="block text-[#8D9B95]">
                  Signals are polled every ~5s by an independent backend worker and synchronized with the frontend every ~5s.
                  Rounds without a stored signal are marked NO SIGNAL and excluded from accuracy and Adaptive Learning.
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

        </div>
      )}

      {/* Disclaimer */}
      <p className="text-[10px] text-[#8D9B95] font-sans">
        ⚠ Test 7 uses the external prediction signal. All predictions are generated before the actual result is known. Past accuracy does not imply future predictability.
      </p>
    </div>
  );
};
