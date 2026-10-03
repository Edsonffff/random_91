import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  compareIssueNumbers,
  evaluateWalkForward,
  scheduledStartFromIssue,
  type ExperimentalHistoryRecord,
  type WalkForwardRow,
} from '../src/experimental/periodicLogisticAlgorithm';
import { calculateLossStreakMetrics } from '../src/experimental/cpl2ConfidenceGate';
import {
  cpl3Metrics,
  CPL3_CONFIGS,
  runCpl3WalkForward,
} from '../src/experimental/cpl3LossStreakBreaker';

const FROZEN_CONFIG_NAME = 'context-8-cap-3';
const WINDOW_START_FRACTIONS = [0.4, 0.5, 0.6, 0.7] as const;

function loadDotEnv(path: string): void {
  try {
    const contents = readFileSync(path, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Deployment environments provide variables directly.
  }
}

loadDotEnv('.env');
loadDotEnv('collector/.env');

const frozenConfig = CPL3_CONFIGS.find((config) => config.name === FROZEN_CONFIG_NAME);
if (!frozenConfig) throw new Error(`Frozen CPL-3 configuration not found: ${FROZEN_CONFIG_NAME}`);

async function loadHistory(): Promise<ExperimentalHistoryRecord[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const latest = await supabase.from('real_wingo_30s_history').select('issue_number')
    .eq('game_code', 'WinGo_30S').order('issue_number', { ascending: false }).limit(1);
  if (latest.error || !latest.data?.length) throw new Error('Cannot establish a history snapshot cutoff.');
  const cutoff = String(latest.data[0].issue_number);
  const rows: ExperimentalHistoryRecord[] = [];
  let cursor: string | null = null;
  while (true) {
    let query = supabase.from('real_wingo_30s_history')
      .select('issue_number, number, source_time, created_at')
      .eq('game_code', 'WinGo_30S').lte('issue_number', cutoff)
      .order('issue_number', { ascending: true }).limit(1000);
    if (cursor !== null) query = query.gt('issue_number', cursor);
    const { data, error } = await query;
    if (error) throw new Error(`History query failed: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data.map((row) => ({
      issueNumber: String(row.issue_number),
      winningNumber: Number(row.number),
      sourceTime: row.source_time,
      createdAt: row.created_at,
    })));
    cursor = String(data.at(-1)!.issue_number);
  }
  const count = await supabase.from('real_wingo_30s_history')
    .select('issue_number', { count: 'exact' }).eq('game_code', 'WinGo_30S')
    .lte('issue_number', cutoff).limit(1);
  if (count.error || count.count !== rows.length) throw new Error('Snapshot row-count mismatch.');
  return rows.sort((a, b) => compareIssueNumbers(a.issueNumber, b.issueNumber));
}

function baselineRows(rows: WalkForwardRow[], history: ExperimentalHistoryRecord[]): WalkForwardRow[] {
  const byDate = new Map<string, ExperimentalHistoryRecord[]>();
  for (const record of history) {
    const date = record.issueNumber.slice(0, 8);
    byDate.set(date, [...(byDate.get(date) ?? []), record]);
  }
  return rows.map((row) => {
    const targetStart = scheduledStartFromIssue(row.periodId);
    const prior = (byDate.get(row.date) ?? []).filter((record) => {
      const recordStart = scheduledStartFromIssue(record.issueNumber);
      const availableValues = [record.createdAt, record.sourceTime]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map((value) => Date.parse(value)).filter((value) => Number.isFinite(value));
      const availableAt = availableValues.length > 0 ? Math.max(...availableValues) : null;
      return targetStart !== null && recordStart !== null && recordStart < targetStart &&
        availableAt !== null && availableAt < targetStart &&
        compareIssueNumbers(record.issueNumber, row.periodId) < 0;
    });
    const bigCount = prior.filter((record) => record.winningNumber >= 5).length;
    const prediction = prior.length === 0 ? null : (bigCount + 1) / (prior.length + 2) >= 0.5 ? 'BIG' : 'SMALL';
    return {
      ...row,
      prediction,
      probabilityBig: prior.length > 0 ? (bigCount + 1) / (prior.length + 2) : null,
      trainingCount: prior.length,
      trainedThroughPeriod: prior.at(-1)?.issueNumber ?? null,
      outcome: prediction === null ? 'NO_SIGNAL' : prediction === row.actualSize ? 'WIN' : 'LOSS',
    };
  });
}

interface WindowResult {
  window: string;
  date: string;
  trainCount: number;
  testCount: number;
  testFirst: string;
  testLast: string;
  baseline: ReturnType<typeof calculateLossStreakMetrics>;
  cpl1: ReturnType<typeof calculateLossStreakMetrics>;
  cpl3: ReturnType<typeof cpl3Metrics>;
}

function evaluateWindow(dateRecords: ExperimentalHistoryRecord[], date: string, windowIndex: number, startFraction: number): WindowResult {
  const trainEnd = Math.floor(dateRecords.length * startFraction);
  const testEnd = windowIndex === WINDOW_START_FRACTIONS.length - 1
    ? dateRecords.length
    : Math.floor(dateRecords.length * (startFraction + 0.1));
  const trainRecords = dateRecords.slice(0, trainEnd);
  const testRecords = dateRecords.slice(trainEnd, testEnd);
  if (trainRecords.length < 20 || testRecords.length < 1) throw new Error(`Invalid window ${date}-${windowIndex + 1}`);

  // The prefix contains training rows and this window's rows only. CPL-1 and
  // CPL-3 are allowed to update after each settled test row, never before it.
  const prefixRows = evaluateWalkForward(dateRecords.slice(0, testEnd));
  const testIds = new Set(testRecords.map((record) => record.issueNumber));
  const cpl1Rows = prefixRows.filter((row) => testIds.has(row.periodId));
  const baseline = baselineRows(cpl1Rows, dateRecords.slice(0, testEnd));
  const cpl3Rows = runCpl3WalkForward(prefixRows, frozenConfig).filter((row) => testIds.has(row.periodId));
  const baseNoSignals = cpl1Rows.filter((row) => row.prediction === null).length;
  const cpl3NoSignals = cpl3Rows.filter((row) => row.noSignal).length;
  if (baseNoSignals !== cpl3NoSignals) throw new Error(`CPL-3 changed coverage in ${date}-${windowIndex + 1}`);

  return {
    window: `${date}-W${windowIndex + 1}`,
    date,
    trainCount: trainRecords.length,
    testCount: testRecords.length,
    testFirst: testRecords[0].issueNumber,
    testLast: testRecords.at(-1)!.issueNumber,
    baseline: calculateLossStreakMetrics(baseline),
    cpl1: calculateLossStreakMetrics(cpl1Rows),
    cpl3: cpl3Metrics(cpl3Rows),
  };
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function aggregate(results: WindowResult[], model: 'baseline' | 'cpl1' | 'cpl3') {
  const metrics = results.map((result) => result[model]);
  const periods = metrics.reduce((sum, value) => sum + value.totalPeriods, 0);
  const predictions = metrics.reduce((sum, value) => sum + value.totalPredictions, 0);
  const wins = metrics.reduce((sum, value) => sum + value.wins, 0);
  const losses = metrics.reduce((sum, value) => sum + value.losses, 0);
  return {
    windows: metrics.length,
    coverage: periods ? predictions / periods : 0,
    wins,
    losses,
    accuracy: predictions ? wins / predictions : null,
    averageLongestLossStreak: average(metrics.map((value) => value.longestLossStreak)),
    worstLongestLossStreak: Math.max(...metrics.map((value) => value.longestLossStreak)),
    averageLossStreakLength: average(metrics.map((value) => value.averageLossStreak)),
    totalLossEpisodes: metrics.reduce((sum, value) => sum + value.lossStreakCount, 0),
    averageLossEpisodesPerWindow: average(metrics.map((value) => value.lossStreakCount)),
    maximumDrawdown: Math.max(...metrics.map((value) => value.maximumDrawdown)),
    averageMaximumDrawdown: average(metrics.map((value) => value.maximumDrawdown)),
    noSignalCount: metrics.reduce((sum, value) => sum + value.noSignalCount, 0),
  };
}

const history = await loadHistory();
const recordsByDate = new Map<string, ExperimentalHistoryRecord[]>();
for (const record of history) {
  const date = record.issueNumber.slice(0, 8);
  recordsByDate.set(date, [...(recordsByDate.get(date) ?? []), record]);
}
const results: WindowResult[] = [];
for (const [date, dateRecords] of recordsByDate) {
  for (let index = 0; index < WINDOW_START_FRACTIONS.length; index += 1) {
    results.push(evaluateWindow(dateRecords, date, index, WINDOW_START_FRACTIONS[index]));
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  frozenConfiguration: frozenConfig,
  dataset: {
    records: history.length,
    firstPeriod: history[0]?.issueNumber ?? null,
    lastPeriod: history.at(-1)?.issueNumber ?? null,
    dates: [...recordsByDate.keys()],
    sha256: createHash('sha256').update(JSON.stringify(history)).digest('hex'),
  },
  protocol: {
    windows: 'Four expanding-prefix test windows per date: 40-50%, 50-60%, 60-70%, and 70-100%.',
    training: 'Only records before each test window are in the training prefix.',
    cpl3: 'context-8-cap-3 is frozen; no configuration selection occurs in any window.',
    noSignal: 'CPL-3 NO_SIGNAL count must equal CPL-1 NO_SIGNAL count in every window.',
    primaryMetric: 'Longest loss streak; wins and accuracy are informational only.',
  },
  windows: results,
  summary: {
    windows: results.length,
    cpl3BeatsBaselineLongest: results.filter((result) => result.cpl3.longestLossStreak < result.baseline.longestLossStreak).length,
    cpl3BeatsCpl1Longest: results.filter((result) => result.cpl3.longestLossStreak < result.cpl1.longestLossStreak).length,
    tiesVsBaselineLongest: results.filter((result) => result.cpl3.longestLossStreak === result.baseline.longestLossStreak).length,
    tiesVsCpl1Longest: results.filter((result) => result.cpl3.longestLossStreak === result.cpl1.longestLossStreak).length,
    baseline: aggregate(results, 'baseline'),
    cpl1: aggregate(results, 'cpl1'),
    cpl3: aggregate(results, 'cpl3'),
  },
};

console.log(JSON.stringify(report, null, 2));
