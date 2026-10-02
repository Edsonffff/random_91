import React from 'react';
import { AlgorithmAnalyzer } from '../components/history/AlgorithmAnalyzer';

export const AdaptiveLearningPage: React.FC = () => {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F5F5] tracking-tight uppercase">
          Adaptive Learning
        </h1>
        <p className="text-sm text-[#8D9B95] mt-1">
          Weighted multi-signal decision engine, live Adaptive Final Result, and evaluated-round history
          driven by the existing Real Live Feed.
        </p>
      </div>

      {/* Existing Adaptive Learning system (single engine/state — not a copy) */}
      <AlgorithmAnalyzer />
    </div>
  );
};
