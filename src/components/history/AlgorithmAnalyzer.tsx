import React, { useState, useMemo, useEffect } from 'react';
import { useResults } from '../../context/ResultContext';
import { useRealHistory, compareIssuesAsc } from '../../context/RealHistoryContext';
import {
  CheckCircle2,
  XCircle,
  Microscope,
  Zap,
  Scale,
  AlertTriangle,
  Radio,
  ChevronDown,
  ChevronUp,
  Flame,
  Trash2,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { CollapsibleCard } from '../common/CollapsibleCard';
import { useAdaptiveLearning } from '../../hooks/useAdaptiveLearning';
import type { Test4InputRow } from '../../hooks/useAdaptiveLearning';
import { AdaptiveLearningPanel } from './AdaptiveLearningPanel';
import {
  AdditionalSignalsPanel,
  computeTest5,
  computeTest6,
  computeTest7,
  computeTest8,
} from './AdditionalSignalsPanel';
import type { WingoAIT7Signal, T7DebugInfo } from './AdditionalSignalsPanel';
import { SignalSummaryPanel } from './SignalSummaryPanel';

interface RoundEntry {
  period: string;
  number: number;
  /** ISO timestamp from RealGameRecord.completedAt — only present for realLive source */
  completedAt?: string;
}

interface StreakDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
  6: number;
  '7+': number;
}

interface StreakStats {
  totalPredictions: number;
  totalHits: number;
  totalMisses: number;
  accuracyPct: number;
  currentHitStreak: number;
  currentMissStreak: number;
  currentRunText: string;
  currentRunType: 'HIT' | 'MISS' | 'NONE';
  currentRunLength: number;
  longestHitStreak: number;
  longestMissStreak: number;
  hitStreakCount: number;
  missStreakCount: number;
  hitStreaks: number[];
  missStreaks: number[];
  avgHitStreak: number;
  avgMissStreak: number;
  hitDistribution: StreakDistribution;
  missDistribution: StreakDistribution;
  sequenceStr: string;
  rawSequence: ('H' | 'M')[];
}

const DISTRIBUTION_KEYS: (1 | 2 | 3 | 4 | 5 | 6 | '7+')[] = [1, 2, 3, 4, 5, 6, '7+'];

function calculateStreakStats(outcomes: ('H' | 'M')[]): StreakStats {
  const totalPredictions = outcomes.length;
  if (totalPredictions === 0) {
    return {
      totalPredictions: 0,
      totalHits: 0,
      totalMisses: 0,
      accuracyPct: 0,
      currentHitStreak: 0,
      currentMissStreak: 0,
      currentRunText: '0',
      currentRunType: 'NONE',
      currentRunLength: 0,
      longestHitStreak: 0,
      longestMissStreak: 0,
      hitStreakCount: 0,
      missStreakCount: 0,
      hitStreaks: [],
      missStreaks: [],
      avgHitStreak: 0,
      avgMissStreak: 0,
      hitDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, '7+': 0 },
      missDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, '7+': 0 },
      sequenceStr: '',
      rawSequence: [],
    };
  }

  let totalHits = 0;
  let totalMisses = 0;
  const hitStreaks: number[] = [];
  const missStreaks: number[] = [];

  let currentStreakType: 'H' | 'M' = outcomes[0];
  let currentLen = 0;

  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    if (outcome === 'H') totalHits++;
    else totalMisses++;

    if (outcome === currentStreakType) {
      currentLen++;
    } else {
      if (currentStreakType === 'H') {
        hitStreaks.push(currentLen);
      } else {
        missStreaks.push(currentLen);
      }
      currentStreakType = outcome;
      currentLen = 1;
    }
  }

  if (currentLen > 0) {
    if (currentStreakType === 'H') {
      hitStreaks.push(currentLen);
    } else {
      missStreaks.push(currentLen);
    }
  }

  const finalOutcome = outcomes[outcomes.length - 1];
  const currentHitStreak = finalOutcome === 'H' ? currentLen : 0;
  const currentMissStreak = finalOutcome === 'M' ? currentLen : 0;
  const currentRunType = finalOutcome === 'H' ? 'HIT' : 'MISS';
  const currentRunLength = currentLen;
  const currentRunText = `${currentLen} ${currentRunType}`;

  const longestHitStreak = hitStreaks.length > 0 ? Math.max(...hitStreaks) : 0;
  const longestMissStreak = missStreaks.length > 0 ? Math.max(...missStreaks) : 0;

  const hitStreakCount = hitStreaks.length;
  const missStreakCount = missStreaks.length;

  const sumHitLengths = hitStreaks.reduce((acc, v) => acc + v, 0);
  const sumMissLengths = missStreaks.reduce((acc, v) => acc + v, 0);

  const avgHitStreak = hitStreakCount > 0 ? Number((sumHitLengths / hitStreakCount).toFixed(1)) : 0;
  const avgMissStreak = missStreakCount > 0 ? Number((sumMissLengths / missStreakCount).toFixed(1)) : 0;

  const hitDistribution: StreakDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, '7+': 0 };
  const missDistribution: StreakDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, '7+': 0 };

  for (const len of hitStreaks) {
    if (len >= 7) hitDistribution['7+']++;
    else hitDistribution[len as 1 | 2 | 3 | 4 | 5 | 6]++;
  }

  for (const len of missStreaks) {
    if (len >= 7) missDistribution['7+']++;
    else missDistribution[len as 1 | 2 | 3 | 4 | 5 | 6]++;
  }

  const accuracyPct = Math.round((totalHits / totalPredictions) * 100);

  return {
    totalPredictions,
    totalHits,
    totalMisses,
    accuracyPct,
    currentHitStreak,
    currentMissStreak,
    currentRunText,
    currentRunType,
    currentRunLength,
    longestHitStreak,
    longestMissStreak,
    hitStreakCount,
    missStreakCount,
    hitStreaks,
    missStreaks,
    avgHitStreak,
    avgMissStreak,
    hitDistribution,
    missDistribution,
    sequenceStr: outcomes.join(' '),
    rawSequence: outcomes,
  };
}

