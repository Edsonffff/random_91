/**
 * Read-only historical recovery audit.
 *
 * Run from the repository root:
 *   node collector/diagnose-historical-recovery.mjs
 * or with the project environments explicitly loaded:
 *   node --env-file=.env --env-file=collector/.env collector/diagnose-historical-recovery.mjs
 *
 * Every network request made here is GET or HEAD. This script never creates an
 * Adaptive worker, writes Supabase data, updates T7 rows, or saves checkpoints.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BDGTHARU_URL,
  HISTORY_GAP,
  OFFICIAL_HISTORY_HOSTS,
  OFFICIAL_HISTORY_PATH,
  UNRESOLVED_T7_PERIODS,
  buildHistoryPeriodReports,
  buildT7PeriodReports,
  normalizeBdgTharuPayload,
  normalizeHistoryRow,
  normalizeOfficialHistoryPayload,
  normalizeT7Row,
  periodRange,
  sourceMatch,
  summarizeReports,
} from './historical-recovery-audit.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });

const root = fileURLToPath(new URL('..', import.meta.url));
const historyPeriods = periodRange(HISTORY_GAP.firstMissingPeriod, HISTORY_GAP.lastMissingPeriod);

const readOnlyFetch = (input, options = {}) => {
  const method = String(options.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) throw new Error(`Historical audit refused non-read-only request: ${method}`);
  return fetch(input, { ...options, method, signal: options.signal ?? AbortSignal.timeout(30_000) });
};

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
  global: { fetch: readOnlyFetch },
});

function checked(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data;
}

async function getJson(source, requestUrl) {
  try {
    const response = await readOnlyFetch(requestUrl, { headers: { Accept: 'application/json, text/plain, */*' } });
    const text = await response.text();
    if (!response.ok) return { source, url: requestUrl, error: `HTTP ${response.status}`, status: response.status };
    try {
      return { source, url: requestUrl, status: response.status, payload: JSON.parse(text) };
    } catch {
      return { source, url: requestUrl, status: response.status, error: 'non_json_response' };
    }
  } catch (error) {
    return { source, url: requestUrl, error: error instanceof Error ? error.message : String(error) };
  }
}

async function readRepositoryMatches(periods) {
  const wanted = new Set(periods);
  const matches = new Map(periods.map((period) => [period, []]));
  const textExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.json', '.md', '.sql', '.txt', '.csv']);
  const skipped = new Set(['node_modules', '.git', 'dist', 'build']);
  const ignoredAuditFiles = new Set([
    'collector/historical-recovery-audit.js',
    'collector/historical-recovery-audit.test.js',
    'collector/diagnose-historical-recovery.mjs',
  ]);
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (skipped.has(entry.name) || entry.name.startsWith('.env')) continue;
      const pathname = join(directory, entry.name);
      if (entry.isDirectory()) await visit(pathname);
      else if (textExtensions.has(extname(entry.name).toLowerCase())) {
        if (ignoredAuditFiles.has(relative(root, pathname))) continue;
        const text = await readFile(pathname, 'utf8').catch(() => '');
        for (const period of wanted) {
          if (text.includes(period)) matches.get(period).push({
            file: relative(root, pathname),
            authoritative: false,
            note: 'Repository text/fixture match only; not an authoritative historical source.',
          });
        }
      }
    }
  }
  await visit(root);
  return matches;
}

