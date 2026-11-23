import { Coins, Hammer, X } from 'lucide-react';
import { THEME_ORDER, THEMES } from '../game/constants';
import { STRINGS } from '../game/strings';
import type { ThemeId } from '../game/types';
import { ThemeIcon } from './ResourceIcon';

interface BuildDockProps {
  variant: 'desktop' | 'mobile';
  gold: number;
  level: 1 | 2;
  activeBuildTheme: ThemeId | null;
  onSelectTheme: (themeId: ThemeId | null) => void;
}

export function BuildDock({
  variant,
  gold,
  level,
  activeBuildTheme,
  onSelectTheme,
}: BuildDockProps) {
  const availableThemes = THEME_ORDER.filter(
    (id) => THEMES[id].unlockLevel <= level
  );

  const toggleTheme = (id: ThemeId) => {
    onSelectTheme(activeBuildTheme === id ? null : id);
  };

  if (variant === 'mobile') {
    return (
      <div className="w-full bg-[#FBF3DF] border-t border-[#E3D3AC] px-2 py-2 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto parchment-scroll">
          {availableThemes.map((id) => {
            const def = THEMES[id];
            const affordable = gold >= def.cost;
            const isSelected = activeBuildTheme === id;

            return (
              <button
                key={id}
                type="button"
                disabled={!affordable}
                onClick={() => toggleTheme(id)}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border shrink-0 transition-all duration-150 ${
                  isSelected
                    ? 'bg-[#F3E2BD] border-[#C9962E] ring-2 ring-[#C9962E]/50'
                    : affordable
                      ? 'bg-[#FDF8EC] border-[#E3D3AC]'
                      : 'bg-[#EFE6D2] border-[#DFD2B6] opacity-55 grayscale'
                }`}
              >
                <ThemeIcon themeId={id} className="w-4 h-4 text-[#14524A]" />
                <div className="text-right leading-tight">
                  <div className="text-xs font-extrabold text-[#2B2118] whitespace-nowrap">
                    {STRINGS.themes[id].name}
                  </div>
                  <div className="text-[10px] font-bold text-[#8A5F12] tabular-nums-latin">
                    {def.cost} {STRINGS.buildDock.goldUnit}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <aside className="flex flex-col w-[210px] shrink-0 p-2.5 bg-[#0C332D] border-l border-[#1A5047]">
      <div className="parchment-panel flex-1 flex flex-col overflow-hidden p-3">
        <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-[#E3D3AC]">
          <div className="flex items-center gap-1.5 text-[#2B2118]">
            <Hammer className="w-4 h-4 text-[#14524A]" />
            <h2 className="text-sm font-extrabold">{STRINGS.buildDock.title}</h2>
          </div>
          {activeBuildTheme && (
            <button
              type="button"
              onClick={() => onSelectTheme(null)}
              className="text-[11px] font-bold text-[#14524A] hover:underline flex items-center gap-0.5"
            >
              <X className="w-3 h-3" />
              <span>{STRINGS.buildDock.cancelBuild}</span>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto parchment-scroll space-y-2 pl-0.5">
          {availableThemes.map((id) => {
            const def = THEMES[id];
            const affordable = gold >= def.cost;
            const isSelected = activeBuildTheme === id;

            return (
              <button
                key={id}
                type="button"
                disabled={!affordable}
                onClick={() => toggleTheme(id)}
                className={`w-full text-right p-2.5 rounded-xl border transition-all duration-150 ${
                  isSelected
                    ? 'bg-[#F3E2BD] border-[#C9962E] ring-2 ring-[#C9962E]/50'
                    : affordable
                      ? 'bg-[#FDF8EC] border-[#E3D3AC] hover:border-[#C9962E] hover:bg-[#F7EBD0]'
                      : 'bg-[#EFE6D2] border-[#DFD2B6] opacity-55 grayscale'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#14524A]/10 text-[#14524A] flex items-center justify-center shrink-0">
                      <ThemeIcon themeId={id} className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold text-[#2B2118] truncate">
                        {STRINGS.themes[id].name}
                      </div>
                      <div className="text-[11px] font-semibold text-[#6F5C43]">
                        {STRINGS.footprint[def.footprint]} ·{' '}
                        {STRINGS.buildDock.workersNeeded(def.workers)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-extrabold text-[#8A5F12] shrink-0">
                    <Coins className="w-3.5 h-3.5 text-[#C9962E]" />
                    <span className="tabular-nums-latin">{def.cost}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {level === 1 && (
          <p className="mt-2.5 pt-2 border-t border-[#E3D3AC] text-[11px] leading-relaxed text-[#6F5C43]">
            {STRINGS.buildDock.level2Teaser}
          </p>
        )}
      </div>
    </aside>
  );
}
