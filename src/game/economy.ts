import {
  BASE_BUY_PRICES,
  GRAND_MARKET_SELL_BONUS,
  INFLATION_BASKET_WEIGHTS,
  PRICE_BANDS,
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

export function computeInflationIndex(prices: PriceMap): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(INFLATION_BASKET_WEIGHTS) as Array<
    [TradedResourceKey, number]
  >) {
    const base = BASE_BUY_PRICES[key];
    const current = prices[key] ?? base;
    if (base > 0 && weight > 0) {
      weightedSum += weight * (current / base);
      totalWeight += weight;
    }
  }

  if (totalWeight <= 0) return 100;
  return Math.round((100 * weightedSum) / totalWeight);
}

export interface BourseRolloverResult {
  prices: PriceMap;
  previousPrices: PriceMap;
  biggestMove: PriceMoveSummary | null;
  tickerMessage: string;
  inflationIndex: number;
}

export function rolloverBoursePrices(
  currentPrices: PriceMap,
  dailyBought: TradeVolumeMap,
  dailySold: TradeVolumeMap,
  level: 1 | 2
): BourseRolloverResult {
  const previousPrices: PriceMap = { ...BASE_BUY_PRICES, ...currentPrices };
  const nextPrices: PriceMap = { ...BASE_BUY_PRICES, ...currentPrices };

  const band = level === 1 ? PRICE_BANDS.level1 : PRICE_BANDS.level2;
  const noiseRange = level === 1 ? 0.035 : 0.07;

  let biggestMove: PriceMoveSummary | null = null;

  for (const resource of TRADED_RESOURCES) {
    const prev = previousPrices[resource];
    const base = BASE_BUY_PRICES[resource];

    const revert = (base - prev) * 0.1;
    const netSold = (dailySold[resource] ?? 0) - (dailyBought[resource] ?? 0);
    const pressurePct = Math.max(-0.06, Math.min(0.06, -netSold * 0.004));
    const noisePct = (Math.random() * 2 - 1) * noiseRange;

    const raw = prev + revert + prev * (pressurePct + noisePct);
    const minPrice = Math.max(1, Math.floor(base * band.lo));
    const maxPrice = Math.ceil(base * band.hi);
    const clampedNext = Math.max(minPrice, Math.min(maxPrice, Math.round(raw)));

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
    inflationIndex: computeInflationIndex(nextPrices),
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
