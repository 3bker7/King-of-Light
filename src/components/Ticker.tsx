import { TrendingUp } from 'lucide-react';
import { STRINGS } from '../game/strings';

interface TickerProps {
  message: string;
  level: 1 | 2;
  onOpenBourse: () => void;
}

export function Ticker({ message, level, onOpenBourse }: TickerProps) {
  const interactive = level >= 2;

  return (
    <div
      className={`w-full h-7 bg-[#C9962E] text-[#2B2118] border-b border-[#A6781E] flex items-center overflow-hidden shrink-0 ${
        interactive ? 'cursor-pointer hover:bg-[#D4A138] transition-colors' : ''
      }`}
      onClick={interactive ? onOpenBourse : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenBourse();
              }
            }
          : undefined
      }
      title={interactive ? STRINGS.bourseButton : undefined}
    >
      <div className="px-2.5 h-full bg-[#B48222] flex items-center gap-1.5 shrink-0 border-l border-[#996C18] z-10">
        <TrendingUp className="w-3.5 h-3.5 text-[#2B2118]" />
        <span className="text-[11px] font-extrabold whitespace-nowrap">
          {STRINGS.bourse.title}
        </span>
      </div>
      <div className="flex-1 overflow-hidden relative h-full flex items-center">
        <div className="ticker-track text-xs font-bold px-4">
          {message}
        </div>
      </div>
    </div>
  );
}
