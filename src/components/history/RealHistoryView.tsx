import React, { useState, useMemo } from 'react';
import { useRealHistory, sortRealHistoryDescending } from '../../context/RealHistoryContext';
import { useToast } from '../../context/ToastContext';
import type { RealGameRecord } from '../../types/result';
import {
  RefreshCw,
  Clock,
  Radio,
  AlertCircle,
  Layers,
  Download,
  Code2,
  X,
  CheckCircle2,
  Globe2,
  Database,
} from 'lucide-react';

function convertToCSV(records: RealGameRecord[]): string {
  const headers = ['Period', 'WinningNumber', 'BigSmall', 'Colors', 'Premium', 'Sum', 'CompletedAt', 'Source'];
  const rows = records.map((r) => [
    `"${r.periodNumber}"`,
    r.winningNumber,
    `"${r.size}"`,
    `"${r.colors.join(';')}"`,
    `"${r.premium}"`,
    r.sum,
    `"${r.completedAt || ''}"`,
    `"${r.source}"`,
  ].join(','));
  return [headers.join(','), ...rows].join('\r\n');
}

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const RealHistoryView: React.FC = () => {
  const {
    realHistory,
    realSchedule,
    selectedLimit,
    setSelectedLimit,
    autoRefresh,
    setAutoRefresh,
    lastUpdated,
    isLoading,
    error,
    pagination,
    connectionMode,
    lastSupabaseSyncTime,
    lastSyncedIssue,
    supabaseStatus,
    supabaseError,
    dismissSupabaseError,
    totalSupabaseRows,
    syncAllToSupabase,
    testSingleSupabaseSync,
    refreshRealResults,
    importRealHistoryCurlJson,
  } = useRealHistory();

  const { showToast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [rawJsonText, setRawJsonText] = useState('');
  const [importing, setImporting] = useState(false);

  const formattedSeconds = realSchedule
    ? String(realSchedule.remainingSeconds).padStart(2, '0')
    : '--';

  const lastUpdatedDisplay = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString()
    : 'Not yet updated';

  // Strictly sort real history by issue_number numerically descending (Requirements 3, 5, 7)
  const sortedHistory = useMemo(() => {
    return sortRealHistoryDescending(realHistory);
  }, [realHistory]);

  const recordsToDisplay =
    selectedLimit === 'all' ? sortedHistory : sortedHistory.slice(0, selectedLimit);

  const handleImportSubmit = () => {
    if (!rawJsonText.trim()) return;
    setImporting(true);
    try {
      const ok = importRealHistoryCurlJson(rawJsonText);
      if (ok) {
        setRawJsonText('');
        setIsImportModalOpen(false);
      }
    } finally {
      setImporting(false);
    }
  };

  const handleDownload = (format: 'csv' | 'json') => {
    try {
      setIsDownloading(true);
      if (sortedHistory.length === 0) {
        showToast('No real game records available to download.', 'warning');
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `wingo30s_real_history_${timestamp}.${format}`;

      if (format === 'csv') {
        const csv = convertToCSV(sortedHistory);
        triggerDownload(csv, filename, 'text/csv;charset=utf-8;');
      } else {
        const json = JSON.stringify(sortedHistory, null, 2);
        triggerDownload(json, filename, 'application/json;charset=utf-8;');
      }

      showToast(
        `Downloaded ${sortedHistory.length} real history records (${format.toUpperCase()})!`,
        'success'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      showToast(`Download failed: ${msg}`, 'error');
    } finally {
      setIsDownloading(false);
    }
  };

  // Helper to categorize and present UI error messages
  const getErrorDetails = (errString: string) => {
    const lower = errString.toLowerCase();
    if (lower.includes('403')) {
      return {
        title: 'HTTP 403 Forbidden (Cloudflare Restriction)',
        description:
          'Access to the official endpoint was blocked by Cloudflare HTTP 403. Use "Import Curl JSON" below to load live results manually.',
      };
    }
    if (lower.includes('cors') || lower.includes('failed to fetch') || lower.includes('network')) {
      return {
        title: 'Browser Network / CORS Restriction',
        description:
          'Direct browser connection to draw.ar-lottery01.com could not be completed. Check your internet connection or use "Import Curl JSON".',
      };
    }
    if (lower.includes('malformed')) {
      return {
        title: 'Malformed JSON Payload',
        description:
          'The endpoint responded but the payload structure was missing expected data fields (data.list).',
      };
    }
    if (lower.includes('empty')) {
      return {
        title: 'Empty Feed Data',
        description: 'The official endpoint returned 0 history records.',
      };
    }
    return {
      title: 'Direct Connection Issue',
      description: errString,
    };
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner & Control Bar */}
      <div className="p-5 rounded-2xl bg-[#071A14] border border-[#1E3A2B] shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-[#35B978]/15 text-[#35B978] border border-[#35B978]/30 inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#35B978] animate-pulse" />
              COMPLETED REAL HISTORY
            </span>

            {/* Connection Mode Indicator */}
            {connectionMode === 'browser-direct' && (
              <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1.5">
                <Globe2 className="w-3 h-3 text-emerald-400" />
                Browser Direct Feed (HTTP 200)
              </span>
            )}
            {connectionMode === 'imported' && (
              <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-[#E7B93F]/20 text-[#E7B93F] border border-[#E7B93F]/40 inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-[#E7B93F]" />
                Imported Official Feed
              </span>
            )}
            {connectionMode === 'cached' && (
              <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-[#1E3A2B] text-[#8D9B95] border border-[#1E3A2B] inline-flex items-center gap-1.5">
                Local Storage Cached
              </span>
            )}
            {connectionMode === 'server-fallback' && (
              <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40 inline-flex items-center gap-1.5">
                Server Fallback
              </span>
            )}
            {/* Auto Sync Indicator (Requirement 10) */}
            <span
              className={`px-2.5 py-0.5 rounded text-[11px] font-mono font-bold border inline-flex items-center gap-1.5 ${
                autoRefresh
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-zinc-800/60 text-zinc-400 border-zinc-700/40'
              }`}
            >
              <Radio className={`w-3 h-3 ${autoRefresh ? 'text-emerald-400 animate-pulse' : 'text-zinc-500'}`} />
              Auto Sync: {autoRefresh ? 'ON' : 'OFF'}
            </span>

            {/* Supabase Status Indicator (Requirement 10) */}
            {lastSupabaseSyncTime ? (
              <span
                className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-teal-500/20 text-teal-300 border border-teal-500/40 inline-flex flex-wrap items-center gap-2"
                title="Records persisted to Supabase public.real_wingo_30s_history"
              >
                <Database className="w-3 h-3 text-teal-400" />
                <span>Supabase Synced {totalSupabaseRows !== null ? `(${totalSupabaseRows} rows)` : ''}</span>
                <span className="text-teal-400/50">•</span>
                <span>Last sync: {new Date(lastSupabaseSyncTime).toLocaleTimeString()}</span>
                {lastSyncedIssue && (
                  <>
                    <span className="text-teal-400/50">•</span>
                    <span className="text-teal-200">Last issue: {lastSyncedIssue}</span>
                  </>
                )}
              </span>
            ) : supabaseStatus === 'syncing' ? (
              <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
                Syncing to Supabase...
              </span>
            ) : (
              <span
                className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-[#06130F] text-[#8D9B95] border border-[#1E3A2B] inline-flex items-center gap-1.5"
                title="Supabase ready"
              >
                <Database className="w-3 h-3 text-[#8D9B95]" />
                Supabase Ready {totalSupabaseRows !== null ? `(${totalSupabaseRows} rows)` : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-[#8D9B95]">
            Direct browser feed from <code className="text-[#35B978]">draw.ar-lottery01.com</code> with persistence in{' '}
            <code className="text-teal-400">public.real_wingo_30s_history</code>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Limit selector */}
          <div className="flex items-center gap-1 bg-[#06130F] p-1 rounded-xl border border-[#1E3A2B]">
            {([10, 50, 100, 'all'] as const).map((lim) => (
              <button
                key={lim}
                onClick={() => setSelectedLimit(lim)}
                className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold transition-all cursor-pointer ${
                  selectedLimit === lim
                    ? 'bg-[#35B978] text-[#020806] shadow'
                    : 'text-[#8D9B95] hover:text-[#F5F5F5]'
                }`}
              >
                {lim === 'all' ? 'ALL' : lim}
              </button>
            ))}
          </div>

          {/* Test 1 Record button (Requirement 13) */}
          <button
            onClick={testSingleSupabaseSync}
            disabled={realHistory.length === 0 || supabaseStatus === 'syncing'}
            className="px-3.5 py-2 rounded-xl bg-[#06130F] hover:bg-[#0E2E22] text-teal-300 border border-teal-500/40 text-xs font-bold transition-all cursor-pointer shadow flex items-center gap-1.5 disabled:opacity-50"
            title="Test inserting 1 real record into Supabase to verify schema and RLS permissions"
          >
            <Database className="w-3.5 h-3.5 text-teal-400" />
            Test 1 Record
          </button>

          {/* Sync to Supabase button */}
          <button
            onClick={syncAllToSupabase}
            disabled={realHistory.length === 0 || supabaseStatus === 'syncing'}
            className="px-3.5 py-2 rounded-xl bg-[#06130F] hover:bg-[#0E2E22] text-teal-300 border border-teal-500/40 text-xs font-bold transition-all cursor-pointer shadow flex items-center gap-1.5 disabled:opacity-50"
            title="Upsert all loaded records into Supabase public.real_wingo_30s_history"
          >
            <Database className={`w-3.5 h-3.5 ${supabaseStatus === 'syncing' ? 'animate-pulse' : ''}`} />
            Sync to Supabase
          </button>

          {/* Import Curl JSON button */}
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-[#06130F] hover:bg-[#0E2E22] text-[#35B978] border border-[#35B978]/30 text-xs font-bold transition-all cursor-pointer shadow flex items-center gap-1.5"
            title="Import raw JSON from curl command to populate official results"
          >
            <Code2 className="w-3.5 h-3.5" />
            Import Curl JSON
          </button>

          {/* Auto Refresh Toggle (Requirement 10) */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-xl border font-mono text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              autoRefresh
                ? 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/30 shadow'
                : 'bg-[#06130F] text-[#8D9B95] border-[#1E3A2B]'
            }`}
            title="Automatically poll and persist newly completed results to Supabase every 5 seconds"
          >
            <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-pulse' : ''}`} />
            Auto Sync: {autoRefresh ? 'ON' : 'OFF'}
          </button>

          {/* Manual Refresh Button */}
          <button
            onClick={() => refreshRealResults(true)}
            disabled={isLoading}
            className="px-3.5 py-2 rounded-xl bg-[#E7B93F] hover:bg-[#d6a935] disabled:opacity-50 text-[#020806] text-xs font-bold transition-all cursor-pointer shadow flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh Real Results
          </button>
        </div>
      </div>

      {/* Upstream Status / Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-600/40 text-xs text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-start sm:items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <div className="font-bold text-amber-300">
                {getErrorDetails(error).title}
              </div>
              <div className="text-[11px] text-[#8D9B95] mt-0.5">
                {getErrorDetails(error).description}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-[#35B978] hover:bg-[#2fa368] text-[#020806] font-bold text-xs cursor-pointer shadow"
            >
              Import Curl JSON
            </button>
            <button
              onClick={() => refreshRealResults(true)}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-lg bg-[#06130F] border border-[#1E3A2B] text-amber-300 hover:text-white font-semibold text-xs cursor-pointer"
            >
              Retry Direct Fetch
            </button>
          </div>
        </div>
      )}

      {/* SUPABASE WRITE FAILURE DIAGNOSTIC BANNER */}
      {supabaseError && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/50 text-xs text-red-200 shadow-xl space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-red-300 text-sm flex flex-wrap items-center gap-2">
                  <span>Supabase Write Diagnostic</span>
                  {supabaseError.code && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-red-900/60 border border-red-500/40 text-red-200">
                      Code: {supabaseError.code}
                    </span>
                  )}
                  {supabaseError.status && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-red-900/60 border border-red-500/40 text-red-200">
                      HTTP {supabaseError.status}
                    </span>
                  )}
                  {supabaseError.stage && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-900/40 border border-amber-500/30 text-amber-200">
                      Stage: {supabaseError.stage}
                    </span>
                  )}
                </div>
                <div className="text-red-100 font-semibold mt-1">
                  {supabaseError.message}
                </div>
                {supabaseError.details && (
                  <div className="text-red-300/90 text-[11px] mt-0.5">
                    <strong>Details:</strong> {supabaseError.details}
                  </div>
                )}
                {supabaseError.hint && (
                  <div className="text-amber-300 text-[11px] mt-0.5">
                    <strong>Hint:</strong> {supabaseError.hint}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={testSingleSupabaseSync}
                disabled={supabaseStatus === 'syncing'}
                className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs cursor-pointer shadow flex items-center gap-1"
                title="Run single record test write"
              >
                <Database className="w-3.5 h-3.5" />
                Test 1 Record
              </button>
              <button
                onClick={dismissSupabaseError}
                className="px-2 py-1 rounded text-red-300 hover:text-white text-xs border border-red-700/50 hover:bg-red-900/40 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>

          {supabaseError.testedPayload && (
            <div className="bg-[#050D0A] p-2.5 rounded-lg border border-red-900/40 text-[11px] font-mono">
              <div className="text-[#8D9B95] mb-1 font-sans font-bold">Tested Payload (Target: public.real_wingo_30s_history):</div>
              <pre className="text-teal-300 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(supabaseError.testedPayload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* CURRENT ACTIVE ISSUE CARD */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-[#071A14] via-[#061912] to-[#071A14] border border-[#35B978]/30 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#35B978] text-[#020806]">
                CURRENT ISSUE
              </span>
              <span className="text-[11px] text-[#35B978] font-bold uppercase tracking-wider flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#35B978] animate-ping" />
                Active Round
              </span>
            </div>
            <div className="font-mono text-xl sm:text-2xl font-black text-[#F5F5F5] tracking-wider">
              {realSchedule?.currentIssue ||
                (realHistory.length > 0
                  ? (BigInt(realHistory[0].periodNumber) + 1n).toString()
                  : 'Connecting to live schedule...')}
            </div>
            <div className="text-[11px] text-[#8D9B95] font-mono flex items-center gap-3">
              <span>
                Prev:{' '}
                <strong className="text-gray-300">
                  {realSchedule?.previousIssue || (realHistory.length > 0 ? realHistory[0].periodNumber : '--')}
                </strong>
              </span>
              <span>•</span>
              <span>
                Next:{' '}
                <strong className="text-gray-300">
                  {realSchedule?.nextIssue ||
                    (realHistory.length > 0
                      ? (BigInt(realHistory[0].periodNumber) + 2n).toString()
                      : '--')}
                </strong>
              </span>
              <span>•</span>
              <span>
                Last updated: <strong className="text-gray-300">{lastUpdatedDisplay}</strong>
              </span>
            </div>
          </div>

          {/* LCD Countdown Display */}
          <div className="flex items-center gap-3 bg-[#020806] px-5 py-3 rounded-2xl border border-[#1E3A2B]">
            <Clock className="w-5 h-5 text-[#E7B93F]" />
            <div className="text-right">
              <span className="text-[10px] text-[#8D9B95] uppercase font-bold block">
                Time Remaining
              </span>
              <div className="font-mono text-2xl font-black text-[#E7B93F] tracking-widest">
                00:{formattedSeconds}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* COMPLETED REAL HISTORY TABLE */}
      <div className="rounded-2xl bg-[#071A14] border border-[#1E3A2B] overflow-hidden shadow-xl">
        <div className="p-4 border-b border-[#1E3A2B] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#35B978]" />
            <div>
              <h3 className="text-sm font-bold text-[#F5F5F5]">
                Completed Official Results ({recordsToDisplay.length} of {realHistory.length} records shown)
              </h3>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#8D9B95] mt-0.5">
                {pagination && (
                  <span>
                    Official Feed: Page {pagination.pageNo} / {pagination.totalPage} ({pagination.totalCount} total upstream)
                  </span>
                )}
                <span>•</span>
                <span className="text-teal-400 flex items-center gap-1">
                  <Database className="w-3 h-3" />
                  public.real_wingo_30s_history
                </span>
                {lastSupabaseSyncTime && (
                  <span>
                    (Synced: {new Date(lastSupabaseSyncTime).toLocaleTimeString()})
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-[#06130F] hover:bg-[#1E3A2B] border border-[#35B978]/30 text-xs font-mono text-[#35B978] transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Code2 className="w-3 h-3" />
              Import Curl JSON
            </button>
            <span className="text-xs font-mono text-[#8D9B95] hidden sm:inline">
              Download:
            </span>
            <button
              onClick={() => handleDownload('csv')}
              disabled={isDownloading || realHistory.length === 0}
              className="px-2.5 py-1 rounded-lg bg-[#06130F] hover:bg-[#1E3A2B] border border-[#1E3A2B] text-xs font-mono text-[#35B978] hover:text-white transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              title="Download all available history as CSV"
            >
              <Download className="w-3 h-3" />
              CSV
            </button>
            <button
              onClick={() => handleDownload('json')}
              disabled={isDownloading || realHistory.length === 0}
              className="px-2.5 py-1 rounded-lg bg-[#06130F] hover:bg-[#1E3A2B] border border-[#1E3A2B] text-xs font-mono text-[#E7B93F] hover:text-white transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              title="Download all available history as JSON"
            >
              <Download className="w-3 h-3" />
              JSON
            </button>
          </div>
        </div>

        {recordsToDisplay.length === 0 ? (
          <div className="p-12 text-center text-xs text-[#8D9B95] space-y-4">
            {isLoading ? (
              <div className="flex flex-col items-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-[#35B978]" />
                <span>Fetching official WinGo 30S history directly from browser...</span>
              </div>
            ) : error ? (
              <div className="max-w-md mx-auto space-y-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-[#F5F5F5] text-sm">
                    {getErrorDetails(error).title}
                  </h4>
                  <p className="text-[#8D9B95] text-xs mt-1">
                    {getErrorDetails(error).description}
                  </p>
                </div>
                <div className="pt-2 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setIsImportModalOpen(true)}
                    className="px-4 py-2 rounded-xl bg-[#35B978] hover:bg-[#2fa368] text-[#020806] font-bold text-xs transition-colors cursor-pointer shadow flex items-center gap-1.5"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    Import Curl JSON
                  </button>
                  <button
                    onClick={() => refreshRealResults(true)}
                    className="px-4 py-2 rounded-xl bg-[#06130F] border border-[#1E3A2B] text-[#F5F5F5] font-semibold text-xs transition-colors cursor-pointer"
                  >
                    Retry Direct Fetch
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p>No real records loaded yet.</p>
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button
                    onClick={() => refreshRealResults(true)}
                    className="px-4 py-2 rounded-xl bg-[#35B978] text-[#020806] font-bold cursor-pointer"
                  >
                    Fetch Now
                  </button>
                  <button
                    onClick={() => setIsImportModalOpen(true)}
                    className="px-4 py-2 rounded-xl bg-[#06130F] border border-[#1E3A2B] text-[#35B978] font-bold cursor-pointer"
                  >
                    Import Curl JSON
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#1E3A2B] bg-[#06130F] text-[#8D9B95] font-mono uppercase text-[11px]">
                  <th className="py-3 px-4">Period / Issue</th>
                  <th className="py-3 px-4 text-center">Result Number</th>
                  <th className="py-3 px-4">Big / Small</th>
                  <th className="py-3 px-4">Color</th>
                  <th className="py-3 px-4 text-center">Premium</th>
                  <th className="py-3 px-4 text-center">Sum</th>
                  <th className="py-3 px-4 text-right">Data Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E3A2B]/40 font-mono">
                {recordsToDisplay.map((item, idx) => {
                  const isZero = item.winningNumber === 0;
                  const isFive = item.winningNumber === 5;
                  const isEven = item.winningNumber % 2 === 0;
                  const numColor =
                    isZero || isFive
                      ? 'text-[#C94DDA]'
                      : isEven
                      ? 'text-[#F04444]'
                      : 'text-[#35B978]';

                  return (
                    <tr
                      key={item.issueNumber}
                      className={`hover:bg-[#06130F]/60 transition-colors ${
                        idx === 0 ? 'bg-[#35B978]/5' : ''
                      }`}
                    >
                      {/* Period / Issue */}
                      <td className="py-3 px-4 font-bold text-[#F5F5F5]">
                        {item.issueNumber}
                        {idx === 0 && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] bg-[#35B978]/20 text-[#35B978] border border-[#35B978]/30 font-bold uppercase">
                            Latest Settled
                          </span>
                        )}
                      </td>

                      {/* Result Number */}
                      <td className="py-3 px-4 text-center">
                        <span className={`text-base font-black ${numColor}`}>
                          {item.winningNumber}
                        </span>
                      </td>

                      {/* Big / Small */}
                      <td className="py-3 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded text-[11px] font-bold ${
                            item.size === 'Big'
                              ? 'bg-[#E7B93F]/15 text-[#E7B93F] border border-[#E7B93F]/30'
                              : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                          }`}
                        >
                          {item.size}
                        </span>
                      </td>

                      {/* Color */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          {item.colors.map((c, i) => (
                            <span
                              key={i}
                              className={`w-3 h-3 rounded-full inline-block ${
                                c === 'red'
                                    ? 'bg-[#F04444]'
                                    : c === 'green'
                                    ? 'bg-[#35B978]'
                                    : 'bg-[#C94DDA]'
                              }`}
                              title={c}
                            />
                          ))}
                          <span className="text-[11px] text-[#8D9B95] capitalize font-sans ml-1">
                            {item.colors.join(' + ')}
                          </span>
                        </div>
                      </td>

                      {/* Premium */}
                      <td className="py-3 px-4 text-center font-bold text-[#8D9B95]">
                        {item.premium}
                      </td>

                      {/* Sum */}
                      <td className="py-3 px-4 text-center font-bold text-[#8D9B95]">
                        {item.sum}
                      </td>

                      {/* Source Label */}
                      <td className="py-3 px-4 text-right">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-[#35B978]/15 text-[#35B978] border border-[#35B978]/30 font-bold">
                          COMPLETED REAL HISTORY
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#071A14] border border-[#1E3A2B] rounded-2xl p-6 w-full max-w-xl shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#1E3A2B]">
              <div className="flex items-center gap-2">
                <Code2 className="w-5 h-5 text-[#35B978]" />
                <h3 className="text-base font-bold text-[#F5F5F5]">
                  Import Official WinGo 30S JSON
                </h3>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-[#8D9B95] hover:text-[#F5F5F5] transition-colors p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-[#8D9B95] block">
                Run this curl command in your terminal and paste the JSON output below:
              </label>
              <div className="p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B] font-mono text-[11px] text-[#35B978] overflow-x-auto select-all">
                curl -s &apos;https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json?ts=&apos;$(date +%s%3N)
              </div>
              <textarea
                value={rawJsonText}
                onChange={(e) => setRawJsonText(e.target.value)}
                placeholder='Paste raw JSON here (e.g. {"data": {"list": [...]}})...'
                rows={8}
                className="w-full p-3 rounded-xl bg-[#06130F] border border-[#1E3A2B] text-xs font-mono text-[#F5F5F5] placeholder-[#8D9B95]/50 focus:outline-none focus:border-[#35B978] resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setRawJsonText('');
                  setIsImportModalOpen(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#8D9B95] hover:text-[#F5F5F5] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleImportSubmit}
                disabled={!rawJsonText.trim() || importing}
                className="px-5 py-2 rounded-xl bg-[#35B978] hover:bg-[#2fa368] disabled:opacity-40 text-[#020806] text-xs font-bold transition-all cursor-pointer shadow flex items-center gap-2"
              >
                {importing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Import Official Results
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
