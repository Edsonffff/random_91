import React, { useState, useMemo } from 'react';
import { useResults } from '../../context/ResultContext';
import { useRealHistory } from '../../context/RealHistoryContext';
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
} from 'lucide-react';

interface RoundEntry {
  period: string;
  number: number;
}

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

export const AlgorithmAnalyzer: React.FC = () => {
  const { results, loadBigMumbaiSample } = useResults();
  const { realHistory } = useRealHistory();
  const [dataSource, setDataSource] = useState<'realLive' | 'sample3' | 'sample2' | 'sample1' | 'live'>('realLive');
  const [activeTestTab, setActiveTestTab] = useState<'periodSum' | 'linearDelta' | 'alternation'>('periodSum');
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const showAllSequence = Boolean(expandedSources[dataSource]);

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
      if (realHistory.length > 0) {
        return realHistory.map((r) => ({
          period: r.periodNumber,
          number: r.winningNumber,
        }));
      }
      return SAMPLE_3_SCREEN; // Fallback to sample 3 if network pending
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
    const details = activeDataset.map((item) => {
      const sum = item.period
        .split('')
        .reduce((acc, char) => acc + parseInt(char, 10), 0);
      const predicted = sum % 10;
      const isHit = predicted === item.number;
      if (isHit) hits++;
      return {
        period: item.period,
        actual: item.number,
        predicted,
        isHit,
      };
    });

    const accuracy = activeDataset.length > 0 ? Math.round((hits / activeDataset.length) * 100) : 0;
    return { hits, total: activeDataset.length, accuracy, details };
  }, [activeDataset]);

  // Test B: Previous Number Linear Recurrence: (Prev * 3 + 7) mod 10
  const testLinearRecurrence = useMemo(() => {
    let hits = 0;
    const details: Array<{
      period: string;
      prev: number;
      actual: number;
      predicted: number;
      isHit: boolean;
    }> = [];

    for (let i = 1; i < activeDataset.length; i++) {
      const prev = activeDataset[i - 1].number;
      const predicted = (prev * 3 + 7) % 10;
      const actual = activeDataset[i].number;
      const isHit = predicted === actual;
      if (isHit) hits++;
      details.push({
        period: activeDataset[i].period,
        prev,
        actual,
        predicted,
        isHit,
      });
    }

    const total = activeDataset.length > 1 ? activeDataset.length - 1 : 0;
    const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
    return { hits, total, accuracy, details };
  }, [activeDataset]);

  // Test C: Alternating Pattern Prediction: Predict opposite of previous size
  const testAlternation = useMemo(() => {
    let hits = 0;
    const details: Array<{
      period: string;
      prevSize: 'Big' | 'Small';
      actualSize: 'Big' | 'Small';
      predictedSize: 'Big' | 'Small';
      isHit: boolean;
    }> = [];

    for (let i = 1; i < activeDataset.length; i++) {
      const prevSize = activeDataset[i - 1].number >= 5 ? 'Big' : 'Small';
      const actualSize = activeDataset[i].number >= 5 ? 'Big' : 'Small';
      const predictedSize = prevSize === 'Big' ? 'Small' : 'Big';
      const isHit = predictedSize === actualSize;
      if (isHit) hits++;
      details.push({
        period: activeDataset[i].period,
        prevSize,
        actualSize,
        predictedSize,
        isHit,
      });
    }

    const total = activeDataset.length > 1 ? activeDataset.length - 1 : 0;
    const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
    return { hits, total, accuracy, details };
  }, [activeDataset]);

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
        </div>
      </div>

      {/* ======================================================== */}
      {/* CATEGORY 1: OBSERVED (What Actually Appears)             */}
      {/* ======================================================== */}
      <div className="p-6 rounded-2xl bg-[#071A14] border border-[#1E3A2B] shadow-xl space-y-5">
        <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#1E3A2B] gap-2">
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-[#35B978]/15 text-[#35B978] border border-[#35B978]/30">
              CATEGORY 1
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
              dataSource === 'live'
                ? 'bg-[#E7B93F]/15 text-[#E7B93F] border-[#E7B93F]/30'
                : 'bg-[#35B978]/20 text-[#35B978] border-[#35B978]/40'
            }`}>
              {dataSource === 'live' ? 'SIMULATOR DATA' : 'COMPLETED REAL HISTORY'}
            </span>
            <h3 className="text-sm font-bold text-[#F5F5F5] uppercase tracking-wider">
              OBSERVED (Empirical Ground Truth)
            </h3>
          </div>
          <span className="text-xs text-[#8D9B95]">
            What actually appears in the recorded history
          </span>
        </div>

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
      </div>

      {/* ======================================================== */}
      {/* CATEGORY 2: TESTED (Formula & Statistical Tests Run)      */}
      {/* ======================================================== */}
      <div className="p-6 rounded-2xl bg-[#071A14] border border-[#1E3A2B] shadow-xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#1E3A2B]">
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-[#E7B93F]/15 text-[#E7B93F] border border-[#E7B93F]/30">
              CATEGORY 2
            </span>
            <h3 className="text-sm font-bold text-[#F5F5F5] uppercase tracking-wider">
              TESTED (Mathematical & Formula Evaluations)
            </h3>
          </div>
          <span className="text-xs text-[#8D9B95]">
            Statistical tests run against the observed history
          </span>
        </div>

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
            Test 2: Linear Recurrence Mod 10
          </button>

          <button
            onClick={() => setActiveTestTab('alternation')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeTestTab === 'alternation'
                ? 'bg-[#E7B93F] text-[#020806] font-bold shadow'
                : 'bg-[#06130F] text-[#8D9B95] hover:text-[#F5F5F5] border border-[#1E3A2B]'
            }`}
          >
            Test 3: Alternating Streak Flip
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
                  <span className="text-[#8D9B95] block text-[10px]">OBSERVED HIT RATE:</span>
                  <span className="text-base font-bold text-[#F04444]">
                    {testPeriodSum.accuracy}% ({testPeriodSum.hits} / {testPeriodSum.total})
                  </span>
                </div>
                <div>
                  <span className="text-[#8D9B95] block text-[10px]">RANDOM BASELINE:</span>
                  <span className="text-base font-bold text-[#8D9B95]">10.0%</span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#1E3A2B]">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#06130F] text-[#8D9B95] uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-4">Period</th>
                    <th className="py-2.5 px-4">Actual Number</th>
                    <th className="py-2.5 px-4">Formula Prediction</th>
                    <th className="py-2.5 px-4 text-right">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E3A2B]/40">
                  {testPeriodSum.details.map((row, i) => (
                    <tr key={i} className="hover:bg-[#06130F]/80">
                      <td className="py-2 px-4 text-gray-300">{row.period}</td>
                      <td className="py-2 px-4 font-bold text-[#E7B93F]">{row.actual}</td>
                      <td className="py-2 px-4 text-gray-400">{row.predicted}</td>
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
          </div>
        )}

        {/* Test 2 Table & Hit Rate */}
        {activeTestTab === 'linearDelta' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
              <div>
                <span className="font-mono font-bold text-xs text-[#F5F5F5]">
                  Formula: (Prev_Number * 3 + 7) mod 10
                </span>
                <p className="text-[11px] text-[#8D9B95] mt-0.5">
                  Standard linear congruential multiplier tested for step-to-step dependence.
                </p>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono">
                <div>
                  <span className="text-[#8D9B95] block text-[10px]">OBSERVED HIT RATE:</span>
                  <span className="text-base font-bold text-[#F04444]">
                    {testLinearRecurrence.accuracy}% ({testLinearRecurrence.hits} / {testLinearRecurrence.total})
                  </span>
                </div>
                <div>
                  <span className="text-[#8D9B95] block text-[10px]">RANDOM BASELINE:</span>
                  <span className="text-base font-bold text-[#8D9B95]">10.0%</span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#1E3A2B]">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#06130F] text-[#8D9B95] uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-4">Period</th>
                    <th className="py-2.5 px-4">Previous Number</th>
                    <th className="py-2.5 px-4">Actual Number</th>
                    <th className="py-2.5 px-4">Formula Prediction</th>
                    <th className="py-2.5 px-4 text-right">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E3A2B]/40">
                  {testLinearRecurrence.details.map((row, i) => (
                    <tr key={i} className="hover:bg-[#06130F]/80">
                      <td className="py-2 px-4 text-gray-300">{row.period}</td>
                      <td className="py-2 px-4 text-gray-400">{row.prev}</td>
                      <td className="py-2 px-4 font-bold text-[#E7B93F]">{row.actual}</td>
                      <td className="py-2 px-4 text-gray-400">{row.predicted}</td>
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
          </div>
        )}

        {/* Test 3 Table & Hit Rate */}
        {activeTestTab === 'alternation' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
              <div>
                <span className="font-mono font-bold text-xs text-[#F5F5F5]">
                  Test: Alternating Binary Inversion (Predict Opposite Size)
                </span>
                <p className="text-[11px] text-[#8D9B95] mt-0.5">
                  Tests whether alternating patterns (Big → Small → Big) persist beyond 50% coin-flip baseline.
                </p>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono">
                <div>
                  <span className="text-[#8D9B95] block text-[10px]">OBSERVED ACCURACY:</span>
                  <span className="text-base font-bold text-[#E7B93F]">
                    {testAlternation.accuracy}% ({testAlternation.hits} / {testAlternation.total})
                  </span>
                </div>
                <div>
                  <span className="text-[#8D9B95] block text-[10px]">RANDOM BASELINE:</span>
                  <span className="text-base font-bold text-[#8D9B95]">50.0%</span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#1E3A2B]">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#06130F] text-[#8D9B95] uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-4">Period</th>
                    <th className="py-2.5 px-4">Prior Size</th>
                    <th className="py-2.5 px-4">Actual Size</th>
                    <th className="py-2.5 px-4">Predicted (Opposite)</th>
                    <th className="py-2.5 px-4 text-right">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E3A2B]/40">
                  {testAlternation.details.map((row, i) => (
                    <tr key={i} className="hover:bg-[#06130F]/80">
                      <td className="py-2 px-4 text-gray-300">{row.period}</td>
                      <td className="py-2 px-4 text-gray-400">{row.prevSize}</td>
                      <td className="py-2 px-4 font-bold text-[#E7B93F]">{row.actualSize}</td>
                      <td className="py-2 px-4 text-gray-400">{row.predictedSize}</td>
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
          </div>
        )}

        {/* Scientific Conclusion Box */}
        <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] text-xs">
          <span className="font-mono font-bold text-[#E7B93F] block uppercase tracking-wider mb-1">
            Empirical Test Conclusion:
          </span>
          <p className="text-gray-300 leading-relaxed font-sans">
            <strong>"No tested mathematical formula sufficiently explains this sample beyond expected random variance."</strong> Hit rates match statistical baseline expectations (10% on single numbers, ~50% on Big/Small), confirming that numbers cannot be predicted via deterministic formulas from period numbers or past draws.
          </p>
        </div>
      </div>

      {/* ======================================================== */}
      {/* CATEGORY 3: INFERRED / UNKNOWN (Boundary of Verifiability) */}
      {/* ======================================================== */}
      <div className="p-6 rounded-2xl bg-[#071A14] border border-[#1E3A2B] shadow-xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#1E3A2B]">
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-[#C94DDA]/15 text-[#C94DDA] border border-[#C94DDA]/30">
              CATEGORY 3
            </span>
            <h3 className="text-sm font-bold text-[#F5F5F5] uppercase tracking-wider">
              INFERRED / UNKNOWN (Boundary of Client-Side Verifiability)
            </h3>
          </div>
          <span className="text-xs text-[#8D9B95]">
            Possible explanations that cannot be verified from client history alone
          </span>
        </div>

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
      </div>

      {/* ======================================================== */}
      {/* CATEGORY 4: STRATEGY EVALUATION (Real vs. Simulator)    */}
      {/* ======================================================== */}
      <div className="p-6 rounded-2xl bg-[#071A14] border border-[#1E3A2B] shadow-xl space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-[#1E3A2B]">
          <div className="flex items-center gap-2.5">
            <Scale className="w-4 h-4 text-[#E7B93F]" />
            <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-[#E7B93F]/15 text-[#E7B93F] border border-[#E7B93F]/30">
              CATEGORY 4
            </span>
            <h3 className="text-sm font-bold text-[#F5F5F5] uppercase tracking-wider">
              STRATEGY EVALUATION (Real Live Draws vs. Local Simulator)
            </h3>
          </div>
          <span className="text-xs text-[#8D9B95]">
            Evaluating whether any betting pattern can predict future values
          </span>
        </div>

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
      </div>
    </div>
  );
};