const StreakAnalysisPanel: React.FC<{ stats: StreakStats; title?: string; id?: string }> = ({
  stats,
  title,
  id = 'streak_panel',
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    try {
      const stored = sessionStorage.getItem(`collapse_sec_${id}`);
      if (stored !== null) return stored === 'true';
    } catch {}
    return true;
  });

  const toggle = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(`collapse_sec_${id}`, String(next));
      } catch {}
      return next;
    });
  };

  const maxHitFreq = Math.max(1, ...Object.values(stats.hitDistribution));
  const maxMissFreq = Math.max(1, ...Object.values(stats.missDistribution));

  return (
    <div className="rounded-xl bg-[#06130F] border border-[#1E3A2B] overflow-hidden transition-colors">
      {/* Header with Title and Current Run */}
      <div
        className={`p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 ${
          isExpanded ? 'border-b border-[#1E3A2B]/60' : ''
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isExpanded}
            className="w-5 h-5 flex items-center justify-center rounded text-[#8D9B95] hover:text-[#E7B93F] hover:bg-[#1E3A2B]/50 transition-colors cursor-pointer select-none shrink-0"
            title={isExpanded ? 'Collapse section' : 'Expand section'}
          >
            <span className="text-[10px] font-sans inline-block select-none">
              {isExpanded ? '▼' : '▶'}
            </span>
          </button>
          <Flame className="w-4 h-4 text-[#E7B93F] shrink-0" />
          <span
            onClick={toggle}
            className="text-xs font-mono font-bold uppercase tracking-wider text-[#F5F5F5] cursor-pointer select-none truncate"
          >
            STREAK ANALYSIS {title ? `• ${title}` : ''}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-[#8D9B95] font-mono">Current Run:</span>
          <span
            className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold border ${
              stats.totalPredictions === 0
                ? 'bg-[#1E3A2B]/40 text-[#8D9B95] border-[#1E3A2B]'
                : stats.currentRunType === 'HIT'
                ? 'bg-[#35B978]/20 text-[#35B978] border-[#35B978]/40 shadow-sm'
                : 'bg-[#F04444]/20 text-[#F04444] border-[#F04444]/40 shadow-sm'
            }`}
          >
            {stats.totalPredictions === 0 ? '0' : stats.currentRunText}
          </span>
        </div>
      </div>

      {/* Collapsible Content with smooth CSS Grid height transition */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
          isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="p-4 sm:p-5 space-y-4">
            {/* 3 Metrics Sections: CURRENT | RECORDS | SUMMARY */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              {/* CURRENT */}
              <div className="p-3 rounded-lg bg-[#071A14] border border-[#1E3A2B] space-y-2">
                <span className="text-[10px] font-mono uppercase font-bold text-[#8D9B95] tracking-wider block">
                  CURRENT
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded bg-[#06130F] border border-[#1E3A2B]/60">
                    <span className="text-[10px] text-[#8D9B95] block">Hit Streak</span>
                    <span className="font-mono text-base font-extrabold text-[#35B978]">
                      {stats.currentHitStreak}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-[#06130F] border border-[#1E3A2B]/60">
                    <span className="text-[10px] text-[#8D9B95] block">Miss Streak</span>
                    <span className="font-mono text-base font-extrabold text-[#F04444]">
                      {stats.currentMissStreak}
                    </span>
                  </div>
                </div>
              </div>

              {/* RECORDS */}
              <div className="p-3 rounded-lg bg-[#071A14] border border-[#1E3A2B] space-y-2">
                <span className="text-[10px] font-mono uppercase font-bold text-[#8D9B95] tracking-wider block">
                  RECORDS
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded bg-[#06130F] border border-[#1E3A2B]/60">
                    <span className="text-[10px] text-[#8D9B95] block">Longest Hit Streak</span>
                    <span className="font-mono text-base font-extrabold text-[#35B978]">
                      {stats.longestHitStreak}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-[#06130F] border border-[#1E3A2B]/60">
                    <span className="text-[10px] text-[#8D9B95] block">Longest Miss Streak</span>
                    <span className="font-mono text-base font-extrabold text-[#F04444]">
                      {stats.longestMissStreak}
                    </span>
                  </div>
                </div>
              </div>

              {/* SUMMARY */}
              <div className="p-3 rounded-lg bg-[#071A14] border border-[#1E3A2B] space-y-2">
                <span className="text-[10px] font-mono uppercase font-bold text-[#8D9B95] tracking-wider block">
                  SUMMARY
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded bg-[#06130F] border border-[#1E3A2B]/60">
                    <span className="text-[10px] text-[#8D9B95] block">Total Hit Streaks</span>
                    <div className="font-mono font-bold text-[#F5F5F5]">
                      <span className="text-sm text-[#35B978]">{stats.hitStreakCount}</span>
                      <span className="text-[10px] text-[#8D9B95] block mt-0.5">
                        Avg: {stats.avgHitStreak}
                      </span>
                    </div>
                  </div>
                  <div className="p-2 rounded bg-[#06130F] border border-[#1E3A2B]/60">
                    <span className="text-[10px] text-[#8D9B95] block">Total Miss Streaks</span>
                    <div className="font-mono font-bold text-[#F5F5F5]">
                      <span className="text-sm text-[#F04444]">{stats.missStreakCount}</span>
                      <span className="text-[10px] text-[#8D9B95] block mt-0.5">
                        Avg: {stats.avgMissStreak}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* DISTRIBUTION Section with compact horizontal bars */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase font-bold text-[#8D9B95] tracking-wider block">
                DISTRIBUTION
              </span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {/* Hit Streaks Distribution */}
                <div className="p-3 rounded-lg bg-[#071A14] border border-[#1E3A2B] space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono font-bold text-[#35B978]">
                      Hit Streaks (H)
                    </span>
                    <span className="font-mono text-[10px] text-[#8D9B95]">
                      {stats.hitStreakCount} streaks • {stats.totalHits} total hits
                    </span>
                  </div>
                  <div className="space-y-1 pt-1">
                    {DISTRIBUTION_KEYS.map((key) => {
                      const count = stats.hitDistribution[key];
                      const pct = stats.hitStreakCount > 0 ? Math.round((count / stats.hitStreakCount) * 100) : 0;
                      const barWidth = maxHitFreq > 0 ? Math.round((count / maxHitFreq) * 100) : 0;
                      return (
                        <div key={key} className="flex items-center gap-2 text-[11px] font-mono py-0.5">
                          <span className="w-5 text-right text-[#8D9B95] font-semibold text-[10px]">{key}</span>
                          <div className="flex-1 h-2.5 rounded bg-[#020806] overflow-hidden border border-[#1E3A2B]/50">
                            <div
                              className="h-full bg-[#35B978] transition-all duration-300 rounded-sm"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <span className="w-16 text-right font-mono text-[10px]">
                            <span className={count > 0 ? 'font-bold text-[#F5F5F5]' : 'text-[#8D9B95]/50'}>{count}</span>
                            <span className="text-[#8D9B95] ml-1">({pct}%)</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Miss Streaks Distribution */}
                <div className="p-3 rounded-lg bg-[#071A14] border border-[#1E3A2B] space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono font-bold text-[#F04444]">
                      Miss Streaks (M)
                    </span>
                    <span className="font-mono text-[10px] text-[#8D9B95]">
                      {stats.missStreakCount} streaks • {stats.totalMisses} total misses
                    </span>
                  </div>
                  <div className="space-y-1 pt-1">
                    {DISTRIBUTION_KEYS.map((key) => {
                      const count = stats.missDistribution[key];
                      const pct = stats.missStreakCount > 0 ? Math.round((count / stats.missStreakCount) * 100) : 0;
                      const barWidth = maxMissFreq > 0 ? Math.round((count / maxMissFreq) * 100) : 0;
                      return (
                        <div key={key} className="flex items-center gap-2 text-[11px] font-mono py-0.5">
                          <span className="w-5 text-right text-[#8D9B95] font-semibold text-[10px]">{key}</span>
                          <div className="flex-1 h-2.5 rounded bg-[#020806] overflow-hidden border border-[#1E3A2B]/50">
                            <div
                              className="h-full bg-[#F04444] transition-all duration-300 rounded-sm"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <span className="w-16 text-right font-mono text-[10px]">
                            <span className={count > 0 ? 'font-bold text-[#F5F5F5]' : 'text-[#8D9B95]/50'}>{count}</span>
                            <span className="text-[#8D9B95] ml-1">({pct}%)</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Internal Sequence Container for verification */}
            <div className="p-3 rounded-lg bg-[#071A14] border border-[#1E3A2B] space-y-1.5">
              <div className="flex flex-wrap items-center justify-between text-[11px] gap-2">
                <span className="text-[#8D9B95] uppercase font-semibold">
                  Sequence Used for Streak Calculation ({stats.totalPredictions} predictions):
                </span>
                <span className="font-mono text-[10px] text-[#8D9B95]">
                  <span className="text-[#35B978] font-bold">H</span> = Hit ({stats.totalHits}) •{' '}
                  <span className="text-[#F04444] font-bold">M</span> = Miss ({stats.totalMisses})
                </span>
              </div>
              <div
                className="h-16 overflow-y-auto overflow-x-hidden p-2 rounded bg-[#020806] border border-[#1E3A2B]/60 font-mono text-xs select-text leading-relaxed tracking-wider break-words"
                style={{ scrollbarWidth: 'thin', scrollbarColor: '#35B978 #020806' }}
              >
                {stats.rawSequence.map((outcome, idx) => (
                  <span
                    key={idx}
                    className={`inline-block mr-1 font-bold ${
                      outcome === 'H' ? 'text-[#35B978]' : 'text-[#F04444]'
                    }`}
                  >
                    {outcome}
                  </span>
                ))}
                {stats.rawSequence.length === 0 && (
                  <span className="text-[#8D9B95] text-xs">No prediction data available</span>
                )}
              </div>
            </div>

            {/* Statistical Integrity Disclaimer */}
            <div className="text-[11px] text-[#8D9B95] flex items-start gap-1.5 px-0.5 font-sans pt-1">
              <span className="text-[#E7B93F] font-bold shrink-0">ℹ</span>
              <span>
                <strong>Empirical Probability Note:</strong> Observed streaks represent past statistical variance.
                Consecutive misses do <em>not</em> increase the mathematical probability of a hit on the next round (independence of trials / Gambler&apos;s Fallacy).
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Sample 1: Earlier 10 rounds from the first Big Mumbai screenshot
const SAMPLE_1_EVIDENCE: RoundEntry[] = [
  { period: '20260928100050486', number: 2 },
  { period: '20260928100050487', number: 5 },
  { period: '20260928100050488', number: 2 },
  { period: '20260928100050489', number: 5 },
  { period: '20260928100050490', number: 5 },
  { period: '20260928100050491', number: 5 },
  { period: '20260928100050492', number: 2 },
  { period: '20260928100050493', number: 6 },
  { period: '20260928100050494', number: 1 },
  { period: '20260928100050495', number: 8 },
];

// Sample 2: Earlier rounds (...545 to ...554)
const SAMPLE_2_LATEST: RoundEntry[] = [
  { period: '20260928100050545', number: 8 },
  { period: '20260928100050546', number: 5 },
  { period: '20260928100050547', number: 1 },
  { period: '20260928100050548', number: 4 },
  { period: '20260928100050549', number: 5 },
  { period: '20260928100050550', number: 3 },
  { period: '20260928100050551', number: 0 },
  { period: '20260928100050552', number: 9 },
  { period: '20260928100050553', number: 3 },
  { period: '20260928100050554', number: 2 },
];

// Sample 3: Latest 10 rounds from the current screen (...568 to ...577)
const SAMPLE_3_SCREEN: RoundEntry[] = [
  { period: '20260928100050568', number: 5 },
  { period: '20260928100050569', number: 0 },
  { period: '20260928100050570', number: 4 },
  { period: '20260928100050571', number: 6 },
  { period: '20260928100050572', number: 6 },
  { period: '20260928100050573', number: 2 },
  { period: '20260928100050574', number: 5 },
  { period: '20260928100050575', number: 7 },
  { period: '20260928100050576', number: 6 },
  { period: '20260928100050577', number: 6 },
];

// ─── Test 3: WingoBot Previous-2-Results Reference Pattern ───────────────────
export const WINGOBOT_T3_PATTERN_MAP: Record<string, 'Big' | 'Small'> = {
  // Column 1 mappings
  '2,4': 'Small',
  '4,0': 'Big',
  '0,2': 'Small',
  '2,0': 'Big',
  '0,9': 'Small',
  '7,7': 'Big',
  '8,6': 'Big',
  '6,8': 'Small',
  '6,4': 'Big',
  '4,7': 'Small',
  '7,3': 'Big',
  '3,7': 'Small',
  '2,9': 'Big',
  '5,2': 'Small',
  '5,0': 'Big',

  // Column 2 mappings
  '0,7': 'Small',
  '7,8': 'Big',
  '8,7': 'Small',
  '7,0': 'Big',
  '2,6': 'Big',
  '4,8': 'Small',
  '8,1': 'Big',
  '4,5': 'Small',
  '1,5': 'Big',
  '6,7': 'Small',
  '7,2': 'Big',
  '9,4': 'Big',
  '4,2': 'Big',
  '3,3': 'Small',
  '0,1': 'Big',
  '1,8': 'Small',
};

export const WINGOBOT_T3_CONFLICTING_PAIRS = new Set(['0,0', '2,5']);

export interface Test3Detail {
  period: string;
  prevPrevDigit: number;
  prevDigit: number;
  prevPrevSize: 'Big' | 'Small';
  prevSize: 'Big' | 'Small';
  pairString: string; // e.g. "2 → 5"
  sizePattern: string; // e.g. "SMALL → BIG"
  predictedSize: 'Big' | 'Small' | null;
  actualSize: 'Big' | 'Small';
  actualNumber: number;
  isHit: boolean;
  noSignal: boolean;
  reason?: string;
}

export interface Test3Result {
  hits: number;
  total: number;
  accuracy: number;
  details: Test3Detail[];
  latestPrediction: 'Big' | 'Small' | null;
  latestPair: string | null;
  latestPattern: string | null;
  latestStatus: 'ACTIVE' | 'NO BET';
  latestReason: string | null;
}

export const AlgorithmAnalyzer: React.FC = () => {
  const { results, loadBigMumbaiSample } = useResults();
  const { realHistory, resetAllSystemData } = useRealHistory();
  const [dataSource, setDataSource] = useState<'realLive' | 'sample3' | 'sample2' | 'sample1' | 'live'>('realLive');
  const [activeTestTab, setActiveTestTab] = useState<'periodSum' | 'linearDelta' | 'alternation' | 'additional'>('periodSum');
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const showAllSequence = Boolean(expandedSources[dataSource]);

  // ── Reset confirmation modal state ──────────────────────────────────────────
  const [showResetModal, setShowResetModal] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // ── WingoAI T7 signals (fetched from backend, never contains auth token) ──
  const [t7SignalsMap, setT7SignalsMap] = useState<Map<string, WingoAIT7Signal>>(new Map());
  const [t7DebugInfo, setT7DebugInfo] = useState<T7DebugInfo | null>(null);

  useEffect(() => {
    const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';
    let cancelled = false;
    let isFetching = false;

    async function loadT7Signals() {
      if (isFetching) return;
      isFetching = true;
      try {
        const resp = await fetch(`${apiBase}/api/real/t7-signals`);
        if (!resp.ok) return;
        const json = await resp.json();
        if (!json.success || !Array.isArray(json.signals)) return;
        if (cancelled) return;
        const newMap = new Map<string, WingoAIT7Signal>();
        for (const s of json.signals) {
          if (s.period_id && (s.signal === 'BIG' || s.signal === 'SMALL')) {
            const pid = String(s.period_id).trim();
            newMap.set(pid, {
              period_id: pid,
              signal: s.signal,
              confidence: typeof s.confidence === 'number' ? s.confidence : null,
              lucky_number: typeof s.lucky_number === 'number' ? s.lucky_number : (typeof s.luckyNumber === 'number' ? s.luckyNumber : null),
              fetched_at: s.fetched_at,
            });
          }
        }
        setT7SignalsMap(newMap);

        // Capture latency telemetry
        const now = Date.now();
        const receivedAtIso = new Date(now).toISOString();
        const newestSignal = json.signals[0];
        const timing = json.timing || {};

        const fetchedTime = timing.fetched_at || newestSignal?.fetched_at;
        const storedTime = timing.stored_at || newestSignal?.stored_at || fetchedTime;
        const period = timing.period_id || newestSignal?.period_id;
        const apiMs = timing.api_response_ms ?? newestSignal?.api_response_ms ?? null;
        const endToEnd = fetchedTime ? Math.max(0, now - new Date(fetchedTime).getTime()) : null;

        setT7DebugInfo({
          lastFetchedAt: fetchedTime || null,
          lastSignalPeriod: period || null,
          lastSignalStoredAt: storedTime || null,
          dashboardReceivedAt: receivedAtIso,
          apiResponseMs: apiMs,
          endToEndDelayMs: endToEnd,
        });
      } catch {
        // Non-fatal — T7 will show as unavailable until signals arrive
      } finally {
        isFetching = false;
      }
    }

    loadT7Signals();
    // Re-fetch every 5s for rapid upcoming period synchronization without lag
    const interval = setInterval(loadT7Signals, 5_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const toggleShowAllSequence = () => {
    setExpandedSources((prev) => ({
      ...prev,
      [dataSource]: !prev[dataSource],
    }));
  };

  const DEFAULT_VISIBLE_ROUNDS = 30;

  // Active dataset being analyzed (Backtesting strictly on completed results)
  const activeDataset: RoundEntry[] = useMemo(() => {
    if (dataSource === 'realLive') {
      return realHistory.map((r) => ({
        period: r.periodNumber,
        number: r.winningNumber,
        completedAt: r.completedAt, // carry actual draw timestamp for Test 5
      }));
    }
    if (dataSource === 'sample3') {
      return SAMPLE_3_SCREEN;
    }
    if (dataSource === 'sample2') {
      return SAMPLE_2_LATEST;
    }
    if (dataSource === 'sample1') {
      return SAMPLE_1_EVIDENCE;
    }
    // Use top 10 from live simulator results
    return results.slice(0, 10).map((r) => ({
      period: r.periodNumber,
      number: r.winningNumber,
    }));
  }, [dataSource, realHistory, results]);

  // ==========================================
  // 1. OBSERVED METRICS (Empirical Ground Truth)
  // ==========================================
  const observedStats = useMemo(() => {
    const total = activeDataset.length;
    if (total === 0) return null;

    const numCounts = Array(10).fill(0);
    let bigCount = 0;
    let smallCount = 0;
    let alternations = 0;

    activeDataset.forEach((item, idx) => {
      numCounts[item.number]++;
      if (item.number >= 5) bigCount++;
      else smallCount++;

      if (idx > 0) {
        const prevSize = activeDataset[idx - 1].number >= 5 ? 'Big' : 'Small';
        const currSize = item.number >= 5 ? 'Big' : 'Small';
        if (prevSize !== currSize) alternations++;
      }
    });

    // Find highest frequency numbers
    const topNumbers = numCounts
      .map((count, num) => ({ num, count, pct: Math.round((count / total) * 100) }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);

    return {
      total,
      sequenceStr: activeDataset.map((d) => d.number).join(' → '),
      bigCount,
      smallCount,
      bigPct: Math.round((bigCount / total) * 100),
      smallPct: Math.round((smallCount / total) * 100),
      alternations,
      alternationRate: total > 1 ? Math.round((alternations / (total - 1)) * 100) : 0,
      topNumbers,
    };
  }, [activeDataset]);

  const visibleSequenceStr = useMemo(() => {
    if (!activeDataset || activeDataset.length === 0) return '';
    const slice = showAllSequence ? activeDataset : activeDataset.slice(0, DEFAULT_VISIBLE_ROUNDS);
    return slice.map((d) => d.number).join(' → ');
  }, [activeDataset, showAllSequence]);

  // ==========================================
  // 2. TESTED FORMULAS (Mathematical Evaluations)
  // ==========================================
  // Test A: Period Digit Sum Modulo 10
  const testPeriodSum = useMemo(() => {
    let hits = 0;
    const toBigSmall = (n: number): 'Big' | 'Small' => (n >= 5 ? 'Big' : 'Small');
    const sorted = [...activeDataset].sort((a, b) => compareIssuesAsc(a.period, b.period));
    const details = sorted.map((item) => {
      const sum = item.period
        .split('')
        .reduce((acc, char) => acc + parseInt(char, 10), 0);
      const predicted = sum % 10;
      const predictedSize = toBigSmall(predicted);
      const actualSize = toBigSmall(item.number);
      const isHit = predictedSize === actualSize;
      if (isHit) hits++;
      return {
        period: item.period,
        actual: item.number,
        actualSize,
        predicted,
        predictedSize,
        isHit,
      };
    });

    const accuracy = activeDataset.length > 0 ? Math.round((hits / activeDataset.length) * 100) : 0;
    return { hits, total: activeDataset.length, accuracy, details };
  }, [activeDataset]);

  // Test B: Markov Chain Transition Model
  // P(next | prev) = N(prev→next) / Σ N(prev→*)
  // Anti-leakage: matrix built from rounds 0..i-1; prediction made before actual of round i is seen.
  // Minimum samples (MIN_MARKOV) required per previous-state before a prediction is generated.
  const testLinearRecurrence = useMemo(() => {
    const MIN_MARKOV = 5;
    const toBigSmall = (n: number): 'Big' | 'Small' => (n >= 5 ? 'Big' : 'Small');

    // Sort ascending so we can process chronologically
    const sorted = [...activeDataset].sort(
      (a, b) => compareIssuesAsc(a.period, b.period)
    );

    // 2×2 matrix: matrix[prev][cur] = transition count
    const matrix: Record<'Big' | 'Small', Record<'Big' | 'Small', number>> = {
      Big:   { Big: 0, Small: 0 },
      Small: { Big: 0, Small: 0 },
    };

    let hits = 0;
    const details: Array<{
      period: string;
      previousState: 'Big' | 'Small';
      pBig: number;
      pSmall: number;
      samplesUsed: number;
      predictedSize: 'Big' | 'Small';
      actual: number;
      actualSize: 'Big' | 'Small';
      isHit: boolean;
      insufficient: boolean;
    }> = [];

    for (let i = 1; i < sorted.length; i++) {
      const prevState = toBigSmall(sorted[i - 1].number);
      const item = sorted[i];
      const actualSize = toBigSmall(item.number);

      // Count transitions from prevState using matrix BEFORE updating
      const samplesUsed = matrix[prevState]['Big'] + matrix[prevState]['Small'];
      const insufficient = samplesUsed < MIN_MARKOV;
      let predictedSize: 'Big' | 'Small' = 'Big';
      let pBig = 0;
      let pSmall = 0;
      let isHit = false;

      if (!insufficient) {
        pBig   = matrix[prevState]['Big']   / samplesUsed;
        pSmall = matrix[prevState]['Small'] / samplesUsed;
        predictedSize = pBig >= pSmall ? 'Big' : 'Small';
        isHit = predictedSize === actualSize;
        if (isHit) hits++;
      }

      details.push({
        period: item.period,
        previousState: prevState,
        pBig,
        pSmall,
        samplesUsed,
        predictedSize,
        actual: item.number,
        actualSize,
        isHit,
        insufficient,
      });

      // Update matrix AFTER generating prediction (anti-leakage)
      matrix[prevState][actualSize]++;
    }

    const total = details.filter((d) => !d.insufficient).length;
    const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;

    // Compute current state for dashboard display
    const lastItem = sorted.length > 0 ? sorted[sorted.length - 1] : null;
    const currentState = lastItem ? toBigSmall(lastItem.number) : null;
    let currentPBig: number | null = null;
    let currentPSmall: number | null = null;
    if (currentState) {
      const tot = matrix[currentState]['Big'] + matrix[currentState]['Small'];
      if (tot >= MIN_MARKOV) {
        currentPBig   = matrix[currentState]['Big']   / tot;
        currentPSmall = matrix[currentState]['Small'] / tot;
      }
    }

    // Latest prediction: last non-insufficient detail
    const validDetails = details.filter((d) => !d.insufficient);
    const latestPrediction = validDetails.length > 0 ? validDetails[validDetails.length - 1].predictedSize : null;

    return { hits, total, accuracy, details, latestPrediction, currentState, currentPBig, currentPSmall };
  }, [activeDataset]);

  // Test 3: Previous 2 Results Pattern (WingoBot Reference Chart)
  const test3 = useMemo((): Test3Result => {
    const roundByPeriod = new Map<string, RoundEntry>();
    for (const item of activeDataset) {
      if (item && item.period) {
        roundByPeriod.set(String(item.period).trim(), item);
      }
    }

    const sortedPeriods = Array.from(roundByPeriod.keys()).sort((a, b) => compareIssuesAsc(a, b));

    let hits = 0;
    let evaluatedTotal = 0;
    const details: Test3Detail[] = [];

    // Historical loop: evaluate each round i >= 2 using i-2 and i-1
    for (let i = 2; i < sortedPeriods.length; i++) {
      const prevPrevPeriod = sortedPeriods[i - 2];
      const prevPeriod = sortedPeriods[i - 1];
      const currentPeriod = sortedPeriods[i];

      const prevPrevRound = roundByPeriod.get(prevPrevPeriod);
      const prevRound = roundByPeriod.get(prevPeriod);
      const currentRound = roundByPeriod.get(currentPeriod);
      if (!prevPrevRound || !prevRound || !currentRound) continue;

      const p1 = prevPrevRound.number;
      const p2 = prevRound.number;
      const key = `${p1},${p2}`;
      const prevPrevSize = p1 >= 5 ? 'Big' : 'Small';
      const prevSize = p2 >= 5 ? 'Big' : 'Small';
      const pairString = `${p1} → ${p2}`;
      const sizePattern = `${prevPrevSize.toUpperCase()} → ${prevSize.toUpperCase()}`;
      const actualSize: 'Big' | 'Small' = currentRound.number >= 5 ? 'Big' : 'Small';

      const isConflicting = WINGOBOT_T3_CONFLICTING_PAIRS.has(key);
      const predictedSize = WINGOBOT_T3_PATTERN_MAP[key] ?? null;
      const noSignal = predictedSize === null;
      const reason = predictedSize
        ? undefined
        : isConflicting
        ? 'Conflicting pair (0→0 / 2→5)'
        : 'Pair not found in reference chart';

      let isHit = false;
      if (!noSignal && predictedSize !== null) {
        isHit = predictedSize === actualSize;
        if (isHit) hits++;
        evaluatedTotal++;
      }

      details.push({
        period: currentRound.period,
        prevPrevDigit: p1,
        prevDigit: p2,
        prevPrevSize,
        prevSize,
        pairString,
        sizePattern,
        predictedSize,
        actualSize,
        actualNumber: currentRound.number,
        isHit,
        noSignal,
        reason,
      });
    }

    const accuracy = evaluatedTotal > 0 ? Math.round((hits / evaluatedTotal) * 100) : 0;

    // Upcoming round prediction (using the 2 latest completed rounds)
    let latestPrediction: 'Big' | 'Small' | null = null;
    let latestPair: string | null = null;
    let latestPattern: string | null = null;
    let latestStatus: 'ACTIVE' | 'NO BET' = 'NO BET';
    let latestReason: string | null = null;

    if (sortedPeriods.length >= 2) {
      const last1 = roundByPeriod.get(sortedPeriods[sortedPeriods.length - 2]);
      const last2 = roundByPeriod.get(sortedPeriods[sortedPeriods.length - 1]);
      if (last1 && last2) {
        const p1 = last1.number;
        const p2 = last2.number;
        const key = `${p1},${p2}`;
        const p1Size = p1 >= 5 ? 'Big' : 'Small';
        const p2Size = p2 >= 5 ? 'Big' : 'Small';
        latestPair = `${p1} → ${p2}`;
        latestPattern = `${p1Size.toUpperCase()} → ${p2Size.toUpperCase()}`;
        latestPrediction = WINGOBOT_T3_PATTERN_MAP[key] ?? null;
        if (latestPrediction !== null) {
          latestStatus = 'ACTIVE';
          latestReason = null;
        } else {
          latestStatus = 'NO BET';
          latestReason = WINGOBOT_T3_CONFLICTING_PAIRS.has(key)
            ? 'Conflicting pair in reference chart (0→0 / 2→5)'
            : 'Pair not found in reference chart';
        }
      }
    } else {
      latestReason = 'Insufficient history (< 2 rounds)';
    }

    return {
      hits,
      total: evaluatedTotal,
      accuracy,
      details,
      latestPrediction,
      latestPair,
      latestPattern,
      latestStatus,
      latestReason,
    };
  }, [activeDataset]);

  const streakStatsPeriodSum = useMemo(() => {
    return calculateStreakStats(testPeriodSum.details.map((d) => (d.isHit ? 'H' : 'M')));
  }, [testPeriodSum.details]);

  const streakStatsLinearRecurrence = useMemo(() => {
    return calculateStreakStats(
      testLinearRecurrence.details
        .filter((d) => !d.insufficient)
        .map((d) => (d.isHit ? 'H' : 'M'))
    );
  }, [testLinearRecurrence.details]);

  const streakStatsTest3 = useMemo(() => {
    return calculateStreakStats(
      test3.details
        .filter((d) => !d.noSignal && d.predictedSize !== null)
        .map((d) => (d.isHit ? 'H' : 'M'))
    );
  }, [test3.details]);

  // ==========================================
  // 5–8. TIME-BASED / ROUND-ID SIGNAL TESTS
  // ==========================================
  // Declared BEFORE test4Inputs so their .details arrays are available
  // when building the join maps below.

  const test5 = useMemo(() => computeTest5(activeDataset), [activeDataset]);
  const test6 = useMemo(() => computeTest6(activeDataset), [activeDataset]);
  const test7 = useMemo(() => computeTest7(activeDataset, t7SignalsMap), [activeDataset, t7SignalsMap]);
  const test8 = useMemo(() => computeTest8(activeDataset), [activeDataset]);

  // ==========================================
  // ADAPTIVE LEARNING MAIN DECISION ENGINE
  // ==========================================
  // Build aligned input rows for Adaptive Learning.
  // T1/T2/T3 + actual are required; T5–T8 are optional.
  // Missing T5–T8 are excluded from that round's vote inside the hook.
  const adaptiveInputs = useMemo((): Test4InputRow[] => {
    if (testPeriodSum.details.length === 0) return [];

    const t1Map = new Map<string, 'Big' | 'Small'>();
    for (const d of testPeriodSum.details) t1Map.set(d.period, d.predictedSize);

    const t2Map = new Map<string, 'Big' | 'Small'>();
    for (const d of testLinearRecurrence.details) {
      if (!d.insufficient) t2Map.set(d.period, d.predictedSize);
    }

    const t3Map = new Map<string, 'Big' | 'Small'>();
    for (const d of test3.details) {
      if (!d.noSignal && d.predictedSize) t3Map.set(d.period, d.predictedSize);
    }

    const t5Map = new Map<string, 'Big' | 'Small'>();
    for (const d of test5.details) {
      if (d.predictedSize) t5Map.set(d.period, d.predictedSize);
    }

    const t6Map = new Map<string, 'Big' | 'Small'>();
    for (const d of test6.details) {
      if (!d.noSignal && d.predictedSize) t6Map.set(d.period, d.predictedSize);
    }

    const t7Map = new Map<string, 'Big' | 'Small'>();
    for (const d of test7.details) {
      if (!d.noSignal && d.predictedSize) t7Map.set(d.period, d.predictedSize);
    }

    const t8Map = new Map<string, 'Big' | 'Small'>();
    for (const d of test8.details) {
      if (d.predictedSize) t8Map.set(d.period, d.predictedSize);
    }

    const actualMap = new Map<string, 'Big' | 'Small'>();
    for (const item of activeDataset) {
      actualMap.set(item.period, item.number >= 5 ? 'Big' : 'Small');
    }

    const rows: Test4InputRow[] = [];
    for (const [period, t1pred] of t1Map) {
      const t2pred = t2Map.get(period);
      const actual = actualMap.get(period);
      if (!t2pred || !actual) continue;
      rows.push({
        period,
        t1pred,
        t2pred,
        t3pred: t3Map.get(period) ?? null,
        t5pred: t5Map.get(period),
        t6pred: t6Map.get(period),
        t7pred: t7Map.get(period),
        t8pred: t8Map.get(period),
        actual,
      });
    }
    return rows;
  }, [
    testPeriodSum.details,
    testLinearRecurrence.details,
    test3.details,
    test5.details,
    test6.details,
    test7.details,
    test8.details,
    activeDataset,
  ]);

  const adaptiveLearning = useAdaptiveLearning(adaptiveInputs);

  // ==========================================
  // INPUT SIGNALS SUMMARY (Tests 1, 2, 3, 5, 6, 7, 8)
  // ==========================================
  const signalSummaryData = useMemo(() => {
    return [
      { testNum: 1, label: 'Period Digit Sum', prediction: testPeriodSum.details.length > 0 ? testPeriodSum.details[testPeriodSum.details.length - 1]?.predictedSize ?? null : null },
      { testNum: 2, label: 'Markov Chain', prediction: testLinearRecurrence.latestPrediction },
      { testNum: 3, label: 'Previous 2 Pattern', prediction: test3.latestPrediction },
      { testNum: 5, label: 'Digit Mix', prediction: test5.latestPrediction },
      { testNum: 6, label: 'SMA-10', prediction: test6.latestPrediction },
      { testNum: 7, label: 'WingoAI Signal', prediction: test7.latestPrediction },
      { testNum: 8, label: 'Round ID + Streak', prediction: test8.latestPrediction },
    ];
  }, [testPeriodSum.details, testLinearRecurrence.latestPrediction, test3.latestPrediction, test5.latestPrediction, test6.latestPrediction, test7.latestPrediction, test8.latestPrediction]);

  const handleFullReset = async () => {
    setIsResetting(true);
    setResetError(null);
    try {
      const res = await resetAllSystemData();
      if (!res.success) {
        setResetError(res.error || 'Reset operation failed on backend.');
        setIsResetting(false);
        return;
      }

      // 1. Reset adaptive learning model state with full clean slate (streaks = 0, weights = initial)
      adaptiveLearning.resetLearning(true);

      // 2. Clear WingoAI signals map
      setT7SignalsMap(new Map());

      // 3. Clear all related local/session storage caches
      try {
        localStorage.removeItem('wingo_adaptive_model_v5');
        localStorage.removeItem('wingo_test4_model_v4');
        localStorage.removeItem('wingo_real_history_cache_v1');
        sessionStorage.removeItem('wingo_real_history_cache_v1');
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('wingo_') || key.startsWith('adaptive_'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      } catch {}

      // 4. Close modal
      setShowResetModal(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResetError(`Reset error: ${msg}`);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl bg-[#071A14] border border-[#1E3A2B]">
        <div>
          <div className="flex items-center gap-2">
            <Microscope className="w-5 h-5 text-[#E7B93F]" />
            <h2 className="text-base font-extrabold uppercase tracking-wide text-[#F5F5F5]">
              Scientific Evidence & Formula Analyzer
            </h2>
          </div>
          <p className="text-xs text-[#8D9B95] mt-1">
            Separating empirical observation, mathematical verification, and unproven inferences.
          </p>
        </div>

        {/* Dataset Toggle & Sync Action */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 bg-[#06130F] p-1 rounded-xl border border-[#1E3A2B] text-xs">
            <button
              onClick={() => setDataSource('realLive')}
              className={`px-3 py-1.5 rounded-lg font-mono font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                dataSource === 'realLive'
                  ? 'bg-[#35B978] text-[#020806] font-black shadow'
                  : 'text-[#8D9B95] hover:text-[#F5F5F5]'
              }`}
            >
              <Radio className={`w-3 h-3 ${dataSource === 'realLive' ? 'animate-pulse' : 'text-[#35B978]'}`} />
              Real Live Feed ({realHistory.length > 0 ? `${realHistory.length} Settled` : 'Live'})
            </button>
            <button
              onClick={() => setDataSource('sample3')}
              className={`px-3 py-1.5 rounded-lg font-mono font-medium transition-colors cursor-pointer ${
                dataSource === 'sample3'
                  ? 'bg-[#E7B93F] text-[#020806] font-bold shadow'
                  : 'text-[#8D9B95] hover:text-[#F5F5F5]'
              }`}
            >
              Sample 3 (...568–...577)
            </button>
            <button
              onClick={() => setDataSource('sample2')}
              className={`px-3 py-1.5 rounded-lg font-mono font-medium transition-colors cursor-pointer ${
                dataSource === 'sample2'
                  ? 'bg-[#E7B93F] text-[#020806] font-bold shadow'
                  : 'text-[#8D9B95] hover:text-[#F5F5F5]'
              }`}
            >
              Sample 2 (...545–...554)
            </button>
            <button
              onClick={() => setDataSource('sample1')}
              className={`px-3 py-1.5 rounded-lg font-mono font-medium transition-colors cursor-pointer ${
                dataSource === 'sample1'
                  ? 'bg-[#E7B93F] text-[#020806] font-bold shadow'
                  : 'text-[#8D9B95] hover:text-[#F5F5F5]'
              }`}
            >
              Sample 1 (...486–...495)
            </button>
            <button
              onClick={() => setDataSource('live')}
              className={`px-3 py-1.5 rounded-lg font-mono font-medium transition-colors cursor-pointer ${
                dataSource === 'live'
                  ? 'bg-[#E7B93F] text-[#020806] font-bold shadow'
                  : 'text-[#8D9B95] hover:text-[#F5F5F5]'
              }`}
            >
              Simulator Data Feed
            </button>
          </div>

          <button
            onClick={loadBigMumbaiSample}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#E7B93F]/15 hover:bg-[#E7B93F]/25 text-[#E7B93F] border border-[#E7B93F]/30 font-mono text-xs font-bold transition-all cursor-pointer shadow"
            title="Inject the latest 10 draws from your screen (...568 to ...577) directly into the simulator"
          >
            <Zap className="w-3.5 h-3.5" />
            Sync Screen to Simulator
          </button>

          <button
            onClick={() => setShowResetModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#F04444]/15 hover:bg-[#F04444]/25 text-[#F04444] border border-[#F04444]/40 font-mono text-xs font-black transition-all cursor-pointer shadow"
            title="Full reset of collected history, predictions, hit/miss records, and adaptive learning state"
          >
            <Trash2 className="w-3.5 h-3.5" />
            RESET ALL DATA
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* MAIN DECISION ENGINE: ADAPTIVE LEARNING                  */}
      {/* ======================================================== */}
      <CollapsibleCard
        id="main_adaptive_learning_engine"
        title={
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-extrabold bg-[#35B978]/20 text-[#35B978] border border-[#35B978]/50 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> MAIN DECISION SYSTEM
            </span>
            <h3 className="text-base font-extrabold text-[#F5F5F5] uppercase tracking-wider">
              ADAPTIVE LEARNING
            </h3>
          </div>
        }
        headerRight={
          <span className="text-xs text-[#8D9B95] font-mono">
            Online Adaptive Ensemble of Supporting Tests (1, 2, 3, 5, 6, 7, 8)
          </span>
        }
        defaultExpanded={true}
      >
        <AdaptiveLearningPanel data={adaptiveLearning} />
      </CollapsibleCard>

      {/* ======================================================== */}
      {/* CATEGORY 1: OBSERVED (What Actually Appears)             */}
      {/* ======================================================== */}
      <CollapsibleCard
        id="analyzer_category_1"
        title={
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-[#35B978]/15 text-[#35B978] border border-[#35B978]/30">
              CATEGORY 1
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                dataSource === 'live'
                  ? 'bg-[#E7B93F]/15 text-[#E7B93F] border-[#E7B93F]/30'
                  : 'bg-[#35B978]/20 text-[#35B978] border-[#35B978]/40'
              }`}
            >
              {dataSource === 'live' ? 'SIMULATOR DATA' : 'COMPLETED REAL HISTORY'}
            </span>
            <h3 className="text-sm font-bold text-[#F5F5F5] uppercase tracking-wider">
              OBSERVED (Empirical Ground Truth)
            </h3>
          </div>
        }
        headerRight={
          <span className="text-xs text-[#8D9B95]">
            What actually appears in the recorded history
          </span>
        }
      >
        {observedStats && (
          <div className="space-y-4">
            {/* Sequence line with compact fixed-height scrollable container */}
            <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-[#8D9B95] uppercase font-semibold">
                    Observed Draw Sequence:
                  </span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-[#1E3A2B]/50 text-[#E7B93F] border border-[#1E3A2B]">
                    {observedStats.total > DEFAULT_VISIBLE_ROUNDS
                      ? showAllSequence
                        ? `Showing all ${observedStats.total} rounds`
                        : `Showing latest ${DEFAULT_VISIBLE_ROUNDS} of ${observedStats.total} rounds`
                      : `Showing all ${observedStats.total} rounds`}
                  </span>
                </div>

                {observedStats.total > DEFAULT_VISIBLE_ROUNDS && (
                  <button
                    type="button"
                    onClick={toggleShowAllSequence}
                    className="px-2.5 py-1 text-xs font-mono font-semibold rounded-lg bg-[#071A14] hover:bg-[#1E3A2B] text-[#F5F5F5] hover:text-[#35B978] border border-[#1E3A2B] hover:border-[#35B978]/50 transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    {showAllSequence ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5 text-[#8D9B95]" />
                        Collapse
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5 text-[#8D9B95]" />
                        Show All
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Compact fixed-height container (~140px tall) with vertical scrolling */}
              <div
                className="h-[140px] overflow-y-auto overflow-x-hidden p-3.5 rounded-lg bg-[#020806] border border-[#1E3A2B]/60 select-text"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#35B978 #020806',
                }}
              >
                <div className="font-mono text-sm sm:text-base font-bold text-[#E7B93F] tracking-wide break-words whitespace-normal leading-relaxed">
                  {visibleSequenceStr}
                  {!showAllSequence && observedStats.total > DEFAULT_VISIBLE_ROUNDS && (
                    <span className="text-[#8D9B95] font-normal"> → ...</span>
                  )}
                </div>
              </div>

              {/* Scroll indicator & metadata */}
              <div className="flex items-center justify-between text-[11px] text-[#8D9B95] px-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#35B978] animate-pulse" />
                  <span>Vertical scroll enabled • Newest to oldest</span>
                </span>
                <span className="font-mono text-[10px] text-[#8D9B95]">
                  {showAllSequence || observedStats.total <= DEFAULT_VISIBLE_ROUNDS
                    ? `${observedStats.total} / ${observedStats.total}`
                    : `${DEFAULT_VISIBLE_ROUNDS} / ${observedStats.total}`}{' '}
                  rounds visible
                </span>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
                <span className="text-[#8D9B95] block text-[11px]">Size Distribution:</span>
                <div className="mt-1 font-mono text-sm font-bold text-[#F5F5F5]">
                  Big: {observedStats.bigPct}% ({observedStats.bigCount}) | Small: {observedStats.smallPct}% ({observedStats.smallCount})
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
                <span className="text-[#8D9B95] block text-[11px]">Alternation Rate (Big ↔ Small):</span>
                <div className="mt-1 font-mono text-sm font-bold text-[#35B978]">
                  {observedStats.alternationRate}% ({observedStats.alternations} transitions)
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
                <span className="text-[#8D9B95] block text-[11px]">Dominant Digits:</span>
                <div className="mt-1 font-mono text-xs font-semibold text-[#E7B93F]">
                  {observedStats.topNumbers.slice(0, 2).map((x) => `Number ${x.num} (${x.pct}%)`).join(', ')}
                </div>
              </div>
            </div>
          </div>
        )}
      </CollapsibleCard>

      {/* ======================================================== */}
      {/* CATEGORY 2: SUPPORTING SIGNALS (Independent Test Models)  */}
      {/* ======================================================== */}
      <CollapsibleCard
        id="analyzer_category_2"
        title={
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-[#E7B93F]/15 text-[#E7B93F] border border-[#E7B93F]/30">
              CATEGORY 2
            </span>
            <h3 className="text-sm font-bold text-[#F5F5F5] uppercase tracking-wider">
              SUPPORTING SIGNALS & FORMULA TESTS
            </h3>
          </div>
        }
        headerRight={
          <span className="text-xs text-[#8D9B95]">
            Tests 1, 2, 3, 5, 6, 7, 8 — independent input signals feeding into Adaptive Learning
          </span>
        }
      >
        {/* Sub tabs for formula tests */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            onClick={() => setActiveTestTab('periodSum')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeTestTab === 'periodSum'
                ? 'bg-[#E7B93F] text-[#020806] font-bold shadow'
                : 'bg-[#06130F] text-[#8D9B95] hover:text-[#F5F5F5] border border-[#1E3A2B]'
            }`}
          >
            Test 1: Period Digit Sum Mod 10
          </button>

          <button
            onClick={() => setActiveTestTab('linearDelta')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeTestTab === 'linearDelta'
                ? 'bg-[#E7B93F] text-[#020806] font-bold shadow'
                : 'bg-[#06130F] text-[#8D9B95] hover:text-[#F5F5F5] border border-[#1E3A2B]'
            }`}
          >
            Test 2: Markov Chain
          </button>

          <button
            onClick={() => setActiveTestTab('alternation')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeTestTab === 'alternation'
                ? 'bg-[#E7B93F] text-[#020806] font-bold shadow'
                : 'bg-[#06130F] text-[#8D9B95] hover:text-[#F5F5F5] border border-[#1E3A2B]'
            }`}
          >
            Test 3: Previous 2 Results Pattern
          </button>

          <button
            onClick={() => setActiveTestTab('additional')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeTestTab === 'additional'
                ? 'bg-[#35B978] text-[#020806] font-bold shadow'
                : 'bg-[#06130F] text-[#35B978] hover:text-[#F5F5F5] border border-[#35B978]/40'
            }`}
          >
            ⏱ Tests 5–8: Additional Signals (incl. WingoAI)
          </button>
        </div>

        {/* Test 1 Table & Hit Rate */}
        {activeTestTab === 'periodSum' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
              <div>
                <span className="font-mono font-bold text-xs text-[#F5F5F5]">
                  Formula: (Sum of Period Digits) mod 10
                </span>
                <p className="text-[11px] text-[#8D9B95] mt-0.5">
                  Evaluates whether period numbers encode winning digits mathematically.
                </p>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono">
                <div>
                  <span className="text-[#8D9B95] block text-[10px]">BIG/SMALL HIT RATE:</span>
                  <span className="text-base font-bold text-[#F04444]">
                    {testPeriodSum.accuracy}% ({testPeriodSum.hits} / {testPeriodSum.total})
                  </span>
                </div>
                <div>
                  <span className="text-[#8D9B95] block text-[10px]">RANDOM BASELINE:</span>
                  <span className="text-base font-bold text-[#8D9B95]">50.0%</span>
                </div>
              </div>
            </div>

            {/* Streak Analysis Panel */}
            <StreakAnalysisPanel
              stats={streakStatsPeriodSum}
              title="Period Digit Sum Mod 10"
              id="streak_test1"
            />

            <CollapsibleCard
              id="test1_predictions_table"
              variant="subcard"
              title={
                <span className="font-mono text-xs font-bold text-[#F5F5F5]">
                  Formula Evaluation Table (Test 1)
                </span>
              }
              subtitle="Per-period predicted digit vs actual outcome"
            >
              <div className="overflow-x-auto rounded-lg border border-[#1E3A2B]/60">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[#06130F] text-[#8D9B95] uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-4">Period</th>
                      <th className="py-2.5 px-4">Actual (Digit → Size)</th>
                      <th className="py-2.5 px-4">Prediction (Digit → Size)</th>
                      <th className="py-2.5 px-4 text-right">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E3A2B]/40">
                    {[...testPeriodSum.details].reverse().map((row, i) => (
                      <tr key={i} className="hover:bg-[#06130F]/80">
                        <td className="py-2 px-4 text-gray-300">{row.period}</td>
                        <td className="py-2 px-4 font-bold text-[#E7B93F]">
                          {row.actual}{' '}
                          <span className="text-[10px] text-[#8D9B95]">→</span>{' '}
                          <span className={row.actualSize === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}>
                            {row.actualSize.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2 px-4 text-gray-400">
                          {row.predicted}{' '}
                          <span className="text-[10px] text-[#8D9B95]">→</span>{' '}
                          <span className={row.predictedSize === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}>
                            {row.predictedSize.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2 px-4 text-right">
                          {row.isHit ? (
                            <span className="inline-flex items-center gap-1 text-[#35B978] font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Hit
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[#F04444]">
                              <XCircle className="w-3.5 h-3.5" /> Miss
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleCard>
          </div>
        )}

        {/* Test 2 Table & Hit Rate */}
        {activeTestTab === 'linearDelta' && (
          <div className="space-y-4">
            {/* Info bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
              <div>
                <span className="font-mono font-bold text-xs text-[#F5F5F5]">
                  Markov Chain Transition Model
                </span>
                <p className="text-[11px] text-[#8D9B95] mt-0.5">
                  P(next | prev) computed from historical transition counts only. Processed chronologically — no future data used. Min 5 samples required per state before prediction starts.
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono">
                <div>
                  <span className="text-[#8D9B95] block text-[10px]">BIG/SMALL HIT RATE:</span>
                  <span className={`text-base font-bold ${testLinearRecurrence.accuracy >= 50 ? 'text-[#35B978]' : 'text-[#F04444]'}`}>
                    {testLinearRecurrence.accuracy}% ({testLinearRecurrence.hits} / {testLinearRecurrence.total})
                  </span>
                </div>
                <div>
                  <span className="text-[#8D9B95] block text-[10px]">RANDOM BASELINE:</span>
                  <span className="text-base font-bold text-[#8D9B95]">50.0%</span>
                </div>
              </div>
            </div>

            {/* Current Markov state */}
            {testLinearRecurrence.currentState && (
              <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-2">
                <span className="text-[10px] font-mono uppercase font-bold text-[#8D9B95] tracking-wider block">Current Markov State</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B]/60 text-center">
                    <span className="text-[10px] text-[#8D9B95] block">Current State</span>
                    <span className={`text-base font-bold ${testLinearRecurrence.currentState === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                      {testLinearRecurrence.currentState.toUpperCase()}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B]/60 text-center">
                    <span className="text-[10px] text-[#8D9B95] block">P(BIG | curr)</span>
                    <span className="text-base font-bold text-[#E7B93F]">
                      {testLinearRecurrence.currentPBig !== null ? `${Math.round(testLinearRecurrence.currentPBig * 1000) / 10}%` : '—'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B]/60 text-center">
                    <span className="text-[10px] text-[#8D9B95] block">P(SMALL | curr)</span>
                    <span className="text-base font-bold text-[#60A5FA]">
                      {testLinearRecurrence.currentPSmall !== null ? `${Math.round(testLinearRecurrence.currentPSmall * 1000) / 10}%` : '—'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B]/60 text-center">
                    <span className="text-[10px] text-[#8D9B95] block">Next Prediction</span>
                    <span className={`text-base font-bold ${testLinearRecurrence.latestPrediction === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                      {testLinearRecurrence.latestPrediction?.toUpperCase() ?? '—'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <StreakAnalysisPanel
              stats={streakStatsLinearRecurrence}
              title="Markov Chain Transition"
              id="streak_test2"
            />

            <CollapsibleCard
              id="test2_predictions_table"
              variant="subcard"
              title={<span className="font-mono text-xs font-bold text-[#F5F5F5]">Markov Transition History (Test 2)</span>}
              subtitle="Chronological predictions — transition probabilities built from prior rounds only"
            >
              <div className="overflow-x-auto rounded-lg border border-[#1E3A2B]/60">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[#06130F] text-[#8D9B95] uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Period</th>
                      <th className="py-2.5 px-3">Prev</th>
                      <th className="py-2.5 px-3">P(BIG)</th>
                      <th className="py-2.5 px-3">P(SML)</th>
                      <th className="py-2.5 px-3">N</th>
                      <th className="py-2.5 px-3">Pred</th>
                      <th className="py-2.5 px-3">Actual</th>
                      <th className="py-2.5 px-3 text-right">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E3A2B]/40">
                    {[...testLinearRecurrence.details].reverse().map((row, i) => (
                      <tr key={i} className={`hover:bg-[#06130F]/80 ${row.insufficient ? 'opacity-40' : ''}`}>
                        <td className="py-1.5 px-3 text-gray-300">{row.period.slice(-7)}</td>
                        <td className={`py-1.5 px-3 font-medium ${row.previousState === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                          {row.previousState === 'Big' ? 'B' : 'S'}
                        </td>
                        <td className="py-1.5 px-3 text-[#E7B93F]">{row.insufficient ? '—' : `${Math.round(row.pBig * 1000) / 10}%`}</td>
                        <td className="py-1.5 px-3 text-[#60A5FA]">{row.insufficient ? '—' : `${Math.round(row.pSmall * 1000) / 10}%`}</td>
                        <td className="py-1.5 px-3 text-gray-400">{row.samplesUsed}</td>
                        <td className={`py-1.5 px-3 font-medium ${row.insufficient ? 'text-[#8D9B95]' : row.predictedSize === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                          {row.insufficient ? '—' : (row.predictedSize === 'Big' ? 'BIG' : 'SML')}
                        </td>
                        <td className={`py-1.5 px-3 font-bold ${row.actualSize === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                          {row.actualSize === 'Big' ? 'BIG' : 'SML'}
                        </td>
                        <td className="py-1.5 px-3 text-right">
                          {row.insufficient ? (
                            <span className="text-[#8D9B95] text-[10px]">INSUFF.</span>
                          ) : row.isHit ? (
                            <span className="inline-flex items-center gap-1 text-[#35B978] font-bold">
                              <CheckCircle2 className="w-3 h-3" /> Hit
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[#F04444]">
                              <XCircle className="w-3 h-3" /> Miss
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-[#8D9B95] font-sans mt-1.5">INSUFF. = fewer than 5 transitions observed from prior state — prediction excluded from accuracy and Adaptive Learning.</p>
            </CollapsibleCard>
          </div>
        )}

        {/* Test 3 Table & Hit Rate */}
        {activeTestTab === 'alternation' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E3A2B]/60 pb-2.5">
                <div>
                  <span className="font-mono font-bold text-xs text-[#F5F5F5]">
                    TEST 3: PREVIOUS 2 RESULTS PATTERN
                  </span>
                  <p className="text-[11px] text-[#8D9B95] mt-0.5">
                    Maps sequential drawn results (result[N-2] → result[N-1]) to the WingoBot reference chart. Missing/conflicting pairs return NO SIGNAL (NO BET).
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded-md text-xs font-mono font-bold border ${
                  test3.latestStatus === 'ACTIVE'
                    ? 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/40'
                    : 'bg-[#8D9B95]/10 text-[#8D9B95] border-[#8D9B95]/30'
                }`}>
                  STATUS: {test3.latestStatus}
                </span>
              </div>

              {/* Grid showing Previous, Pattern, Prediction, Status */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B]">
                  <span className="text-[#8D9B95] block text-[10px] uppercase">Previous 2</span>
                  <span className="text-sm font-bold text-[#F5F5F5]">
                    {test3.latestPair ?? '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B]">
                  <span className="text-[#8D9B95] block text-[10px] uppercase">Pattern</span>
                  <span className="text-sm font-bold text-[#E7B93F]">
                    {test3.latestPattern ?? '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B]">
                  <span className="text-[#8D9B95] block text-[10px] uppercase">Test 3 Prediction</span>
                  <span className={`text-sm font-bold ${
                    test3.latestPrediction === 'Big'
                      ? 'text-[#E7B93F]'
                      : test3.latestPrediction === 'Small'
                      ? 'text-[#60A5FA]'
                      : 'text-[#8D9B95]'
                  }`}>
                    {test3.latestPrediction ? test3.latestPrediction.toUpperCase() : 'NO SIGNAL'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B]">
                  <span className="text-[#8D9B95] block text-[10px] uppercase">Observed Accuracy</span>
                  <span className="text-sm font-bold text-[#35B978]">
                    {test3.accuracy}% ({test3.hits} / {test3.total})
                  </span>
                </div>
              </div>

              {test3.latestReason && (
                <div className="text-[11px] text-[#8D9B95] font-mono flex items-center gap-1.5 pt-1">
                  <span className="text-[#E7B93F]">ℹ</span> Reason: {test3.latestReason}
                </div>
              )}
            </div>

            {/* Streak Analysis Panel */}
            <StreakAnalysisPanel
              stats={streakStatsTest3}
              title="Previous 2 Results Pattern"
              id="streak_test3"
            />

            <CollapsibleCard
              id="test3_predictions_table"
              variant="subcard"
              title={
                <span className="font-mono text-xs font-bold text-[#F5F5F5]">
                  Formula Evaluation Table (Test 3)
                </span>
              }
              subtitle="Sequential results N-2 → N-1 reference predictions and hit outcomes"
            >
              <div className="overflow-x-auto rounded-lg border border-[#1E3A2B]/60">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[#06130F] text-[#8D9B95] uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-4">Period</th>
                      <th className="py-2.5 px-4">Previous 2 (N-2 → N-1)</th>
                      <th className="py-2.5 px-4">Pattern</th>
                      <th className="py-2.5 px-4">Actual Result</th>
                      <th className="py-2.5 px-4">Test 3 Prediction</th>
                      <th className="py-2.5 px-4 text-right">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E3A2B]/40">
                    {[...test3.details].reverse().map((row, i) => (
                      <tr key={i} className="hover:bg-[#06130F]/80">
                        <td className="py-2 px-4 text-gray-300">{row.period}</td>
                        <td className="py-2 px-4 text-gray-400 font-bold">{row.pairString}</td>
                        <td className="py-2 px-4 text-[#8D9B95]">{row.sizePattern}</td>
                        <td className="py-2 px-4 font-bold text-[#E7B93F]">
                          {row.actualNumber} ({row.actualSize.toUpperCase()})
                        </td>
                        <td className="py-2 px-4">
                          {row.noSignal ? (
                            <span className="text-[#8D9B95] italic">NO SIGNAL</span>
                          ) : (
                            <span className={`font-bold ${row.predictedSize === 'Big' ? 'text-[#E7B93F]' : 'text-[#60A5FA]'}`}>
                              {row.predictedSize?.toUpperCase()}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-4 text-right">
                          {row.noSignal ? (
                            <span className="text-[#8D9B95] text-[11px]">— (NO BET)</span>
                          ) : row.isHit ? (
                            <span className="inline-flex items-center gap-1 text-[#35B978] font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Hit
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[#F04444]">
                              <XCircle className="w-3.5 h-3.5" /> Miss
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleCard>
          </div>
        )}

        {/* Tests 5–8: Time-Based & External Additional Signals */}
        {activeTestTab === 'additional' && (
          <CollapsibleCard
            id="tests5to8_additional"
            variant="subcard"
            title={
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#35B978]/15 text-[#35B978] border border-[#35B978]/30">
                  TESTS 5–8
                </span>
                <span className="font-mono text-xs font-bold text-[#F5F5F5]">
                  Additional & External Signals (Digit Mix, SMA-10, WingoAI, Streak)
                </span>
              </div>
            }
            subtitle="Time-of-day, minute, SMA-10, WingoAI API signal (Test 7), and streak formulas"
          >
            <AdditionalSignalsPanel
              test5={test5}
              test6={test6}
              test7={test7}
              test8={test8}
              t7DebugInfo={t7DebugInfo}
            />
          </CollapsibleCard>
        )}

        {/* Input Signals Summary — always visible inside Category 2 */}
        <CollapsibleCard
          id="signal_summary_inputs"
          variant="subcard"
          title={<span className="font-mono text-xs font-bold text-[#F5F5F5]">📊 Input Signals Vote Summary (Tests 1, 2, 3, 5, 6, 7, 8)</span>}
          subtitle="Latest prediction from each supporting test — input signals feeding into Adaptive Learning"
          defaultExpanded={true}
        >
          <SignalSummaryPanel signals={signalSummaryData} />
        </CollapsibleCard>

        {/* Scientific Conclusion Box */}
        <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] text-xs">
          <span className="font-mono font-bold text-[#E7B93F] block uppercase tracking-wider mb-1">
            Empirical Test Conclusion:
          </span>
          <p className="text-gray-300 leading-relaxed font-sans">
            <strong>&quot;No tested mathematical formula sufficiently explains this sample beyond expected random variance.&quot;</strong> Hit rates match statistical baseline expectations (10% on single numbers, ~50% on Big/Small), confirming that numbers cannot be predicted via deterministic formulas from period numbers or past draws.
          </p>
        </div>
      </CollapsibleCard>

      {/* ======================================================== */}
      {/* CATEGORY 3: INFERRED / UNKNOWN (Boundary of Verifiability) */}
      {/* ======================================================== */}
      <CollapsibleCard
        id="analyzer_category_3"
        title={
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-[#C94DDA]/15 text-[#C94DDA] border border-[#C94DDA]/30">
              CATEGORY 3
            </span>
            <h3 className="text-sm font-bold text-[#F5F5F5] uppercase tracking-wider">
              INFERRED / UNKNOWN (Boundary of Client-Side Verifiability)
            </h3>
          </div>
        }
        headerRight={
          <span className="text-xs text-[#8D9B95]">
            Possible explanations that cannot be verified from client history alone
          </span>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
          {/* Left: What is Documented & Proven */}
          <div className="p-5 rounded-xl bg-[#06130F] border border-[#35B978]/30 space-y-3">
            <div className="flex items-center gap-2 text-[#35B978] font-bold uppercase tracking-wider text-xs">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              What the Custom Result API Proves (Documented Facts):
            </div>
            <ul className="space-y-2 text-[#F5F5F5] font-sans">
              <li className="flex items-start gap-2">
                <span className="text-[#35B978] font-bold">✓</span>
                <span>The endpoint <code className="text-[#E7B93F]">POST /merchant/api/set_merchant_custom_result.php</code> exists.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#35B978] font-bold">✓</span>
                <span>Parameters <code className="text-[#E7B93F]">game_code</code>, <code className="text-[#E7B93F]">period_number</code>, and <code className="text-[#E7B93F]">winning_number</code> are documented.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#35B978] font-bold">✓</span>
                <span>Upcoming-period override is explicitly documented by SaaS Imperial.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#35B978] font-bold">✓</span>
                <span><strong>Proves:</strong> The merchant integration possesses an architectural mechanism for specifying a custom result.</span>
              </li>
            </ul>
          </div>

          {/* Right: What it does NOT prove */}
          <div className="p-5 rounded-xl bg-[#06130F] border border-[#F04444]/30 space-y-3">
            <div className="flex items-center gap-2 text-[#F04444] font-bold uppercase tracking-wider text-xs">
              <XCircle className="w-4 h-4 shrink-0" />
              What this does NOT Prove (Unverifiable from Client History):
            </div>
            <ul className="space-y-2 text-[#8D9B95] font-sans">
              <li className="flex items-start gap-2">
                <span className="text-[#F04444] font-bold">✗</span>
                <span>Does <strong>NOT</strong> prove that every result is manually overridden.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#F04444] font-bold">✗</span>
                <span>Does <strong>NOT</strong> prove that the server uses a least-payout algorithm.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#F04444] font-bold">✗</span>
                <span>Does <strong>NOT</strong> prove that player bets determined the result.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#F04444] font-bold">✗</span>
                <span>Does <strong>NOT</strong> prove that the observed sequence was generated by an override vs random variance.</span>
              </li>
            </ul>
          </div>
        </div>
      </CollapsibleCard>

      {/* ======================================================== */}
      {/* CATEGORY 4: STRATEGY EVALUATION (Real vs. Simulator)    */}
      {/* ======================================================== */}
      <CollapsibleCard
        id="analyzer_category_4"
        title={
          <div className="flex items-center gap-2.5">
            <Scale className="w-4 h-4 text-[#E7B93F]" />
            <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-[#E7B93F]/15 text-[#E7B93F] border border-[#E7B93F]/30">
              CATEGORY 4
            </span>
            <h3 className="text-sm font-bold text-[#F5F5F5] uppercase tracking-wider">
              STRATEGY EVALUATION (Real Live Draws vs. Local Simulator)
            </h3>
          </div>
        }
        headerRight={
          <span className="text-xs text-[#8D9B95]">
            Evaluating whether any betting pattern can predict future values
          </span>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
          {/* Real Live Screen Sample */}
          <div className="p-5 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#F5F5F5] uppercase tracking-wider text-xs">
                Real Betting App (Big Mumbai Screen)
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                10 Live Draws
              </span>
            </div>
            <div className="p-3 rounded-lg bg-[#020806] font-mono text-sm text-[#E7B93F] font-bold tracking-wide">
              5 → 0 → 4 → 6 → 6 → 2 → 5 → 7 → 6 → 6
            </div>
            <div className="space-y-1.5 text-[#8D9B95]">
              <div className="flex justify-between">
                <span>Big vs. Small Ratio:</span>
                <strong className="text-[#F5F5F5]">6 Big (60%) / 4 Small (40%)</strong>
              </div>
              <div className="flex justify-between">
                <span>Streak Occurrences:</span>
                <strong className="text-[#F5F5F5]">Double 6 (twice), 5 Small in a clump</strong>
              </div>
              <div className="flex justify-between">
                <span>Modulo 10 Formula Hit Rate:</span>
                <strong className="text-[#F04444]">10% (1/10 hits — Baseline)</strong>
              </div>
            </div>
            <div className="pt-2 border-t border-[#1E3A2B] text-[11px] text-gray-300">
              <strong>Strategy Test:</strong> &quot;Betting against streaks&quot; would have lost heavily on repeated 6s. &quot;Following streaks&quot; immediately lost on round ...573 when 6 flipped to 2.
            </div>
          </div>

          {/* Simulator Local Feed */}
          <div className="p-5 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#F5F5F5] uppercase tracking-wider text-xs">
                Local Simulator Sandbox (Your PC)
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Local PRNG
              </span>
            </div>
            <div className="p-3 rounded-lg bg-[#020806] font-mono text-sm text-[#35B978] font-bold tracking-wide truncate">
              {results.slice(0, 10).map((r) => r.winningNumber).join(' → ') || 'No local draws yet'}
            </div>
            <div className="space-y-1.5 text-[#8D9B95]">
              <div className="flex justify-between">
                <span>Active Local Records:</span>
                <strong className="text-[#F5F5F5]">{results.length} draws in memory</strong>
              </div>
              <div className="flex justify-between">
                <span>Current Environment:</span>
                <strong className="text-[#35B978]">Isolated Mock / Sandbox</strong>
              </div>
              <div className="flex justify-between">
                <span>Formula Predictability:</span>
                <strong className="text-[#F04444]">0% (Statistically Unpredictable)</strong>
              </div>
            </div>
            <div className="pt-2 border-t border-[#1E3A2B] text-[11px] text-gray-300">
              <strong>Behavior:</strong> Demonstrates that local pseudo-random generators produce independent outcomes that cannot be synchronized with a remote server without a live settlement feed.
            </div>
          </div>
        </div>

        {/* The Mathematical Proof Alert */}
        <div className="p-4 rounded-xl bg-[#06130F] border border-[#E7B93F]/30 space-y-2">
          <div className="flex items-center gap-2 text-[#E7B93F] font-bold uppercase tracking-wider text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Why Mathematical &quot;Strategies&quot; Cannot Predict Lottery Outcomes:
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-gray-300 pt-1">
            <div className="p-2.5 rounded bg-[#071A14] border border-[#1E3A2B]">
              <span className="font-bold text-[#F5F5F5] block mb-1">1. The Gambler&apos;s Fallacy</span>
              Past numbers have zero physical or mathematical influence on upcoming numbers. Each 30-second draw is an independent event with identical 10% probability for every digit.
            </div>
            <div className="p-2.5 rounded bg-[#071A14] border border-[#1E3A2B]">
              <span className="font-bold text-[#F5F5F5] block mb-1">2. Negative Expected Value</span>
              The game pays 1.96× for a 50/50 proposition (2% house commission). Over time, the expected return is mathematically negative: E = -2%. No sequence arrangement can make it positive.
            </div>
            <div className="p-2.5 rounded bg-[#071A14] border border-[#1E3A2B]">
              <span className="font-bold text-[#F5F5F5] block mb-1">3. Server Pool Balancing</span>
              As proven by the SaaS Imperial API docs, the server calculates total bet exposure across thousands of users or uses server-side CSPRNG. Client history alone cannot foresee this.
            </div>
          </div>
        </div>
      </CollapsibleCard>

      {/* ── Confirmation Dialog for FULL RESET ────────────────────────── */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#06130F] border-2 border-[#F04444]/60 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-[#F04444]">
              <AlertTriangle className="w-7 h-7 shrink-0" />
              <h3 className="text-lg font-mono font-extrabold uppercase tracking-wide">
                RESET ALL DATA?
              </h3>
            </div>
            <p className="text-xs font-mono text-[#F5F5F5] leading-relaxed">
              This will permanently delete the collected history, predictions, hit/miss records, WingoAI signal history, and adaptive learning state.
            </p>
            <p className="text-xs font-mono text-[#F04444] font-bold">
              This cannot be undone.
            </p>

            {resetError && (
              <div className="p-3 rounded-lg bg-[#F04444]/15 border border-[#F04444]/40 text-xs font-mono text-[#F04444]">
                {resetError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#1E3A2B]/60">
              <button
                type="button"
                disabled={isResetting}
                onClick={() => {
                  setShowResetModal(false);
                  setResetError(null);
                }}
                className="px-4 py-2 rounded-xl bg-[#071A14] border border-[#1E3A2B] text-xs font-mono font-bold text-[#8D9B95] hover:text-[#F5F5F5] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isResetting}
                onClick={handleFullReset}
                className="px-4 py-2 rounded-xl bg-[#F04444] hover:bg-[#d63030] text-white text-xs font-mono font-extrabold transition-colors cursor-pointer flex items-center gap-2 shadow-lg shadow-[#F04444]/20"
              >
                {isResetting ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                    RESETTING...
                  </>
                ) : (
                  'RESET EVERYTHING'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
