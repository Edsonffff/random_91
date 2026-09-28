import React, { useState } from 'react';
import { useRealHistory } from '../../context/RealHistoryContext';
import { useToast } from '../../context/ToastContext';
import { realHistoryApiService } from '../../services/realHistoryApi';
import type { RealGameRecord } from '../../types/result';
import {
  RefreshCw,
  Clock,
  Radio,
  AlertCircle,
  Layers,
  Download,
  FileSpreadsheet,
  FileJson,
  Check,
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
    refreshRealResults,
  } = useRealHistory();

  const { showToast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadedFormat, setDownloadedFormat] = useState<'csv' | 'json' | null>(null);

  const formattedSeconds = realSchedule
    ? String(realSchedule.remainingSeconds).padStart(2, '0')
    : '--';

  const lastUpdatedDisplay = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString()
    : 'Not yet updated';

  const handleDownload = async (format: 'csv' | 'json') => {
    try {
      setIsDownloading(true);
      let recordsToExport: RealGameRecord[] = realHistory;

      // Always attempt to fetch the complete set of accumulated records from the proxy
      try {
        const res = await realHistoryApiService.fetchRealHistory('all', false);
        if (res.results && res.results.length > 0) {
          recordsToExport = res.results;
        }
      } catch {
        // Fallback to realHistory already in context
      }

      if (recordsToExport.length === 0) {
        showToast('No real game records available to download.', 'warning');
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `wingo30s_real_history_${timestamp}.${format}`;

      if (format === 'csv') {
        const csv = convertToCSV(recordsToExport);
        triggerDownload(csv, filename, 'text/csv;charset=utf-8;');
      } else {
        const json = JSON.stringify(recordsToExport, null, 2);
        triggerDownload(json, filename, 'application/json;charset=utf-8;');
      }

      setDownloadedFormat(format);
      setTimeout(() => setDownloadedFormat(null), 2500);

      showToast(
        `Downloaded ${recordsToExport.length} real history records (${format.toUpperCase()})!`,
        'success'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      showToast(`Download failed: ${msg}`, 'error');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner & Control Bar */}
      <div className="p-5 rounded-2xl bg-[#071A14] border border-[#1E3A2B] shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-[#35B978]/15 text-[#35B978] border border-[#35B978]/30 inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#35B978] animate-pulse" />
              COMPLETED REAL HISTORY
            </span>
            <span className="text-xs text-[#8D9B95] font-mono">
              Live Feed from draw.ar-lottery01.com
            </span>
          </div>
          <p className="text-xs text-[#8D9B95]">
            Official settled results and real-time schedule. Isolated from simulator data.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Limit selector */}
          <div className="flex items-center gap-1 bg-[#06130F] p-1 rounded-xl border border-[#1E3A2B] text-xs">
            <span className="px-2 text-[10px] text-[#8D9B95] uppercase font-mono font-bold">
              Show:
            </span>
            {([10, 50, 100, 'all'] as const).map((lim) => (
              <button
                key={lim}
                onClick={() => setSelectedLimit(lim)}
                className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold transition-all cursor-pointer ${
                  selectedLimit === lim
                    ? 'bg-[#E7B93F] text-[#020806] shadow'
                    : 'text-[#8D9B95] hover:text-[#F5F5F5]'
                }`}
              >
                {lim === 'all' ? 'All' : lim}
              </button>
            ))}
          </div>

          {/* Download Export Group */}
          <div className="flex items-center gap-1 bg-[#06130F] p-1 rounded-xl border border-[#1E3A2B] text-xs">
            <span className="px-2 text-[10px] text-[#8D9B95] uppercase font-mono font-bold flex items-center gap-1">
              <Download className="w-3 h-3 text-[#E7B93F]" />
              Export:
            </span>
            <button
              onClick={() => handleDownload('csv')}
              disabled={isDownloading || realHistory.length === 0}
              className="px-2.5 py-1 rounded-lg font-mono text-xs font-bold bg-[#1E3A2B]/60 hover:bg-[#1E3A2B] text-[#F5F5F5] border border-[#1E3A2B] transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-40"
              title="Download all accumulated live game records as CSV (Spreadsheet / Excel)"
            >
              {downloadedFormat === 'csv' ? (
                <Check className="w-3 h-3 text-[#35B978]" />
              ) : (
                <FileSpreadsheet className="w-3 h-3 text-[#35B978]" />
              )}
              CSV
            </button>
            <button
              onClick={() => handleDownload('json')}
              disabled={isDownloading || realHistory.length === 0}
              className="px-2.5 py-1 rounded-lg font-mono text-xs font-bold bg-[#1E3A2B]/60 hover:bg-[#1E3A2B] text-[#F5F5F5] border border-[#1E3A2B] transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-40"
              title="Download all accumulated live game records as JSON"
            >
              {downloadedFormat === 'json' ? (
                <Check className="w-3 h-3 text-[#E7B93F]" />
              ) : (
                <FileJson className="w-3 h-3 text-[#E7B93F]" />
              )}
              JSON
            </button>
          </div>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-xl border font-mono text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              autoRefresh
                ? 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/30 shadow'
                : 'bg-[#06130F] text-[#8D9B95] border-[#1E3A2B]'
            }`}
            title="Automatically poll for completed results every 8 seconds"
          >
            <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-pulse' : ''}`} />
            Auto: {autoRefresh ? 'ON' : 'OFF'}
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

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/40 text-xs text-red-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => refreshRealResults(true)}
            className="underline font-bold text-red-300 hover:text-white"
          >
            Retry
          </button>
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
                Active Unsettled Round
              </span>
            </div>
            <div className="font-mono text-xl sm:text-2xl font-black text-[#F5F5F5] tracking-wider">
              {realSchedule?.currentIssue || 'Connecting to live schedule...'}
            </div>
            <div className="text-[11px] text-[#8D9B95] font-mono flex items-center gap-3">
              <span>Prev: <strong className="text-gray-300">{realSchedule?.previousIssue || '--'}</strong></span>
              <span>•</span>
              <span>Next: <strong className="text-gray-300">{realSchedule?.nextIssue || '--'}</strong></span>
              <span>•</span>
              <span>Last updated: <strong className="text-gray-300">{lastUpdatedDisplay}</strong></span>
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
            <h3 className="text-sm font-bold text-[#F5F5F5]">
              Completed Official Results ({realHistory.length} records shown)
            </h3>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="text-xs font-mono text-[#8D9B95] hidden sm:inline">
              Download All:
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

        {realHistory.length === 0 ? (
          <div className="p-12 text-center text-xs text-[#8D9B95] space-y-3">
            {isLoading ? (
              <div className="flex flex-col items-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-[#35B978]" />
                <span>Fetching official WinGo 30S history from live feed...</span>
              </div>
            ) : (
              <div className="space-y-2">
                <p>No real records loaded yet.</p>
                <button
                  onClick={() => refreshRealResults(true)}
                  className="px-4 py-2 rounded-xl bg-[#35B978] text-[#020806] font-bold"
                >
                  Fetch Now
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#1E3A2B] bg-[#06130F] text-[#8D9B95] font-mono uppercase text-[11px]">
                  <th className="py-3 px-4">Period / Issue</th>
                  <th className="py-3 px-4 text-center">Number</th>
                  <th className="py-3 px-4">Big / Small</th>
                  <th className="py-3 px-4">Color</th>
                  <th className="py-3 px-4 text-center">Premium</th>
                  <th className="py-3 px-4 text-center">Sum</th>
                  <th className="py-3 px-4 text-right">Data Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E3A2B]/40 font-mono">
                {realHistory.map((item, idx) => {
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
                      key={item.periodNumber}
                      className={`hover:bg-[#06130F]/60 transition-colors ${
                        idx === 0 ? 'bg-[#35B978]/5' : ''
                      }`}
                    >
                      {/* Period */}
                      <td className="py-3 px-4 font-bold text-[#F5F5F5]">
                        {item.periodNumber}
                        {idx === 0 && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] bg-[#35B978]/20 text-[#35B978] border border-[#35B978]/30 font-bold uppercase">
                            Latest Settled
                          </span>
                        )}
                      </td>

                      {/* Number */}
                      <td className="py-3 px-4 text-center">
                        <span className={`text-base font-black ${numColor}`}>
                          {item.winningNumber}
                        </span>
                      </td>

                      {/* Size */}
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
    </div>
  );
};
