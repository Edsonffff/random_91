import React from 'react';
import type { CalculatedOutcome } from '../../types/result';
import { ColorBadge } from '../common/ColorBadge';
import { SizeBadge } from '../common/SizeBadge';
import { ShieldCheck, Sparkles } from 'lucide-react';

interface ResultPreviewProps {
  outcome: CalculatedOutcome | null;
  periodNumber: string;
  gameName: string;
}

export const ResultPreview: React.FC<ResultPreviewProps> = ({
  outcome,
  periodNumber,
  gameName,
}) => {
  return (
    <div className="relative flex flex-col justify-between p-6 rounded-2xl bg-[#071A14] border border-[#1E3A2B] overflow-hidden shadow-xl min-h-[360px]">
      {/* Background ambient lighting */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-[#E7B93F]/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-[#35B978]/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-[#1E3A2B]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#E7B93F]" />
          <h3 className="text-xs font-bold tracking-widest text-[#8D9B95] uppercase">
            Result Preview
          </h3>
        </div>
        <span className="text-xs font-mono text-[#8D9B95] px-2 py-0.5 rounded bg-[#06130F] border border-[#1E3A2B]">
          {gameName}
        </span>
      </div>

      {/* Center visual display */}
      <div className="my-6 flex flex-col items-center justify-center text-center">
        {outcome !== null ? (
          <div className="space-y-4 animate-in zoom-in-95 duration-200">
            {/* Big winning number display */}
            <div className="relative inline-flex items-center justify-center">
              <div className="w-24 h-24 rounded-2xl bg-[#06130F] border-2 border-[#E7B93F]/60 flex items-center justify-center shadow-[0_0_30px_rgba(231,185,63,0.15)]">
                <span className="text-6xl font-extrabold font-mono text-[#E7B93F] tracking-tight">
                  {outcome.number}
                </span>
              </div>
            </div>

            {/* Size Badge */}
            <div>
              <SizeBadge size={outcome.size} variant="bold" />
            </div>

            {/* Color Indicators */}
            <div className="pt-1">
              <ColorBadge colors={outcome.colors} size="md" showText={true} />
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-[#8D9B95]">
            <p className="text-sm">Select a winning number (0–9)</p>
            <p className="text-xs text-[#5e6f66] mt-1">
              Live calculation will preview here
            </p>
          </div>
        )}
      </div>

      {/* Footer metadata matching section 6 */}
      <div className="pt-4 border-t border-[#1E3A2B] grid grid-cols-2 gap-4 text-xs">
        <div>
          <span className="text-[#8D9B95] block text-[11px] uppercase tracking-wider">
            Period
          </span>
          <span className="font-mono font-medium text-[#F5F5F5] break-all">
            {periodNumber || '—'}
          </span>
        </div>

        <div className="text-right">
          <span className="text-[#8D9B95] block text-[11px] uppercase tracking-wider">
            Status
          </span>
          <span className="inline-flex items-center gap-1 font-semibold text-[#35B978]">
            <ShieldCheck className="w-3.5 h-3.5" />
            TEST RESULT
          </span>
        </div>
      </div>
    </div>
  );
};
