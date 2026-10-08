import { AdaptiveLearningEngine, InputRevisionError } from './adaptive-learning.js';
import { LEGACY_T7_REQUIRED_POLICY } from './adaptive-input-policy.js';

export function replayCheckpoint(records, signals, checkpoint, log = () => {}, inputPolicy = LEGACY_T7_REQUIRED_POLICY) {
  const candidate = new AdaptiveLearningEngine({ log, inputPolicy });
  candidate.setSignals(signals);
  let replayedCount = 0;
  for (const record of records) {
    candidate.settle(record, { quiet: true });
    replayedCount++;
    if (checkpoint?.period === record.issueNumber) {
      candidate.verifyRecovery(checkpoint);
      return { candidate, replayedCount };
    }
  }
  if (checkpoint?.period === null) {
    const empty = new AdaptiveLearningEngine({ log });
    empty.verifyRecovery(checkpoint);
    return { candidate: empty, replayedCount: 0 };
  }
  throw new InputRevisionError('Checkpoint period is missing from Supabase history.');
}

function signalMap(signals, throughPeriod) {
  return new Map(signals.filter((s) => s.period_id && BigInt(s.period_id) <= BigInt(throughPeriod)
    && ['BIG', 'SMALL'].includes(s.signal)).map((s) => [s.period_id, s]));
}

export function isLateT7Checkpoint(checkpoint, checkpointUpdatedAt, currentSignals) {
  if (!checkpoint?.period || !checkpointUpdatedAt || !Number.isFinite(Date.parse(checkpointUpdatedAt))) return false;
  const checkpointTime = Date.parse(checkpointUpdatedAt);
  const oldSignals = currentSignals.filter((signal) => {
    const visibleAt = signal.created_at || signal.stored_at;
    return !visibleAt || Date.parse(visibleAt) <= checkpointTime;
  });
  const oldMap = signalMap(oldSignals, checkpoint.period);
  const currentMap = signalMap(currentSignals, checkpoint.period);
  let lateAddition = false;
  for (const period of new Set([...oldMap.keys(), ...currentMap.keys()])) {
    const old = oldMap.get(period);
    const current = currentMap.get(period);
    if (old?.signal === current?.signal) continue;
    if (!old && current?.stored_at && Date.parse(current.stored_at) > checkpointTime) {
      lateAddition = true;
      continue;
    }
    return false;
  }
  return lateAddition;
}

export function recoverLateT7Checkpoint(records, currentSignals, checkpoint, checkpointUpdatedAt, log = () => {}) {
  if (!isLateT7Checkpoint(checkpoint, checkpointUpdatedAt, currentSignals)) {
    throw new InputRevisionError('Checkpoint is not provably stale due to late T7 additions.');
  }
  const checkpointTime = Date.parse(checkpointUpdatedAt);
  const historicalSignals = currentSignals.filter((signal) => {
    const visibleAt = signal.created_at || signal.stored_at;
    return !visibleAt || Date.parse(visibleAt) <= checkpointTime;
  });
  replayCheckpoint(records, historicalSignals, checkpoint, log);
  const candidate = new AdaptiveLearningEngine({ log });
  candidate.setSignals(currentSignals);
  let replayedCount = 0;
  for (const record of records) {
    if (BigInt(record.issueNumber) > BigInt(checkpoint.period)) break;
    candidate.settle(record, { quiet: true });
    replayedCount++;
  }
  candidate.firstPredictions = new Map(checkpoint.firstPredictions ?? []);
  candidate.lastEvaluatedAt = candidate.history.at(-1) ? checkpoint.evaluatedAt : null;
  return { candidate, replayedCount };
}
