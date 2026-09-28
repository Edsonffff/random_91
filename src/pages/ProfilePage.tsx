import React from 'react';
import { User, Shield } from 'lucide-react';

export const ProfilePage: React.FC = () => {
  return (
    <div className="max-w-4xl space-y-8 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F5F5] tracking-tight">
          Developer Profile
        </h1>
        <p className="text-sm text-[#8D9B95] mt-1">
          Active test sandbox session and developer authorization details.
        </p>
      </div>

      <div className="bg-[#071A14] border border-[#1E3A2B] rounded-2xl p-6 lg:p-8 shadow-xl space-y-6">
        <div className="flex items-center gap-4 pb-6 border-b border-[#1E3A2B]">
          <div className="w-16 h-16 rounded-2xl bg-[#06130F] border border-[#E7B93F]/40 flex items-center justify-center text-[#E7B93F] shadow-[0_0_20px_rgba(231,185,63,0.15)]">
            <User className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-[#F5F5F5]">Lead Sandbox Engineer</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#35B978]/15 text-[#35B978] border border-[#35B978]/30">
                ACTIVE
              </span>
            </div>
            <p className="text-xs text-[#8D9B95] mt-0.5">dev-admin@imperial-simulator.local</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-1">
            <span className="text-[11px] text-[#8D9B95] uppercase font-sans font-semibold">
              Access Role
            </span>
            <div className="text-sm font-bold text-[#E7B93F]">Simulator Administrator</div>
            <p className="text-[11px] text-[#8D9B95] font-sans">Full access to generate and override test period outcomes</p>
          </div>

          <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] space-y-1">
            <span className="text-[11px] text-[#8D9B95] uppercase font-sans font-semibold">
              Session Mode
            </span>
            <div className="text-sm font-bold text-[#35B978]">Local Mock (Isolated)</div>
            <p className="text-[11px] text-[#8D9B95] font-sans">No live API keys required or exported</p>
          </div>
        </div>

        {/* Security badge notice */}
        <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] flex items-center gap-3">
          <Shield className="w-5 h-5 text-[#E7B93F] shrink-0" />
          <p className="text-xs text-[#8D9B95]">
            Strict credential concealment is enforced. Production API tokens are never saved in local storage or rendered client-side.
          </p>
        </div>
      </div>
    </div>
  );
};
