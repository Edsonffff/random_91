import React from 'react';
import { useResults } from '../context/ResultContext';
import { useTestMaxLossStreaks } from '../hooks/useTestMaxLossStreaks';
import { StatCard } from '../components/common/StatCard';
import { ResultTable } from '../components/results/ResultTable';
import { Link } from 'react-router-dom';
import { Database, Gamepad2, Calendar, Shield, Sparkles, ArrowRight, Flame } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const { results, activeGame, currentPeriod, isLoading, deleteResult } = useResults();
  const { t3, t7, t9 } = useTestMaxLossStreaks();

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

      {/* Maximum Loss Streak Section (Independent Tests T3, T7, T9) */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold tracking-tight text-[#F5F5F5] uppercase flex items-center gap-2">
              <Flame className="w-4 h-4 text-[#F04444]" />
              INDEPENDENT TEST MAXIMUM LOSS STREAKS
            </h2>
            <p className="text-xs text-[#8D9B95] mt-0.5">
              Longest consecutive loss sequence calculated independently for each test.
            </p>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-lg bg-[#071A14] border border-[#1E3A2B] text-[#35B978]">
            T3 · T7 · T9 Independent
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* T3 Card */}
          <div className="p-4 rounded-xl bg-[#071A14] border border-[#1E3A2B] space-y-3 shadow">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-[#E7B93F]/15 text-[#E7B93F] border border-[#E7B93F]/30">
                T3
              </span>
              <span className="text-[11px] font-mono text-[#8D9B95]">14-Round Repeating</span>
            </div>
            <div>
              <div className="text-xs text-[#8D9B95] font-medium">T3 Max Loss Streak</div>
              <div className="text-2xl font-black font-mono text-[#F04444] mt-0.5">
                {t3.maxLossStreak}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs font-mono text-[#8D9B95] pt-2 border-t border-[#1E3A2B]/60">
              <span>Current: <strong className="text-[#F5F5F5]">{t3.currentLossStreak}</strong> L</span>
              <span>{t3.totalEvaluated} draws evaluated</span>
            </div>
          </div>

          {/* T7 Card */}
          <div className="p-4 rounded-xl bg-[#071A14] border border-[#1E3A2B] space-y-3 shadow">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-[#35B978]/15 text-[#35B978] border border-[#35B978]/30">
                T7
              </span>
              <span className="text-[11px] font-mono text-[#8D9B95]">External Signal</span>
            </div>
            <div>
              <div className="text-xs text-[#8D9B95] font-medium">T7 Max Loss Streak</div>
              <div className="text-2xl font-black font-mono text-[#F04444] mt-0.5">
                {t7.maxLossStreak}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs font-mono text-[#8D9B95] pt-2 border-t border-[#1E3A2B]/60">
              <span>Current: <strong className="text-[#F5F5F5]">{t7.currentLossStreak}</strong> L</span>
              <span>{t7.totalEvaluated} signals scored</span>
            </div>
          </div>

          {/* T9 Card */}
          <div className="p-4 rounded-xl bg-[#071A14] border border-[#1E3A2B] space-y-3 shadow">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-[#A78BFA]/15 text-[#A78BFA] border border-[#A78BFA]/30">
                T9
              </span>
              <span className="text-[11px] font-mono text-[#8D9B95]">CPL-3 Streak Breaker</span>
            </div>
            <div>
              <div className="text-xs text-[#8D9B95] font-medium">T9 Max Loss Streak</div>
              <div className="text-2xl font-black font-mono text-[#F04444] mt-0.5">
                {t9.maxLossStreak}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs font-mono text-[#8D9B95] pt-2 border-t border-[#1E3A2B]/60">
              <span>Current: <strong className="text-[#F5F5F5]">{t9.currentLossStreak}</strong> L</span>
              <span>{t9.totalEvaluated} draws evaluated</span>
            </div>
          </div>
        </div>
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
