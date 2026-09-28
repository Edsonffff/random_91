import React from 'react';
import { ApiLogTable } from '../components/api/ApiLogTable';

export const ApiLogsPage: React.FC = () => {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F5F5] tracking-tight">
          API Logs
        </h1>
        <p className="text-sm text-[#8D9B95] mt-1">
          Inspect real-time mock request payloads, generated server responses, and execution latency.
        </p>
      </div>

      <ApiLogTable />
    </div>
  );
};
