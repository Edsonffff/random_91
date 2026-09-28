import React from 'react';
import type { ResultSize } from '../../types/result';

interface SizeBadgeProps {
  size: ResultSize;
  variant?: 'pill' | 'tag' | 'bold';
}

export const SizeBadge: React.FC<SizeBadgeProps> = ({ size, variant = 'pill' }) => {
  const isBig = size === 'Big';

  if (variant === 'bold') {
    return (
      <span
        className={`px-3 py-1 rounded text-xs font-bold uppercase tracking-wider ${
          isBig
            ? 'bg-[#E7B93F]/15 text-[#E7B93F] border border-[#E7B93F]/30'
            : 'bg-[#35B978]/15 text-[#35B978] border border-[#35B978]/30'
        }`}
      >
        {size}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
        isBig
          ? 'bg-[#E7B93F]/10 text-[#E7B93F] border-[#E7B93F]/30'
          : 'bg-[#8D9B95]/10 text-[#F5F5F5] border-[#1E3A2B]'
      }`}
    >
      {size}
    </span>
  );
};
