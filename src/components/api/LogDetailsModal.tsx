import React, { useState } from 'react';
import type { ApiLogEntry } from '../../types/api';
import { X, Copy, Check, Terminal } from 'lucide-react';

interface LogDetailsModalProps {
  entry: ApiLogEntry | null;
  onClose: () => void;
}

export const LogDetailsModal: React.FC<LogDetailsModalProps> = ({ entry, onClose }) => {
  const [copiedSection, setCopiedSection] = useState<'req' | 'res' | null>(null);

  if (!entry) return null;

  const copy = (content: unknown, section: 'req' | 'res') => {
    navigator.clipboard.writeText(JSON.stringify(content, null, 2));
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-[#071A14] border border-[#1E3A2B] rounded-2xl shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#1E3A2B]">
          <div className="flex items-center gap-3">
            <span
              className={`text-xs font-mono font-bold px-2 py-0.5 rounded border uppercase ${
                entry.method === 'GET'
                  ? 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/30'
                  : entry.method === 'POST'
                  ? 'bg-[#E7B93F]/15 text-[#E7B93F] border-[#E7B93F]/30'
                  : 'bg-[#F04444]/15 text-[#F04444] border-[#F04444]/30'
              }`}
            >
              {entry.method}
            </span>
            <span className="font-mono text-xs font-bold text-[#F5F5F5] truncate">
              {entry.endpoint}
            </span>
            <span
              className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${
                entry.status < 300
                  ? 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/30'
                  : 'bg-[#F04444]/15 text-[#F04444] border-[#F04444]/30'
              }`}
            >
              {entry.status}
            </span>
          </div>

          <button
            onClick={onClose}
            className="text-[#8D9B95] hover:text-[#F5F5F5] p-1 rounded cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Metadata sub-bar */}
        <div className="py-2.5 flex items-center gap-4 text-xs font-mono text-[#8D9B95] border-b border-[#1E3A2B]/60">
          <span>Time: <strong className="text-[#F5F5F5]">{entry.timestamp}</strong></span>
          <span>Latency: <strong className="text-[#E7B93F]">{entry.responseTimeMs}ms</strong></span>
          <span>Env: <strong className="text-[#35B978]">{entry.environment}</strong></span>
        </div>

        {/* Bodies */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {/* Request Payload */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#8D9B95] uppercase tracking-wider flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#E7B93F]" />
                REQUEST
              </span>
              <button
                type="button"
                onClick={() => copy(entry.requestPayload || {}, 'req')}
                className="inline-flex items-center gap-1 text-[11px] text-[#8D9B95] hover:text-[#F5F5F5] transition-colors cursor-pointer"
              >
                {copiedSection === 'req' ? <Check className="w-3 h-3 text-[#35B978]" /> : <Copy className="w-3 h-3" />}
                <span>{copiedSection === 'req' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B] font-mono text-xs text-[#F5F5F5] overflow-x-auto">
              {entry.requestPayload
                ? JSON.stringify(entry.requestPayload, null, 2)
                : '// No request body'}
            </pre>
          </div>

          {/* Response Payload */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#8D9B95] uppercase tracking-wider flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#35B978]" />
                RESPONSE
              </span>
              <button
                type="button"
                onClick={() => copy(entry.responsePayload || {}, 'res')}
                className="inline-flex items-center gap-1 text-[11px] text-[#8D9B95] hover:text-[#F5F5F5] transition-colors cursor-pointer"
              >
                {copiedSection === 'res' ? <Check className="w-3 h-3 text-[#35B978]" /> : <Copy className="w-3 h-3" />}
                <span>{copiedSection === 'res' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B] font-mono text-xs text-emerald-400 overflow-x-auto">
              {entry.responsePayload
                ? JSON.stringify(entry.responsePayload, null, 2)
                : '// No response body'}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-[#1E3A2B] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-[#F5F5F5] bg-[#06130F] hover:bg-[#0E2E22] border border-[#1E3A2B] rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
