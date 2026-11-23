import {
  Coins,
  Crown,
  Hammer,
  Heart,
  Lock,
  Mountain,
  Pickaxe,
  Store,
  Wheat,
  X,
} from 'lucide-react';
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
  gold: number;
  level: 1 | 2;
  warehouse: Warehouse;
  activeBuildTheme: ThemeId | null;
  openCategory: ThemeCategory | null;
  pulsingTheme: ThemeId | null;
  kingdomOpen: boolean;
  onToggleCategory: (cat: ThemeCategory | null) => void;
  onSelectTheme: (themeId: ThemeId | null, closePanel?: boolean) => void;
  onToggleKingdom: () => void;
}

function CategoryIcon({
  category,
  className = 'w-5 h-5',
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
  gold,
  level,
  warehouse,
  activeBuildTheme,
  openCategory,
  pulsingTheme,
  kingdomOpen,
  onToggleCategory,
  onSelectTheme,
  onToggleKingdom,
}: BuildDockProps) {
  const getUnlockedThemes = (cat: ThemeCategory): ThemeId[] =>
    CATEGORY_THEMES[cat].filter((id) => THEMES[id].unlockLevel <= level);

  const handlePickTheme = (id: ThemeId) => {
    const next = activeBuildTheme === id ? null : id;
    // Element 1.2: choosing a theme collapses the panel back to the rail
    onSelectTheme(next, true);
  };

  const openUnlockedThemes = openCategory ? getUnlockedThemes(openCategory) : [];

  const renderThemeCards = () => (
    <div className="space-y-1.5">
      {openUnlockedThemes.map((id) => {
        const def = THEMES[id];
        const matCheck = checkMaterialCosts(warehouse, id);
        const affordable = gold >= def.cost && matCheck.ok;
        const isSelected = activeBuildTheme === id;
        const isPulsing = pulsingTheme === id;
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
            onClick={() => handlePickTheme(id)}
            className={`w-full text-right p-2.5 rounded-xl border transition-all duration-150 space-y-1.5 ${
              isPulsing
                ? 'bg-[#F5E0AC] border-[#C9962E] ring-2 ring-[#C9962E] animate-pulse'
                : isSelected
                  ? 'bg-[#F3E2BD] border-[#C9962E] ring-2 ring-[#C9962E]/60'
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
                <Coins className="w-3.5 h-3.5 text-[#C9962E]" />
                <span className="tabular-nums-latin">{def.cost}</span>
              </div>
            </div>

            {(matEntries.length > 0 || def.rockyOnly) && (
              <div className="flex items-center flex-wrap gap-2 pt-1 border-t border-[#EFE3C5] text-[10px] font-bold">
                {matEntries.map(([res, amt]) => (
                  <span
                    key={res}
                    className={`tabular-nums-latin ${
                      warehouse[res] < amt ? 'text-[#A83629]' : 'text-[#4F3F2B]'
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
  );

  return (
    <>
      {/* Desktop Slim Icon Rail (56px wide, right edge in RTL) */}
      <nav
        aria-label={STRINGS.buildDock.title}
        className="hidden lg:flex flex-col items-center justify-between w-[56px] shrink-0 py-2.5 bg-[#0E3A34] border-l border-[#1C5B52] z-30"
      >
        <div className="flex flex-col items-center gap-2">
          {/* Kingdom / Palace summary button */}
          <button
            type="button"
            onClick={onToggleKingdom}
            title={STRINGS.inspector.palaceTitle}
            aria-label={STRINGS.inspector.palaceTitle}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors border ${
              kingdomOpen
                ? 'bg-[#C9962E] border-[#F2CA6B] text-[#2B2118] shadow-md'
                : 'bg-[#14524A] border-[#1F6A60] text-[#F2CA6B] hover:bg-[#1B685E]'
            }`}
          >
            <Crown className="w-5 h-5" />
          </button>

          <div className="w-7 h-px bg-[#1E5E55]" />

          {/* 5 Build Category Icons */}
          {CATEGORY_ORDER.map((cat) => {
            const unlocked = getUnlockedThemes(cat);
            const locked = unlocked.length === 0;
            const isOpen = openCategory === cat && !locked;

            return (
              <button
                key={cat}
                type="button"
                disabled={locked}
                onClick={() => onToggleCategory(isOpen ? null : cat)}
                title={
                  locked
                    ? `${STRINGS.categories[cat]} (${STRINGS.buildDock.level2LockedCat})`
                    : STRINGS.categories[cat]
                }
                aria-label={STRINGS.categories[cat]}
                className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-colors border ${
                  isOpen
                    ? 'bg-[#FBF3DF] border-[#C9962E] text-[#14524A] shadow-md'
                    : locked
                      ? 'bg-[#0B2E29] border-[#16463F] text-[#5F8A82] opacity-60'
                      : 'bg-[#14524A] border-[#1E6259] text-[#FBF3DF] hover:bg-[#1C6A60]'
                }`}
              >
                <CategoryIcon category={cat} className="w-5 h-5" />
                {locked && (
                  <Lock className="w-2.5 h-2.5 absolute bottom-1 left-1 text-[#C9962E]" />
                )}
              </button>
            );
          })}
        </div>

        {activeBuildTheme && (
          <button
            type="button"
            onClick={() => onSelectTheme(null, true)}
            title={STRINGS.buildDock.cancelBuild}
            aria-label={STRINGS.buildDock.cancelBuild}
            className="w-10 h-10 rounded-xl bg-[#C44536] hover:bg-[#D45242] text-white flex items-center justify-center shadow-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </nav>

      {/* Desktop Slide-Out Category Overlay Panel (260px, overlays map right edge, does NOT shrink canvas) */}
      {openCategory && openUnlockedThemes.length > 0 && (
        <aside
          aria-label={STRINGS.categories[openCategory]}
          className="hidden lg:flex flex-col absolute top-2 bottom-3 right-[64px] w-[260px] z-30 parchment-panel border border-[#C9962E] shadow-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2.5 bg-[#F4E7C8] border-b border-[#E3D3AC]">
            <div className="flex items-center gap-2 text-[#2B2118] min-w-0">
              <CategoryIcon
                category={openCategory}
                className="w-4 h-4 text-[#14524A] shrink-0"
              />
              <h2 className="text-xs font-extrabold truncate">
                {STRINGS.categories[openCategory]}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onToggleCategory(null)}
              aria-label={STRINGS.modals.close}
              className="w-7 h-7 rounded-lg hover:bg-[#E7D5AE] text-[#4F3F2B] flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto parchment-scroll p-2.5">
            {renderThemeCards()}
          </div>
        </aside>
      )}

      {/* Mobile Bottom Sheet for Open Build Category (max 45% height, above 56px bottom rail) */}
      {openCategory && openUnlockedThemes.length > 0 && (
        <div className="lg:hidden fixed inset-x-0 bottom-[56px] z-30 px-2 pb-1.5 pointer-events-none">
          <div className="pointer-events-auto w-full max-h-[45dvh] bg-[#FBF3DF] border-2 border-[#C9962E] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-[#F4E7C8] border-b border-[#E3D3AC]">
              <div className="flex items-center gap-1.5 text-[#2B2118]">
                <CategoryIcon
                  category={openCategory}
                  className="w-4 h-4 text-[#14524A]"
                />
                <span className="text-xs font-extrabold">
                  {STRINGS.categories[openCategory]}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onToggleCategory(null)}
                aria-label={STRINGS.modals.close}
                className="w-7 h-7 rounded-lg bg-[#E7D5AE]/60 text-[#2B2118] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto parchment-scroll p-2.5">
              {renderThemeCards()}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Icon Bar (56px tall) */}
      <nav
        aria-label={STRINGS.buildDock.title}
        className="lg:hidden h-[56px] w-full bg-[#0E3A34] border-t border-[#1C5B52] px-2 flex items-center justify-around gap-1 shrink-0 z-30"
      >
        <button
          type="button"
          onClick={onToggleKingdom}
          title={STRINGS.inspector.palaceTitle}
          aria-label={STRINGS.inspector.palaceTitle}
          className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors border ${
            kingdomOpen
              ? 'bg-[#C9962E] border-[#F2CA6B] text-[#2B2118]'
              : 'bg-[#14524A] border-[#1F6A60] text-[#F2CA6B]'
          }`}
        >
          <Crown className="w-5 h-5" />
        </button>

        {CATEGORY_ORDER.map((cat) => {
          const unlocked = getUnlockedThemes(cat);
          const locked = unlocked.length === 0;
          const isOpen = openCategory === cat && !locked;

          return (
            <button
              key={cat}
              type="button"
              disabled={locked}
              onClick={() => onToggleCategory(isOpen ? null : cat)}
              title={
                locked
                  ? `${STRINGS.categories[cat]} (${STRINGS.buildDock.level2LockedCat})`
                  : STRINGS.categories[cat]
              }
              aria-label={STRINGS.categories[cat]}
              className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-colors border ${
                isOpen
                  ? 'bg-[#FBF3DF] border-[#C9962E] text-[#14524A]'
                  : locked
                    ? 'bg-[#0B2E29] border-[#16463F] text-[#5F8A82] opacity-60'
                    : 'bg-[#14524A] border-[#1E6259] text-[#FBF3DF]'
              }`}
            >
              <CategoryIcon category={cat} className="w-5 h-5" />
              {locked && (
                <Lock className="w-2.5 h-2.5 absolute bottom-1 left-1 text-[#C9962E]" />
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}
