import {
  BASE_BUY_PRICES,
  BOURSE_VOLUME_MODIFIER,
  BOURSE_VOLUME_THRESHOLD,
  LEVEL_1_PRICE_DRIFT_RANGE,
  LEVEL_2_PRICE_DRIFT_RANGE,
  MAX_BOURSE_PRICE_MULTIPLIER,
  MIN_BOURSE_PRICE,
  SELL_PRICE_RATIO,
  TRADED_RESOURCES,
} from './constants';
import { STRINGS } from './strings';
import type {
  PriceMap,
  PriceMoveSummary,
  TradedResourceKey,
  TradeVolumeMap,
  Warehouse,
} from './types';

export function getSellPrice(buyPrice: number): number {
  return Math.max(0, Math.floor(buyPrice * SELL_PRICE_RATIO));
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
  const previousPrices: PriceMap = { ...currentPrices };
  const nextPrices: PriceMap = { ...currentPrices };

  // Level 1 safety rule: drift halved to [-0.07, +0.07] and NO flooding/surge modifiers.
  const driftRange =
    level === 1 ? LEVEL_1_PRICE_DRIFT_RANGE : LEVEL_2_PRICE_DRIFT_RANGE;

  let biggestMove: PriceMoveSummary | null = null;

  for (const resource of TRADED_RESOURCES) {
    let r = (Math.random() * 2 - 1) * driftRange;

    if (level >= 2) {
      if (dailySold[resource] > BOURSE_VOLUME_THRESHOLD) {
        r -= BOURSE_VOLUME_MODIFIER;
      }
      if (dailyBought[resource] > BOURSE_VOLUME_THRESHOLD) {
        r += BOURSE_VOLUME_MODIFIER;
      }
    }

    const prev = currentPrices[resource];
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
    const unitPrice = prices[resource];
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
    nextWarehouse[resource] = nextWarehouse[resource] + actualQty;
    nextBought[resource] = nextBought[resource] + actualQty;

    return {
      gold: Math.max(0, gold - totalCost),
      warehouse: nextWarehouse,
      dailyBought: nextBought,
      dailySold: nextSold,
      tradedQty: actualQty,
    };
  }

  // Sell
  const unitSellPrice = getSellPrice(prices[resource]);
  const inStock = Math.max(0, warehouse[resource]);
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

  nextWarehouse[resource] = Math.max(0, nextWarehouse[resource] - actualQty);
  nextSold[resource] = nextSold[resource] + actualQty;

  return {
    gold: Math.max(0, gold + actualQty * unitSellPrice),
    warehouse: nextWarehouse,
    dailyBought: nextBought,
    dailySold: nextSold,
    tradedQty: actualQty,
  };
}
