import React, { useState } from 'react';
import { useToast } from '../context/ToastContext';
import { Palette, Save } from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const { showToast } = useToast();
  const [audioFeedback, setAudioFeedback] = useState<boolean>(false);
  const [autoAdvance, setAutoAdvance] = useState<boolean>(true);

  const handleSave = () => {
    showToast('Preferences saved successfully', 'success');
  };

  return (
    <div className="max-w-4xl space-y-8 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F5F5] tracking-tight">
          Settings
        </h1>
        <p className="text-sm text-[#8D9B95] mt-1">
          Customize UI behavior, visual contrast, and simulator preferences.
        </p>
      </div>

      <div className="bg-[#071A14] border border-[#1E3A2B] rounded-2xl p-6 lg:p-8 shadow-xl space-y-6">
        <div className="flex items-center gap-2 pb-4 border-b border-[#1E3A2B]">
          <Palette className="w-4 h-4 text-[#E7B93F]" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#F5F5F5]">
            Display & Interaction Preferences
          </h2>
        </div>

        <div className="space-y-4">
          {/* High Contrast Theme */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
            <div>
              <span className="text-xs font-semibold text-[#F5F5F5] block">
                Imperial SaaS Dark Theme
              </span>
              <span className="text-[11px] text-[#8D9B95]">
                Ultra-dark panels (#020806, #071A14) with emerald borders and gold accents
              </span>
            </div>
            <span className="px-2.5 py-1 rounded bg-[#E7B93F]/15 text-[#E7B93F] text-xs font-mono font-bold border border-[#E7B93F]/30">
              ACTIVE
            </span>
          </div>

          {/* Auto advance period */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
            <div>
              <span className="text-xs font-semibold text-[#F5F5F5] block">
                Auto-Advance Period on Result Generation
              </span>
              <span className="text-[11px] text-[#8D9B95]">
                Automatically loads the next sequential period in the result generator input
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAutoAdvance(!autoAdvance)}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold border transition-colors cursor-pointer ${
                autoAdvance
                  ? 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/30'
                  : 'bg-gray-800 text-gray-400 border-gray-700'
              }`}
            >
              {autoAdvance ? 'ENABLED' : 'DISABLED'}
            </button>
          </div>

          {/* Audible click */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#06130F] border border-[#1E3A2B]">
            <div>
              <span className="text-xs font-semibold text-[#F5F5F5] block">
                Silent Generator Mode
              </span>
              <span className="text-[11px] text-[#8D9B95]">
                Disable all browser sounds and animations during test runs
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAudioFeedback(!audioFeedback)}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold border transition-colors cursor-pointer ${
                audioFeedback
                  ? 'bg-[#E7B93F]/15 text-[#E7B93F] border-[#E7B93F]/30'
                  : 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/30'
              }`}
            >
              {!audioFeedback ? 'SILENT' : 'ENABLED'}
            </button>
          </div>
        </div>

        <div className="pt-4 border-t border-[#1E3A2B] flex justify-end">
          <button
            onClick={handleSave}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E7B93F] hover:bg-[#f3c754] text-[#020806] font-bold text-xs shadow-md transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
};
