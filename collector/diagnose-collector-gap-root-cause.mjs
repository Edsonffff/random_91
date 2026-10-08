/**
 * Investigation only. No collector/server imports, workers, source writes,
 * recovery requests, algorithm changes, or checkpoint updates.
 *
 * node --env-file=.env --env-file=collector/.env collector/diagnose-collector-gap-root-cause.mjs
 * Optional: --history-json=/absolute/path/to/uploaded-history.json
 * The optional JSON is used for period-presence comparison only.
 */
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  REPRESENTATIVE_GAPS, createReadOnlyTransport, describeGap, outageLossBounds,
  scheduledSettlement, summarizeGapEvidence, summarizePollAudits, summarizeWindow,
} from './collector-gap-diagnosis.js';

const startedAt = new Date().toISOString();
const { readOnlyFetch, operations } = createReadOnlyTransport();
const sources = await Promise.all(['server.js', 'adaptive-coordinator.js', 't7-ingestion.js', 't7-monitoring.js']
  .map(async (name) => ({ name, text: await readFile(new URL(name, import.meta.url), 'utf8') })));
const server = sources[0].text;
function literal(pattern, description) {
  const match = server.match(pattern);
  if (!match) throw new Error(`Cannot verify current collector ${description}; inspect changed source before rerunning.`);
  return match[1];
}
const historyUrl = literal(/const OFFICIAL_WINGO_HISTORY_URL = '([^']+)'/, 'history URL');
const t7Url = literal(/const T7_API_BASE_URL = '([^']+)'/, 'T7 URL');
const historyDefault = Number(literal(/POLL_INTERVAL_MS \|\| '(\d+)'/, 'poll default'));
const retryDefault = Number(literal(/RETRY_DELAY_MS \|\| '(\d+)'/, 'retry default'));
const t7Interval = Number(literal(/const T7_POLL_INTERVAL_MS = (\d+)/, 'T7 interval'));
const t7Timeout = Number(literal(/const T7_REQUEST_TIMEOUT_MS = (\d+)/, 'T7 timeout'));
const historyPollMs = parseInt(process.env.POLL_INTERVAL_MS || String(historyDefault), 10);
const retryMs = parseInt(process.env.RETRY_DELAY_MS || String(retryDefault), 10);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Load SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY using the existing environment files.');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: readOnlyFetch } });
function checked(result, name) {
  if (result.error) throw new Error(`${name}: ${result.error.message}`);
  return result.data;
}
async function readCheckpoints() {
  return checked(await client.from('wingo_adaptive_checkpoints').select('*').order('game_code'), 'Read checkpoints');
}
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
async function getSourceWindow(endpoint, kind) {
  try {
    const response = await readOnlyFetch(`${endpoint}?${kind === 'history' ? 'ts' : '_'}=${Date.now()}`, {
      headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) return { endpoint, httpStatus: response.status, error: `HTTP ${response.status}`, window: null };
    const payload = await response.json();
    const list = kind === 'history' ? payload?.data?.list : payload?.history;
    if (!Array.isArray(list)) return { endpoint, httpStatus: response.status, error: 'Expected array absent', window: null };
    return {
      endpoint, httpStatus: response.status, rawHistoryCount: list.length,
      window: summarizeWindow(list.map((row) => String(kind === 'history' ? row.issueNumber ?? '' : row.issue ?? '').trim())),
      currentPredictionPeriod: kind === 't7' ? payload?.prediction?.issue ?? null : null,
      note: 'One current-window observation; not a historical lookup or a guaranteed retention contract.',
    };
  } catch (error) { return { endpoint, error: error.message, window: null }; }
}

const beforeCheckpoints = await readCheckpoints();
const [official, bdgTharu, earliestAudit] = await Promise.all([
  getSourceWindow(historyUrl, 'history'),
  getSourceWindow(t7Url, 't7'),
  client.from('wingo_t7_poll_audit').select('id,poll_started_at,created_at').order('poll_started_at').limit(1),
]);
const earliestAuditRows = earliestAudit.error ? [] : earliestAudit.data;
let uploadedHistory = null;
const jsonArg = process.argv.slice(2).find((arg) => arg.startsWith('--history-json='));
if (jsonArg) {
  const payload = JSON.parse(await readFile(jsonArg.slice('--history-json='.length), 'utf8'));
  const rows = Array.isArray(payload) ? payload : payload.results ?? payload.records ?? payload.data?.list;
  if (!Array.isArray(rows)) throw new Error('Uploaded history JSON must contain an array, results, records, or data.list.');
  uploadedHistory = new Set(rows.map((row) => String(row.issueNumber ?? row.issue_number ?? row.periodNumber ?? '').trim()));
}

// Capture only incident ranges, not the full historical dataset. Each range is
// under the PostgREST 1000-row page size, including the cross-date gap D.
async function readRange(gap) {
  const [history, t7] = await Promise.all([
    client.from('real_wingo_30s_history').select('*').eq('game_code', 'WinGo_30S')
      .gte('issue_number', gap.before).lte('issue_number', gap.after).order('issue_number').limit(1000),
    client.from('wingo_t7_signals').select('*').gte('period_id', gap.before).lte('period_id', gap.after).order('period_id').limit(1000),
  ]);
  return { history: checked(history, `Read history range ${gap.id}`), t7: checked(t7, `Read T7 range ${gap.id}`) };
}
async function readIncidentAudits(gap) {
  const from = new Date(Date.parse(scheduledSettlement(gap.before)) - 10 * 60_000).toISOString();
  const through = new Date(Date.parse(scheduledSettlement(gap.after)) + 30 * 60_000).toISOString();
  const newest = await client.from('wingo_t7_poll_audit').select('id')
    .gte('poll_started_at', from).lte('poll_started_at', through).order('id', { ascending: false }).limit(1);
  if (newest.error) return { unavailable: newest.error.message };
  const cutoff = newest.data[0]?.id;
  if (cutoff == null) return summarizePollAudits([]);
  const rows = [];
  let after = null;
  for (;;) {
    let query = client.from('wingo_t7_poll_audit').select('*').gte('poll_started_at', from)
      .lte('poll_started_at', through).lte('id', cutoff).order('id').limit(1000);
    if (after != null) query = query.gt('id', after);
    const result = await query;
    if (result.error) return { unavailable: result.error.message, partialRows: rows.length };
    if (!result.data.length) break;
    rows.push(...result.data);
    after = result.data.at(-1).id;
  }
  return { queriedFrom: from, queriedThrough: through, ...summarizePollAudits(rows) };
}

const capturedRanges = [];
const gaps = [];
for (const boundaries of REPRESENTATIVE_GAPS) {
  const gap = describeGap(boundaries, official.window?.uniquePeriodCount ?? null);
  const [range, audit] = await Promise.all([readRange(gap), readIncidentAudits(gap)]);
  capturedRanges.push({ gap, range });
  const evidence = summarizeGapEvidence(gap, range.history, range.t7);
  gaps.push({
    ...gap,
    evidence,
    t7PollAuditNearIncident: audit,
    uploadedJsonComparison: uploadedHistory ? {
      beforePresent: uploadedHistory.has(gap.before), afterPresent: uploadedHistory.has(gap.after),
      missingPeriodsFound: gap.missingPeriods.filter((period) => uploadedHistory.has(period)),
    } : null,
    bestSupportedFailureClass: evidence.t7InsideHistoryGap.rowsCreatedDuringScheduledGap > 0
      ? 'History-path capture/persistence interruption long enough to exhaust the rolling official window; T7 writes continued at least part of the time.'
      : 'Capture outage exceeding rolling official retention; whole-process/phone/network outage, history-only failure, and persistence interruption cannot be distinguished from these records.',
    exactIncidentTriggerProven: false,
  });
}

const comparisons = [];
for (const { gap, range } of capturedRanges) {
  const reread = await readRange(gap);
  comparisons.push({ id: gap.id, historyUnchanged: fingerprint(range.history) === fingerprint(reread.history), t7Unchanged: fingerprint(range.t7) === fingerprint(reread.t7) });
}
const afterCheckpoints = await readCheckpoints();
const evidenceAnchors = {
  'server.js': ['const POLL_INTERVAL_MS', 'const RETRY_DELAY_MS', 'const OFFICIAL_WINGO_HISTORY_URL', 'const T7_POLL_INTERVAL_MS', 'clearTimeout(timeoutId)', 'await response.json()', 'const batchChronological', 'knownPeriods.has(issueNumber)', "onConflict: 'game_code,issue_number'", 'knownPeriods.add(issueNumber)', 'lastInsertedPeriod = issueNumber', "}, 'history')", 'adaptiveRetryTimer = setInterval'],
  'adaptive-coordinator.js': ['this.pendingWrites = new Map()', 'pending.push(operation)', 'result = await pending[0]()', 'pending.shift()', 'for (const source of this.pendingWrites.keys())'],
  't7-ingestion.js': ['await this.persist(signalRecord)', 'this.cache.set(entry.period_id', 'await this.persist(settleRow)'],
  't7-monitoring.js': ["String(raw.issue ?? '').trim()", "size !== 'BIG'"],
};
const sourceEvidence = sources.map(({ name, text }) => ({
  file: `collector/${name}`, sha256: fingerprint(text),
  anchors: text.split(/\r?\n/).flatMap((line, index) => evidenceAnchors[name].some((anchor) => line.includes(anchor))
    ? [{ line: index + 1, code: line.trim() }] : []),
}));
const windowSize = official.window?.uniquePeriodCount ?? null;
console.log(JSON.stringify({
  readOnly: true, startedAt, completedAt: new Date().toISOString(),
  scope: 'Collector root-cause investigation only; no recovery attempted.',
  sourceEvidence,
  pipeline: {
    drawHistory: { source: historyUrl, table: 'real_wingo_30s_history', note: 'BDGTharu history[] is NOT inserted into the draw-history table.' },
    t7: { source: t7Url, table: 'wingo_t7_signals' },
    polling: {
      historyPollDelayMs: historyPollMs, historyErrorRetryDelayMs: retryMs, t7PollDelayMs: t7Interval, t7HeaderTimeoutMs: t7Timeout, historyHeaderTimeoutMs: 15000,
      cadence: 'Completion + delay, not fixed wall-clock intervals. Includes count checks, body reads, lock waits, sequential writes, and T7 diagnostic/audit writes.',
      timeoutLimit: 'Timeout is cleared once fetch returns headers; response.json/text and Supabase reads/writes have no explicit application deadline. A stalled body/DB call can block indefinitely.',
      retryBehavior: 'History errors retry after RETRY_DELAY_MS; T7 errors finish the cycle then sleep 5s. No direct history mirror failover.',
      networkErrors: 'History logs Error.message only (often fetch failed); T7 logs fetch error cause in console, but audit stores a shorter message. DNS failures are retried, not separately handled.',
    },
    parsing: {
      history: 'Requires non-empty data.list. Trims full issueNumber, uses number or parseInt(string), skips empty issues/NaN/out-of-range values. Does not enforce canonical period shape/integer number. Bad records are not durably quarantined.',
      t7: 'Trims full issue, uppercases size, accepts only BIG/SMALL. Usable history processed even when prediction is malformed. A thrown per-entry timestamp normalization error can still abort the poll.',
      ordering: 'Official list is reversed, not explicitly sorted; assumes newest-first upstream. Full-period membership dedup does not use an ordering cursor.',
    },
    deduplication: {
      historyMemoryKey: 'String(item.issueNumber).trim(), full date + full period', historyConflictKey: 'game_code,issue_number',
      t7MemoryAndConflictKey: 'period_id, full date + full period', rolloverCollision: false,
      phantomSeenAfterFailedWrite: false,
      caveat: 'Only a full-table-empty check invalidates history seen-set. Partial external deletion would leave stale keys until restart; not evidence of these incidents.',
    },
    persistence: {
      bootReadPageSize: 1000, historyRowsPerUpsert: 1, t7RowsPerUpsert: 1, batchAtomicity: false,
      history: 'Await upsert; retry source_time ISO→millis only on 22007/22P02; throw on remaining error; add knownPeriods and lastInsertedPeriod only after success.',
      retainedFetchedBatches: 'AdaptiveCoordinator.pendingWrites retains failed response closures and retries them before Adaptive advance, also via the server 5s readiness timer. Already persisted history rows are skipped on retry.',
      pendingBatchDurability: 'RAM only; killed/restarted process loses fetched-but-unpersisted payloads. No local spool/WAL exists.',
      headOfLineRisk: 'History and T7 writes/Adaptive requests share serialize() tail. A hung operation blocks later ingestion; a failed queue entry stops later entries for that source until retry succeeds.',
      priorImplementation: 'Before hardening, history insert errors were logged and loop continued, potentially marking cycle healthy; no retained failed response queue. Git deployment on phone is not established.',
    },
    cursor: {
      newestPeriod: 'Boot-time newest persisted row for logging only; not an insertion filter.',
      lastInsertedPeriod: 'Last successful write, not proof of contiguous history; later windows can advance this telemetry beyond missing periods.',
      restart: 'Preloads only persisted full-period IDs; retries duplicate-safe upserts in current window. No scan/download of expired periods or durable pending-write restoration.',
    },
    historicalBackfill: { exists: false, note: 'Only the latest official data.list and BDGTharu history[] windows are reprocessed. Comments saying backfill refer to returned T7 entries, not pagination/archive recovery.' },
  },
  currentApiWindows: { official, bdgTharu },
  observationLimits: {
    uploadedJsonProvidedToDiagnostic: Boolean(uploadedHistory),
    earliestStoredT7Audit: earliestAuditRows[0] ?? null,
    auditReadError: earliestAudit.error?.message ?? null,
    missingEvidence: 'No durable official-history poll/write audit, Android lifecycle logs, original HTTP payload archive, or exact deployed phone version is available in this workspace. These records prove gaps but cannot prove sleep vs DNS vs HTTP vs DB vs deployment interruption.',
  },
  gaps,
  outageModel: {
    formula: 'If m new periods elapse between successful captures and the next source response contains W consecutive periods, permanent misses = max(0, m - W) without an archive.',
    maximumLossForUnboundedOutage: 'unbounded',
    historyExamples: windowSize == null ? [] : [30, 60, 300, 330, 600, 1800, 3600].map((seconds) => outageLossBounds(seconds, windowSize)),
    scenarios: [
      { event: 'phone sleep / Termux killed / network unavailable', result: 'No capture; source windows keep rotating. Misses grow beyond W. RAM retry batches are lost when killed.' },
      { event: 'one promptly completed API failure', result: 'Normally no permanent loss while subsequent success remains within W; not guaranteed if the body or DB hangs or failure persists.' },
      { event: 'collector restart', result: 'Safe for persisted rows; expired unseen and RAM-only pending rows cannot be restored. Startup preload delay counts toward the capture outage.' },
      { event: 'Supabase temporarily unavailable', result: 'Fetched batches survive ordinary returned errors while process remains alive; in-memory backlog is unbounded, hung requests block capture, and process kill loses pending payloads.' },
    ],
    t7Limit: 'BDGTharu current history[] is ~80 entries, not guaranteed contiguous/finalized history. Missing provider entries and lost final settlements cannot be manufactured; this window never automatically repairs draw history.',
  },
  safety: {
    operations, databaseWritesPerformed: 0, workersStarted: 0,
    checkpointUnchangedDuringDiagnostic: fingerprint(beforeCheckpoints) === fingerprint(afterCheckpoints),
    incidentInputsUnchangedDuringDiagnostic: comparisons,
  },
  conclusion: {
    canCurrentCollectorLoseHistoricalPeriodsPermanentlyAgain: true,
    rootCauseClass: 'Finite rolling source window without durable always-on capture or archive catch-up; current RAM retries protect fetched batches only while the process survives.',
    proposedFixNotImplemented: [
      'Use supervised always-on acquisition with an authoritative source offering verified retention/archive retrieval; a phone-only process cannot guarantee no loss through an unbounded outage.',
      'Durably spool each exact received upstream payload before database ingestion; recover/ack spool after successful writes; keep capture independent of Adaptive and DB queue stalls.',
      'Apply deadlines through body reads and DB operations, isolate invalid entries, and use already-known official mirrors for transient failover.',
      'Add durable draw-history poll/write/window/continuity monitoring and alerts before window expiry. Track durable receipt separately from contiguous persisted coverage.',
      'Any future catch-up must use exact authoritative rows only; existing permanently missing periods remain missing. Keep strict T7 eligibility and Adaptive checkpoint rules.',
    ],
  },
}, null, 2));
