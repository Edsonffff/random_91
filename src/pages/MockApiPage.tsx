import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Terminal, Layers } from 'lucide-react';

export const MockApiPage: React.FC = () => {
  return (
    <div className="max-w-4xl space-y-8 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F5F5] tracking-tight">
          Mock API Documentation & Architecture
        </h1>
        <p className="text-sm text-[#8D9B95] mt-1">
          Technical specifications for the decoupled Lottery Result Provider service layer.
        </p>
      </div>

      {/* Overview Card */}
      <div className="bg-[#071A14] border border-[#1E3A2B] rounded-2xl p-6 lg:p-8 shadow-xl space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-[#1E3A2B]">
          <div className="p-2.5 rounded-xl bg-[#06130F] text-[#E7B93F] border border-[#1E3A2B]">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#F5F5F5]">
              Service Abstraction Architecture
            </h2>
            <span className="text-xs text-[#8D9B95]">src/services/resultApi.ts</span>
          </div>
        </div>

        <div className="text-xs text-[#8D9B95] space-y-3 leading-relaxed">
          <p>
            The Result Simulator enforces a strict isolation layer between user interface components and outcome generation. All actions route through the <code className="text-[#E7B93F]">ResultProvider</code> interface:
          </p>

          <pre className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] font-mono text-xs text-[#F5F5F5] overflow-x-auto">
{`interface ResultProvider {
  getCurrentPeriod(gameCode?: string): Promise<ResultPeriod>;
  getResults(gameCode?: string, limit?: number): Promise<TestResult[]>;
  createTestResult(input: CreateTestResultInput): Promise<TestResult>;
  deleteTestResult(id: string): Promise<boolean>;
  resetSeedData(): Promise<TestResult[]>;
}`}
          </pre>

          <p>
            The default runtime is <code className="text-[#35B978]">MockResultProvider</code> which stores simulated draw history safely in the browser's <code className="text-[#35B978]">localStorage</code> and calculates color/size deterministically to eliminate client discrepancies.
          </p>
        </div>

        {/* Security / Safety Rule */}
        <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-[#35B978] shrink-0 mt-0.5" />
          <div className="text-xs text-[#8D9B95]">
            <span className="font-bold text-[#F5F5F5] block">
              Security Compliance
            </span>
            <p className="mt-0.5">
              Production endpoints like <code className="text-[#E7B93F]">/merchant/api/set_merchant_custom_result.php</code> are deliberately prevented from accessing live money hosts.
            </p>
          </div>
        </div>

        <div className="pt-2 flex flex-wrap gap-4">
          <Link
            to="/api-console"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#E7B93F] hover:bg-[#f3c754] text-[#020806] font-bold text-xs shadow-md transition-colors cursor-pointer"
          >
            <Terminal className="w-4 h-4" />
            Launch Interactive API Console
          </Link>
          <Link
            to="/api-logs"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#06130F] hover:bg-[#0E2E22] text-[#8D9B95] hover:text-[#F5F5F5] border border-[#1E3A2B] text-xs font-semibold transition-colors cursor-pointer"
          >
            View Live API Logs
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
};
