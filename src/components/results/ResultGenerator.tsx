import React, { useState, useEffect, useMemo } from 'react';
import { useResults } from '../../context/ResultContext';
import { calculateResult } from '../../utils/resultRules';
import { SUPPORTED_GAMES } from '../../types/result';
import { NumberSelector } from './NumberSelector';
import { ResultPreview } from './ResultPreview';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Sparkles, RefreshCw, AlertCircle, CheckCircle, RotateCcw } from 'lucide-react';

export const ResultGenerator: React.FC = () => {
  const {
    results,
    activeGame,
    setActiveGame,
    currentPeriod,
    generateResult,
    generateNextPeriod,
  } = useResults();

  const [periodInput, setPeriodInput] = useState<string>(currentPeriod);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(7); // Default to 7 like example
  const [allowReplace, setAllowReplace] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState<boolean>(false);

  // Sync initial period when currentPeriod updates from provider
  useEffect(() => {
    if (currentPeriod) {
      setPeriodInput(currentPeriod);
    }
  }, [currentPeriod]);

  // Check duplicate period
  const isDuplicatePeriod = useMemo(() => {
    if (!periodInput.trim()) return false;
    return results.some(
      (r) => r.gameCode === activeGame.code && r.periodNumber === periodInput.trim()
    );
  }, [results, activeGame.code, periodInput]);

  // Validation errors
  const errors = useMemo(() => {
    const errs: { period?: string; number?: string; duplicate?: string } = {};

    if (!periodInput.trim()) {
      errs.period = 'Period is required.';
    } else if (!/^\d+$/.test(periodInput.trim())) {
      errs.period = 'Period must be numeric.';
    } else if (isDuplicatePeriod && !allowReplace) {
      errs.duplicate = `Period ${periodInput} already exists. Check "Replace Existing Test Result" below or generate a next period.`;
    }

    if (selectedNumber === null) {
      errs.number = 'Winning number must be selected (0–9).';
    } else if (selectedNumber < 0 || selectedNumber > 9) {
      errs.number = 'Number must be between 0 and 9.';
    }

    return errs;
  }, [periodInput, isDuplicatePeriod, allowReplace, selectedNumber]);

  const hasErrors = Object.keys(errors).length > 0;

  // Live calculated preview
  const outcome = useMemo(() => {
    if (selectedNumber === null) return null;
    try {
      return calculateResult(selectedNumber);
    } catch {
      return null;
    }
  }, [selectedNumber]);

  const handleReset = () => {
    setSelectedNumber(null);
    setPeriodInput(currentPeriod);
    setAllowReplace(false);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasErrors || selectedNumber === null) return;

    if (isDuplicatePeriod && allowReplace) {
      setConfirmReplaceOpen(true);
      return;
    }

    await executeGeneration();
  };

  const executeGeneration = async () => {
    if (selectedNumber === null) return;
    setIsSubmitting(true);
    try {
      await generateResult(selectedNumber, periodInput.trim(), allowReplace);
      // Auto reset allowReplace for safety
      setAllowReplace(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Result Form Card */}
      <div className="lg:col-span-7 bg-[#071A14] border border-[#1E3A2B] rounded-2xl p-6 lg:p-7 shadow-xl space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-[#1E3A2B]">
          <div>
            <h2 className="text-lg font-bold text-[#F5F5F5] tracking-tight">
              TEST RESULT GENERATOR
            </h2>
            <p className="text-xs text-[#8D9B95] mt-0.5">
              Deterministic outcome preview & injection into test database
            </p>
          </div>
          <span className="px-2.5 py-1 rounded bg-[#E7B93F]/10 text-[#E7B93F] text-xs font-mono font-semibold border border-[#E7B93F]/30">
            SANDBOX
          </span>
        </div>

        <form onSubmit={handleFormSubmit} className="space-y-5">
          {/* Game Selection */}
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
              className="w-full bg-[#06130F] border border-[#1E3A2B] rounded-xl px-4 py-2.5 text-sm text-[#F5F5F5] font-medium focus:outline-none focus:border-[#E7B93F] focus:ring-1 focus:ring-[#E7B93F] transition-colors"
            >
              {SUPPORTED_GAMES.map((game) => (
                <option key={game.code} value={game.code}>
                  {game.name} ({game.intervalSeconds}s cycle)
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[#8D9B95]">{activeGame.description}</p>
          </div>

          {/* Period Input + Next Generator */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-[#8D9B95] uppercase tracking-wider">
                Period Number
              </label>
              <button
                type="button"
                onClick={generateNextPeriod}
                className="inline-flex items-center gap-1.5 text-xs text-[#E7B93F] hover:text-[#f3c754] font-medium transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Generate Next Test Period
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                value={periodInput}
                onChange={(e) => setPeriodInput(e.target.value)}
                placeholder="20260928100050374"
                className={`w-full bg-[#06130F] border rounded-xl px-4 py-2.5 text-sm font-mono text-[#F5F5F5] focus:outline-none transition-colors ${
                  errors.period || errors.duplicate
                    ? 'border-[#F04444] focus:border-[#F04444] focus:ring-1 focus:ring-[#F04444]'
                    : 'border-[#1E3A2B] focus:border-[#E7B93F] focus:ring-1 focus:ring-[#E7B93F]'
                }`}
              />
            </div>

            {/* Error messages */}
            {errors.period && (
              <p className="text-xs text-[#F04444] flex items-center gap-1.5 mt-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {errors.period}
              </p>
            )}

            {errors.duplicate && (
              <p className="text-xs text-[#E7B93F] flex items-start gap-1.5 mt-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{errors.duplicate}</span>
              </p>
            )}
          </div>

          {/* Replace Existing Checkbox if duplicate */}
          {isDuplicatePeriod && (
            <div className="p-3 rounded-xl bg-[#06130F] border border-[#E7B93F]/40 flex items-start gap-3">
              <input
                type="checkbox"
                id="allowReplace"
                checked={allowReplace}
                onChange={(e) => setAllowReplace(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-[#1E3A2B] text-[#E7B93F] focus:ring-[#E7B93F] bg-[#071A14] cursor-pointer"
              />
              <label htmlFor="allowReplace" className="text-xs text-[#F5F5F5] cursor-pointer">
                <span className="font-semibold text-[#E7B93F] block">
                  Replace Existing Test Result
                </span>
                Overwriting period {periodInput} will replace the previously stored outcome in test history.
              </label>
            </div>
          )}

          {/* 0-9 Interactive Number Selector */}
          <div className="pt-2">
            <NumberSelector
              selectedNumber={selectedNumber}
              onSelectNumber={(num) => setSelectedNumber(num)}
            />
            {errors.number && (
              <p className="text-xs text-[#F04444] flex items-center gap-1.5 mt-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {errors.number}
              </p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-4 border-t border-[#1E3A2B]">
            <button
              type="submit"
              disabled={hasErrors || isSubmitting}
              className="w-full sm:flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#E7B93F] hover:bg-[#f3c754] text-[#020806] font-bold text-sm tracking-wide shadow-lg transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate Test Result
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleReset}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#06130F] hover:bg-[#0E2E22] text-[#8D9B95] hover:text-[#F5F5F5] border border-[#1E3A2B] text-sm font-semibold transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>
        </form>
      </div>

      {/* Right Column: Live Result Preview Card */}
      <div className="lg:col-span-5 sticky top-24">
        <ResultPreview
          outcome={outcome}
          periodNumber={periodInput}
          gameName={activeGame.name}
        />

        {/* Small developer safety notes */}
        <div className="mt-4 p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] text-xs text-[#8D9B95] space-y-1">
          <div className="flex items-center gap-2 text-[#35B978] font-semibold">
            <CheckCircle className="w-3.5 h-3.5" />
            Sandbox Mode Verified
          </div>
          <p>
            This action creates local test data only. No external wagering endpoints are contacted.
          </p>
        </div>
      </div>

      {/* Confirmation modal when replacing existing result */}
      <ConfirmDialog
        isOpen={confirmReplaceOpen}
        title="Replace Existing Test Result?"
        message={`Period ${periodInput} already has a generated test result. Overwriting it will update the historical draw records in the test database.`}
        confirmLabel="Overwrite Result"
        isDestructive={true}
        onConfirm={async () => {
          setConfirmReplaceOpen(false);
          await executeGeneration();
        }}
        onCancel={() => setConfirmReplaceOpen(false)}
      />
    </div>
  );
};
