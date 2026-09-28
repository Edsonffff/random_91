import React from 'react';
import { useResults } from '../context/ResultContext';
import { StatCard } from '../components/common/StatCard';
import { ResultTable } from '../components/results/ResultTable';
import { Link } from 'react-router-dom';
import { Database, Gamepad2, Calendar, Shield, Sparkles, ArrowRight } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const { results, activeGame, currentPeriod, isLoading, deleteResult } = useResults();

  // Show top 6 recent items on dashboard
  const recentResults = results.slice(0, 6);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Title & Subtitle */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F5F5] tracking-tight">
            Welcome to Result Simulator 👋
          </h1>
          <p className="text-sm text-[#8D9B95] mt-1">
            Test lottery-style result generation without affecting live games.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/simulator"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#E7B93F] hover:bg-[#f3c754] text-[#020806] font-bold text-xs shadow-lg transition-all cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            Open Simulator
          </Link>
          <Link
            to="/api-console"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#071A14] hover:bg-[#0E2E22] text-[#8D9B95] hover:text-[#F5F5F5] border border-[#1E3A2B] text-xs font-semibold transition-colors cursor-pointer"
          >
            API Console
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Four Statistic Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* 1. TEST RESULTS */}
        <StatCard
          label="TEST RESULTS"
          value={results.length}
          subValue="Locally persisted mock draws"
          icon={<Database className="w-5 h-5" />}
          highlight={true}
        />

        {/* 2. ACTIVE GAME */}
        <StatCard
          label="ACTIVE GAME"
          value={activeGame.name}
          subValue={`${activeGame.intervalSeconds}s rapid test interval`}
          icon={<Gamepad2 className="w-5 h-5" />}
        />

        {/* 3. CURRENT PERIOD */}
        <StatCard
          label="CURRENT PERIOD"
          value={currentPeriod.length > 10 ? `..${currentPeriod.slice(-7)}` : currentPeriod}
          subValue={currentPeriod}
          icon={<Calendar className="w-5 h-5" />}
        />

        {/* 4. ENVIRONMENT */}
        <StatCard
          label="ENVIRONMENT"
          value="TEST"
          badge="ISOLATED"
          subValue="Mock provider sandbox active"
          icon={<Shield className="w-5 h-5" />}
        />
      </div>

      {/* Recent Test Results Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold tracking-tight text-[#F5F5F5] uppercase">
              RECENT TEST RESULTS
            </h2>
            <p className="text-xs text-[#8D9B95]">
              Real-time sequence of simulated draws for {activeGame.name}
            </p>
          </div>

          <Link
            to="/history"
            className="text-xs font-semibold text-[#E7B93F] hover:text-[#f3c754] flex items-center gap-1 transition-colors"
          >
            Full Game History →
          </Link>
        </div>

        <ResultTable
          results={recentResults}
          isLoading={isLoading}
          onDelete={deleteResult}
        />
      </div>
    </div>
  );
};