async function readSupabaseInputs() {
  const [historyRows, t7Rows, checkpointRows, pendingDiagnostics, gapDiagnostics, pollAudit] = await Promise.all([
    checked(await client.from('real_wingo_30s_history').select('*').eq('game_code', 'WinGo_30S').in('issue_number', historyPeriods), 'Read exact history-gap periods'),
    checked(await client.from('wingo_t7_signals').select('*').in('period_id', UNRESOLVED_T7_PERIODS), 'Read exact unresolved T7 periods'),
    checked(await client.from('wingo_adaptive_checkpoints').select('game_code,state,updated_at').in('game_code', ['WinGo_30S:baseline', 'WinGo_30S']), 'Read Adaptive checkpoints'),
    checked(await client.from('wingo_t7_pending_diagnostics').select('*').in('period_id', UNRESOLVED_T7_PERIODS), 'Read T7 pending diagnostics'),
    checked(await client.from('wingo_t7_gap_diagnostics').select('*').in('period', [...historyPeriods, ...UNRESOLVED_T7_PERIODS]), 'Read T7 gap diagnostics'),
    checked(await client.from('wingo_t7_poll_audit').select('*').order('created_at', { ascending: true }).limit(1000), 'Read T7 poll audit'),
  ]);
  return { historyRows, t7Rows, checkpointRows, pendingDiagnostics, gapDiagnostics, pollAudit };
}

async function readProviderSources() {
  const official = await Promise.all(OFFICIAL_HISTORY_HOSTS.map(async (host) => {
    const result = await getJson(`official_history:${host}`, `${host}${OFFICIAL_HISTORY_PATH}?ts=${Date.now()}`);
    return { ...result, records: normalizeOfficialHistoryPayload(result.payload) };
  }));
  // Probe only query shapes suggested by the existing endpoint usage and prior
  // diagnostics. A response that ignores a parameter is retained as evidence;
  // it is never treated as historical backfill support.
  const bdgUrls = [
    `${BDGTHARU_URL}?_=${Date.now()}`,
    `${BDGTHARU_URL}?page=2&_=${Date.now()}`,
    `${BDGTHARU_URL}?pageNo=2&_=${Date.now()}`,
    `${BDGTHARU_URL}?limit=1000&_=${Date.now()}`,
    `${BDGTHARU_URL}?issue=${historyPeriods[0]}&_=${Date.now()}`,
    `${BDGTHARU_URL}?period_id=${UNRESOLVED_T7_PERIODS[0]}&_=${Date.now()}`,
  ];
  const bdgProbes = await Promise.all(bdgUrls.map((requestUrl, index) => getJson(`bdgtharu_t7_probe_${index}`, requestUrl)));
  const bdg = bdgProbes[0];
  const bdgEntries = normalizeBdgTharuPayload(bdg.payload);
  const bdgProbeEntries = bdgProbes.map((response) => ({ ...response, entries: normalizeBdgTharuPayload(response.payload) }));

  const officialProbeUrls = [
    `${OFFICIAL_HISTORY_HOSTS[0]}${OFFICIAL_HISTORY_PATH}?page=2&ts=${Date.now()}`,
    `${OFFICIAL_HISTORY_HOSTS[0]}${OFFICIAL_HISTORY_PATH}?pageNo=2&ts=${Date.now()}`,
    `${OFFICIAL_HISTORY_HOSTS[0]}${OFFICIAL_HISTORY_PATH}?limit=1000&ts=${Date.now()}`,
  ];
  const officialProbes = (await Promise.all(officialProbeUrls.map((requestUrl, index) => getJson(`official_history_probe_${index}`, requestUrl))))
    .map((response) => ({ ...response, records: normalizeOfficialHistoryPayload(response.payload) }));

  const configuredApiBases = new Set();
  for (const value of [process.env.VITE_API_BASE_URL, process.env.COLLECTOR_URL]) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      let base = parsed.pathname.endsWith('/reset') ? parsed.pathname.slice(0, -'/reset'.length) : parsed.pathname.replace(/\/$/, '');
      base = base.replace(/\/api\/(real|t7-signals).*$/, '').replace(/\/api$/, '');
      configuredApiBases.add(`${parsed.origin}${base}`);
    } catch { /* Reported as a source configuration issue below. */ }
  }
  const project = [];
  for (const base of configuredApiBases) {
    project.push({
      base,
      history: await getJson(`project_history:${base}`, `${base}/api/real/history?limit=all`),
      t7: await getJson(`project_t7:${base}`, `${base}/api/real/t7-signals`),
      status: await getJson(`project_t7_status:${base}`, `${base}/api/t7/status`),
      adaptive: await getJson(`project_adaptive:${base}`, `${base}/api/adaptive-learning/current`),
    });
  }
  return { official, officialProbes, bdg, bdgEntries, bdgProbes: bdgProbeEntries, project };
}

