import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Sparkles,
  History,
  Brain,
  Terminal,
  Code2,
  FileText,
  Sliders,
  User,
  Settings,
  Crown,
  X,
  Smartphone,
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const mainNav = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Result Simulator', path: '/simulator', icon: Sparkles },
    { name: 'Game Client (Live UI)', path: '/game-client', icon: Smartphone },
    { name: 'Game History', path: '/history', icon: History },
    { name: 'Adaptive Learning', path: '/adaptive-learning', icon: Brain },
    { name: 'API Console', path: '/api-console', icon: Terminal },
  ];

  const devNav = [
    { name: 'Mock API', path: '/mock-api', icon: Code2 },
    { name: 'API Logs', path: '/api-logs', icon: FileText },
    { name: 'Configuration', path: '/config', icon: Sliders },
  ];

  const accountNav = [
    { name: 'Profile', path: '/profile', icon: User },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all duration-150 cursor-pointer ${
      isActive
        ? 'bg-[#0E2E22] text-[#E7B93F] border border-[#1E3A2B] shadow-[0_0_10px_rgba(231,185,63,0.1)]'
        : 'text-[#8D9B95] hover:text-[#F5F5F5] hover:bg-[#071A14]'
    }`;

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-xs lg:hidden"
        />
      )}

      {/* Sidebar Panel */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 w-64 bg-[#06130F] border-r border-[#1E3A2B] flex flex-col justify-between transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top Header Section */}
        <div>
          <div className="p-5 flex items-center justify-between border-b border-[#1E3A2B]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#E7B93F] to-[#8d690a] p-0.5 flex items-center justify-center shadow-[0_0_15px_rgba(231,185,63,0.2)]">
                <div className="w-full h-full bg-[#06130F] rounded-[10px] flex items-center justify-center">
                  <Crown className="w-5 h-5 text-[#E7B93F]" />
                </div>
              </div>

              <div>
                <h1 className="text-xs font-extrabold text-[#F5F5F5] tracking-wider uppercase leading-none">
                  LOTTERY SIMULATOR
                </h1>
                <span className="text-[10px] font-mono font-semibold tracking-widest text-[#E7B93F] uppercase block mt-1">
                  TEST CONSOLE
                </span>
              </div>
            </div>

            {/* Mobile close button */}
            <button
              onClick={onClose}
              className="lg:hidden text-[#8D9B95] hover:text-[#F5F5F5] p-1 rounded-md"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <div className="px-4 py-5 space-y-6 overflow-y-auto max-h-[calc(100vh-170px)]">
            {/* MAIN */}
            <div>
              <span className="px-3 text-[10px] font-bold text-[#8D9B95]/80 uppercase tracking-widest block mb-2 font-mono">
                MAIN
              </span>
              <nav className="space-y-1">
                {mainNav.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => onClose()}
                    className={linkClass}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span>{item.name}</span>
                  </NavLink>
                ))}
              </nav>
            </div>

            {/* DEVELOPMENT */}
            <div>
              <span className="px-3 text-[10px] font-bold text-[#8D9B95]/80 uppercase tracking-widest block mb-2 font-mono">
                DEVELOPMENT
              </span>
              <nav className="space-y-1">
                {devNav.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => onClose()}
                    className={linkClass}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span>{item.name}</span>
                  </NavLink>
                ))}
              </nav>
            </div>

            {/* ACCOUNT */}
            <div>
              <span className="px-3 text-[10px] font-bold text-[#8D9B95]/80 uppercase tracking-widest block mb-2 font-mono">
                ACCOUNT
              </span>
              <nav className="space-y-1">
                {accountNav.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => onClose()}
                    className={linkClass}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span>{item.name}</span>
                  </NavLink>
                ))}
              </nav>
            </div>
          </div>
        </div>

        {/* Bottom Section: Developer Mode Active indicator */}
        <div className="p-4 border-t border-[#1E3A2B] bg-[#071A14]">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-[#F5F5F5] block">
                Developer Mode
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-[#35B978] animate-pulse" />
                <span className="text-[11px] font-mono text-[#35B978] font-medium">
                  Active
                </span>
              </div>
            </div>
            <span className="text-[10px] font-mono text-[#8D9B95] px-2 py-0.5 rounded bg-[#06130F] border border-[#1E3A2B]">
              v1.0.4-dev
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
