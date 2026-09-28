import React, { useState } from 'react';
import { useResults } from '../context/ResultContext';
import { useToast } from '../context/ToastContext';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { SUPPORTED_GAMES } from '../types/result';
import {
  Sliders,
  AlertTriangle,
  RotateCcw,
  Download,
} from 'lucide-react';

export const Configuration: React.FC = () => {
  const { activeGame, setActiveGame, resetToSeedData, results } = useResults();
  const { showToast } = useToast();

  const [mockApiEnabled, setMockApiEnabled] = useState<boolean>(true);
  const [autoGenPeriods, setAutoGenPeriods] = useState<boolean>(true);
  const [storeLocally, setStoreLocally] = useState<boolean>(true);
  const [confirmResetOpen, setConfirmResetOpen] = useState<boolean>(false);

  const handleExportJson = () => {
    try {
      const dataStr =
        'data:text/json;charset=utf-8,' +
        encodeURIComponent(JSON.stringify(results, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute(
        'download',
        `lottery_sim_results_${new Date().toISOString().slice(0, 10)}.json`
      );
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast('Exported test results JSON', 'success');
    } catch {
      showToast('Failed to export data', 'error');
    }
  };

  return (
    <div className="max-w-4xl space-y-8 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F5F5] tracking-tight">
          Configuration
        </h1>
        <p className="text-sm text-[#8D9B95] mt-1">
          Manage sandbox runtime settings, test parameters, and data persistence controls.
        </p>
      </div>

      {/* Mandatory Safety Notice from Section 16 */}
      <div className="p-4 rounded-xl bg-[#180909] border border-[#F04444]/40 flex items-start gap-3 shadow-lg">
        <AlertTriangle className="w-5 h-5 text-[#F04444] shrink-0 mt-0.5" />
        <div className="text-xs">
          <span className="font-bold text-[#F5F5F5] block uppercase tracking-wider">
            TEST MODE ONLY
          </span>
          <p className="text-[#8D9B95] mt-1 leading-relaxed">
            These results are simulated and are not sent to a live wagering system. All transactions, numbers, and payouts are purely synthetic and intended strictly for front-end interface verification.
          </p>
        </div>
      </div>

      {/* Main Settings Card */}
      <div className="bg-[#071A14] border border-[#1E3A2B] rounded-2xl p-6 lg:p-8 shadow-xl space-y-6">
        <div className="flex items-center gap-2 pb-4 border-b border-[#1E3A2B]">
          <Sliders className="w-4 h-4 text-[#E7B93F]" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#F5F5F5]">
            Environment & Game Settings
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Environment */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[#8D9B95] uppercase tracking-wider">
              Environment
            </label>
            <div className="w-full bg-[#06130F] border border-[#1E3A2B] rounded-xl px-4 py-2.5 text-sm font-mono text-[#E7B93F] font-bold flex items-center justify-between">
              <span>TEST</span>
              <span className="text-[10px] font-sans px-2 py-0.5 rounded bg-[#35B978]/15 text-[#35B978] border border-[#35B978]/30">
                SANDBOX LOCKED
              </span>
            </div>
          </div>

          {/* Active Game */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[#8D9B95] uppercase tracking-wider">
              Game
            </label>
            <select
              value={activeGame.code}
              onChange={(e) => {
                const found = SUPPORTED_GAMES.find((g) => g.code === e.target.value);
                if (found) setActiveGame(found);
              }}
              className="w-full bg-[#06130F] border border-[#1E3A2B] rounded-xl px-4 py-2.5 text-sm text-[#F5F5F5] font-medium focus:outline-none focus:border-[#E7B93F]"
            >
              {SUPPORTED_GAMES.map((game) => (
                <option key={game.code} value={game.code}>
                  {game.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Toggles */}
        <div className="pt-4 border-t border-[#1E3A2B] space-y-4">
          {/* Mock API toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
            <div>
              <span className="text-xs font-semibold text-[#F5F5F5] block">
                Mock API
              </span>
              <span className="text-[11px] text-[#8D9B95]">
                Interception layer provides zero-latency deterministic simulated responses
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setMockApiEnabled(!mockApiEnabled);
                showToast(
                  !mockApiEnabled ? 'Mock API Enabled' : 'Mock API cannot be disabled in test sandbox',
                  !mockApiEnabled ? 'success' : 'warning'
                );
              }}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold border transition-colors cursor-pointer ${
                mockApiEnabled
                  ? 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/30'
                  : 'bg-gray-800 text-gray-400 border-gray-700'
              }`}
            >
              {mockApiEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          {/* Auto-generate periods toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
            <div>
              <span className="text-xs font-semibold text-[#F5F5F5] block">
                Auto-generate periods
              </span>
              <span className="text-[11px] text-[#8D9B95]">
                Automatically suggest the next incremental period after each successful generation
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAutoGenPeriods(!autoGenPeriods)}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold border transition-colors cursor-pointer ${
                autoGenPeriods
                  ? 'bg-[#E7B93F]/15 text-[#E7B93F] border-[#E7B93F]/30'
                  : 'bg-gray-800 text-gray-400 border-gray-700'
              }`}
            >
              {autoGenPeriods ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Results stored locally toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
            <div>
              <span className="text-xs font-semibold text-[#F5F5F5] block">
                Results stored locally
              </span>
              <span className="text-[11px] text-[#8D9B95]">
                Persist results in browser LocalStorage across sessions
              </span>
            </div>
            <button
              type="button"
              onClick={() => setStoreLocally(!storeLocally)}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold border transition-colors cursor-pointer ${
                storeLocally
                  ? 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/30'
                  : 'bg-gray-800 text-gray-400 border-gray-700'
              }`}
            >
              {storeLocally ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* Database Management Utilities */}
        <div className="pt-4 border-t border-[#1E3A2B] space-y-3">
          <span className="text-xs font-bold text-[#8D9B95] uppercase tracking-wider block">
            Test Data Management
          </span>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setConfirmResetOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#06130F] hover:bg-[#F04444]/15 hover:text-[#F04444] text-[#8D9B95] border border-[#1E3A2B] text-xs font-semibold transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Reset to Default Seed Data (9 Records)
            </button>

            <button
              type="button"
              onClick={handleExportJson}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#06130F] hover:bg-[#0E2E22] text-[#8D9B95] hover:text-[#F5F5F5] border border-[#1E3A2B] text-xs font-semibold transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4 text-[#E7B93F]" />
              Export Test Records (.JSON)
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmDialog
        isOpen={confirmResetOpen}
        title="Reset Test Records to Seed State?"
        message="This will overwrite current test results in LocalStorage and restore the initial 9 seed entries defined in the test specification."
        confirmLabel="Reset to Seed Data"
        isDestructive={true}
        onConfirm={async () => {
          setConfirmResetOpen(false);
          await resetToSeedData();
        }}
        onCancel={() => setConfirmResetOpen(false)}
      />
    </div>
  );
};
