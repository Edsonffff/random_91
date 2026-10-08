# WinGo 30S 24/7 Standalone Backend Collector

This is a standalone, lightweight Node.js worker service that continuously fetches live WinGo 30S lottery results from the official source API every ~30 seconds and inserts new settled results directly into Supabase.

---

## Architecture

```
┌─────────────────────────────────┐
│ Node.js Collector (server.js)   │
│ 24/7 Standalone Backend Worker  │
└────────────────┬────────────────┘
                 │
           Fetch source API
             every ~30 sec
                  │
                  ▼
           Durable local spool
                  │
                   ▼
           Check new period
                  │
                  ▼
          Supabase Database (public.real_wingo_30s_history)
                 │
                 ▼
         React Dashboard (reads/displays latest data)
```

---

## Features

- **No Browser Dependencies**: Eliminates gaps caused by browser throttling, background tabs, or closed windows.
- **Deduplication**: Checks both an in-memory set and Supabase unique constraint (`game_code,issue_number`).
- **Preserves Existing Data**: Pre-loads all 1,042+ historical records on boot and only appends new draws.
- **Fault-Tolerant Polling Loop**: Never crashes on network drops, HTTP errors, or upstream rate limits; automatically logs failures and retries.
- **Durable History Spool**: Every newly received history record is atomically written to `.history-spool` before Supabase persistence. Entries are removed only after an acknowledged upsert and are replayed before normal history polling after restart.
- **Official Mirror Failover**: History requests try the official mirror hosts already used by the project, without assuming any mirror provides historical backfill.
- **History Continuity Diagnostics**: The health endpoint reports the newest persisted period, pending spool age, retries, and observed gaps without fabricating periods.
- **Precise Logging**: Clear, timestamped event logs for every step (`Fetch started`, `Period detected`, `already exists → skipped`, `New result → inserted`).
- **T7 Permanent Capture**: Every BDGTharu `prediction` and `history[]` entry is upserted by `period_id`; pending-to-final transitions preserve the original capture time and finalized values are immutable.
- **T7 Diagnostics**: Poll audits, provider-window expiry, and provider-stream gaps are available from `GET /api/t7/status` and `/health`.
- **Protected Full Reset**: An explicitly enabled, JSON-confirmed admin operation can clear only the current collector history/T7/checkpoint state. It is never run automatically.

---

## Configuration

Create a `.env` file in the `collector/` directory (or set environment variables in your deployment dashboard):

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Optional settings:
POLL_INTERVAL_MS=30000
RETRY_DELAY_MS=10000
HISTORY_SPOOL_DIR=.history-spool
HISTORY_REQUEST_TIMEOUT_MS=15000
HISTORY_SUPABASE_TIMEOUT_MS=15000
PORT=8080
```

Apply `supabase/migrations/20261007_create_wingo_t7_monitoring.sql` before enabling the durable T7 diagnostics. The current BDGTharu endpoint does not provide verified historical lookup, so the collector reports `historicalBackfillSupported: false` and never issues unsupported period/page queries.

## Controlled full reset

The reset is destructive and disabled by default. It does not run at startup and does not delete the durable `.history-spool` directory.

Enable it only for an intentional maintenance window:

```env
RESET_ENABLED=true
```

The spool must already be empty. A pending spool batch causes the reset to refuse. The operation pauses History, T7, and Adaptive processing, clears the current collector state, then resumes normal polling.

Dry-run, with no database or runtime mutation:

```bash
curl -X POST http://127.0.0.1:8080/api/admin/reset-all \
  -H 'Content-Type: application/json' \
  -d '{"confirm":"RESET_ALL","dryRun":true}'
```

Actual reset:

```bash
curl -X POST http://127.0.0.1:8080/api/admin/reset-all \
  -H 'Content-Type: application/json' \
  -d '{"confirm":"RESET_ALL"}'
```

The endpoint accepts only `POST`, requires `confirm: RESET_ALL` in the JSON body, rejects query-string confirmation, and returns `403` unless `RESET_ENABLED=true`. Duplicate reset requests are rejected while a reset is running.

Cleared state:

- `public.real_wingo_30s_history` rows for `game_code = WinGo_30S`
- `public.wingo_t7_signals`
- `public.wingo_adaptive_checkpoints` keys `WinGo_30S` and `WinGo_30S:baseline`
- `public.wingo_t7_pending_diagnostics`
- `public.wingo_t7_gap_diagnostics`
- in-memory collector/T7/Adaptive runtime state

Preserved state:

- `.history-spool` files; a non-empty spool refuses the reset
- `public.wingo_t7_poll_audit`
- Test 3, Test 7, and Test 9 algorithm source
- T9 prediction tables and unrelated application tables
- users/authentication, configuration, repository, and Cloudflare settings

After a successful reset, the newest period in the current upstream window becomes `resetStartPeriod`. The first post-reset History response accepts only periods strictly newer than that boundary; older and equal periods are ignored, including across midnight rollover. The boundary remains active until a strictly newer period is successfully persisted. No period before the reset is reconstructed, no missing historical result is fabricated, and no historical backfill beyond the provider window is attempted. Adaptive creates a new baseline only from new durable inputs and continues to wait for exact strict T7 inputs when required.

---

## Local Setup & Testing

```bash
cd collector
npm install
npm start
```

---

## Deployment Options

### 1. Render.com (Background Worker or Web Service)
1. In Render Dashboard, click **New +** > **Background Worker** (or **Web Service**).
2. Connect your Git repository.
3. Set the following settings:
   - **Root Directory**: `collector`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. In **Environment Variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Click **Create Service**.

### 2. Railway.app
1. Create a new service from your GitHub repo.
2. Under **Settings**:
   - **Root Directory**: `/collector`
3. Under **Variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Railway will automatically detect `npm start` and run the worker.

### 3. VPS with PM2 (Ubuntu/Debian)
```bash
cd /var/www/random_91/collector
npm install
pm2 start server.js --name wingo-collector
pm2 save
pm2 startup
```
