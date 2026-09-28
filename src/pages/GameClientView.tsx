import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useResults } from '../context/ResultContext';
import { useRealHistory } from '../context/RealHistoryContext';
import { useToast } from '../context/ToastContext';
import {
  HelpCircle,
  Volume2,
  VolumeX,
  ChevronLeft,
  Play,
  Pause,
  Zap,
  Brain,
  Info,
  Clock,
  Flame,
  Radio,
} from 'lucide-react';

export const GameClientView: React.FC = () => {
  const {
    results,
    activeGame,
    currentPeriod,
    isAutoDrawActive,
    setIsAutoDrawActive,
    countdownSeconds,
    drawCycleDuration,
    setDrawCycleDuration,
    queuedNextNumber,
    setQueuedNextNumber,
    triggerInstantDraw,
  } = useResults();

  const { realHistory, realSchedule, refreshRealResults } = useRealHistory();
  const { showToast } = useToast();

  // Mode: Real official live feed vs. local simulator sandbox
  const [feedMode, setFeedMode] = useState<'real' | 'simulator'>('real');

  // Active game sub-tab (Game history, Chart, Follow Strategy)
  const [activeTab, setActiveTab] = useState<'history' | 'chart' | 'strategy'>('history');

  // Interactive selection states (visual development preview)
  const [selectedBetType, setSelectedBetType] = useState<string | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState<number>(1);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Track latest period to play chime & highlight new rows
  const prevPeriodRef = useRef(currentPeriod);
  const [justDrawn, setJustDrawn] = useState<boolean>(false);

  // Play subtle draw chime when a new round finishes
  useEffect(() => {
    if (prevPeriodRef.current !== currentPeriod) {
      prevPeriodRef.current = currentPeriod;
      setJustDrawn(true);

      if (soundEnabled) {
        try {
          const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (AudioContextClass) {
            const ctx = new AudioContextClass();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(587.33, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
          }
        } catch {
          // Audio disabled or blocked by browser autoplay
        }
      }

      const timer = setTimeout(() => setJustDrawn(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [currentPeriod, soundEnabled]);

  // Dynamic timing & period based on feedMode
  const activeSeconds = feedMode === 'real'
    ? (realSchedule?.remainingSeconds ?? 0)
    : countdownSeconds;

  const formattedSeconds = String(activeSeconds).padStart(2, '0');
  const isLocked = activeSeconds <= 5; // Real-world betting locks at 5s

  const displayPeriodNumber = feedMode === 'real'
    ? (realSchedule?.currentIssue || 'Loading live schedule...')
    : currentPeriod;

  // Top 5 recent winning balls for the ticket header
  const recentFive = useMemo(() => {
    if (feedMode === 'real') {
      return realHistory.slice(0, 5).map((r) => ({
        id: r.periodNumber,
        gameCode: 'WinGo_30S',
        periodNumber: r.periodNumber,
        winningNumber: r.winningNumber,
        size: r.size,
        colors: r.colors,
        environment: 'real' as const,
        createdAt: r.completedAt,
        status: 'REAL' as const,
      }));
    }
    const filtered = results.filter((r) => r.gameCode === activeGame.code);
    return filtered.slice(0, 5);
  }, [feedMode, realHistory, results, activeGame.code]);

  // Pattern tracker & probability metrics
  const predictionMetrics = useMemo(() => {
    const list = feedMode === 'real' ? realHistory.slice(0, 15) : results.slice(0, 15);
    if (list.length === 0) return null;
    const bigs = list.filter((r) => r.size === 'Big').length;
    const smalls = list.length - bigs;
    const reds = list.filter((r) => r.colors.includes('red')).length;
    const greens = list.filter((r) => r.colors.includes('green')).length;

    // Detect streak in latest items
    let streakCount = 1;
    const firstSize = list[0]?.size;
    for (let i = 1; i < list.length; i++) {
      if (list[i]?.size === firstSize) {
        streakCount++;
      } else {
        break;
      }
    }

    return {
      sampleSize: list.length,
      bigRatio: Math.round((bigs / list.length) * 100),
      smallRatio: Math.round((smalls / list.length) * 100),
      redRatio: Math.round((reds / list.length) * 100),
      greenRatio: Math.round((greens / list.length) * 100),
      currentStreak: {
        type: firstSize,
        count: streakCount,
      },
      statisticalTrend: bigs > smalls ? 'Big' : bigs < smalls ? 'Small' : 'Neutral',
    };
  }, [feedMode, realHistory, results]);

  const displayTableList = useMemo(() => {
    if (feedMode === 'real') {
      return realHistory.slice(0, 15).map((r) => ({
        id: r.periodNumber,
        periodNumber: r.periodNumber,
        winningNumber: r.winningNumber,
        size: r.size,
        colors: r.colors,
        source: 'COMPLETED REAL HISTORY' as const,
      }));
    }
    return results.slice(0, 15).map((r) => ({
      id: r.id,
      periodNumber: r.periodNumber,
      winningNumber: r.winningNumber,
      size: r.size,
      colors: r.colors,
      source: 'SIMULATOR DATA' as const,
    }));
  }, [feedMode, realHistory, results]);

  const handleSimulateBet = (type: string, num?: number) => {
    if (isLocked) {
      showToast('Betting is locked for current draw (final 5 seconds)', 'warning');
      return;
    }
    setSelectedBetType(type);
    if (num !== undefined) setSelectedNumber(num);
    showToast(`Test Selection: ${type}${num !== undefined ? ` (Number ${num})` : ''} - x${multiplier}`, 'info');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Primary Data Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-[#071A14] border border-[#1E3A2B] shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#35B978]/10 border border-[#35B978]/20">
            <Radio className="w-5 h-5 text-[#35B978] animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-[#F5F5F5] uppercase tracking-wide">
                Live Client Interface Mode
              </h2>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                feedMode === 'real'
                  ? 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/30'
                  : 'bg-[#E7B93F]/15 text-[#E7B93F] border-[#E7B93F]/30'
              }`}>
                {feedMode === 'real' ? 'COMPLETED REAL HISTORY' : 'SIMULATOR DATA'}
              </span>
            </div>
            <p className="text-xs text-[#8D9B95] mt-0.5">
              {feedMode === 'real'
                ? 'Displaying official WinGo 30S draws & live active countdown from draw.ar-lottery01.com.'
                : 'Displaying local simulated random draws and developer controls.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-[#06130F] rounded-xl border border-[#1E3A2B] text-xs">
          <button
            onClick={() => {
              setFeedMode('real');
              refreshRealResults(true);
            }}
            className={`px-3 py-1.5 rounded-lg font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              feedMode === 'real'
                ? 'bg-[#35B978] text-[#020806] shadow font-black'
                : 'text-[#8D9B95] hover:text-[#F5F5F5]'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${feedMode === 'real' ? 'animate-pulse' : ''}`} />
            Real Game Feed ({realHistory.length > 0 ? `${realHistory.length} Settled` : 'Live'})
          </button>
          <button
            onClick={() => setFeedMode('simulator')}
            className={`px-3 py-1.5 rounded-lg font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              feedMode === 'simulator'
                ? 'bg-[#E7B93F] text-[#020806] shadow font-black'
                : 'text-[#8D9B95] hover:text-[#F5F5F5]'
            }`}
          >
            Simulator Sandbox
          </button>
        </div>
      </div>

      {/* Top Header / Context Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-[#1E3A2B]">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#F5F5F5] tracking-tight flex items-center gap-2">
            <span>WinGo Live Client Simulator</span>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-[#E7B93F]/15 text-[#E7B93F] border border-[#E7B93F]/30">
              REAL-TIME DRAW ENGINE
            </span>
          </h1>
          <p className="text-xs text-[#8D9B95] mt-0.5">
            Automatic real-time round generation, live 30s countdown, and pattern tracking.
          </p>
        </div>

        {/* Real-Time Generator Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Pause / Resume Auto-Draw */}
          <button
            onClick={() => {
              setIsAutoDrawActive(!isAutoDrawActive);
              showToast(!isAutoDrawActive ? 'Real-time Auto-Draw activated' : 'Auto-Draw paused', 'info');
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              isAutoDrawActive
                ? 'bg-[#35B978]/15 text-[#35B978] border border-[#35B978]/40 hover:bg-[#35B978]/25'
                : 'bg-[#F04444]/15 text-[#F04444] border border-[#F04444]/40 hover:bg-[#F04444]/25'
            }`}
          >
            {isAutoDrawActive ? (
              <>
                <span className="w-2 h-2 rounded-full bg-[#35B978] animate-pulse" />
                <Pause className="w-3.5 h-3.5" />
                Live Draw: Active
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Live Draw: Paused
              </>
            )}
          </button>

          {/* Speed Presets */}
          <div className="flex items-center bg-[#071A14] p-1 rounded-lg border border-[#1E3A2B]">
            {[
              { label: '30s Real', sec: 30 },
              { label: '10s Fast', sec: 10 },
              { label: '5s Turbo', sec: 5 },
            ].map((speed) => (
              <button
                key={speed.sec}
                onClick={() => {
                  setDrawCycleDuration(speed.sec);
                  showToast(`Draw interval set to ${speed.sec}s`, 'info');
                }}
                className={`px-2 py-1 rounded text-xs font-mono font-medium transition-colors cursor-pointer ${
                  drawCycleDuration === speed.sec
                    ? 'bg-[#E7B93F] text-[#020806] font-bold shadow-xs'
                    : 'text-[#8D9B95] hover:text-[#F5F5F5]'
                }`}
              >
                {speed.label}
              </button>
            ))}
          </div>

          {/* Trigger Instant Draw */}
          <button
            onClick={() => triggerInstantDraw()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E7B93F] hover:bg-[#f3c754] text-[#020806] font-bold text-xs shadow-md transition-all cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            Draw Now
          </button>
        </div>
      </div>

      {/* Force Next Draw Number Bar */}
      <div className="p-3.5 rounded-xl bg-[#071A14] border border-[#1E3A2B] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-[#8D9B95]">
          <Flame className="w-4 h-4 text-[#E7B93F]" />
          <span className="font-semibold uppercase tracking-wider text-[#F5F5F5]">
            Next Draw Number:
          </span>
          <span className="text-[11px]">
            {queuedNextNumber !== null ? (
              <strong className="text-[#E7B93F] font-mono">FORCED NUMBER {queuedNextNumber}</strong>
            ) : (
              'Auto PRNG (Random 0–9)'
            )}
          </span>
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button
              key={n}
              onClick={() => {
                setQueuedNextNumber(queuedNextNumber === n ? null : n);
                showToast(
                  queuedNextNumber === n
                    ? 'Reset to Auto PRNG'
                    : `Next draw will land on number ${n}`,
                  'info'
                );
              }}
              className={`w-6 h-6 rounded-md font-mono text-xs font-bold transition-all cursor-pointer ${
                queuedNextNumber === n
                  ? 'bg-[#E7B93F] text-[#020806] ring-2 ring-white/50 scale-110'
                  : 'bg-[#06130F] text-[#8D9B95] hover:text-[#F5F5F5] border border-[#1E3A2B]'
              }`}
            >
              {n}
            </button>
          ))}
          {queuedNextNumber !== null && (
            <button
              onClick={() => setQueuedNextNumber(null)}
              className="text-[11px] text-[#F04444] hover:underline ml-2 cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* ======================================================== */}
        {/* LEFT COLUMN: Pixel-Perfect Mobile Game Client View */}
        {/* ======================================================== */}
        <div className="lg:col-span-7 flex justify-center">
          <div className="w-full max-w-[430px] rounded-3xl bg-[#f8f9fa] text-[#333333] shadow-2xl border-4 border-[#071A14] overflow-hidden flex flex-col font-sans">
            {/* 1. Mobile Top Navigation Bar */}
            <div className="bg-[#f0e6d6] px-4 py-3 flex items-center justify-between border-b border-[#e5d8c3]">
              <button className="text-[#665544] p-1 rounded-full hover:bg-black/5 cursor-pointer">
                <ChevronLeft className="w-6 h-6" />
              </button>

              <div className="px-5 py-1 rounded-full bg-[#f39c12] text-white font-extrabold text-sm tracking-wide shadow-sm flex items-center gap-1">
                <span>Big Mumbai</span>
              </div>

              <div className="flex items-center gap-2 text-[#665544]">
                <button
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className="p-1 hover:text-black cursor-pointer"
                  title="Toggle Sound"
                >
                  {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5 opacity-50" />}
                </button>
                <HelpCircle className="w-5 h-5 cursor-pointer" />
              </div>
            </div>

            {/* 2. Game Ticket Container with Timer & Recent Balls */}
            <div className="p-3 bg-[#e8e2d8]">
              <div
                className={`relative rounded-2xl bg-gradient-to-r from-[#b38a5b] to-[#996e3d] text-white p-4 shadow-md overflow-hidden transition-all duration-300 ${
                  justDrawn ? 'ring-4 ring-[#E7B93F]' : ''
                }`}
              >
                <div className="grid grid-cols-2 gap-2 items-center">
                  {/* Left: How to play & 5 previous winning balls */}
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-white/20 text-[11px] font-semibold tracking-wide backdrop-blur-xs">
                      <span>How to play</span>
                    </div>

                    <div className="text-xs font-bold tracking-tight text-white/95">
                      WinGo 30sec
                    </div>

                    {/* 5 Recent balls */}
                    <div className="flex items-center gap-1.5 pt-1">
                      {recentFive.map((res, i) => {
                        const isZero = res.winningNumber === 0;
                        const isFive = res.winningNumber === 5;
                        const isEven = res.winningNumber % 2 === 0;

                        return (
                          <div
                            key={i}
                            className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs text-white shadow-sm ring-1 ring-white/40 transition-transform ${
                              i === 0 && justDrawn ? 'scale-125 ring-2 ring-yellow-300 animate-bounce' : ''
                            } ${
                              isZero
                                ? 'bg-gradient-to-r from-[#ef4444] to-[#c026d3]'
                                : isFive
                                ? 'bg-gradient-to-r from-[#10b981] to-[#c026d3]'
                                : isEven
                                ? 'bg-[#ef4444]'
                                : 'bg-[#10b981]'
                            }`}
                          >
                            {res.winningNumber}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right: Digital Countdown Clock & Current Period */}
                  <div className="text-right flex flex-col items-end">
                    <span className="text-[11px] font-medium text-white/90 flex items-center gap-1">
                      {isLocked ? (
                        <span className="text-yellow-300 font-bold animate-pulse">Drawing...</span>
                      ) : (
                        'Time remaining'
                      )}
                    </span>

                    {/* Digital LCD Countdown: 0 0 : S S */}
                    <div className="flex items-center gap-1 my-1">
                      <div className="w-5 h-7 rounded bg-white text-[#996e3d] font-bold font-mono text-base flex items-center justify-center shadow-inner">
                        0
                      </div>
                      <div className="w-5 h-7 rounded bg-white text-[#996e3d] font-bold font-mono text-base flex items-center justify-center shadow-inner">
                        0
                      </div>
                      <span className="font-bold text-white text-base">:</span>
                      <div
                        className={`w-5 h-7 rounded font-bold font-mono text-base flex items-center justify-center shadow-inner transition-colors ${
                          isLocked ? 'bg-yellow-300 text-red-600 animate-pulse' : 'bg-white text-[#996e3d]'
                        }`}
                      >
                        {formattedSeconds[0]}
                      </div>
                      <div
                        className={`w-5 h-7 rounded font-bold font-mono text-base flex items-center justify-center shadow-inner transition-colors ${
                          isLocked ? 'bg-yellow-300 text-red-600 animate-pulse' : 'bg-white text-[#996e3d]'
                        }`}
                      >
                        {formattedSeconds[1]}
                      </div>
                    </div>

                    {/* Period Sequence */}
                    <span className="font-mono text-xs font-semibold text-white tracking-wider">
                      {displayPeriodNumber}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Action Buttons & Number Balls Panel */}
            <div className="p-4 bg-white space-y-4">
              {/* Color Buttons: Green, Violet, Red */}
              <div className="grid grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleSimulateBet('Green')}
                  className={`py-2 rounded-lg font-bold text-xs text-white shadow-sm transition-transform active:scale-95 cursor-pointer bg-[#10b981] hover:bg-[#059669] ${
                    selectedBetType === 'Green' ? 'ring-2 ring-black/40 scale-102' : ''
                  }`}
                >
                  Green
                </button>

                <button
                  type="button"
                  onClick={() => handleSimulateBet('Violet')}
                  className={`py-2 rounded-lg font-bold text-xs text-white shadow-sm transition-transform active:scale-95 cursor-pointer bg-[#c026d3] hover:bg-[#a21caf] ${
                    selectedBetType === 'Violet' ? 'ring-2 ring-black/40 scale-102' : ''
                  }`}
                >
                  Violet
                </button>

                <button
                  type="button"
                  onClick={() => handleSimulateBet('Red')}
                  className={`py-2 rounded-lg font-bold text-xs text-white shadow-sm transition-transform active:scale-95 cursor-pointer bg-[#ef4444] hover:bg-[#dc2626] ${
                    selectedBetType === 'Red' ? 'ring-2 ring-black/40 scale-102' : ''
                  }`}
                >
                  Red
                </button>
              </div>

              {/* 10 Number Balls (0-9) with glossy circle styling */}
              <div className="grid grid-cols-5 gap-2.5 pt-1">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => {
                  const isZero = num === 0;
                  const isFive = num === 5;
                  const isEven = num % 2 === 0;
                  const isSelected = selectedNumber === num;

                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleSimulateBet(`Number`, num)}
                      className={`relative aspect-square rounded-full flex items-center justify-center font-extrabold text-lg text-white shadow-md transition-all active:scale-90 cursor-pointer ${
                        isSelected ? 'ring-3 ring-[#333333] scale-105' : 'hover:opacity-90'
                      } ${
                        isZero
                          ? 'bg-gradient-to-br from-[#ef4444] via-[#dc2626] to-[#c026d3]'
                          : isFive
                          ? 'bg-gradient-to-br from-[#10b981] via-[#059669] to-[#c026d3]'
                          : isEven
                          ? 'bg-gradient-to-br from-[#f87171] to-[#ef4444]'
                          : 'bg-gradient-to-br from-[#34d399] to-[#10b981]'
                      }`}
                    >
                      {/* Highlight reflection */}
                      <span className="absolute top-1 left-2 w-3 h-2 bg-white/40 rounded-full blur-[0.5px]" />
                      <span className="relative drop-shadow">{num}</span>
                    </button>
                  );
                })}
              </div>

              {/* Multipliers selector: Random, X1, X5, X10, X20, X50, X100 */}
              <div className="flex items-center justify-between gap-1 overflow-x-auto py-1 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    const r = Math.floor(Math.random() * 10);
                    handleSimulateBet('Number', r);
                  }}
                  className="px-2 py-1 rounded border border-[#ef4444] text-[#ef4444] font-semibold shrink-0 cursor-pointer hover:bg-[#ef4444]/10"
                >
                  Random
                </button>

                {[1, 5, 10, 20, 50, 100].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMultiplier(m)}
                    className={`px-2 py-1 rounded font-semibold text-[11px] shrink-0 cursor-pointer transition-colors ${
                      multiplier === m
                        ? 'bg-[#10b981] text-white shadow-xs'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    X{m}
                  </button>
                ))}
              </div>

              {/* Big / Small Choice Bar */}
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => handleSimulateBet('Big')}
                  className={`py-2.5 rounded-xl font-extrabold text-sm text-white shadow-sm transition-transform active:scale-98 cursor-pointer bg-[#f39c12] hover:bg-[#e67e22] ${
                    selectedBetType === 'Big' ? 'ring-2 ring-black/40' : ''
                  }`}
                >
                  Big
                </button>

                <button
                  type="button"
                  onClick={() => handleSimulateBet('Small')}
                  className={`py-2.5 rounded-xl font-extrabold text-sm text-white shadow-sm transition-transform active:scale-98 cursor-pointer bg-[#3498db] hover:bg-[#2980b9] ${
                    selectedBetType === 'Small' ? 'ring-2 ring-black/40' : ''
                  }`}
                >
                  Small
                </button>
              </div>
            </div>

            {/* 4. Tab Bar: [Game history] [Chart] [Follow Strategy] */}
            <div className="bg-[#f0e6d6] px-3 pt-3">
              <div className="flex items-center gap-1 border-b border-[#e5d8c3]">
                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className={`px-3.5 py-2 font-bold text-xs rounded-t-lg transition-colors cursor-pointer ${
                    activeTab === 'history'
                      ? 'bg-[#b38a5b] text-white shadow'
                      : 'text-[#665544] hover:bg-black/5'
                  }`}
                >
                  Game history
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('chart')}
                  className={`px-3.5 py-2 font-bold text-xs rounded-t-lg transition-colors cursor-pointer ${
                    activeTab === 'chart'
                      ? 'bg-[#b38a5b] text-white shadow'
                      : 'text-[#665544] hover:bg-black/5'
                  }`}
                >
                  Chart
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('strategy')}
                  className={`px-3.5 py-2 font-bold text-xs rounded-t-lg transition-colors cursor-pointer ${
                    activeTab === 'strategy'
                      ? 'bg-[#b38a5b] text-white shadow'
                      : 'text-[#665544] hover:bg-black/5'
                  }`}
                >
                  Follow Strategy
                </button>
              </div>
            </div>

            {/* 5. Results Table matching screenshot */}
            <div className="bg-white p-3 flex-1 overflow-y-auto max-h-[380px]">
              {activeTab === 'history' && (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#b38a5b] text-white font-semibold text-[11px]">
                      <th className="py-2 px-3 rounded-l">Period</th>
                      <th className="py-2 px-3 text-center">Number</th>
                      <th className="py-2 px-3">Big Small</th>
                      <th className="py-2 px-3 text-right rounded-r">Color</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-sans text-xs">
                    {displayTableList.slice(0, 12).map((item, idx) => {
                      const isZero = item.winningNumber === 0;
                      const isFive = item.winningNumber === 5;
                      const isEven = item.winningNumber % 2 === 0;
                      const numColor = isZero || isFive ? 'text-[#c026d3]' : isEven ? 'text-[#ef4444]' : 'text-[#10b981]';
                      const isLatest = idx === 0;

                      return (
                        <tr
                          key={item.id}
                          className={`transition-colors duration-500 ${
                            isLatest && justDrawn ? 'bg-amber-100/80 font-bold' : 'hover:bg-gray-50'
                          }`}
                        >
                          <td className="py-2.5 px-3 font-mono text-gray-700">
                            {item.periodNumber}
                            {isLatest && (
                              <span className="ml-1.5 px-1 py-0.2 text-[9px] rounded bg-green-100 text-green-700 font-sans font-bold">
                                NEW
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`font-black text-base ${numColor}`}>
                              {item.winningNumber}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-medium text-gray-600">
                            {item.size}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="inline-flex items-center gap-1 justify-end">
                              {item.colors.map((c, colorIdx) => (
                                <span
                                  key={colorIdx}
                                  className={`w-2.5 h-2.5 rounded-full inline-block ${
                                    c === 'red'
                                      ? 'bg-[#ef4444]'
                                      : c === 'green'
                                      ? 'bg-[#10b981]'
                                      : 'bg-[#c026d3]'
                                  }`}
                                />
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {activeTab === 'chart' && (
                <div className="p-4 text-center text-xs text-gray-500">
                  <p className="font-semibold text-gray-700">Client Historical Trend</p>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    {results.slice(0, 10).map((r, i) => (
                      <div key={i} className="flex flex-col items-center gap-1">
                        <span className="font-bold text-xs text-gray-800">{r.winningNumber}</span>
                        <div
                          className={`w-3.5 rounded-full ${r.size === 'Big' ? 'bg-[#f39c12]' : 'bg-[#3498db]'}`}
                          style={{ height: `${(r.winningNumber + 1) * 7}px` }}
                        />
                        <span className="text-[9px] text-gray-400">..{r.periodNumber.slice(-2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'strategy' && (
                <div className="p-3 text-xs space-y-2.5 text-gray-600">
                  <div className="flex justify-between border-b pb-1.5">
                    <span>Big / Small Ratio:</span>
                    <strong className="text-gray-800">
                      {predictionMetrics?.bigRatio}% / {predictionMetrics?.smallRatio}%
                    </strong>
                  </div>
                  <div className="flex justify-between border-b pb-1.5">
                    <span>Dominant Color:</span>
                    <strong className="text-gray-800">
                      {predictionMetrics && predictionMetrics.greenRatio >= predictionMetrics.redRatio ? 'Green' : 'Red'}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Current Active Streak:</span>
                    <strong className="text-[#f39c12]">
                      {predictionMetrics?.currentStreak.count}x {predictionMetrics?.currentStreak.type}
                    </strong>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ======================================================== */}
        {/* RIGHT COLUMN: How the Game Server Works & Prediction Analysis */}
        {/* ======================================================== */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card 1: How the Real-Time Auto Draw Operates */}
          <div className="p-6 rounded-2xl bg-[#071A14] border border-[#1E3A2B] shadow-xl space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#1E3A2B]">
              <Clock className="w-5 h-5 text-[#E7B93F]" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-[#F5F5F5]">
                Real-Time Game Server Architecture
              </h2>
            </div>

            <div className="text-xs text-[#8D9B95] space-y-3 leading-relaxed">
              <p>
                Your simulator is running an active round engine synchronized with the 30-second cycle:
              </p>

              <div className="space-y-2 font-mono text-[11px]">
                <div className="p-3 bg-[#06130F] rounded-xl border border-[#1E3A2B] space-y-1.5">
                  <div className="text-[#35B978] font-bold">1. Live Tick Clock</div>
                  <p className="text-gray-300 font-sans text-xs">
                    The timer on the ticket counts down every second. In production, this syncs with server NTP time so all players see the exact same countdown.
                  </p>
                </div>

                <div className="p-3 bg-[#06130F] rounded-xl border border-[#1E3A2B] space-y-1.5">
                  <div className="text-[#E7B93F] font-bold">2. T-5s Draw Lock</div>
                  <p className="text-gray-300 font-sans text-xs">
                    When the timer hits 5 seconds, betting locks. The server queries whether a merchant override was set via <code className="text-[#E7B93F]">set_merchant_custom_result.php</code>. If so, that exact number drops; otherwise the random generator triggers.
                  </p>
                </div>

                <div className="p-3 bg-[#06130F] rounded-xl border border-[#1E3A2B] space-y-1.5">
                  <div className="text-[#C94DDA] font-bold">3. T-0s Ball Reveal & State Shift</div>
                  <p className="text-gray-300 font-sans text-xs">
                    The winning ball lands at the top of the history table, the 5 mini-balls shift one step right, the period increments, and the next 30-second timer begins immediately.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Prediction Analysis & Pattern Tracker */}
          <div className="p-6 rounded-2xl bg-[#071A14] border border-[#1E3A2B] shadow-xl space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#1E3A2B]">
              <Brain className="w-5 h-5 text-[#35B978]" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-[#F5F5F5]">
                Real-Time Prediction & Trend Signals
              </h2>
            </div>

            <div className="space-y-3 text-xs text-[#8D9B95]">
              <div className="p-3.5 rounded-xl bg-[#06130F] border border-[#35B978]/30 text-[#F5F5F5] space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-[#8D9B95]">Current Stream Trend:</span>
                  <strong className="text-[#E7B93F]">{predictionMetrics?.statisticalTrend} Bias</strong>
                </div>
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-[#8D9B95]">Active Run:</span>
                  <strong className="text-[#35B978]">
                    {predictionMetrics?.currentStreak.count}x {predictionMetrics?.currentStreak.type} streak
                  </strong>
                </div>
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-[#8D9B95]">Color Split (Recent 15):</span>
                  <span>
                    <strong className="text-[#35B978]">{predictionMetrics?.greenRatio}% Green</strong> /{' '}
                    <strong className="text-[#F04444]">{predictionMetrics?.redRatio}% Red</strong>
                  </span>
                </div>
              </div>

              {/* Technical / Scientific explanation */}
              <div className="p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-2 text-[11px] leading-relaxed">
                <div className="flex items-center gap-1.5 font-bold text-[#E7B93F]">
                  <Info className="w-4 h-4 shrink-0" />
                  Understanding the "Prediction" Logic:
                </div>
                <p>
                  • <strong>Independent Probability:</strong> In random lottery servers, every single round has an exact 50% probability of Big and 50% probability of Small regardless of prior outcomes.
                </p>
                <p>
                  • <strong>Why Players Track Streaks:</strong> When a streak reaches 4 or 5 of the same size (e.g., 4 Smalls in a row), players often use regression-to-the-mean strategies (betting Big) or trend-following (betting Small until the streak breaks).
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
