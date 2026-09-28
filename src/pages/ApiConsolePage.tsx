import React from 'react';
import { ApiConsole } from '../components/api/ApiConsole';

export const ApiConsolePage: React.FC = () => {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F5F5] tracking-tight">
          API Console
        </h1>
        <p className="text-sm text-[#8D9B95] mt-1">
          Simulate HTTP endpoint operations against the deterministic lottery mock server.
        </p>
      </div>

      <ApiConsole />
    </div>
  );
};
