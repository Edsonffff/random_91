import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-[#071A14] border border-[#1E3A2B] rounded-xl shadow-2xl p-6 overflow-hidden">
        <div className="flex items-start gap-4">
          <div
            className={`p-2.5 rounded-lg shrink-0 ${
              isDestructive
                ? 'bg-[#F04444]/15 text-[#F04444] border border-[#F04444]/30'
                : 'bg-[#E7B93F]/15 text-[#E7B93F] border border-[#E7B93F]/30'
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>

          <div className="flex-1">
            <h3 className="text-base font-semibold text-[#F5F5F5]">{title}</h3>
            <p className="mt-2 text-sm text-[#8D9B95] leading-relaxed">{message}</p>
          </div>

          <button
            onClick={onCancel}
            className="text-[#8D9B95] hover:text-[#F5F5F5] p-1 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-[#1E3A2B]/60">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold text-[#8D9B95] hover:text-[#F5F5F5] hover:bg-[#06130F] rounded-lg transition-colors cursor-pointer border border-[#1E3A2B]"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-xs font-semibold rounded-lg shadow transition-colors cursor-pointer ${
              isDestructive
                ? 'bg-[#F04444] hover:bg-[#ff5555] text-white'
                : 'bg-[#E7B93F] hover:bg-[#f3c754] text-[#020806]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
