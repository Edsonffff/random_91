import React from 'react';
import { AdaptiveLearningPanel } from '../components/history/AdaptiveLearningPanel';
import { useServerAdaptiveLearning } from '../hooks/useServerAdaptiveLearning';
import { AdaptiveMaxLoss } from '../components/history/AdaptiveMaxLoss';

export const AdaptiveLearningPage: React.FC = () => {
  const serverState = useServerAdaptiveLearning();
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F5F5] tracking-tight uppercase">
          Adaptive Learning
        </h1>
        <p className="text-sm text-[#8D9B95] mt-1">
          Weighted multi-signal decision engine, live Adaptive Final Result, and latest evaluation
          from the phone-side Adaptive Learning server.
        </p>
      </div>

      {/* Mount the server-backed panel without the full-history analysis parent. */}
      <AdaptiveLearningPanel serverState={serverState} />

      <AdaptiveMaxLoss metric={serverState.maxLoss} />
    </div>
  );
};
