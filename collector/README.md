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
         Check new period
                 │
         Prevent duplicates
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
- **Precise Logging**: Clear, timestamped event logs for every step (`Fetch started`, `Period detected`, `already exists → skipped`, `New result → inserted`).

---

## Configuration

Create a `.env` file in the `collector/` directory (or set environment variables in your deployment dashboard):

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Optional settings:
POLL_INTERVAL_MS=30000
RETRY_DELAY_MS=10000
PORT=8080
```

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
