import React, { useState } from 'react';
import { useResults } from '../context/ResultContext';
import { HistoryTable } from '../components/history/HistoryTable';
import { ResultChart } from '../components/history/ResultChart';
import { StrategySummary } from '../components/history/StrategySummary';
import { AlgorithmAnalyzer } from '../components/history/AlgorithmAnalyzer';
import { RealHistoryView } from '../components/history/RealHistoryView';
import { History, LineChart, Target, RefreshCw, Brain, Zap, Code2, X, Radio } from 'lucide-react';

export const GameHistory: React.FC = () => {
  const {
    results,
    activeGame,
    setActiveGame,
    refreshResults,
    isLoading,
    loadBigMumbaiSample,
    importRawCurlJson,
  } = useResults();

  const [activeTab, setActiveTab] = useState<'real' | 'history' | 'chart' | 'strategy' | 'analyzer'>('real');
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [rawJsonText, setRawJsonText] = useState<string>('');
  const [importing, setImporting] = useState<boolean>(false);

  const filteredResults = results.filter((r) => r.gameCode === activeGame.code);

  const handleImportSubmit = async () => {
    if (!rawJsonText.trim()) return;
    setImporting(true);
    const ok = await importRawCurlJson(rawJsonText);
    setImporting(false);
    if (ok) {
      setRawJsonText('');
      setIsImportModalOpen(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F5F5] tracking-tight">
            Game History
          </h1>
          <p className="text-sm text-[#8D9B95] mt-1">
            Historical draw sequence, trend visualizer, and pattern analysis for {activeGame.name}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#06130F] hover:bg-[#0E2E22] text-[#35B978] border border-[#35B978]/30 text-xs font-bold transition-all cursor-pointer shadow"
            title="Paste raw JSON from curl command to import live draws"
          >
            <Code2 className="w-3.5 h-3.5" />
            Import Curl JSON
          </button>

          <button
            onClick={loadBigMumbaiSample}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#E7B93F]/15 hover:bg-[#E7B93F]/25 text-[#E7B93F] border border-[#E7B93F]/30 text-xs font-bold transition-all cursor-pointer shadow"
            title="Sync the latest draws from your screen (...568 to ...577) into simulator"
          >
            <Zap className="w-3.5 h-3.5" />
            Sync Screen (...568–...577)
          </button>

          <button
            onClick={refreshResults}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#071A14] hover:bg-[#0E2E22] text-[#8D9B95] hover:text-[#F5F5F5] border border-[#1E3A2B] text-xs font-semibold transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh History
          </button>
        </div>
      </div>

      {/* Tabs navigation: [ Real History ] [ Simulator History ] [ Chart ] [ Follow Strategy ] [ Algorithm Analyzer ] */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-xl bg-[#071A14] border border-[#1E3A2B] w-fit">
        <button
          onClick={() => setActiveTab('real')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'real'
              ? 'bg-[#35B978] text-[#020806] shadow font-black'
              : 'text-[#8D9B95] hover:text-[#F5F5F5]'
          }`}
        >
          <Radio className={`w-3.5 h-3.5 ${activeTab === 'real' ? 'animate-pulse' : 'text-[#35B978]'}`} />
          Real History (Live Feed)
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'history'
              ? 'bg-[#E7B93F] text-[#020806] shadow'
              : 'text-[#8D9B95] hover:text-[#F5F5F5]'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          Simulator History
        </button>

        <button
          onClick={() => setActiveTab('chart')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'chart'
              ? 'bg-[#E7B93F] text-[#020806] shadow'
              : 'text-[#8D9B95] hover:text-[#F5F5F5]'
          }`}
        >
          <LineChart className="w-3.5 h-3.5" />
          Chart
        </button>

        <button
          onClick={() => setActiveTab('strategy')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'strategy'
              ? 'bg-[#E7B93F] text-[#020806] shadow'
              : 'text-[#8D9B95] hover:text-[#F5F5F5]'
          }`}
        >
          <Target className="w-3.5 h-3.5" />
          Follow Strategy
        </button>

        <button
          onClick={() => setActiveTab('analyzer')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'analyzer'
              ? 'bg-[#E7B93F] text-[#020806] shadow'
              : 'text-[#8D9B95] hover:text-[#F5F5F5]'
          }`}
        >
          <Brain className="w-3.5 h-3.5 text-[#35B978]" />
          Algorithm & Formula Analyzer
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'real' && (
        <RealHistoryView />
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-[#8D9B95]">
            <span>
              Displaying <strong className="text-[#F5F5F5]">{filteredResults.length}</strong> test records for{' '}
              <span className="text-[#E7B93F]">{activeGame.name}</span>
            </span>
          </div>
          <HistoryTable results={filteredResults} />
        </div>
      )}

      {activeTab === 'chart' && (
        <ResultChart
          results={results}
          activeGame={activeGame}
          onSelectGame={setActiveGame}
        />
      )}

      {activeTab === 'strategy' && (
        <StrategySummary results={filteredResults} />
      )}

      {activeTab === 'analyzer' && (
        <AlgorithmAnalyzer />
      )}

      {/* Import Curl JSON Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#071A14] border border-[#1E3A2B] rounded-2xl p-6 w-full max-w-xl shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#1E3A2B]">
              <div className="flex items-center gap-2">
                <Code2 className="w-5 h-5 text-[#35B978]" />
                <h3 className="text-base font-bold text-[#F5F5F5]">
                  Import Live Curl History JSON
                </h3>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-[#8D9B95] hover:text-[#F5F5F5] transition-colors p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-[#8D9B95] block">
                Paste JSON from your terminal command:
              </label>
              <div className="p-2.5 rounded-lg bg-[#020806] border border-[#1E3A2B] font-mono text-[11px] text-[#35B978] overflow-x-auto">
                curl -s &apos;https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json?ts=&apos;$(date +%s%3N)
              </div>
              <textarea
                value={rawJsonText}
                onChange={(e) => setRawJsonText(e.target.value)}
                placeholder='Paste raw JSON here (either full response with {"data": {"list": [...]}} or just the list array)...'
                rows={8}
                className="w-full p-3 rounded-xl bg-[#06130F] border border-[#1E3A2B] text-xs font-mono text-[#F5F5F5] placeholder-[#8D9B95]/50 focus:outline-none focus:border-[#35B978] resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setRawJsonText('');
                  setIsImportModalOpen(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#8D9B95] hover:text-[#F5F5F5] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImportSubmit}
                disabled={!rawJsonText.trim() || importing}
                className="px-5 py-2 rounded-xl bg-[#35B978] hover:bg-[#2fa368] disabled:opacity-40 text-[#020806] text-xs font-bold transition-all cursor-pointer shadow flex items-center gap-2"
              >
                {importing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Import Draws Into Simulator
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
