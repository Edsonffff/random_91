import React, { useState, useMemo } from 'react';
import type { TestResult, GameOption } from '../../types/result';
import { SUPPORTED_GAMES } from '../../types/result';
import { ColorBadge } from '../common/ColorBadge';
import { SizeBadge } from '../common/SizeBadge';
import { BarChart3, LineChart as LineChartIcon } from 'lucide-react';

interface ResultChartProps {
  results: TestResult[];
  activeGame: GameOption;
  onSelectGame: (game: GameOption) => void;
}

export const ResultChart: React.FC<ResultChartProps> = ({
  results,
  activeGame,
  onSelectGame,
}) => {
  const [limit, setLimit] = useState<number>(10);
  const [chartType, setChartType] = useState<'line' | 'bar'>('line');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Filter and prepare chart data (chronological order from left to right)
  const chartData = useMemo(() => {
    const filtered = results.filter((r) => r.gameCode === activeGame.code);
    const sliced = filtered.slice(0, limit);
    // Reverse so earliest is on left, latest is on right
    return [...sliced].reverse();
  }, [results, activeGame.code, limit]);

  // SVG Chart dimensions
  const svgWidth = 800;
  const svgHeight = 280;
  const padding = { top: 30, right: 30, bottom: 40, left: 45 };

  const chartWidth = svgWidth - padding.left - padding.right;
  const chartHeight = svgHeight - padding.top - padding.bottom;

  // Calculate points
  const points = useMemo(() => {
    if (chartData.length === 0) return [];
    const stepX = chartData.length > 1 ? chartWidth / (chartData.length - 1) : chartWidth / 2;

    return chartData.map((item, index) => {
      const x = chartData.length > 1 ? padding.left + index * stepX : padding.left + chartWidth / 2;
      const y = padding.top + chartHeight - (item.winningNumber / 9) * chartHeight;
      return { x, y, item, index };
    });
  }, [chartData, chartWidth, chartHeight, padding.left, padding.top]);

  // SVG line path
  const linePath = useMemo(() => {
    if (points.length < 2) return '';
    return points.reduce((acc, curr, idx) => {
      return idx === 0 ? `M ${curr.x} ${curr.y}` : `${acc} L ${curr.x} ${curr.y}`;
    }, '');
  }, [points]);

  const yTicks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  return (
    <div className="bg-[#071A14] border border-[#1E3A2B] rounded-2xl p-6 shadow-xl space-y-6">
      {/* Top Controls & Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#1E3A2B]">
        <div className="flex flex-wrap items-center gap-3">
          {/* Game selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#8D9B95]">
              Game:
            </span>
            <select
              value={activeGame.code}
              onChange={(e) => {
                const found = SUPPORTED_GAMES.find((g) => g.code === e.target.value);
                if (found) onSelectGame(found);
              }}
              className="bg-[#06130F] border border-[#1E3A2B] rounded-lg px-3 py-1.5 text-xs text-[#F5F5F5] font-medium focus:outline-none focus:border-[#E7B93F]"
            >
              {SUPPORTED_GAMES.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Results count limit */}
          <div className="flex items-center gap-1.5 bg-[#06130F] p-1 rounded-lg border border-[#1E3A2B]">
            {[10, 25, 50].map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => setLimit(count)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                  limit === count
                    ? 'bg-[#E7B93F] text-[#020806] font-bold shadow'
                    : 'text-[#8D9B95] hover:text-[#F5F5F5]'
                }`}
              >
                Last {count}
              </button>
            ))}
          </div>
        </div>

        {/* Chart type toggle */}
        <div className="flex items-center gap-1 bg-[#06130F] p-1 rounded-lg border border-[#1E3A2B]">
          <button
            type="button"
            onClick={() => setChartType('line')}
            className={`p-1.5 rounded transition-colors cursor-pointer ${
              chartType === 'line'
                ? 'bg-[#1E3A2B] text-[#E7B93F]'
                : 'text-[#8D9B95] hover:text-[#F5F5F5]'
            }`}
            title="Line View"
          >
            <LineChartIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setChartType('bar')}
            className={`p-1.5 rounded transition-colors cursor-pointer ${
              chartType === 'bar'
                ? 'bg-[#1E3A2B] text-[#E7B93F]'
                : 'text-[#8D9B95] hover:text-[#F5F5F5]'
            }`}
            title="Bar View"
          >
            <BarChart3 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* SVG Chart Area */}
      {chartData.length === 0 ? (
        <div className="py-20 text-center text-xs text-[#8D9B95]">
          No historical test records available to plot.
        </div>
      ) : (
        <div className="relative w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-auto min-w-[600px] select-none"
          >
            {/* Horizontal Grid lines and Y axis numbers (0-9) */}
            {yTicks.map((tick) => {
              const y = padding.top + chartHeight - (tick / 9) * chartHeight;
              const isThreshold = tick === 4;

              return (
                <g key={tick}>
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={svgWidth - padding.right}
                    y2={y}
                    stroke={isThreshold ? 'rgba(231, 185, 63, 0.3)' : 'rgba(30, 58, 43, 0.5)'}
                    strokeDasharray={isThreshold ? '4 4' : '2 2'}
                  />
                  <text
                    x={padding.left - 12}
                    y={y + 4}
                    fill="#8D9B95"
                    fontSize="11"
                    fontFamily="monospace"
                    textAnchor="end"
                  >
                    {tick}
                  </text>
                </g>
              );
            })}

            {/* Threshold dividing label */}
            <text
              x={svgWidth - padding.right}
              y={padding.top + chartHeight - (4.5 / 9) * chartHeight}
              fill="#E7B93F"
              fontSize="9"
              fontFamily="sans-serif"
              textAnchor="end"
              opacity="0.6"
            >
              BIG / SMALL DIVIDER (4 | 5)
            </text>

            {/* Plot: Line or Bar */}
            {chartType === 'line' && (
              <>
                {points.length > 1 && (
                  <path
                    d={`${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`}
                    fill="url(#goldGradient)"
                    opacity="0.15"
                  />
                )}
                <path
                  d={linePath}
                  fill="none"
                  stroke="#E7B93F"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            )}

            {chartType === 'bar' &&
              points.map((p) => {
                const barHeight = ((p.item.winningNumber + 0.3) / 9.3) * chartHeight;
                const barWidth = Math.max(12, Math.min(30, chartWidth / points.length - 8));
                const barColor =
                  p.item.winningNumber === 0
                    ? '#F04444'
                    : p.item.winningNumber === 5
                    ? '#35B978'
                    : p.item.winningNumber % 2 === 0
                    ? '#F04444'
                    : '#35B978';

                return (
                  <rect
                    key={`bar-${p.index}`}
                    x={p.x - barWidth / 2}
                    y={padding.top + chartHeight - barHeight}
                    width={barWidth}
                    height={barHeight}
                    rx="4"
                    fill={barColor}
                    opacity={hoveredIndex === p.index ? 1 : 0.8}
                    className="transition-opacity cursor-pointer"
                    onMouseEnter={() => setHoveredIndex(p.index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  />
                );
              })}

            {/* Dot markers on top of line */}
            {points.map((p) => {
              const isHovered = hoveredIndex === p.index;
              const dotColor =
                p.item.winningNumber === 0
                  ? '#F04444'
                  : p.item.winningNumber === 5
                  ? '#35B978'
                  : p.item.winningNumber % 2 === 0
                  ? '#F04444'
                  : '#35B978';

              return (
                <g key={`point-${p.index}`}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isHovered ? 7 : 5}
                    fill={dotColor}
                    stroke="#020806"
                    strokeWidth="2"
                    className="cursor-pointer transition-all duration-150"
                    onMouseEnter={() => setHoveredIndex(p.index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  />
                  <text
                    x={p.x}
                    y={svgHeight - 12}
                    fill={isHovered ? '#E7B93F' : '#8D9B95'}
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    ..{p.item.periodNumber.slice(-3)}
                  </text>
                </g>
              );
            })}

            {/* Gradient definition */}
            <defs>
              <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#E7B93F" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#E7B93F" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>

          {/* Interactive Hover Tooltip card below or floating */}
          {hoveredIndex !== null && points[hoveredIndex] && (
            <div className="mt-3 p-3 bg-[#06130F] border border-[#E7B93F]/40 rounded-xl flex items-center justify-between gap-4 animate-in fade-in duration-150 text-xs">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[#8D9B95]">
                  Period: <strong className="text-[#F5F5F5]">{points[hoveredIndex].item.periodNumber}</strong>
                </span>
                <span className="text-[#1E3A2B]">|</span>
                <span className="font-mono text-[#8D9B95]">
                  Winning Number:{' '}
                  <strong className="text-[#E7B93F] text-sm">
                    {points[hoveredIndex].item.winningNumber}
                  </strong>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <SizeBadge size={points[hoveredIndex].item.size} />
                <ColorBadge colors={points[hoveredIndex].item.colors} size="sm" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