function addHistoryMatch(map, period, match) {
  if (map.has(period)) map.get(period).push(match);
}

function addT7Match(map, period, match) {
  if (map.has(period)) map.get(period).push(match);
}

function buildSourceMaps(supabase, provider) {
  const historyMatches = new Map(historyPeriods.map((period) => [period, []]));
  const t7Matches = new Map(UNRESOLVED_T7_PERIODS.map((period) => [period, []]));
  for (const row of supabase.historyRows.map(normalizeHistoryRow).filter(Boolean)) {
    addHistoryMatch(historyMatches, row.period, sourceMatch('supabase.real_wingo_30s_history', row.winningNumber, {
      period: row.period, authoritative: true, independentlyVerifiable: false,
      note: 'Durable project history row; this is authoritative only when present.',
    }));
  }
  for (const row of supabase.t7Rows.map(normalizeT7Row).filter(Boolean)) {
    addT7Match(t7Matches, row.period, sourceMatch('supabase.wingo_t7_signals', null, {
      period: row.period, signal: row.signal, authoritative: true,
      finalized: Boolean(row.status && row.actualNumber != null && row.settledAt),
      independentlyVerifiable: false,
      note: 'Durable project capture of the T7 prediction; pending status is not a finalized settlement.',
    }));
  }
  for (const response of provider.official) {
    for (const row of response.records) addHistoryMatch(historyMatches, row.period, sourceMatch(response.source, row.winningNumber, {
      period: row.period, authoritative: true, independentlyVerifiable: true,
      note: 'Official WinGo mirror response; only the returned current window is available.',
    }));
  }
  for (const response of [...provider.officialProbes]) {
    for (const row of response.records) addHistoryMatch(historyMatches, row.period, sourceMatch(response.source, row.winningNumber, {
      period: row.period, authoritative: true, independentlyVerifiable: true,
      note: 'Official mirror query-parameter probe; the endpoint returned its available window.',
    }));
  }
  for (const row of provider.bdgEntries) addT7Match(t7Matches, row.period, sourceMatch('bdgtharu.com/api.php', null, {
    period: row.period, signal: row.signal, authoritative: true,
    finalized: Boolean(row.status && row.actualNumber != null && row.settledAt),
    independentlyVerifiable: true,
    note: 'Current BDGTharu response; no historical backfill parameter is used by the project.',
  }));
  for (const response of provider.bdgProbes) {
    for (const row of response.entries) addT7Match(t7Matches, row.period, sourceMatch(response.source, null, {
      period: row.period, signal: row.signal, authoritative: true,
      finalized: Boolean(row.status && row.actualNumber != null && row.settledAt),
      independentlyVerifiable: true,
      note: 'BDGTharu query-parameter probe; the endpoint returned its available current window.',
    }));
  }
  for (const api of provider.project) {
    const historyPayload = api.history.payload;
    const historyList = Array.isArray(historyPayload?.results) ? historyPayload.results
      : Array.isArray(historyPayload?.data?.list) ? historyPayload.data.list : [];
    for (const row of historyList.map(normalizeHistoryRow).filter(Boolean)) addHistoryMatch(historyMatches, row.period, sourceMatch(`${api.base}/api/real/history`, row.winningNumber, {
      period: row.period, authoritative: false, independentlyVerifiable: false,
      note: 'Configured project endpoint projection; not independently authoritative beyond its backing source.',
    }));
    const t7List = Array.isArray(api.t7.payload?.signals) ? api.t7.payload.signals : [];
    for (const row of t7List.map(normalizeT7Row).filter(Boolean)) addT7Match(t7Matches, row.period, sourceMatch(`${api.base}/api/real/t7-signals`, null, {
      period: row.period, signal: row.signal, authoritative: false, finalized: Boolean(row.status && row.actualNumber != null && row.settledAt),
      note: 'Configured collector/API projection; no new authoritative source.',
    }));
  }
  return { historyMatches, t7Matches };
}

