import React, { useState } from 'react';

export interface CollapsibleCardProps {
  id: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  headerRight?: React.ReactNode;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  variant?: 'card' | 'subcard';
}

export const CollapsibleCard: React.FC<CollapsibleCardProps> = ({
  id,
  title,
  subtitle,
  headerRight,
  defaultExpanded = true,
  children,
  className = '',
  headerClassName = '',
  bodyClassName = 'p-5 sm:p-6 space-y-5',
  variant = 'card',
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    try {
      const stored = sessionStorage.getItem(`collapse_sec_${id}`);
      if (stored !== null) {
        return stored === 'true';
      }
    } catch {
      // sessionStorage not available
    }
    return defaultExpanded;
  });

  const toggle = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(`collapse_sec_${id}`, String(next));
      } catch {
        // sessionStorage not available
      }
      return next;
    });
  };

  const isSubcard = variant === 'subcard';

  return (
    <div
      className={`${
        isSubcard
          ? 'rounded-xl bg-[#06130F] border border-[#1E3A2B]'
          : 'rounded-2xl bg-[#071A14] border border-[#1E3A2B] shadow-xl'
      } overflow-hidden transition-colors ${className}`}
    >
      {/* Header with triangle arrow button */}
      <div
        className={`p-4 ${isSubcard ? 'sm:p-4' : 'sm:p-5'} flex flex-wrap items-center justify-between gap-3 ${
          isExpanded ? 'border-b border-[#1E3A2B]' : ''
        } ${headerClassName}`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {/* Small unobtrusive triangle arrow button */}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isExpanded}
            className="w-6 h-6 flex items-center justify-center rounded text-[#8D9B95] hover:text-[#E7B93F] hover:bg-[#1E3A2B]/50 transition-colors cursor-pointer select-none shrink-0"
            title={isExpanded ? 'Collapse section' : 'Expand section'}
          >
            <span className="text-[10px] sm:text-[11px] font-sans inline-block select-none">
              {isExpanded ? '▼' : '▶'}
            </span>
          </button>

          <div
            className="cursor-pointer select-none min-w-0 flex-1"
            onClick={toggle}
          >
            <div className="flex flex-wrap items-center gap-2">
              {title}
            </div>
            {subtitle && (
              <div className="text-xs text-[#8D9B95] mt-0.5 truncate">
                {subtitle}
              </div>
            )}
          </div>
        </div>

        {headerRight && (
          <div className="flex items-center gap-2 shrink-0">
            {headerRight}
          </div>
        )}
      </div>

      {/* Collapsible Content with smooth CSS Grid height transition */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
          isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className={bodyClassName}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
