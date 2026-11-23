import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { TRADE_BATCH_QUANTITIES, TRADED_RESOURCES } from '../game/constants';
import { getSellPrice } from '../game/economy';
import { STRINGS } from '../game/strings';
import type { GameState, TradedResourceKey } from '../game/types';
import { ResourceIcon } from './ResourceIcon';

interface BoursePanelProps {
  state: GameState;
  compact?: boolean;
  onTrade: (
    resource: TradedResourceKey,
    side: 'buy' | 'sell',
    quantity: number | 'max'
  ) => void;
}

export function BoursePanel({
  state,
  compact = false,
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
      <p className="text-[11px] leading-relaxed text-[#6F5C43]">
        {STRINGS.bourse.subtitle}
      </p>

      <div className={compact ? 'space-y-2.5' : 'grid grid-cols-1 sm:grid-cols-2 gap-3'}>
        {TRADED_RESOURCES.map((resource) => {
          const buyPrice = state.prices[resource];
          const prevPrice = state.previousPrices[resource] ?? buyPrice;
          const sellPrice = getSellPrice(buyPrice);
          const stock = state.warehouse[resource];
          const diff = buyPrice - prevPrice;
          const pct = prevPrice > 0 ? Math.round((diff / prevPrice) * 100) : 0;

          const maxBuy = buyPrice > 0 ? Math.floor(state.gold / buyPrice) : 0;
          const canSellAny = stock > 0 && sellPrice > 0;

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
                    disabled={!canSellAny || stock < qty}
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
    </div>
  );
}
