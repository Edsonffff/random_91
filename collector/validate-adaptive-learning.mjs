// Read-only parity check: no collector/upstream worker and no database writes.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { AdaptiveLearningEngine } from './adaptive-learning.js';
import { AdaptiveLearningStore, createAdaptiveClient } from './adaptive-learning-store.js';
import {
  computeTest3, computeTest7, evaluateWalkForward, runCpl3WalkForward, CPL3_CONFIGS,
  browserAdaptiveInputs, browserActiveInput, browserT9Active, replayBrowser, compareIssuesAsc, calculateLossStreakMetrics,
} from './adaptive-algorithms.generated.js';

const statFields = [
  'finalDecision', 'totalPredictions', 'totalHits', 'totalMisses', 'accuracyPct',
  'currentHitStreak', 'currentMissStreak', 'longestHitStreak', 'longestMissStreak',
  'weights', 'dominantSignalIndex', 'last20', 'last50', 'last100', 'last250', 'lastSignalAgreement',
];

export function assertCurrentParity(engine, reference, label) {
  const current = engine.current();
  for (const field of statFields) assert.deepStrictEqual(current[field], reference[field], `${label}: ${field}`);
  assert.deepStrictEqual(current.activePrediction, reference.activePrediction, `${label}: activePrediction`);
}

export function validateDataset(records, signals, { activeSamples = 5 } = {}) {
  const ascending = [...records].sort((a, b) => compareIssuesAsc(a.issueNumber, b.issueNumber));
  const signalMap = new Map(signals.filter((s) => ['BIG', 'SMALL'].includes(s.signal)).map((s) => [String(s.period_id).trim(), s]));
  const dataset = [...ascending].reverse().map((r) => ({ period: r.issueNumber, number: r.winningNumber }));
  const t3 = computeTest3(dataset);
  const t7 = computeTest7(dataset, signalMap);
  const cpl1 = evaluateWalkForward(ascending);
  const config = CPL3_CONFIGS.find((c) => c.name === 'context-8-cap-3');
  const cpl3 = runCpl3WalkForward(cpl1, config);
  const inputs = browserAdaptiveInputs(dataset, t3, t7, cpl3);
  const reference = replayBrowser(inputs, null);
  const engine = new AdaptiveLearningEngine();
  engine.setSignals(signals);
  const sampleEvery = Math.max(1, Math.floor(ascending.length / activeSamples));
  for (let i = 0; i < ascending.length; i++) {
    const period = ascending[i].issueNumber;
    const step = engine.settle(ascending[i]);
    assert.deepStrictEqual(step.cpl1, cpl1[i], `T9 CPL-1 mismatch at ${period}`);
    assert.deepStrictEqual(step.cpl3, cpl3[i], `T9 CPL-3 mismatch at ${period}`);
    // Includes T3/T7/T9, decision, pre-update weights, probabilities and win/loss.
    assert.deepStrictEqual(step.evaluated, reference.history[i], `Adaptive row mismatch at ${period}`);
    const prefixReference = replayBrowser(inputs.filter((r) => compareIssuesAsc(r.period, period) <= 0), null);
    assertCurrentParity(engine, prefixReference, period);
    const prefixDatasetForStats = dataset.filter((row) => compareIssuesAsc(row.period, period) <= 0);
    const current = engine.current();
    assert.equal(current.test3MaxLoss, computeTest3(prefixDatasetForStats).longestMissStreak, `Test 3 max loss at ${period}`);
    assert.equal(current.test7MaxLoss, computeTest7(prefixDatasetForStats, signalMap).longestMissStreak, `Test 7 max loss at ${period}`);
    assert.equal(current.test9MaxLoss, calculateLossStreakMetrics(cpl3.slice(0, i + 1)).longestLossStreak, `Test 9 max loss at ${period}`);
    // Directly compare POST-update weights, not only the following prediction.
    assert.deepStrictEqual(engine.weights, prefixReference.weights, `Weight update mismatch at ${period}`);
    if (i % sampleEvery === 0 || i === ascending.length - 1) {
      const activePeriod = (BigInt(period) + 1n).toString();
      const prefixHistory = ascending.slice(0, i + 1).reverse();
      const prefixDataset = prefixHistory.map((r) => ({ period: r.issueNumber, number: r.winningNumber }));
      const activeT3 = computeTest3(prefixDataset);
      const activeT7 = computeTest7(prefixDataset, signalMap);
      const activeT9 = browserT9Active({ currentIssue: activePeriod }, prefixHistory, cpl1.slice(0, i + 1));
      const activeInput = browserActiveInput(activePeriod, activeT3, activeT7, activeT9);
      const activeReference = replayBrowser(inputs.filter((r) => compareIssuesAsc(r.period, period) <= 0), activeInput);
      const beforePrediction = JSON.stringify({ weights: engine.weights, cpl: engine.cplState, history: engine.history });
      engine.predict(activePeriod);
      assert.deepStrictEqual([engine.activeSignals.t3pred, engine.activeSignals.t7pred, engine.activeSignals.t9pred],
        [activeInput.t3pred, activeInput.t7pred, activeInput.t9pred], `Active signals mismatch at ${activePeriod}`);
      assertCurrentParity(engine, activeReference, `active ${activePeriod}`);
      assert.equal(JSON.stringify({ weights: engine.weights, cpl: engine.cplState, history: engine.history }), beforePrediction, 'Active prediction mutated learning state');
      assert.equal(engine.predict(activePeriod), false, 'Unchanged poll repeated prediction computation');
    }
  }
  return {
    engine,
    report: {
      rows: ascending.length, firstPeriod: ascending[0]?.issueNumber, lastPeriod: ascending.at(-1)?.issueNumber,
      signalsEvaluated: {
        t3: reference.history.filter((r) => r.t3pred !== null).length,
        t7: reference.history.filter((r) => r.t7pred !== null).length,
        t9: reference.history.filter((r) => r.t9pred !== null).length,
      },
      maxLoss: { test3: engine.test3MaxLoss, test7: engine.test7MaxLoss, test9: engine.test9MaxLoss },
      result: 'EXACT MATCH (no numeric tolerance)',
    },
  };
}

async function main() {
  dotenv.config({ path: new URL('./.env', import.meta.url).pathname });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase credentials required for historical parity validation.');
  const store = new AdaptiveLearningStore(createAdaptiveClient(url, key));
  const [batch, stored] = await Promise.all([store.historyAfter(), store.signalsSince()]);
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 300;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
  const records = batch.records.slice(-limit);
  if (records.length === 0) throw new Error('Supabase returned no historical records; parity cannot be established.');
  console.log(`Read-only historical snapshot: ${batch.count} stored rows; comparing latest ${records.length}.`);
  const { report } = validateDataset(records, stored.signals);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`VALIDATION STOPPED: ${error.message}`);
    process.exitCode = 1;
  });
}
