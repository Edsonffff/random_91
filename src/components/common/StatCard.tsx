import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon?: React.ReactNode;
  badge?: string;
  highlight?: boolean;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  subValue,
  icon,
  badge,
  highlight = false,
}) => {
  return (
    <div
      className={`relative p-5 rounded-xl bg-[#071A14] border transition-all duration-200 ${
        highlight
          ? 'border-[#E7B93F]/40 shadow-[0_0_15px_-3px_rgba(231,185,63,0.12)]'
          : 'border-[#1E3A2B] hover:border-[#2b543e]'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold tracking-wider text-[#8D9B95] uppercase">
          {label}
        </span>
        {icon && (
          <div className="p-2 rounded-lg bg-[#06130F] text-[#E7B93F] border border-[#1E3A2B]/80">
            {icon}
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-2xl lg:text-3xl font-bold tracking-tight text-[#F5F5F5] font-mono">
          {value}
        </span>
        {badge && (
          <span className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded bg-[#35B978]/15 text-[#35B978] border border-[#35B978]/30">
            {badge}
          </span>
        )}
      </div>

      {subValue && (
        <p className="mt-2 text-xs text-[#8D9B95] truncate">
          {subValue}
        </p>
      )}
    </div>
  );
};
