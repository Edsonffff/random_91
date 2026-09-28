import React from 'react';
import type { ResultColor } from '../../types/result';

interface ColorBadgeProps {
  colors: ResultColor[];
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const ColorBadge: React.FC<ColorBadgeProps> = ({
  colors,
  showText = true,
  size = 'md',
}) => {
  const dotSizeClasses = {
    sm: 'w-2.5 h-2.5',
    md: 'w-3.5 h-3.5',
    lg: 'w-5 h-5',
  };

  const getColorBg = (c: ResultColor) => {
    switch (c) {
      case 'red':
        return 'bg-[#F04444] shadow-[0_0_8px_rgba(240,68,68,0.5)]';
      case 'green':
        return 'bg-[#35B978] shadow-[0_0_8px_rgba(53,185,120,0.5)]';
      case 'violet':
        return 'bg-[#C94DDA] shadow-[0_0_8px_rgba(201,77,218,0.5)]';
      default:
        return 'bg-gray-400';
    }
  };

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <div className="inline-flex items-center gap-1.5 flex-wrap">
      {colors.map((color, idx) => (
        <span key={`${color}-${idx}`} className="inline-flex items-center gap-1.5 text-xs font-medium">
          <span
            className={`rounded-full shrink-0 ${dotSizeClasses[size]} ${getColorBg(color)} ring-1 ring-white/10`}
          />
          {showText && (
            <span
              className={
                color === 'red'
                  ? 'text-[#F04444]'
                  : color === 'green'
                  ? 'text-[#35B978]'
                  : 'text-[#C94DDA]'
              }
            >
              {capitalize(color)}
            </span>
          )}
          {showText && idx < colors.length - 1 && (
            <span className="text-[#8D9B95] font-light">+</span>
          )}
        </span>
      ))}
    </div>
  );
};
