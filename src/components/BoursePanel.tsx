import {
  ArrowDownRight,
  ArrowUpRight,
  Gauge,
  Globe,
  Minus,
  Newspaper,
} from 'lucide-react';
import { TRADE_BATCH_QUANTITIES, TRADED_RESOURCES } from '../game/constants';
import { getEffectiveBuyPrice, getSellPrice } from '../game/economy';
import { STRINGS } from '../game/strings';
import type { GameState, TradedResourceKey } from '../game/types';
import {
  ONLINE_BOURSE_DAILY_KINGDOM_CAP,
  type WorldNewsletter,
} from '../net/worldTypes';
import { ResourceIcon } from './ResourceIcon';

interface BoursePanelProps {
  state: GameState;
  compact?: boolean;
  isWorldBourse?: boolean;
  worldBourseDay?: number | null;
  worldBourseUsedToday?: Partial<Record<TradedResourceKey, number>>;
  worldNewsletter?: WorldNewsletter | null;
  worldFromLocalLines?: string[];
  onTrade: (
    resource: TradedResourceKey,
    side: 'buy' | 'sell',
    quantity: number | 'max'
  ) => void;
}

function getInflationBadgeClass(index: number): string {
  if (index < 110) {
    return 'bg-[#E3F3E6] border-[#9CD0A7] text-[#2D6E3B]';
  }
  if (index <= 130) {
    return 'bg-[#F8E7C1] border-[#E2BA64] text-[#8A5F12]';
  }
  return 'bg-[#FBE2DF] border-[#E5ABA3] text-[#A83629]';
}

