import { AlertTriangle, CheckCircle2, Info, MapPin, X } from 'lucide-react';
import type { ToastItem } from '../game/types';

interface ToastsProps {
  toasts: ToastItem[];
  hasOverlayCard?: boolean;
  onDismiss: (id: string) => void;
  onFocusToast?: (toast: ToastItem) => void;
}

export function Toasts({
  toasts,
  hasOverlayCard = false,
  onDismiss,
  onFocusToast,
}: ToastsProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className={`fixed bottom-[68px] lg:bottom-4 left-3 z-40 flex flex-col gap-2 max-w-xs w-[calc(100vw-1.5rem)] pointer-events-none transition-[left] duration-150 ${
        hasOverlayCard ? 'lg:left-[320px]' : ''
      }`}
    >
      {toasts.map((toast) => {
        const Icon =
          toast.tone === 'success'
            ? CheckCircle2
            : toast.tone === 'warning'
              ? AlertTriangle
              : Info;
        const accentClass =
          toast.tone === 'success'
            ? 'border-[#3E9B4F] text-[#245A2F]'
            : toast.tone === 'warning'
              ? 'border-[#C44536] text-[#8E2A1F]'
              : 'border-[#C9962E] text-[#2B2118]';

        const isNavigable =
          typeof toast.focusCubeId === 'number' && Boolean(onFocusToast);

        return (
          <div
            key={toast.id}
            className={`toast-enter pointer-events-auto flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#FBF3DF] border-2 shadow-lg text-xs font-extrabold ${accentClass}`}
          >
            {isNavigable ? (
              <button
                type="button"
                onClick={() => onFocusToast?.(toast)}
                className="flex-1 flex items-center gap-2 min-w-0 text-right hover:underline"
              >
                <MapPin className="w-4 h-4 shrink-0 text-[#14524A]" />
                <span className="leading-snug">{toast.message}</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="leading-snug">{toast.message}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="p-0.5 rounded hover:bg-black/5 shrink-0"
              aria-label="إغلاق"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
