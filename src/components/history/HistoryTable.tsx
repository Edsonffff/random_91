import React from 'react';
import type { TestResult } from '../../types/result';
import { SizeBadge } from '../common/SizeBadge';

interface HistoryTableProps {
  results: TestResult[];
}

export const HistoryTable: React.FC<HistoryTableProps> = ({ results }) => {
  return (
    <div className="overflow-hidden rounded-xl border border-[#1E3A2B] bg-[#071A14]">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#1E3A2B] bg-[#06130F] text-xs font-semibold tracking-wider text-[#8D9B95]">
              <th className="py-3 px-5">Period</th>
              <th className="py-3 px-5 text-center">Number</th>
              <th className="py-3 px-5">Big Small</th>
              <th className="py-3 px-5">Color</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1E3A2B]/50 font-mono text-sm">
            {results.map((item) => {
              const isZero = item.winningNumber === 0;
              const isFive = item.winningNumber === 5;
              const isEven = item.winningNumber % 2 === 0;

              return (
                <tr
                  key={item.id}
                  className="hover:bg-[#0b251c]/60 transition-colors"
                >
                  {/* Period */}
                  <td className="py-3.5 px-5 font-semibold text-[#F5F5F5] whitespace-nowrap">
                    {item.periodNumber}
                  </td>

                  {/* Number circular styling */}
                  <td className="py-3.5 px-5 text-center">
                    <div className="inline-flex items-center justify-center">
                      {isZero ? (
                        /* Dual half split Red/Violet circle for 0 */
                        <div className="relative w-8 h-8 rounded-full overflow-hidden flex items-center justify-center border border-white/20 shadow-[0_0_10px_rgba(240,68,68,0.4)]">
                          <div className="absolute inset-0 bg-gradient-to-r from-[#F04444] from-50% to-[#C94DDA] to-50%" />
                          <span className="relative z-10 text-white font-bold text-sm">
                            0
                          </span>
                        </div>
                      ) : isFive ? (
                        /* Dual half split Green/Violet circle for 5 */
                        <div className="relative w-8 h-8 rounded-full overflow-hidden flex items-center justify-center border border-white/20 shadow-[0_0_10px_rgba(53,185,120,0.4)]">
                          <div className="absolute inset-0 bg-gradient-to-r from-[#35B978] from-50% to-[#C94DDA] to-50%" />
                          <span className="relative z-10 text-white font-bold text-sm">
                            5
                          </span>
                        </div>
                      ) : isEven ? (
                        /* Solid Red circle */
                        <div className="w-8 h-8 rounded-full bg-[#F04444] text-white font-bold text-sm flex items-center justify-center shadow-[0_0_10px_rgba(240,68,68,0.4)]">
                          {item.winningNumber}
                        </div>
                      ) : (
                        /* Solid Green circle */
                        <div className="w-8 h-8 rounded-full bg-[#35B978] text-white font-bold text-sm flex items-center justify-center shadow-[0_0_10px_rgba(53,185,120,0.4)]">
                          {item.winningNumber}
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Big / Small */}
                  <td className="py-3.5 px-5 font-sans">
                    <SizeBadge size={item.size} />
                  </td>

                  {/* Color Indicators with dots & text */}
                  <td className="py-3.5 px-5 font-sans">
                    <div className="flex items-center gap-2">
                      {item.colors.map((c, i) => (
                        <div key={i} className="inline-flex items-center gap-1.5 text-xs font-medium">
                          <span
                            className={`w-2.5 h-2.5 rounded-full ring-1 ring-white/10 ${
                              c === 'red'
                                ? 'bg-[#F04444] shadow-[0_0_6px_rgba(240,68,68,0.6)]'
                                : c === 'green'
                                ? 'bg-[#35B978] shadow-[0_0_6px_rgba(53,185,120,0.6)]'
                                : 'bg-[#C94DDA] shadow-[0_0_6px_rgba(201,77,218,0.6)]'
                            }`}
                          />
                          <span
                            className={
                              c === 'red'
                                ? 'text-[#F04444]'
                                : c === 'green'
                                ? 'text-[#35B978]'
                                : 'text-[#C94DDA]'
                            }
                          >
                            {c.charAt(0).toUpperCase() + c.slice(1)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
