import React from 'react';
import { ResultGenerator } from '../components/results/ResultGenerator';
import { ResultTable } from '../components/results/ResultTable';
import { useResults } from '../context/ResultContext';

export const ResultSimulator: React.FC = () => {
  const { results, isLoading, deleteResult, activeGame } = useResults();

  // Filter results for active game, top 5
  const activeGameResults = results.filter((r) => r.gameCode === activeGame.code).slice(0, 5);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Title & Subtitle */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F5F5] tracking-tight">
          Result Simulator
        </h1>
        <p className="text-sm text-[#8D9B95] mt-1">
          Generate deterministic test results and preview how they appear in the game history.
        </p>
      </div>

      {/* Main Generator Card */}
      <ResultGenerator />

      {/* Recent Activity for Active Game */}
      <div className="space-y-4 pt-4 border-t border-[#1E3A2B]/60">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight text-[#F5F5F5] uppercase">
            RECENT DRAWS — {activeGame.name}
          </h2>
          <span className="text-xs font-mono text-[#8D9B95]">
            Showing latest 5 entries
          </span>
        </div>

        <ResultTable
          results={activeGameResults}
          isLoading={isLoading}
          onDelete={deleteResult}
        />
      </div>
    </div>
  );
};
