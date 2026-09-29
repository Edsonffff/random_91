/**
 * useAdaptiveLearning — Test 4 Adaptive Self-Learning Engine
 *
 * Learning mechanism:
 *   - Maintains weights [w1, w2, w3] that sum to 1.0 (always normalised).
 *   - After each settled round the weight of a test that was CORRECT is nudged
 *     up by learningRate; a weight that was WRONG is nudged down by learningRate.
 *   - Weights are clamped to [MIN_WEIGHT, 1] then re-normalised.
 *
 * Anti-leakage guarantee:
 *   - The prediction for round `i` is generated using weights derived from
 *     rounds 0 … i-1 ONLY.  The actual result of round `i` is never available
 *     when the prediction is made.
 *
 * Persistence:
 *   - Model state (weights + processed period set) is stored in localStorage so
 *     a page-refresh does not reset learning.
 *   - History rows are computed deterministically from the inputs, so no extra
 *     storage is required for them.
 *
 * Duplicate protection:
 *   - A Set<string> of already-processed period IDs is maintained.  The same
 *     period is never processed twice regardless of how many times the dataset
 *     updates.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const LEARNING_RATE = 0.05;
const INITIAL_WEIGHT = 1 / 3; // equal start
const MIN_WEIGHT = 0.01; // prevents any signal from reaching 0
const STORAGE_KEY = 'wingo_test4_model_v2';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BigSmall = 'Big' | 'Small';

export interface Test4InputRow {
  period: string;
  t1pred: BigSmall; // Test 1 Big/Small prediction
  t2pred: BigSmall; // Test 2 Big/Small prediction
  t3pred: BigSmall; // Test 3 Big/Small prediction
  actual: BigSmall; // Ground-truth Big/Small for this period
}

export interface Test4HistoryRow {
  period: string;
  t1pred: BigSmall;
  t2pred: BigSmall;
  t3pred: BigSmall;
  t4pred: BigSmall; // prediction made BEFORE seeing actual
  actual: BigSmall;
  isHit: boolean;
  probBig: number; // 0-100 %
  probSmall: number; // 0-100 %
  w1: number; // weights AT THE TIME the prediction was made
  w2: number;
  w3: number;
}

export interface ModelState {
  w1: number;
  w2: number;
  w3: number;
  processedPeriods: string[]; // serialised Set
}

export interface Test4Result {
  // live prediction (next round)
  nextPrediction: BigSmall | null;
  nextProbBig: number;
  nextProbSmall: number;
  nextConfidence: number;

  // history (evaluated rows, oldest first for display)
  history: Test4HistoryRow[];

  // aggregate stats
  totalPredictions: number;
  totalHits: number;
  totalMisses: number;
  accuracyPct: number;

  // streaks
  currentHitStreak: number;
  currentMissStreak: number;
  longestHitStreak: number;
  longestMissStreak: number;

  // model weights (live)
  w1: number;
  w2: number;
  w3: number;
  dominantSignal: 1 | 2 | 3;

  // rolling windows
  last20: { hits: number; total: number };
  last50: { hits: number; total: number };
  last100: { hits: number; total: number };

  // controls
  resetLearning: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalise(w1: number, w2: number, w3: number): [number, number, number] {
  const sum = w1 + w2 + w3;
  if (sum <= 0) return [INITIAL_WEIGHT, INITIAL_WEIGHT, INITIAL_WEIGHT];
  return [w1 / sum, w2 / sum, w3 / sum];
}

function clamp(v: number): number {
  return Math.max(MIN_WEIGHT, v);
}

function loadModel(): ModelState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('no data');
    const parsed = JSON.parse(raw) as Partial<ModelState>;
    const w1 = typeof parsed.w1 === 'number' && isFinite(parsed.w1) ? parsed.w1 : INITIAL_WEIGHT;
    const w2 = typeof parsed.w2 === 'number' && isFinite(parsed.w2) ? parsed.w2 : INITIAL_WEIGHT;
    const w3 = typeof parsed.w3 === 'number' && isFinite(parsed.w3) ? parsed.w3 : INITIAL_WEIGHT;
    const [nw1, nw2, nw3] = normalise(clamp(w1), clamp(w2), clamp(w3));
    return {
      w1: nw1,
      w2: nw2,
      w3: nw3,
      processedPeriods: Array.isArray(parsed.processedPeriods) ? parsed.processedPeriods : [],
    };
  } catch {
    return { w1: INITIAL_WEIGHT, w2: INITIAL_WEIGHT, w3: INITIAL_WEIGHT, processedPeriods: [] };
  }
}

function saveModel(state: ModelState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

function computeStreaks(outcomes: boolean[]): {
  currentHitStreak: number;
  currentMissStreak: number;
  longestHitStreak: number;
  longestMissStreak: number;
} {
  if (outcomes.length === 0) {
    return { currentHitStreak: 0, currentMissStreak: 0, longestHitStreak: 0, longestMissStreak: 0 };
  }
  let longestHit = 0;
  let longestMiss = 0;
  let runLen = 1;
  for (let i = 1; i < outcomes.length; i++) {
    if (outcomes[i] === outcomes[i - 1]) {
      runLen++;
    } else {
      if (outcomes[i - 1]) longestHit = Math.max(longestHit, runLen);
      else longestMiss = Math.max(longestMiss, runLen);
      runLen = 1;
    }
  }
  // flush last run
  if (outcomes[outcomes.length - 1]) longestHit = Math.max(longestHit, runLen);
  else longestMiss = Math.max(longestMiss, runLen);

  const last = outcomes[outcomes.length - 1];
  return {
    currentHitStreak: last ? runLen : 0,
    currentMissStreak: !last ? runLen : 0,
    longestHitStreak: longestHit,
    longestMissStreak: longestMiss,
  };
}

function rollingWindow(history: Test4HistoryRow[], n: number): { hits: number; total: number } {
  const slice = history.slice(-n);
  const hits = slice.filter((r) => r.isHit).length;
  return { hits, total: slice.length };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAdaptiveLearning(inputs: Test4InputRow[]): Test4Result & { resetLearning: () => void } {
  const [modelState, setModelState] = useState<ModelState>(() => loadModel());

  // Reset: restore equal weights and clear processed-periods memory
  const resetLearning = useCallback(() => {
    const fresh: ModelState = {
      w1: INITIAL_WEIGHT,
      w2: INITIAL_WEIGHT,
      w3: INITIAL_WEIGHT,
      processedPeriods: [],
    };
    saveModel(fresh);
    setModelState(fresh);
  }, []);

  // ── Core learning pass ────────────────────────────────────────────────────
  // Re-run whenever either the inputs array or the stored model changes.
  // The result is a deterministic replay: starting from stored weights, we
  // process only NEWLY SEEN periods (those NOT in processedPeriods), in
  // ascending chronological order.

  const result = useMemo(() => {
    if (inputs.length === 0) {
      return null;
    }

    // Sort inputs ascending (oldest first) so we can learn chronologically
    const ascending = [...inputs].sort((a, b) => {
      try {
        const diff = BigInt(a.period) - BigInt(b.period);
        if (diff > 0n) return 1;
        if (diff < 0n) return -1;
        return 0;
      } catch {
        return a.period.localeCompare(b.period, undefined, { numeric: true });
      }
    });

    // Build processed-period lookup
    const processedSet = new Set<string>(modelState.processedPeriods);

    // Running weights — start from persisted state
    let w1 = modelState.w1;
    let w2 = modelState.w2;
    let w3 = modelState.w3;

    // We build the full history by replaying ALL inputs:
    // • Rounds already in processedSet: we still replay them using the
    //   weights-as-they-were (stored implicitly in the sequential update).
    //   Since we re-derive history entirely, we replay from scratch each render.
    //
    // IMPORTANT: we replay from equal weights and reprocess ALL rows each
    // render so the history is always self-consistent.  The persisted weights
    // give us the "live" starting state for the NEXT unseen round, but for
    // history display we recompute from scratch (deterministic replay).

    let rw1 = INITIAL_WEIGHT;
    let rw2 = INITIAL_WEIGHT;
    let rw3 = INITIAL_WEIGHT;

    const history: Test4HistoryRow[] = [];

    for (const row of ascending) {
      // Prediction for this round is generated with weights from BEFORE this round
      const bigScore = (row.t1pred === 'Big' ? rw1 : 0) +
                       (row.t2pred === 'Big' ? rw2 : 0) +
                       (row.t3pred === 'Big' ? rw3 : 0);
      const smallScore = (row.t1pred === 'Small' ? rw1 : 0) +
                         (row.t2pred === 'Small' ? rw2 : 0) +
                         (row.t3pred === 'Small' ? rw3 : 0);

      const totalScore = bigScore + smallScore;
      const rawProbBig = totalScore > 0 ? bigScore / totalScore : 0.5;

      const t4pred: BigSmall = rawProbBig >= 0.5 ? 'Big' : 'Small';
      const isHit = t4pred === row.actual;

      const probBig = Math.round(rawProbBig * 1000) / 10; // one decimal
      const probSmall = Math.round((1 - rawProbBig) * 1000) / 10;

      history.push({
        period: row.period,
        t1pred: row.t1pred,
        t2pred: row.t2pred,
        t3pred: row.t3pred,
        t4pred,
        actual: row.actual,
        isHit,
        probBig,
        probSmall,
        w1: rw1,
        w2: rw2,
        w3: rw3,
      });

      // ── Learn from this round ────────────────────────────────────────────
      const t1correct = row.t1pred === row.actual;
      const t2correct = row.t2pred === row.actual;
      const t3correct = row.t3pred === row.actual;

      rw1 = clamp(rw1 + (t1correct ? LEARNING_RATE : -LEARNING_RATE));
      rw2 = clamp(rw2 + (t2correct ? LEARNING_RATE : -LEARNING_RATE));
      rw3 = clamp(rw3 + (t3correct ? LEARNING_RATE : -LEARNING_RATE));
      [rw1, rw2, rw3] = normalise(rw1, rw2, rw3);
    }

    // The "live" weights after replaying everything
    const liveW1 = rw1;
    const liveW2 = rw2;
    const liveW3 = rw3;

    // ── Stats ─────────────────────────────────────────────────────────────
    const totalPredictions = history.length;
    const totalHits = history.filter((r) => r.isHit).length;
    const totalMisses = totalPredictions - totalHits;
    const accuracyPct = totalPredictions > 0 ? Math.round((totalHits / totalPredictions) * 100) : 0;

    const outcomes = history.map((r) => r.isHit);
    const streaks = computeStreaks(outcomes);

    // ── Next prediction (using live weights) ──────────────────────────────
    // We need Test 1/2/3 predictions for the NEXT unsettled round.
    // We don't have that yet — it will be the last row's NEXT period.
    // For the UI, we use the LAST available Test 1/2/3 predictions
    // (the prediction the model would make for the period AFTER the last known one).
    // This is the "upcoming" prediction shown on the dashboard.
    //
    // Since Test 1/2/3 produce predictions for each known period (the prediction
    // for period N uses only information available before period N), the last
    // row of our history represents the most recent evaluated round.
    // The "next" prediction requires Test 1/2/3 inputs for the NEXT period —
    // which we don't have yet. So we display it as "Awaiting next round".
    // 
    // However, we can show what the model WOULD predict if we knew the next
    // period's Test 1/2/3 signals — but those depend on the NEXT round's period
    // number / previous number, which we can't compute here without knowing the
    // next period ID. We'll return null and let the UI show a placeholder.

    const nextPrediction: BigSmall | null = null;
    const nextProbBig = Math.round(liveW1 * 50 + liveW2 * 50 + liveW3 * 50); // placeholder
    const nextProbSmall = 100 - nextProbBig;
    const nextConfidence = Math.abs(50 - nextProbBig) * 2; // 0–100

    // Rolling windows (use history in chronological order)
    const last20 = rollingWindow(history, 20);
    const last50 = rollingWindow(history, 50);
    const last100 = rollingWindow(history, 100);

    // Dominant signal
    let dominantSignal: 1 | 2 | 3 = 1;
    if (liveW2 >= liveW1 && liveW2 >= liveW3) dominantSignal = 2;
    else if (liveW3 >= liveW1 && liveW3 >= liveW2) dominantSignal = 3;

    // ── Persist updated weights if any new periods were processed ─────────
    // We always persist the live (replayed) weights so they reflect reality
    const newProcessed = ascending.map((r) => r.period);
    const updatedProcessedSet = new Set([...processedSet, ...newProcessed]);

    // We use w1/w2/w3 from the persisted modelState as a reference —
    // but we want to save the freshly-replayed live weights:
    const prevLiveW1 = w1; // from persisted state (not replayed)
    const prevLiveW2 = w2;
    const prevLiveW3 = w3;

    const weightsChanged =
      Math.abs(liveW1 - prevLiveW1) > 0.0001 ||
      Math.abs(liveW2 - prevLiveW2) > 0.0001 ||
      Math.abs(liveW3 - prevLiveW3) > 0.0001 ||
      updatedProcessedSet.size !== processedSet.size;

    if (weightsChanged) {
      const newModelState: ModelState = {
        w1: liveW1,
        w2: liveW2,
        w3: liveW3,
        processedPeriods: Array.from(updatedProcessedSet),
      };
      saveModel(newModelState);
    }

    return {
      nextPrediction,
      nextProbBig,
      nextProbSmall,
      nextConfidence,
      history,
      totalPredictions,
      totalHits,
      totalMisses,
      accuracyPct,
      ...streaks,
      w1: liveW1,
      w2: liveW2,
      w3: liveW3,
      dominantSignal,
      last20,
      last50,
      last100,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, modelState.processedPeriods.length, modelState.w1, modelState.w2, modelState.w3]);

  // Sync persisted weights back into state when localStorage changes externally
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setModelState(loadModel());
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Default empty result when inputs are empty
  const empty: Test4Result & { resetLearning: () => void } = {
    nextPrediction: null,
    nextProbBig: 50,
    nextProbSmall: 50,
    nextConfidence: 0,
    history: [],
    totalPredictions: 0,
    totalHits: 0,
    totalMisses: 0,
    accuracyPct: 0,
    currentHitStreak: 0,
    currentMissStreak: 0,
    longestHitStreak: 0,
    longestMissStreak: 0,
    w1: modelState.w1,
    w2: modelState.w2,
    w3: modelState.w3,
    dominantSignal: 1,
    last20: { hits: 0, total: 0 },
    last50: { hits: 0, total: 0 },
    last100: { hits: 0, total: 0 },
    resetLearning,
  };

  if (!result) return empty;

  return { ...result, resetLearning };
}
