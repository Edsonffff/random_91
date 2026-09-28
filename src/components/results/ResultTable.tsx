import React from 'react';
import type { TestResult } from '../../types/result';
import { ColorBadge } from '../common/ColorBadge';
import { SizeBadge } from '../common/SizeBadge';
import { formatRelativeTime } from '../../utils/formatters';
import { Trash2, Inbox } from 'lucide-react';

interface ResultTableProps {
  results: TestResult[];
  isLoading?: boolean;
  onDelete?: (id: string) => void;
  compact?: boolean;
}

export const ResultTable: React.FC<ResultTableProps> = ({
  results,
  isLoading = false,
  onDelete,
}) => {
  if (isLoading) {
    return (
      <div className="py-16 text-center">
        <div className="inline-block w-8 h-8 border-2 border-[#1E3A2B] border-t-[#E7B93F] rounded-full animate-spin mb-3" />
        <p className="text-xs text-[#8D9B95]">Loading test results...</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="py-16 text-center border border-dashed border-[#1E3A2B] rounded-2xl p-8 bg-[#06130F]">
        <Inbox className="w-10 h-10 text-[#8D9B95] mx-auto mb-2 opacity-50" />
        <h4 className="text-sm font-semibold text-[#F5F5F5]">No test results available</h4>
        <p className="text-xs text-[#8D9B95] mt-1 max-w-sm mx-auto">
          Generate results using the Result Simulator to populate test records.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#1E3A2B] bg-[#071A14]">
      <table className="w-full text-left border-collapse text-sm">
        <thead>
          <tr className="border-b border-[#1E3A2B] bg-[#06130F] text-[11px] font-semibold tracking-wider uppercase text-[#8D9B95]">
            <th className="py-3 px-4">Period</th>
            <th className="py-3 px-4 text-center">Number</th>
            <th className="py-3 px-4">Big/Small</th>
            <th className="py-3 px-4">Color</th>
            <th className="py-3 px-4">Created</th>
            <th className="py-3 px-4">Status</th>
            {onDelete && <th className="py-3 px-4 text-right">Action</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1E3A2B]/60 font-mono text-xs">
          {results.map((res) => {
            const numColorClass =
              res.winningNumber === 0
                ? 'text-[#F04444]'
                : res.winningNumber === 5
                ? 'text-[#35B978]'
                : res.winningNumber % 2 === 0
                ? 'text-[#F04444]'
                : 'text-[#35B978]';

            return (
              <tr
                key={res.id}
                className="hover:bg-[#0b251c]/60 transition-colors group"
              >
                {/* Period */}
                <td className="py-3 px-4 font-semibold text-[#F5F5F5]">
                  {res.periodNumber}
                  {res.replaced && (
                    <span className="ml-2 text-[10px] text-[#E7B93F] bg-[#E7B93F]/10 px-1.5 py-0.5 rounded border border-[#E7B93F]/30 font-sans">
                      REPLACED
                    </span>
                  )}
                </td>

                {/* Number */}
                <td className="py-3 px-4 text-center">
                  <span
                    className={`inline-flex items-center justify-center w-7 h-7 rounded-lg font-bold text-sm bg-[#06130F] border border-[#1E3A2B] ${numColorClass}`}
                  >
                    {res.winningNumber}
                  </span>
                </td>

                {/* Big / Small */}
                <td className="py-3 px-4 font-sans">
                  <SizeBadge size={res.size} />
                </td>

                {/* Color */}
                <td className="py-3 px-4 font-sans">
                  <ColorBadge colors={res.colors} size="sm" showText={true} />
                </td>

                {/* Created */}
                <td className="py-3 px-4 text-[#8D9B95] font-sans whitespace-nowrap">
                  {formatRelativeTime(res.createdAt)}
                </td>

                {/* Status */}
                <td className="py-3 px-4 font-sans">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-[#35B978]/15 text-[#35B978] border border-[#35B978]/30">
                    {res.status}
                  </span>
                </td>

                {/* Action */}
                {onDelete && (
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => onDelete(res.id)}
                      className="p-1.5 rounded-lg text-[#8D9B95] hover:text-[#F04444] hover:bg-[#F04444]/10 transition-colors opacity-70 group-hover:opacity-100 cursor-pointer"
                      title="Delete test result"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