function checkpointFingerprint(rows) {
  return JSON.stringify((rows ?? []).map((row) => ({ game_code: row.game_code, state: row.state, updated_at: row.updated_at }))
    .sort((a, b) => a.game_code.localeCompare(b.game_code)));
}

const startedAt = new Date().toISOString();
const repositoryMatches = await readRepositoryMatches([...historyPeriods, ...UNRESOLVED_T7_PERIODS]);
const supabase = await readSupabaseInputs();
const provider = await readProviderSources();
const beforeCheckpoint = checkpointFingerprint(supabase.checkpointRows);
const { historyMatches, t7Matches } = buildSourceMaps(supabase, provider);
for (const [period, matches] of repositoryMatches) {
  for (const match of matches) {
    if (historyPeriods.includes(period)) historyMatches.get(period).push({ source: `repository:${match.file}`, ...match });
    else t7Matches.get(period).push({ source: `repository:${match.file}`, ...match });
  }
}
const historyReports = buildHistoryPeriodReports(historyPeriods, historyMatches, repositoryMatches);
const storedT7 = new Map(supabase.t7Rows.map((row) => [row.period_id, normalizeT7Row(row)]));
const t7Reports = buildT7PeriodReports(UNRESOLVED_T7_PERIODS, storedT7, t7Matches, repositoryMatches);
const afterCheckpointRows = checked(await client.from('wingo_adaptive_checkpoints').select('game_code,state,updated_at').in('game_code', ['WinGo_30S:baseline', 'WinGo_30S']), 'Re-read Adaptive checkpoints');
const checkpointUnchanged = beforeCheckpoint === checkpointFingerprint(afterCheckpointRows);

  const officialCoverage = provider.official.map((entry) => ({
  source: entry.source, url: entry.url, status: entry.status ?? null, error: entry.error ?? null,
  returnedCount: entry.records.length, oldestPeriod: entry.records.map((r) => r.period).sort()[0] ?? null,
  newestPeriod: entry.records.map((r) => r.period).sort().at(-1) ?? null,
  exactGapMatches: entry.records.filter((r) => historyPeriods.includes(r.period)).map((r) => ({ period: r.period, winningNumber: r.winningNumber })),
  }));

