import { Coins, Hammer, ShoppingBag } from 'lucide-react';
import { MATERIAL_PRODUCER_THEME, THEMES } from '../game/constants';
import { getEffectiveBuyPrice } from '../game/economy';
import { checkMaterialCosts } from '../game/production';
import { STRINGS } from '../game/strings';
import type {
  Cube,
  PriceMap,
  ThemeId,
  TradedResourceKey,
  Warehouse,
} from '../game/types';
import { ResourceIcon } from './ResourceIcon';

interface MaterialRequirementsCardProps {
  themeId: ThemeId;
  level: 1 | 2;
  warehouse: Warehouse;
  gold: number;
  prices: PriceMap;
  cubes: Cube[];
  showActions?: boolean;
  onBuyMaterials?: (items: Partial<Record<TradedResourceKey, number>>) => void;
  onBuildProducer?: (resource: TradedResourceKey) => void;
}

export function MaterialRequirementsCard({
  themeId,
  level,
  warehouse,
  gold,
  prices,
  cubes,
  showActions = false,
  onBuyMaterials,
  onBuildProducer,
}: MaterialRequirementsCardProps) {
  if (level < 2) return null;

  const def = THEMES[themeId];
  const matEntries = def.materialCosts
    ? (
        Object.entries(def.materialCosts) as Array<[TradedResourceKey, number]>
      ).filter(([, amt]) => amt > 0)
    : [];

  if (matEntries.length === 0) return null;

  const matCheck = checkMaterialCosts(warehouse, themeId, level);
  const missingItems: Partial<Record<TradedResourceKey, number>> = {};
  let totalMissingGold = 0;

  for (const m of matCheck.missing) {
    const qty = Math.max(0, m.needed - m.have);
    if (qty > 0) {
      missingItems[m.resource] = qty;
      totalMissingGold += getEffectiveBuyPrice(prices[m.resource], cubes) * qty;
    }
  }

  const firstMissing = matCheck.missing[0]?.resource ?? null;
  const producerTheme = firstMissing
    ? MATERIAL_PRODUCER_THEME[firstMissing]
    : undefined;
  const canAffordBuy = totalMissingGold > 0 && gold >= totalMissingGold;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center flex-wrap gap-1.5">
        {matEntries.map(([res, needed]) => {
          const have = warehouse[res] ?? 0;
          const covered = have >= needed;
          return (
            <span
              key={res}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-extrabold tabular-nums-latin ${
                covered
                  ? 'bg-[#E3F3E6] border-[#9CD0A7] text-[#1E6B34]'
                  : 'bg-[#FBE2DF] border-[#E5ABA3] text-[#9E2A1F]'
              }`}
            >
              <ResourceIcon resource={res} className="w-3 h-3 shrink-0" />
              <span>{STRINGS.resources[res]}</span>
              <span>
                {have}/{needed}
              </span>
            </span>
          );
        })}
      </div>

      {showActions && !matCheck.ok && (
        <div className="pt-1 space-y-1.5">
          {onBuyMaterials && (
            <button
              type="button"
              disabled={!canAffordBuy}
              onClick={(e) => {
                e.stopPropagation();
                onBuyMaterials(missingItems);
              }}
              className="w-full py-1.5 px-2 rounded-lg bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-50 text-white text-[11px] font-extrabold flex items-center justify-between gap-1.5 transition-colors"
            >
              <span className="flex items-center gap-1 min-w-0 truncate">
                <ShoppingBag className="w-3.5 h-3.5 shrink-0 text-[#F2CA6B]" />
                <span className="truncate">اشترِ الناقص من البورصة</span>
              </span>
              <span className="inline-flex items-center gap-0.5 text-[#F2CA6B] shrink-0 tabular-nums-latin">
                <Coins className="w-3 h-3" />
                <span>{totalMissingGold}</span>
              </span>
            </button>
          )}

          {firstMissing && producerTheme && onBuildProducer && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBuildProducer(firstMissing);
              }}
              className="w-full py-1.5 px-2 rounded-lg bg-[#EFE0BC] hover:bg-[#E5CF9D] border border-[#D4B878] text-[#2B2118] text-[11px] font-extrabold flex items-center justify-center gap-1 transition-colors"
            >
              <Hammer className="w-3.5 h-3.5 shrink-0 text-[#8A5F12]" />
              <span>ابنِ منتج الناقص</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
