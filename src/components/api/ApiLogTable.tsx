import React, { useState, useEffect } from 'react';
import type { ApiLogEntry, HttpMethod } from '../../types/api';
import { ApiLogger } from '../../services/apiLogger';
import { LogDetailsModal } from './LogDetailsModal';
import { Trash2, Terminal, Filter } from 'lucide-react';

export const ApiLogTable: React.FC = () => {
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<ApiLogEntry | null>(null);
  const [filterMethod, setFilterMethod] = useState<string>('ALL');

  useEffect(() => {
    // Initial fetch
    setLogs(ApiLogger.getLogs());

    // Subscribe to live log updates
    const unsubscribe = ApiLogger.subscribe((updated) => {
      setLogs(updated);
    });

    return () => unsubscribe();
  }, []);

  const handleClear = () => {
    ApiLogger.clearLogs();
    setLogs([]);
  };

  const filteredLogs = logs.filter((l) => {
    if (filterMethod === 'ALL') return true;
    return l.method === filterMethod;
  });

  const getMethodBadge = (m: HttpMethod) => {
    switch (m) {
      case 'GET':
        return 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/30';
      case 'POST':
        return 'bg-[#E7B93F]/15 text-[#E7B93F] border-[#E7B93F]/30';
      case 'DELETE':
        return 'bg-[#F04444]/15 text-[#F04444] border-[#F04444]/30';
      default:
        return 'bg-gray-800 text-gray-300 border-gray-700';
    }
  };

  return (
    <div className="space-y-4">
      {/* Action and Filter toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-[#071A14] border border-[#1E3A2B] rounded-xl">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-[#8D9B95]">
            <Filter className="w-3.5 h-3.5 text-[#E7B93F]" />
            <span className="font-semibold uppercase tracking-wider">Method:</span>
          </div>
          <div className="flex items-center gap-1 bg-[#06130F] p-1 rounded-lg border border-[#1E3A2B]">
            {['ALL', 'GET', 'POST', 'DELETE'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setFilterMethod(m)}
                className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors cursor-pointer ${
                  filterMethod === m
                    ? 'bg-[#E7B93F] text-[#020806] font-bold shadow'
                    : 'text-[#8D9B95] hover:text-[#F5F5F5]'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-[#8D9B95] font-mono">
            {filteredLogs.length} events logged
          </span>
          <button
            type="button"
            onClick={handleClear}
            disabled={logs.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#06130F] hover:bg-[#F04444]/15 hover:text-[#F04444] text-[#8D9B95] border border-[#1E3A2B] text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear Logs
          </button>
        </div>
      </div>

      {/* Log Table */}
      {filteredLogs.length === 0 ? (
        <div className="py-20 text-center border border-dashed border-[#1E3A2B] rounded-2xl bg-[#06130F] p-8">
          <Terminal className="w-10 h-10 text-[#8D9B95] mx-auto mb-2 opacity-50" />
          <h4 className="text-sm font-semibold text-[#F5F5F5]">No API Logs Yet</h4>
          <p className="text-xs text-[#8D9B95] mt-1 max-w-sm mx-auto">
            Interact with the Result Generator, switch games, or use the API Console to generate live API traces.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#1E3A2B] bg-[#071A14]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#1E3A2B] bg-[#06130F] text-[11px] font-semibold tracking-wider uppercase text-[#8D9B95]">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Method</th>
                <th className="py-3 px-4">Endpoint</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Response Time</th>
                <th className="py-3 px-4">Environment</th>
                <th className="py-3 px-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E3A2B]/60 font-mono">
              {filteredLogs.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => setSelectedEntry(entry)}
                  className="hover:bg-[#0b251c] transition-colors cursor-pointer group"
                >
                  <td className="py-3 px-4 text-[#8D9B95] whitespace-nowrap">
                    {entry.timestamp}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${getMethodBadge(
                        entry.method
                      )}`}
                    >
                      {entry.method}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-semibold text-[#F5F5F5] group-hover:text-[#E7B93F] transition-colors">
                    {entry.endpoint}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold border ${
                        entry.status < 300
                          ? 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/30'
                          : 'bg-[#F04444]/15 text-[#F04444] border-[#F04444]/30'
                      }`}
                    >
                      {entry.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-[#8D9B95]">
                    {entry.responseTimeMs}ms
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-[#35B978] font-semibold">
                      {entry.environment}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-sans text-xs text-[#8D9B95] group-hover:text-[#E7B93F]">
                    Inspect →
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Inspect Dialog */}
      <LogDetailsModal
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />
    </div>
  );
};