console.log(JSON.stringify({
  readOnly: true,
  startedAt,
  completedAt: new Date().toISOString(),
  operations: { networkMethods: ['GET'], supabaseWrites: 0, checkpointWrites: 0, t7Writes: 0, workersStarted: 0 },
  checkpointUnchangedDuringAudit: checkpointUnchanged,
  historyGap: {
    known: HISTORY_GAP,
    ...summarizeReports(historyReports),
    exactRecoverablePeriods: historyReports.filter((r) => r.recoverable).map((r) => ({ period: r.period, winningNumber: r.exactValue })),
    exactUnrecoverablePeriods: historyReports.filter((r) => !r.recoverable).map((r) => r.period),
    sourcesUsed: ['Supabase real_wingo_30s_history', ...OFFICIAL_HISTORY_HOSTS.map((host) => `${host}${OFFICIAL_HISTORY_PATH}`), 'configured project history endpoint when available', 'repository text/fixture scan'],
    officialCoverage,
    officialQueryProbes: provider.officialProbes.map((entry) => ({
      source: entry.source, url: entry.url, status: entry.status ?? null, error: entry.error ?? null,
      returnedCount: entry.records.length,
      oldestPeriod: entry.records.map((r) => r.period).sort()[0] ?? null,
      newestPeriod: entry.records.map((r) => r.period).sort().at(-1) ?? null,
      exactGapMatches: entry.records.filter((r) => historyPeriods.includes(r.period)).map((r) => ({ period: r.period, winningNumber: r.winningNumber })),
    })),
    periods: historyReports,
  },
  t7Gap: {
    ...summarizeReports(t7Reports),
    recoverablePeriods: t7Reports.filter((r) => r.recoverable).map((r) => r.period),
    unrecoverablePeriods: t7Reports.filter((r) => !r.recoverable).map((r) => r.period),
    completeFinalizedRecoveryCount: t7Reports.filter((r) => r.completeFinalizedRecovery).length,
    sourcesUsed: ['Supabase wingo_t7_signals', 'BDGTharu https://bdgtharu.com/api.php', 'configured collector/API endpoint when available', 'repository text/fixture scan'],
    bdgTharu: {
      url: provider.bdg.url, status: provider.bdg.status ?? null, error: provider.bdg.error ?? null,
      returnedCount: provider.bdgEntries.length,
      oldestPeriod: provider.bdgEntries.map((r) => r.period).sort()[0] ?? null,
      newestPeriod: provider.bdgEntries.map((r) => r.period).sort().at(-1) ?? null,
      exactMatches: provider.bdgEntries.filter((r) => UNRESOLVED_T7_PERIODS.includes(r.period)).map((r) => ({ period: r.period, signal: r.signal, status: r.status })),
      historicalBackfillSupported: false,
      queryProbes: provider.bdgProbes.map((entry) => ({
        source: entry.source, url: entry.url, status: entry.status ?? null, error: entry.error ?? null,
        returnedCount: entry.entries.length,
        oldestPeriod: entry.entries.map((r) => r.period).sort()[0] ?? null,
        newestPeriod: entry.entries.map((r) => r.period).sort().at(-1) ?? null,
        exactMatches: entry.entries.filter((r) => UNRESOLVED_T7_PERIODS.includes(r.period)).map((r) => ({ period: r.period, signal: r.signal })),
      })),
    },
    periods: t7Reports,
  },
  sourceInventory: {
    supabaseTablesRead: ['real_wingo_30s_history', 'wingo_t7_signals', 'wingo_adaptive_checkpoints'],
    officialHistoryHosts: OFFICIAL_HISTORY_HOSTS,
    configuredProjectEndpoints: provider.project.map((api) => api.base),
    configuredProjectEndpointResults: provider.project.map((api) => ({
      base: api.base,
      history: { status: api.history.status ?? null, error: api.history.error ?? null },
      t7: { status: api.t7.status ?? null, error: api.t7.error ?? null },
      t7Status: { status: api.status.status ?? null, error: api.status.error ?? null },
      adaptive: { status: api.adaptive.status ?? null, error: api.adaptive.error ?? null },
    })),
    repositoryMatches: Object.fromEntries([...repositoryMatches].filter(([, matches]) => matches.length)),
    monitoringRowsRead: {
      pendingDiagnostics: supabase.pendingDiagnostics.length,
      gapDiagnostics: supabase.gapDiagnostics.length,
      pollAuditRows: supabase.pollAudit.length,
    },
    note: 'No repository archive, local historical cache, or existing historical backfill utility was found. Current-window provider responses cannot establish old-period values when those periods are absent.',
  },
  conclusion: {
    historyGapSafelyRepairable: false,
    t7PeriodsSafelyRepairable: false,
    adaptiveReplayCanResumeAfterAudit: false,
    adaptiveReplayReason: 'Audit performs no repair; the missing history gap and unresolved T7 inputs remain, so the existing waiting_for_t7/coverage gate remains necessary.',
    noDatabaseRowsOrCheckpointsModified: checkpointUnchanged,
  },
}, null, 2));
