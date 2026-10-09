import { createClient } from '@supabase/supabase-js';
import { InputRevisionError } from './adaptive-learning.js';

const GAME = 'WinGo_30S';
const CHECKPOINT_TABLE = 'wingo_adaptive_checkpoints';
export const BASELINE_CHECKPOINT_KEY = `${GAME}:baseline`;

export function createAdaptiveClient(url, key) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function checked(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data;
}

/** Match api/index.ts readFromSupabase and AlgorithmAnalyzer.test9History exactly. */
export function browserHistoryRecord(row, now = new Date().toISOString()) {
  const rawNum = row.winning_number !== undefined ? row.winning_number : row.number;
  const num = typeof rawNum === 'number' ? rawNum : /^\d$/.test(String(rawNum ?? '')) ? Number(rawNum) : NaN;
  const completedAt = row.completed_at || row.created_at || now;
  return {
    issueNumber: String(row.issue_number ?? '').trim(), winningNumber: num,
    sourceTime: completedAt, createdAt: completedAt,
  };
}

export class AdaptiveLearningStore {
  constructor(client) { this.client = client; }

  async loadCheckpoint() {
    const checkpoint = await this.loadCheckpointRecord();
    return checkpoint?.state ?? null;
  }

  async loadCheckpointRecord() {
    const data = checked(await this.client.from(CHECKPOINT_TABLE).select('state, updated_at').eq('game_code', GAME).maybeSingle(), 'Load adaptive checkpoint (apply collector/adaptive-learning-schema.sql first)');
    return data?.state ? { state: data.state, updatedAt: data.updated_at ?? null } : null;
  }

  async saveCheckpoint(state) {
    checked(await this.client.from(CHECKPOINT_TABLE).upsert({ game_code: GAME, state, updated_at: new Date().toISOString() }, { onConflict: 'game_code' }), 'Persist adaptive checkpoint');
  }

  async loadBaselineCheckpointRecord() {
    const data = checked(await this.client.from(CHECKPOINT_TABLE).select('state, updated_at')
      .eq('game_code', BASELINE_CHECKPOINT_KEY).maybeSingle(), 'Load active adaptive baseline checkpoint');
    return data?.state ? { state: data.state, updatedAt: data.updated_at ?? null } : null;
  }

  async saveBaselineCheckpoint(state) {
    checked(await this.client.from(CHECKPOINT_TABLE).upsert({
      game_code: BASELINE_CHECKPOINT_KEY, state, updated_at: new Date().toISOString(),
    }, { onConflict: 'game_code' }), 'Persist active adaptive baseline checkpoint');
  }

  async periodInputs(period) {
    const [history, t7] = await Promise.all([
      this.client.from('real_wingo_30s_history').select('*').eq('game_code', GAME).eq('issue_number', period).limit(1),
      this.client.from('wingo_t7_signals').select('*').eq('period_id', period).limit(1),
    ]);
    const rows = checked(history, 'Verify settled history input');
    const signals = checked(t7, 'Verify finalized T7 input');
    return { record: rows[0] ? browserHistoryRecord(rows[0]) : null, signal: signals[0] ?? null };
  }

  async historyAfter(cursor = null) {
    return this.historyFrom(null, cursor);
  }

  async historyFrom(startPeriod = null, cursor = null) {
    const latest = checked(await this.client.from('real_wingo_30s_history').select('issue_number')
      .eq('game_code', GAME).order('issue_number', { ascending: false }).limit(1), 'Read history cutoff');
    const cutoff = latest[0]?.issue_number;
    if (!cutoff) return { records: [], count: 0 };
    const records = [];
    let after = cursor;
    const now = new Date().toISOString();
    while (true) {
      let query = this.client.from('real_wingo_30s_history').select('*').eq('game_code', GAME)
        .lte('issue_number', cutoff).order('issue_number', { ascending: true }).limit(1000);
      if (startPeriod) query = query.gte('issue_number', startPeriod);
      if (after) query = query.gt('issue_number', after);
      const page = checked(await query, 'Read adaptive history');
      if (!page.length) break;
      records.push(...page.map((row) => browserHistoryRecord(row, now)));
      after = page.at(-1).issue_number;
      if (page.length < 1000) break;
    }
    let countQuery = this.client.from('real_wingo_30s_history').select('issue_number', { count: 'exact', head: true })
      .eq('game_code', GAME).lte('issue_number', cutoff);
    if (startPeriod) countQuery = countQuery.gte('issue_number', startPeriod);
    const result = await countQuery;
    checked(result, 'Check adaptive history coverage');
    if (typeof result.count !== 'number') throw new Error('History count unavailable.');
    return { records, count: result.count };
  }

  async signalsSince(since = null, pendingPeriods = []) {
    const cutoff = new Date().toISOString();
    const signals = [];
    for (let from = 0; ; from += 1000) {
      let query = this.client.from('wingo_t7_signals').select('period_id, signal, confidence, fetched_at, stored_at, created_at, status, source, algorithm_version, prediction_created_at, settled_at, actual_number')
        .lte('stored_at', cutoff).order('stored_at', { ascending: true }).order('period_id', { ascending: true })
        .range(from, from + 999);
      // Include the boundary to avoid losing simultaneous writes; engine dedups by value.
      if (since) query = query.gte('stored_at', since);
      const page = checked(await query, 'Read stored T7 inputs');
      signals.push(...page);
      if (page.length < 1000) break;
    }
    // Advance only to an observed write, never the polling wall clock: an in-flight
    // collector upsert may commit after this read with an earlier stored_at value.
    const through = signals.at(-1)?.stored_at ?? since;
    // stored_at is assigned before the collector upsert commits. A delayed write
    // can therefore become visible behind an already observed newer timestamp.
    // Re-read every pending period by ID; these reads do not advance the delta cursor.
    const periods = [...new Set(pendingPeriods)];
    for (let from = 0; from < periods.length; from += 500) {
      const page = checked(await this.client.from('wingo_t7_signals')
        .select('period_id, signal, confidence, fetched_at, stored_at, created_at, status, source, algorithm_version, prediction_created_at, settled_at, actual_number')
        .in('period_id', periods.slice(from, from + 500)), 'Read pending T7 inputs');
      signals.push(...page);
    }
    return { signals, through };
  }

  assertCoverage(engine, batch) {
    if (engine.history.length + batch.records.length !== batch.count) {
      throw new InputRevisionError('History was reset/backfilled or snapshot coverage changed; browser replay would differ.');
    }
  }
}
