import {
  ChevronDown,
  Coins,
  Hammer,
  Heart,
  Lock,
  Mountain,
  Pickaxe,
  Store,
  Wheat,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { CATEGORY_ORDER, CATEGORY_THEMES, THEMES } from '../game/constants';
import { checkMaterialCosts } from '../game/production';
import { STRINGS } from '../game/strings';
import type {
  ThemeCategory,
  ThemeId,
  TradedResourceKey,
  Warehouse,
} from '../game/types';
import { ThemeIcon } from './ResourceIcon';

interface BuildDockProps {
  variant: 'desktop' | 'mobile';
  gold: number;
  level: 1 | 2;
  warehouse: Warehouse;
  activeBuildTheme: ThemeId | null;
  onSelectTheme: (themeId: ThemeId | null) => void;
}

function CategoryIcon({
  category,
  className = 'w-4 h-4',
}: {
  category: ThemeCategory;
  className?: string;
}) {
  switch (category) {
    case 'food':
      return <Wheat className={className} />;
    case 'mines':
      return <Pickaxe className={className} />;
    case 'industry':
      return <Hammer className={className} />;
    case 'trade':
      return <Store className={className} />;
    case 'welfare':
      return <Heart className={className} />;
  }
}

export function BuildDock({
  variant,
  gold,
  level,
  warehouse,
  activeBuildTheme,
  onSelectTheme,
}: BuildDockProps) {
  // User-click controlled category state (never auto-switched by game ticks or state updates)
  const [openCategory, setOpenCategory] = useState<ThemeCategory | null>('food');
  const [mobileCategory, setMobileCategory] = useState<ThemeCategory>('food');

  const toggleTheme = (id: ThemeId) => {
    onSelectTheme(activeBuildTheme === id ? null : id);
  };

  const getUnlockedThemes = (cat: ThemeCategory): ThemeId[] =>
    CATEGORY_THEMES[cat].filter((id) => THEMES[id].unlockLevel <= level);

  if (variant === 'mobile') {
    const activeThemes = getUnlockedThemes(mobileCategory);

    return (
      <div className="w-full bg-[#FBF3DF] border-t border-[#E3D3AC] px-2 py-1.5 space-y-1.5 shrink-0">
        {/* Category selector strip */}
        <div className="flex items-center gap-1 overflow-x-auto parchment-scroll">
          {CATEGORY_ORDER.map((cat) => {
            const unlocked = getUnlockedThemes(cat);
            const locked = unlocked.length === 0;
            const selected = mobileCategory === cat && !locked;

            return (
              <button
                key={cat}
                type="button"
                disabled={locked}
                onClick={() => setMobileCategory(cat)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-extrabold whitespace-nowrap shrink-0 transition-colors ${
                  selected
                    ? 'bg-[#14524A] border-[#14524A] text-white'
                    : locked
                      ? 'bg-[#EFE6D2] border-[#DFD2B6] text-[#8E7D63] opacity-65'
                      : 'bg-[#FDF8EC] border-[#E3D3AC] text-[#2B2118]'
                }`}
              >
                {locked ? (
                  <Lock className="w-3 h-3" />
                ) : (
                  <CategoryIcon category={cat} className="w-3.5 h-3.5" />
                )}
                <span>{STRINGS.categories[cat]}</span>
              </button>
            );
          })}
        </div>

        {/* Horizontal strip of unlocked themes in active category */}
        <div className="flex items-center gap-1.5 overflow-x-auto parchment-scroll">
          {activeThemes.map((id) => {
            const def = THEMES[id];
            const matCheck = checkMaterialCosts(warehouse, id);
            const affordable = gold >= def.cost && matCheck.ok;
            const isSelected = activeBuildTheme === id;
            const matEntries = def.materialCosts
              ? (Object.entries(def.materialCosts) as Array<
                  [TradedResourceKey, number]
                >)
              : [];

            return (
              <button
                key={id}
                type="button"
                disabled={!affordable}
                onClick={() => toggleTheme(id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border shrink-0 transition-all duration-150 ${
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
                  <div className="flex items-center gap-1.5 text-[10px] font-bold tabular-nums-latin">
                    <span className="text-[#8A5F12]">
                      {def.cost} {STRINGS.buildDock.goldUnit}
                    </span>
                    {matEntries.map(([res, amt]) => (
                      <span
                        key={res}
                        className={
                          warehouse[res] < amt
                            ? 'text-[#A83629]'
                            : 'text-[#6F5C43]'
                        }
                      >
                        {STRINGS.resources[res]} {amt}
                      </span>
                    ))}
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
    <aside className="flex flex-col w-[220px] shrink-0 p-2.5 bg-[#0C332D] border-l border-[#1A5047]">
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
          {CATEGORY_ORDER.map((cat) => {
            const unlockedThemes = getUnlockedThemes(cat);
            const isLocked = unlockedThemes.length === 0;
            const isOpen = !isLocked && openCategory === cat;

            return (
              <div
                key={cat}
                className="rounded-xl border border-[#E3D3AC] bg-[#F7ECD4] overflow-hidden"
              >
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() =>
                    setOpenCategory((prev) => (prev === cat ? null : cat))
                  }
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 text-right transition-colors ${
                    isLocked
                      ? 'opacity-65 cursor-not-allowed bg-[#EFE4CC]'
                      : isOpen
                        ? 'bg-[#14524A] text-white'
                        : 'hover:bg-[#EFE2C2] text-[#2B2118]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isLocked ? (
                      <Lock className="w-3.5 h-3.5 shrink-0 text-[#7C684C]" />
                    ) : (
                      <CategoryIcon
                        category={cat}
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isOpen ? 'text-[#F2CA6B]' : 'text-[#14524A]'
                        }`}
                      />
                    )}
                    <span className="text-xs font-extrabold truncate">
                      {STRINGS.categories[cat]}
                    </span>
                  </div>

                  {isLocked ? (
                    <span className="text-[10px] font-bold text-[#7C684C] shrink-0">
                      {STRINGS.buildDock.level2LockedCat}
                    </span>
                  ) : (
                    <ChevronDown
                      className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${
                        isOpen ? 'rotate-180 text-white' : 'text-[#6F5C43]'
                      }`}
                    />
                  )}
                </button>

                {isOpen && (
                  <div className="p-1.5 space-y-1.5 bg-[#FBF3DF]">
                    {unlockedThemes.map((id) => {
                      const def = THEMES[id];
                      const matCheck = checkMaterialCosts(warehouse, id);
                      const affordable = gold >= def.cost && matCheck.ok;
                      const isSelected = activeBuildTheme === id;
                      const matEntries = def.materialCosts
                        ? (Object.entries(def.materialCosts) as Array<
                            [TradedResourceKey, number]
                          >)
                        : [];

                      return (
                        <button
                          key={id}
                          type="button"
                          disabled={!affordable}
                          onClick={() => toggleTheme(id)}
                          className={`w-full text-right p-2 rounded-xl border transition-all duration-150 space-y-1.5 ${
                            isSelected
                              ? 'bg-[#F3E2BD] border-[#C9962E] ring-2 ring-[#C9962E]/50'
                              : affordable
                                ? 'bg-[#FDF8EC] border-[#E3D3AC] hover:border-[#C9962E] hover:bg-[#F7EBD0]'
                                : 'bg-[#EFE6D2] border-[#DFD2B6] opacity-55 grayscale'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-7 h-7 rounded-lg bg-[#14524A]/10 text-[#14524A] flex items-center justify-center shrink-0">
                                <ThemeIcon themeId={id} className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-extrabold text-[#2B2118] truncate">
                                  {STRINGS.themes[id].name}
                                </div>
                                <div className="text-[10px] font-semibold text-[#6F5C43]">
                                  {STRINGS.footprint[def.footprint]} ·{' '}
                                  {STRINGS.buildDock.workersNeeded(def.workers)}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-0.5 text-xs font-extrabold text-[#8A5F12] shrink-0">
                              <Coins className="w-3 h-3 text-[#C9962E]" />
                              <span className="tabular-nums-latin">
                                {def.cost}
                              </span>
                            </div>
                          </div>

                          {(matEntries.length > 0 || def.rockyOnly) && (
                            <div className="flex items-center flex-wrap gap-1.5 pt-1 border-t border-[#EFE3C5] text-[10px] font-bold">
                              {matEntries.map(([res, amt]) => (
                                <span
                                  key={res}
                                  className={`tabular-nums-latin ${
                                    warehouse[res] < amt
                                      ? 'text-[#A83629]'
                                      : 'text-[#4F3F2B]'
                                  }`}
                                >
                                  {STRINGS.resources[res]}: {amt}
                                </span>
                              ))}
                              {def.rockyOnly && (
                                <span className="flex items-center gap-0.5 text-[#6F5C43]">
                                  <Mountain className="w-3 h-3 shrink-0" />
                                  <span>{STRINGS.buildDock.rockyOnlyTag}</span>
                                </span>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
