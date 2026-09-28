import React, { useState } from 'react';
import { Menu, HelpCircle, ShieldCheck, X } from 'lucide-react';

interface HeaderProps {
  onOpenMobileMenu: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenMobileMenu }) => {
  const [supportModalOpen, setSupportModalOpen] = useState<boolean>(false);

  return (
    <>
      <header className="sticky top-0 z-30 h-16 bg-[#06130F]/90 backdrop-blur-md border-b border-[#1E3A2B] px-4 lg:px-8 flex items-center justify-between">
        {/* Left Side: Mobile toggle + Page Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenMobileMenu}
            className="lg:hidden p-2 rounded-xl text-[#8D9B95] hover:text-[#F5F5F5] hover:bg-[#071A14] transition-colors cursor-pointer"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div>
            <h1 className="text-sm lg:text-base font-extrabold tracking-wider text-[#F5F5F5] uppercase flex items-center gap-2">
              RESULT SIMULATOR
            </h1>
          </div>
        </div>

        {/* Right Side Badges & Controls */}
        <div className="flex items-center gap-2.5 sm:gap-4">
          {/* Environment Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#071A14] border border-[#E7B93F]/40 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-[#E7B93F]" />
            <span className="text-[11px] font-mono font-bold text-[#E7B93F] uppercase tracking-wider">
              LOCAL / TEST
            </span>
          </div>

          {/* API Status Badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#071A14] border border-[#1E3A2B]">
            <span className="w-2 h-2 rounded-full bg-[#35B978] animate-pulse" />
            <span className="text-xs font-mono font-medium text-[#35B978]">
              Mock API Online
            </span>
          </div>

          {/* Support Button */}
          <button
            onClick={() => setSupportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#071A14] hover:bg-[#0E2E22] text-[#8D9B95] hover:text-[#F5F5F5] border border-[#1E3A2B] text-xs font-medium transition-colors cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5 text-[#E7B93F]" />
            <span>Support</span>
          </button>
        </div>
      </header>

      {/* Support / Safety Modal */}
      {supportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-lg bg-[#071A14] border border-[#1E3A2B] rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#1E3A2B]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#35B978]" />
                <h3 className="text-sm font-bold text-[#F5F5F5] uppercase tracking-wide">
                  Development & Testing Support
                </h3>
              </div>
              <button
                onClick={() => setSupportModalOpen(false)}
                className="text-[#8D9B95] hover:text-[#F5F5F5] p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-[#8D9B95] space-y-3 leading-relaxed">
              <p>
                <strong className="text-[#F5F5F5]">Development Sandbox:</strong> This application is designed specifically for testing lottery-style game interfaces, calculation pipelines, and front-end state management.
              </p>
              <div className="p-3 bg-[#06130F] rounded-xl border border-[#1E3A2B] space-y-1 font-mono text-[11px]">
                <div className="text-[#E7B93F] font-bold">Safe Architecture:</div>
                <div className="text-[#F5F5F5]">● Zero connection to real betting systems</div>
                <div className="text-[#F5F5F5]">● No real money or wagering transactions</div>
                <div className="text-[#F5F5F5]">● Server/provider deterministically computes size & color</div>
              </div>
              <p>
                Need to test a custom draw sequence? Use the <span className="text-[#E7B93F]">Result Simulator</span> tab or execute arbitrary payloads directly in the <span className="text-[#E7B93F]">API Console</span>.
              </p>
            </div>

            <div className="pt-3 border-t border-[#1E3A2B] flex justify-end">
              <button
                onClick={() => setSupportModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#E7B93F] hover:bg-[#f3c754] text-[#020806] text-xs font-bold transition-colors cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
