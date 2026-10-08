import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const DAY_MS = 86_400_000;
const ROUNDS_PER_DAY = 2880;

function canonical(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function keyFor(record) {
  const game = String(record.game_code ?? 'WinGo_30S');
  const period = String(record.issue_number ?? '').trim();
  if (!period) throw new Error('History spool record requires issue_number.');
  return `${game}:${period}`;
}

function fileNameFor(key) {
  return `${encodeURIComponent(key)}.json`;
}

let batchSequence = 0;

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    // Directory fsync is a POSIX durability primitive. Windows (and some
    // filesystems) reject it with EPERM/EINVAL/EISDIR/ENOTSUP; the rename that
    // precedes this call remains atomic there, so only these codes are ignored.
    if (!['EPERM', 'EINVAL', 'EISDIR', 'ENOTSUP'].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

export class HistorySpool {
  constructor(directory) {
    this.directory = directory;
    this.retryCounts = new Map();
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true });
    return this;
  }

  pathFor(key) { return join(this.directory, fileNameFor(key)); }

  async enqueue(record, metadata = {}) {
    const key = keyFor(record);
    const path = this.pathFor(key);
    const payload = {
      spool_version: 1,
      spool_key: key,
      received_at: metadata.receivedAt ?? new Date().toISOString(),
      source_url: metadata.sourceUrl ?? null,
      upstream_item: metadata.upstreamItem ?? null,
      service_time: metadata.serviceTime ?? null,
      record: { ...record },
    };
    try {
      const existing = JSON.parse(await readFile(path, 'utf8'));
      if (canonical(existing.record) !== canonical(payload.record)) {
        throw new Error(`History spool conflict for ${key}; refusing to overwrite the original record.`);
      }
      return { key, created: false, payload: existing };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, path);
      await syncDirectory(this.directory);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      // A competing retry may have completed the atomic rename. Re-read it so
      // duplicate delivery remains safe instead of masking the durable entry.
      if (error?.code === 'EEXIST') return this.enqueue(record, metadata);
      throw error;
    }
    return { key, created: true, payload };
  }

  async enqueueBatch(records, metadata = {}) {
    if (!Array.isArray(records) || records.length === 0) throw new Error('History spool batch requires records.');
    const receivedAt = metadata.receivedAt ?? new Date().toISOString();
    const key = `batch:${process.pid}:${Date.now()}:${batchSequence++}`;
    const payload = {
      spool_version: 2,
      spool_key: key,
      received_at: receivedAt,
      source_url: metadata.sourceUrl ?? null,
      upstream_items: metadata.upstreamItems ?? null,
      service_time: metadata.serviceTime ?? null,
      records: records.map((record) => ({ ...record })),
    };
    const path = this.pathFor(key);
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, path);
      await syncDirectory(this.directory);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    return { key, created: true, payload };
  }

  async listPending() {
    await this.initialize();
    const names = (await readdir(this.directory)).filter((name) => name.endsWith('.json')).sort();
    const entries = [];
    for (const name of names) {
      try {
        const payload = JSON.parse(await readFile(join(this.directory, name), 'utf8'));
        if (!payload?.spool_key || (!payload?.record?.issue_number && !Array.isArray(payload?.records))) continue;
        entries.push(payload);
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw new Error(`History spool entry ${name} is unreadable: ${error.message}`);
      }
    }
    return entries.sort((left, right) => String(left.received_at).localeCompare(String(right.received_at)));
  }

  async acknowledge(payloadOrKey) {
    const key = typeof payloadOrKey === 'string' ? payloadOrKey : payloadOrKey.spool_key;
    if (!key) throw new Error('History spool acknowledgement requires a spool key.');
    await rm(this.pathFor(key), { force: true });
    await syncDirectory(this.directory);
    this.retryCounts.delete(key);
  }

  recordRetry(key) {
    const count = (this.retryCounts.get(key) ?? 0) + 1;
    this.retryCounts.set(key, count);
    return count;
  }

  async status() {
    const entries = await this.listPending();
    const oldest = entries[0]?.received_at ? Date.parse(entries[0].received_at) : null;
    return {
      pendingCount: entries.length,
      oldestPendingAgeMs: oldest == null || !Number.isFinite(oldest) ? null : Math.max(0, Date.now() - oldest),
      retryCount: [...this.retryCounts.values()].reduce((sum, count) => sum + count, 0),
    };
  }
}

function periodParts(period) {
  const match = String(period).match(/^(\d{4})(\d{2})(\d{2})10005(\d{4})$/);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  const sequence = Number(match[4]);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date
    || sequence < 1 || sequence > ROUNDS_PER_DAY) return null;
  return { midnight, sequence };
}

export function periodOrdinal(period) {
  const parts = periodParts(period);
  if (!parts) return null;
  return parts.midnight / DAY_MS * ROUNDS_PER_DAY + parts.sequence - 1;
}

export function nextHistoryPeriod(period) {
  const ordinal = periodOrdinal(period);
  if (ordinal == null) return null;
  const next = ordinal + 1;
  const day = Math.floor(next / ROUNDS_PER_DAY);
  const sequence = next - day * ROUNDS_PER_DAY + 1;
  return `${new Date(day * DAY_MS).toISOString().slice(0, 10).replaceAll('-', '')}10005${String(sequence).padStart(4, '0')}`;
}

export function compareHistoryPeriods(left, right) {
  const a = periodOrdinal(left);
  const b = periodOrdinal(right);
  if (a != null && b != null) return a - b;
  return String(left).localeCompare(String(right), undefined, { numeric: true });
}

export function detectHistoryGaps(previousNewest, periods) {
  const ordered = [...new Set(periods.map((period) => String(period).trim()).filter(Boolean))]
    .sort(compareHistoryPeriods);
  const gaps = [];
  let previous = previousNewest ? String(previousNewest) : null;
  for (const current of ordered) {
    if (previous) {
      const expected = nextHistoryPeriod(previous);
      if (expected && compareHistoryPeriods(current, expected) > 0) {
        gaps.push({ after: previous, expectedNext: expected, observedNext: current });
      }
    }
    previous = current;
  }
  return gaps;
}

export function createDeadline(ms, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${ms}ms`)), ms);
  return {
    signal: controller.signal,
    clear() { clearTimeout(timer); },
  };
}

export async function fetchJsonWithFailover({ hosts, path, fetcher = fetch, timeoutMs = 15_000, now = Date.now }) {
  const failures = [];
  for (const host of hosts) {
    const endpoint = `${host}${path}`;
    const startedAt = now();
    const deadline = createDeadline(timeoutMs, `History request ${host}`);
    try {
      const response = await fetcher(`${endpoint}?ts=${startedAt}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        },
        signal: deadline.signal,
      });
      if (!response.ok) {
        failures.push({ host, reason: `HTTP ${response.status}` });
        await response.text().catch(() => {});
        continue;
      }
      const payload = await response.json();
      if (!Array.isArray(payload?.data?.list) || payload.data.list.length === 0) {
        failures.push({ host, reason: 'empty_or_invalid_list' });
        continue;
      }
      return { payload, host, responseTimeMs: now() - startedAt, failures };
    } catch (error) {
      failures.push({ host, reason: error instanceof Error ? error.message : String(error) });
    } finally {
      deadline.clear();
    }
  }
  throw new Error(`all history sources failed: ${failures.map((failure) => `${failure.host} ${failure.reason}`).join('; ')}`);
}
