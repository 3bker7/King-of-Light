import {
  BASE_BUY_PRICES,
  BOURSE_VOLUME_MODIFIER,
  BOURSE_VOLUME_THRESHOLD,
  GRAND_MARKET_SELL_BONUS,
  LEVEL_1_PRICE_DRIFT_RANGE,
  LEVEL_2_PRICE_DRIFT_RANGE,
  MAX_BOURSE_PRICE_MULTIPLIER,
  MIN_BOURSE_PRICE,
  SELL_PRICE_RATIO,
  TRADE_OFFICE_BUY_DISCOUNT,
  TRADED_RESOURCES,
} from './constants';
import { hasThemeBuilt } from './people';
import { STRINGS } from './strings';
import type {
  Cube,
  PriceMap,
  PriceMoveSummary,
  TradedResourceKey,
  TradeVolumeMap,
  Warehouse,
} from './types';

export function getEffectiveBuyPrice(baseBuyPrice: number, cubes?: Cube[]): number {
  const hasOffice = cubes ? hasThemeBuilt(cubes, 'trade_office') : false;
  if (!hasOffice) return baseBuyPrice;
  return Math.max(1, Math.round(baseBuyPrice * (1 - TRADE_OFFICE_BUY_DISCOUNT)));
}

export function getSellPrice(buyPrice: number, cubes?: Cube[]): number {
  const hasGrandMarket = cubes ? hasThemeBuilt(cubes, 'grand_market') : false;
  const baseSell = Math.floor(buyPrice * SELL_PRICE_RATIO);
  if (!hasGrandMarket) return Math.max(0, baseSell);
  return Math.max(1, Math.floor(buyPrice * SELL_PRICE_RATIO * (1 + GRAND_MARKET_SELL_BONUS)));
}

export function generateTickerForMove(move: PriceMoveSummary | null): string {
  if (!move || move.percentChange === 0) {
    return move
      ? STRINGS.bourse.tickerFlat(move.resource)
      : STRINGS.bourse.defaultTicker;
  }
  const absPct = Math.abs(Math.round(move.percentChange));
  if (move.percentChange > 0) {
    return STRINGS.bourse.tickerUp(move.resource, absPct);
  }
  return STRINGS.bourse.tickerDown(move.resource, absPct);
}

export interface BourseRolloverResult {
  prices: PriceMap;
  previousPrices: PriceMap;
  biggestMove: PriceMoveSummary | null;
  tickerMessage: string;
}

export function rolloverBoursePrices(
  currentPrices: PriceMap,
  dailyBought: TradeVolumeMap,
  dailySold: TradeVolumeMap,
  level: 1 | 2
): BourseRolloverResult {
  const previousPrices: PriceMap = { ...BASE_BUY_PRICES, ...currentPrices };
  const nextPrices: PriceMap = { ...BASE_BUY_PRICES, ...currentPrices };

  const driftRange =
    level === 1 ? LEVEL_1_PRICE_DRIFT_RANGE : LEVEL_2_PRICE_DRIFT_RANGE;

  let biggestMove: PriceMoveSummary | null = null;

  for (const resource of TRADED_RESOURCES) {
    let r = (Math.random() * 2 - 1) * driftRange;

    if (level >= 2) {
      if ((dailySold[resource] ?? 0) > BOURSE_VOLUME_THRESHOLD) {
        r -= BOURSE_VOLUME_MODIFIER;
      }
      if ((dailyBought[resource] ?? 0) > BOURSE_VOLUME_THRESHOLD) {
        r += BOURSE_VOLUME_MODIFIER;
      }
    }

    const prev = previousPrices[resource];
    const base = BASE_BUY_PRICES[resource];
    const maxPrice = base * MAX_BOURSE_PRICE_MULTIPLIER;
    const rawNext = Math.round(prev * (1 + r));
    const clampedNext = Math.max(MIN_BOURSE_PRICE, Math.min(maxPrice, rawNext));

    nextPrices[resource] = clampedNext;

    const pctChange = prev > 0 ? ((clampedNext - prev) / prev) * 100 : 0;
    if (
      !biggestMove ||
      Math.abs(pctChange) > Math.abs(biggestMove.percentChange)
    ) {
      biggestMove = {
        resource,
        previousPrice: prev,
        newPrice: clampedNext,
        percentChange: pctChange,
      };
    }
  }

  return {
    prices: nextPrices,
    previousPrices,
    biggestMove,
    tickerMessage: generateTickerForMove(biggestMove),
  };
}

export interface TradeResult {
  gold: number;
  warehouse: Warehouse;
  dailyBought: TradeVolumeMap;
  dailySold: TradeVolumeMap;
  tradedQty: number;
}

export function executeTrade(
  cubes: Cube[],
  gold: number,
  warehouse: Warehouse,
  prices: PriceMap,
  dailyBought: TradeVolumeMap,
  dailySold: TradeVolumeMap,
  resource: TradedResourceKey,
  side: 'buy' | 'sell',
  quantity: number | 'max'
): TradeResult {
  const nextWarehouse: Warehouse = { ...warehouse };
  const nextBought: TradeVolumeMap = { ...dailyBought };
  const nextSold: TradeVolumeMap = { ...dailySold };

  if (side === 'buy') {
    const unitPrice = getEffectiveBuyPrice(prices[resource], cubes);
    const maxAffordable = unitPrice > 0 ? Math.floor(gold / unitPrice) : 0;
    const actualQty =
      quantity === 'max'
        ? maxAffordable
        : Math.max(0, Math.min(quantity, maxAffordable));

    if (actualQty <= 0) {
      return {
        gold,
        warehouse: nextWarehouse,
        dailyBought: nextBought,
        dailySold: nextSold,
        tradedQty: 0,
      };
    }

    const totalCost = actualQty * unitPrice;
    nextWarehouse[resource] = (nextWarehouse[resource] ?? 0) + actualQty;
    nextBought[resource] = (nextBought[resource] ?? 0) + actualQty;

    return {
      gold: Math.max(0, gold - totalCost),
      warehouse: nextWarehouse,
      dailyBought: nextBought,
      dailySold: nextSold,
      tradedQty: actualQty,
    };
  }

  // Sell
  const unitSellPrice = getSellPrice(prices[resource], cubes);
  const inStock = Math.max(0, warehouse[resource] ?? 0);
  const actualQty =
    quantity === 'max' ? inStock : Math.max(0, Math.min(quantity, inStock));

  if (actualQty <= 0) {
    return {
      gold,
      warehouse: nextWarehouse,
      dailyBought: nextBought,
      dailySold: nextSold,
      tradedQty: 0,
    };
  }

  nextWarehouse[resource] = Math.max(0, (nextWarehouse[resource] ?? 0) - actualQty);
  nextSold[resource] = (nextSold[resource] ?? 0) + actualQty;

  return {
    gold: Math.max(0, gold + actualQty * unitSellPrice),
    warehouse: nextWarehouse,
    dailyBought: nextBought,
    dailySold: nextSold,
    tradedQty: actualQty,
  };
}
