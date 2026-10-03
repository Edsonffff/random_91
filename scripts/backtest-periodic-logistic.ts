import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  compareIssueNumbers,
  evaluateWalkForward,
  scheduledStartFromIssue,
  type ExperimentalHistoryRecord,
  type WalkForwardRow,
} from '../src/experimental/periodicLogisticAlgorithm';
import {
  calculateLossStreakMetrics,
  compareLossObjectives,
  CPL2_MINIMUM_COVERAGE,
  CPL2_THRESHOLDS,
  measureCpl2,
  selectCpl2Threshold,
} from '../src/experimental/cpl2ConfidenceGate';
import {
  cpl3Metrics,
  CPL3_CONFIGS,
  CPL3_MINIMUM_COVERAGE,
  runCpl3WalkForward,
  selectCpl3Config,
  type Cpl3Config,
  type Cpl3Row,
} from '../src/experimental/cpl3LossStreakBreaker';

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

async function loadAllHistory(): Promise<ExperimentalHistoryRecord[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const latest = await supabase.from('real_wingo_30s_history').select('issue_number')
    .eq('game_code', 'WinGo_30S').order('issue_number', { ascending: false }).limit(1);
  if (latest.error || !latest.data?.length) throw new Error('Cannot establish history snapshot cutoff.');
  const cutoff = String(latest.data[0].issue_number);
  const rows: ExperimentalHistoryRecord[] = [];
  let cursor: string | null = null;
  while (true) {
    let query = supabase
      .from('real_wingo_30s_history')
      .select('issue_number, number, source_time, created_at')
      .eq('game_code', 'WinGo_30S')
      .lte('issue_number', cutoff)
      .order('issue_number', { ascending: true })
      .limit(1000);
    if (cursor !== null) query = query.gt('issue_number', cursor);
    const { data, error } = await query;
    if (error) throw new Error(`History query failed: ${error.message}`);
    if (!data || data.length === 0) break;
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
  if (count.error || count.count !== rows.length) throw new Error('Snapshot row-count mismatch; refusing partial history.');
  return rows.sort((a, b) => compareIssueNumbers(a.issueNumber, b.issueNumber));
}

function baselineRows(rows: WalkForwardRow[], history: ExperimentalHistoryRecord[]): WalkForwardRow[] {
  const byDate = new Map<string, ExperimentalHistoryRecord[]>();
  for (const record of history) {
    const date = record.issueNumber.slice(0, 8);
    const existing = byDate.get(date) ?? [];
    existing.push(record);
    byDate.set(date, existing);
  }

  return rows.map((row) => {
    const targetStart = scheduledStartFromIssue(row.periodId);
    const priorRecords = (byDate.get(row.date) ?? []).filter((record) => {
      const recordStart = scheduledStartFromIssue(record.issueNumber);
      const availabilityValues = [record.createdAt, record.sourceTime]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map((value) => Date.parse(value))
        .filter((value) => Number.isFinite(value));
      const availableAt = availabilityValues.length > 0 ? Math.max(...availabilityValues) : null;
      return (
        targetStart !== null &&
        recordStart !== null &&
        recordStart < targetStart &&
        availableAt !== null &&
        availableAt < targetStart &&
        compareIssueNumbers(record.issueNumber, row.periodId) < 0
      );
    });
    const prior = priorRecords.slice(-1);
    const bigCount = priorRecords.filter((record) => record.winningNumber >= 5).length;
    const baselinePrediction = prior.length === 0
      ? null
      : (bigCount + 1) / (priorRecords.length + 2) >= 0.5 ? 'BIG' : 'SMALL';
    const outcome = baselinePrediction === null
      ? 'NO_SIGNAL'
      : baselinePrediction === row.actualSize
      ? 'WIN'
      : 'LOSS';
    return {
      ...row,
      prediction: baselinePrediction,
      probabilityBig: priorRecords.length > 0 ? (bigCount + 1) / (priorRecords.length + 2) : null,
      trainingCount: priorRecords.length,
      trainedThroughPeriod: prior[0]?.issueNumber ?? null,
      outcome,
    };
  });
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error(`${name} needs a path`);
  return process.argv[index + 1];
}

const snapshotPath = option('--snapshot');
const outputPath = option('--output');
const history: ExperimentalHistoryRecord[] = snapshotPath
  ? JSON.parse(readFileSync(snapshotPath, 'utf8'))
  : await loadAllHistory();
history.sort((a, b) => compareIssueNumbers(a.issueNumber, b.issueNumber));
const seen = new Set<string>();
for (const row of history) {
  const start = scheduledStartFromIssue(row.issueNumber);
  if (!/^\d{8}10005\d{4}$/.test(row.issueNumber) || start === null ||
      Number(row.issueNumber.slice(-4)) < 1 || Number(row.issueNumber.slice(-4)) > 2880 ||
      !Number.isInteger(row.winningNumber) || row.winningNumber < 0 || row.winningNumber > 9 ||
      !row.createdAt || !row.sourceTime || !Number.isFinite(Date.parse(row.createdAt)) ||
      !Number.isFinite(Date.parse(row.sourceTime)) || seen.has(row.issueNumber)) {
    throw new Error('Invalid or duplicate history row; refusing to silently change the dataset.');
  }
  seen.add(row.issueNumber);
}
if (history.length < 100) throw new Error('Insufficient history for train/validation/holdout.');
const recordsByDate = new Map<string, ExperimentalHistoryRecord[]>();
for (const record of history) {
  const date = record.issueNumber.slice(0, 8);
  const rows = recordsByDate.get(date) ?? [];
  rows.push(record);
  recordsByDate.set(date, rows);
}

const validationRows: WalkForwardRow[] = [];
const holdoutRows: WalkForwardRow[] = [];
const splitDetails: Record<string, { train: number; validation: number; holdout: number; first: string; last: string }> = {};
for (const [date, dateRecords] of recordsByDate) {
  const dateTrainEnd = Math.floor(dateRecords.length * 0.4);
  const dateValidationEnd = Math.floor(dateRecords.length * 0.8);
  const developmentRows = evaluateWalkForward(dateRecords.slice(0, dateValidationEnd));
  const fullDateRows = evaluateWalkForward(dateRecords);
  const validationPeriodIds = new Set(dateRecords.slice(dateTrainEnd, dateValidationEnd).map((record) => record.issueNumber));
  const holdoutPeriodIds = new Set(dateRecords.slice(dateValidationEnd).map((record) => record.issueNumber));
  validationRows.push(...developmentRows.filter((row) => validationPeriodIds.has(row.periodId)));
  holdoutRows.push(...fullDateRows.filter((row) => holdoutPeriodIds.has(row.periodId)));
  splitDetails[date] = {
    train: dateTrainEnd,
    validation: dateValidationEnd - dateTrainEnd,
    holdout: dateRecords.length - dateValidationEnd,
    first: dateRecords[0].issueNumber,
    last: dateRecords.at(-1)!.issueNumber,
  };
}

function buildCpl3Split(config: Cpl3Config, split: 'validation' | 'holdout'): Cpl3Row[] {
  const result: Cpl3Row[] = [];
  for (const dateRecords of recordsByDate.values()) {
    const dateTrainEnd = Math.floor(dateRecords.length * 0.4);
    const dateValidationEnd = Math.floor(dateRecords.length * 0.8);
    const baseRows = split === 'validation'
      ? evaluateWalkForward(dateRecords.slice(0, dateValidationEnd))
      : evaluateWalkForward(dateRecords);
    const selectedRecords = split === 'validation'
      ? dateRecords.slice(dateTrainEnd, dateValidationEnd)
      : dateRecords.slice(dateValidationEnd);
    const selectedIds = new Set(selectedRecords.map((record) => record.issueNumber));
    const selectedBaseRows = baseRows.filter((row) => selectedIds.has(row.periodId));
    const cpl3Rows = runCpl3WalkForward(baseRows, config)
      .filter((row) => selectedIds.has(row.periodId));
    const baseNoSignals = selectedBaseRows.filter((row) => row.prediction === null).length;
    const cpl3NoSignals = cpl3Rows.filter((row) => row.noSignal).length;
    if (baseNoSignals !== cpl3NoSignals) {
      throw new Error('CPL-3 changed NO_SIGNAL coverage; refusing streak-metric manipulation.');
    }
    result.push(...cpl3Rows);
  }
  return result;
}

const validationCpl3Candidates = CPL3_CONFIGS.map((config) => ({
  config,
  metrics: cpl3Metrics(buildCpl3Split(config, 'validation')),
}));
const selectedCpl3 = selectCpl3Config(validationCpl3Candidates);
const frozenCpl3Config = selectedCpl3?.config ?? null;
// Only the validation-selected configuration is ever run on holdout.
const holdoutCpl3Rows = frozenCpl3Config === null ? [] : buildCpl3Split(frozenCpl3Config, 'holdout');
const holdoutCpl3 = frozenCpl3Config === null ? null : cpl3Metrics(holdoutCpl3Rows);
const validationThresholdResults = CPL2_THRESHOLDS.map((threshold) => {
  const metrics = measureCpl2(validationRows, threshold);
  return { threshold, eligible: metrics.coverage >= CPL2_MINIMUM_COVERAGE, metrics };
});
const selected = selectCpl2Threshold(validationThresholdResults);
const frozenThreshold = selected?.threshold ?? null;
// This immutable decision is made before any holdout prediction is evaluated.
const selection = Object.freeze({ threshold: frozenThreshold, minimumCoverage: CPL2_MINIMUM_COVERAGE });
const validationBaseline = calculateLossStreakMetrics(baselineRows(validationRows, history));
const validationCpl1 = calculateLossStreakMetrics(validationRows);
const holdoutBaseline = calculateLossStreakMetrics(baselineRows(holdoutRows, history));
const holdoutCpl1 = calculateLossStreakMetrics(holdoutRows);
// Never evaluate unselected thresholds on holdout. No eligible threshold means
// rejection, not a fallback, coverage relaxation, or an all-NO_SIGNAL model.
const holdoutCpl2 = selection.threshold === null ? null : measureCpl2(holdoutRows, selection.threshold);
const report = {
  generatedAt: new Date().toISOString(),
  dataset: {
    records: history.length,
    firstPeriod: history[0]?.issueNumber ?? null,
    lastPeriod: history.at(-1)?.issueNumber ?? null,
    dates: [...new Set(history.map((row) => row.issueNumber.slice(0, 8)))],
    sha256: createHash('sha256').update(JSON.stringify(history)).digest('hex'),
  },
  splits: {
    byDate: splitDetails,
    trainTotal: Object.values(splitDetails).reduce((sum, split) => sum + split.train, 0),
    validationTotal: Object.values(splitDetails).reduce((sum, split) => sum + split.validation, 0),
    holdoutTotal: Object.values(splitDetails).reduce((sum, split) => sum + split.holdout, 0),
  },
  protocol: {
    coverageDenominator: 'All records in the split, including CPL-1 warm-up NO_SIGNALs; identical across models.',
    training: 'Unchanged CPL-1 expanding same-date training using only rows available before the target start.',
    selection: 'Validation only; CPL-3 configs and CPL-2 thresholds are frozen before holdout evaluation, with an 80% coverage constraint.',
    drawdown: 'Fixed +/-1 unit per issued prediction; zero for NO_SIGNAL; worst within-date drawdown, not reset at gaps.',
    streaks: 'NO_SIGNAL, date boundaries, and missing issue gaps break loss streaks.',
    limitation: 'Historical holdout excluded from this selection; portions were inspected in prior CPL-1 research, so not a pristine prospective trial.',
  },
  cpl3: {
    configs: validationCpl3Candidates,
    selectedConfig: frozenCpl3Config,
    status: selectedCpl3 ? 'CONFIG_FROZEN' : 'REJECTED_NO_CONFIG_MEETS_COVERAGE',
    holdoutEvaluations: selectedCpl3 ? 1 : 0,
  },
  cpl2: {
    thresholds: validationThresholdResults,
    selectedThreshold: frozenThreshold,
    status: selected ? 'THRESHOLD_FROZEN' : 'REJECTED_NO_THRESHOLD_MEETS_COVERAGE',
    holdoutEvaluations: selected ? 1 : 0,
  },
  validation: {
    baseline: validationBaseline,
    cpl1: validationCpl1,
    cpl3: selectedCpl3?.metrics ?? null,
    cpl2: selected?.metrics ?? null,
  },
  holdout: {
    baseline: holdoutBaseline,
    cpl1: holdoutCpl1,
    cpl3: holdoutCpl3,
    cpl2: holdoutCpl2,
    cpl3ImprovedVsCpl1: holdoutCpl3 !== null && holdoutCpl3.coverage >= CPL3_MINIMUM_COVERAGE &&
      (holdoutCpl3.longestLossStreak < holdoutCpl1.longestLossStreak ||
        holdoutCpl3.longestLossStreak === holdoutCpl1.longestLossStreak &&
        (holdoutCpl3.lossStreakCount < holdoutCpl1.lossStreakCount ||
          holdoutCpl3.lossStreakCount === holdoutCpl1.lossStreakCount &&
          (holdoutCpl3.averageLossStreak < holdoutCpl1.averageLossStreak ||
            holdoutCpl3.averageLossStreak === holdoutCpl1.averageLossStreak &&
            holdoutCpl3.maximumDrawdown < holdoutCpl1.maximumDrawdown))),
    cpl3ImprovedVsBaseline: holdoutCpl3 !== null && holdoutCpl3.coverage >= CPL3_MINIMUM_COVERAGE &&
      (holdoutCpl3.longestLossStreak < holdoutBaseline.longestLossStreak ||
        holdoutCpl3.longestLossStreak === holdoutBaseline.longestLossStreak &&
        (holdoutCpl3.lossStreakCount < holdoutBaseline.lossStreakCount ||
          holdoutCpl3.lossStreakCount === holdoutBaseline.lossStreakCount &&
          (holdoutCpl3.averageLossStreak < holdoutBaseline.averageLossStreak ||
            holdoutCpl3.averageLossStreak === holdoutBaseline.averageLossStreak &&
            holdoutCpl3.maximumDrawdown < holdoutBaseline.maximumDrawdown))),
    improvedVsCpl1: holdoutCpl2 !== null && holdoutCpl2.coverage >= CPL2_MINIMUM_COVERAGE && compareLossObjectives(holdoutCpl2, holdoutCpl1) < 0,
    improvedVsBaseline: holdoutCpl2 !== null && holdoutCpl2.coverage >= CPL2_MINIMUM_COVERAGE && compareLossObjectives(holdoutCpl2, holdoutBaseline) < 0,
  },
};

if (outputPath) {
  writeFileSync(outputPath, JSON.stringify(report, null, 2), { flag: 'wx' });
  writeFileSync(`${outputPath}.snapshot.json`, JSON.stringify(history, null, 2), { flag: 'wx' });
}
console.log(JSON.stringify(report, null, 2));
