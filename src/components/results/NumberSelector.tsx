import React from 'react';
import { calculateResult } from '../../utils/resultRules';

interface NumberSelectorProps {
  selectedNumber: number | null;
  onSelectNumber: (num: number) => void;
  disabled?: boolean;
}

export const NumberSelector: React.FC<NumberSelectorProps> = ({
  selectedNumber,
  onSelectNumber,
  disabled = false,
}) => {
  const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <label className="font-semibold text-[#8D9B95] uppercase tracking-wider">
          Winning Number (0–9)
        </label>
        <span className="text-[#8D9B95] text-[11px]">Select a single digit</span>
      </div>

      <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
        {digits.map((num) => {
          const outcome = calculateResult(num);
          const isSelected = selectedNumber === num;

          return (
            <button
              key={num}
              type="button"
              disabled={disabled}
              onClick={() => onSelectNumber(num)}
              className={`relative group flex flex-col items-center justify-center p-3 rounded-xl border transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isSelected
                  ? 'bg-[#0E2E22] border-[#E7B93F] shadow-[0_0_15px_-2px_rgba(231,185,63,0.3)] ring-1 ring-[#E7B93F]'
                  : 'bg-[#06130F] border-[#1E3A2B] hover:border-[#35B978]/60 hover:bg-[#071A14]'
              }`}
            >
              {/* Digit display */}
              <span
                className={`text-xl sm:text-2xl font-bold font-mono transition-transform duration-200 group-hover:scale-110 ${
                  isSelected ? 'text-[#E7B93F]' : 'text-[#F5F5F5]'
                }`}
              >
                {num}
              </span>

              {/* Color dots indicators below digit */}
              <div className="flex items-center gap-1 mt-1.5">
                {outcome.colors.map((c, i) => (
                  <span
                    key={i}
                    className={`w-2 h-2 rounded-full ring-1 ring-white/10 ${
                      c === 'red'
                        ? 'bg-[#F04444]'
                        : c === 'green'
                        ? 'bg-[#35B978]'
                        : 'bg-[#C94DDA]'
                    }`}
                  />
                ))}
              </div>

              {/* Badge for size */}
              <span className="text-[10px] text-[#8D9B95] mt-1 font-mono">
                {outcome.size === 'Big' ? 'B' : 'S'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