export function BoursePanel({
  state,
  compact = false,
  isWorldBourse = false,
  worldBourseDay = null,
  worldBourseUsedToday,
  worldNewsletter = null,
  worldFromLocalLines,
  onTrade,
}: BoursePanelProps) {
  if (state.level < 2) {
    return (
      <div className="py-6 text-center text-xs font-bold text-[#6F5C43]">
        {STRINGS.bourse.lockedHint}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="space-y-0.5">
          <p className="text-[11px] leading-relaxed text-[#6F5C43]">
            {STRINGS.bourse.subtitle}
          </p>
          {isWorldBourse && (
            <p className="text-[10px] font-bold text-[#14524A] tabular-nums-latin">
              حد التداول اليومي لكل مورد: {ONLINE_BOURSE_DAILY_KINGDOM_CAP} وحدة في يوم العالم
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
          {isWorldBourse && (
            <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border bg-[#E6F2EF] border-[#8CC3B8] text-[#14524A] text-xs font-extrabold">
              <Globe className="w-3.5 h-3.5 shrink-0" />
              <span>بورصة العالم</span>
              {worldBourseDay !== null && (
                <span className="text-[10px] opacity-80 tabular-nums-latin">
                  · يوم {worldBourseDay}
                </span>
              )}
            </div>
          )}
          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-extrabold tabular-nums-latin shrink-0 ${getInflationBadgeClass(
              state.inflationIndex
            )}`}
          >
            <Gauge className="w-3.5 h-3.5 shrink-0" />
            <span>مؤشر الغلاء: {state.inflationIndex}</span>
          </div>
        </div>
      </div>

      <div className={compact ? 'space-y-2.5' : 'grid grid-cols-1 sm:grid-cols-2 gap-3'}>
        {TRADED_RESOURCES.map((resource) => {
          const buyPrice = getEffectiveBuyPrice(
            state.prices[resource],
            state.cubes
          );
          const prevPrice = state.previousPrices[resource] ?? state.prices[resource];
          const sellPrice = getSellPrice(state.prices[resource], state.cubes);
          const stock = state.warehouse[resource];
          const diff = state.prices[resource] - prevPrice;
          const pct = prevPrice > 0 ? Math.round((diff / prevPrice) * 100) : 0;

          const usedToday = isWorldBourse
            ? Math.max(0, Math.floor(worldBourseUsedToday?.[resource] ?? 0))
            : 0;
          const remainingCap = isWorldBourse
            ? Math.max(0, ONLINE_BOURSE_DAILY_KINGDOM_CAP - usedToday)
            : Infinity;

          const rawMaxBuy = buyPrice > 0 ? Math.floor(state.gold / buyPrice) : 0;
          const maxBuy = Math.min(rawMaxBuy, remainingCap);
          const maxSell = Math.min(stock, remainingCap);
          const canSellAny = maxSell > 0 && sellPrice > 0;

          return (
            <div
              key={resource}
              className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2"
            >
              {/* Header row */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#14524A]/10 text-[#14524A] flex items-center justify-center">
                    <ResourceIcon resource={resource} className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-[#2B2118]">
                      {STRINGS.resources[resource]}
                    </div>
                    <div className="text-[11px] text-[#6F5C43]">
                      {STRINGS.bourse.inStock}:{' '}
                      <span className="font-extrabold text-[#2B2118] tabular-nums-latin">
                        {stock}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Price & Daily change */}
                <div className="text-left">
                  <div className="flex items-center justify-end gap-1 text-[11px] font-bold">
                    {diff > 0 ? (
                      <span className="text-[#3E9B4F] flex items-center gap-0.5 tabular-nums-latin">
                        <ArrowUpRight className="w-3 h-3" />+{pct}%
                      </span>
                    ) : diff < 0 ? (
                      <span className="text-[#C44536] flex items-center gap-0.5 tabular-nums-latin">
                        <ArrowDownRight className="w-3 h-3" />
                        {pct}%
                      </span>
                    ) : (
                      <span className="text-[#8A7759] flex items-center gap-0.5">
                        <Minus className="w-3 h-3" />
                        0%
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#6F5C43]">
                    {STRINGS.bourse.buyPrice}{' '}
                    <span className="font-extrabold text-[#8A5F12] tabular-nums-latin">
                      {buyPrice}
                    </span>{' '}
                    · {STRINGS.bourse.sellPrice}{' '}
                    <span className="font-extrabold text-[#14524A] tabular-nums-latin">
                      {sellPrice}
                    </span>
                  </div>
                </div>
              </div>

              {/* Buy row */}
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-extrabold text-[#14524A] w-9 shrink-0">
                  {STRINGS.bourse.buyAction}
                </span>
                {TRADE_BATCH_QUANTITIES.map((qty) => (
                  <button
                    key={`buy-${qty}`}
                    type="button"
                    disabled={maxBuy < qty}
                    onClick={() => onTrade(resource, 'buy', qty)}
                    className="flex-1 py-1 rounded-lg bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-40 text-white text-[11px] font-bold tabular-nums-latin transition-colors"
                  >
                    +{qty}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={maxBuy <= 0}
                  onClick={() => onTrade(resource, 'buy', 'max')}
                  className="flex-1 py-1 rounded-lg bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-40 text-white text-[11px] font-bold transition-colors"
                >
                  {STRINGS.bourse.maxLabel}
                </button>
              </div>

              {/* Sell row */}
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-extrabold text-[#8A5F12] w-9 shrink-0">
                  {STRINGS.bourse.sellAction}
                </span>
                {TRADE_BATCH_QUANTITIES.map((qty) => (
                  <button
                    key={`sell-${qty}`}
                    type="button"
                    disabled={!canSellAny || maxSell < qty}
                    onClick={() => onTrade(resource, 'sell', qty)}
                    className="flex-1 py-1 rounded-lg bg-[#EFE0BC] hover:bg-[#E5CF9D] disabled:opacity-40 text-[#2B2118] text-[11px] font-bold tabular-nums-latin transition-colors"
                  >
                    -{qty}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={!canSellAny}
                  onClick={() => onTrade(resource, 'sell', 'max')}
                  className="flex-1 py-1 rounded-lg bg-[#EFE0BC] hover:bg-[#E5CF9D] disabled:opacity-40 text-[#2B2118] text-[11px] font-bold transition-colors"
                >
                  {STRINGS.bourse.maxLabel}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {isWorldBourse && worldNewsletter && worldNewsletter.lines.length > 0 && (
        <div className="p-3 rounded-xl bg-[#F4E7C8] border border-[#C9962E] space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-[#2B2118]">
            <span className="flex items-center gap-1.5">
              <Newspaper className="w-4 h-4 text-[#14524A]" />
              <span>نشرة العالم</span>
            </span>
            <span className="text-[10px] font-bold text-[#6F5C43] tabular-nums-latin">
              يوم {worldNewsletter.day}
            </span>
          </div>
          <ul className="space-y-1 text-[11px] font-bold text-[#3B2F20] leading-relaxed">
            {worldNewsletter.lines.map((line, idx) => (
              <li key={`wn-${idx}`}>• {line}</li>
            ))}
          </ul>
        </div>
      )}

      {isWorldBourse && worldFromLocalLines && worldFromLocalLines.length > 0 && (
        <div className="p-2.5 rounded-xl bg-[#E6F2EF] border border-[#8CC3B8] space-y-1">
          <div className="text-[11px] font-extrabold text-[#14524A]">
            من العالم
          </div>
          <ul className="space-y-0.5 text-[11px] font-bold text-[#1E4B44] leading-relaxed">
            {worldFromLocalLines.map((line, idx) => (
              <li key={`fw-${idx}`}>• {line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
