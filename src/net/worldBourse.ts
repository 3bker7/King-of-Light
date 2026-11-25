import {
  BASE_BUY_PRICES,
  createEmptyTradeVolumes,
  createInitialPrices,
  PRICE_BANDS,
  TRADED_RESOURCES,
} from '../game/constants';
import {
  computeInflationIndex,
  generateTickerForMove,
} from '../game/economy';
import type {
  PriceMap,
  PriceMoveSummary,
  TradedResourceKey,
  TradeVolumeMap,
} from '../game/types';
import { getFirebaseServices, isOnlineWorldEnabled } from './firebase';
import {
  ONLINE_BOURSE_DAILY_KINGDOM_CAP,
  type WorldBourse,
  type WorldBourseKingdomVolume,
} from './worldTypes';

export const WORLD_DAY_MS = 86_400_000; // 1 UTC day per shared world day
export const WORLD_BOURSE_NOISE_RANGE = 0.035; // Prompt 2 Level 2 noise (0.07) halved

export function getWorldEpochDay(nowMs = Date.now()): number {
  return Math.floor(nowMs / WORLD_DAY_MS);
}

function pickTradedPrices(
  prices: PriceMap
): Record<TradedResourceKey, number> {
  const out = {} as Record<TradedResourceKey, number>;
  for (const res of TRADED_RESOURCES) {
    out[res] = prices[res] ?? BASE_BUY_PRICES[res];
  }
  return out;
}

function serializeWorldBourseForFirestore(bourse: WorldBourse, nowMs: number) {
  const prices = pickTradedPrices(bourse.prices);
  const previousPrices = pickTradedPrices(bourse.previousPrices ?? bourse.prices);
  return {
    day: Math.max(1, Math.trunc(bourse.day)),
    prices,
    previousPrices,
    inflationIndex: Math.round(bourse.inflationIndex),
    dailyBought: { ...createEmptyTradeVolumes(), ...bourse.dailyBought },
    dailySold: { ...createEmptyTradeVolumes(), ...bourse.dailySold },
    lastRollEpochDay:
      typeof bourse.lastRollEpochDay === 'number'
        ? Math.trunc(bourse.lastRollEpochDay)
        : getWorldEpochDay(nowMs),
    updatedAt: Math.trunc(nowMs),
  };
}

export function createInitialWorldBourse(nowMs = Date.now()): WorldBourse {
  const prices = createInitialPrices();
  return {
    day: 1,
    prices,
    previousPrices: { ...prices },
    inflationIndex: computeInflationIndex(prices),
    dailyBought: createEmptyTradeVolumes(),
    dailySold: createEmptyTradeVolumes(),
    lastRollEpochDay: getWorldEpochDay(nowMs),
    updatedAt: Math.trunc(nowMs),
  };
}

export interface WorldBourseRollResult {
  bourse: WorldBourse;
  biggestMove: PriceMoveSummary | null;
  tickerMessage: string;
}

/**
 * Element 3.2 & Harden 3:
 * Pure World Bourse day roll using Prompt 2 formula:
 * - Mean reversion: 10% toward BASE_BUY_PRICES
 * - Aggregate sell pressure: clamp(-netSold * 0.004, -0.06, +0.06)
 * - Halved noise: ±0.035 (half of Prompt 2 Level 2's ±0.07)
 * - Clamped strictly to Prompt 2 Level 2 bands [max(1, floor(base*0.6)), ceil(base*1.6)]
 * - Resets dailyBought/dailySold to 0, increments day += 1, recomputes inflationIndex
 */
export function computeWorldBourseRoll(
  current: WorldBourse,
  nowMs = Date.now(),
  rng: () => number = Math.random
): WorldBourseRollResult {
  const previousPrices: PriceMap = { ...BASE_BUY_PRICES, ...current.prices };
  const nextPrices: PriceMap = { ...BASE_BUY_PRICES, ...current.prices };
  const band = PRICE_BANDS.level2;

  let biggestMove: PriceMoveSummary | null = null;

  for (const resource of TRADED_RESOURCES) {
    const prev = previousPrices[resource];
    const base = BASE_BUY_PRICES[resource];

    const revert = (base - prev) * 0.1;
    const netSold =
      (current.dailySold[resource] ?? 0) - (current.dailyBought[resource] ?? 0);
    const pressurePct = Math.max(-0.06, Math.min(0.06, -netSold * 0.004));
    const noisePct = (rng() * 2 - 1) * WORLD_BOURSE_NOISE_RANGE;

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

  const nextBourse: WorldBourse = {
    day: Math.max(1, Math.trunc(current.day)) + 1,
    prices: nextPrices,
    previousPrices,
    inflationIndex: computeInflationIndex(nextPrices),
    dailyBought: createEmptyTradeVolumes(),
    dailySold: createEmptyTradeVolumes(),
    lastRollEpochDay: getWorldEpochDay(nowMs),
    updatedAt: Math.trunc(nowMs),
  };

  return {
    bourse: nextBourse,
    biggestMove,
    tickerMessage: generateTickerForMove(biggestMove),
  };
}

export interface VolumeDeltaBatch {
  bought?: Partial<Record<TradedResourceKey, number>>;
  sold?: Partial<Record<TradedResourceKey, number>>;
}

/**
 * Harden 3 pure transaction delta applier:
 * Enforces per-kingdom daily volume cap (500 units per resource per world day)
 * and NEVER modifies day, prices, or inflationIndex.
 */
export function applyCappedVolumeDeltas(
  currentBourse: WorldBourse,
  kingdomCounts: Partial<Record<TradedResourceKey, number>>,
  batch: VolumeDeltaBatch
): {
  nextBought: TradeVolumeMap;
  nextSold: TradeVolumeMap;
  nextKingdomCounts: Partial<Record<TradedResourceKey, number>>;
  appliedAny: boolean;
} {
  const nextBought: TradeVolumeMap = {
    ...createEmptyTradeVolumes(),
    ...currentBourse.dailyBought,
  };
  const nextSold: TradeVolumeMap = {
    ...createEmptyTradeVolumes(),
    ...currentBourse.dailySold,
  };
  const nextKingdomCounts: Partial<Record<TradedResourceKey, number>> = {
    ...kingdomCounts,
  };
  let appliedAny = false;

  for (const res of TRADED_RESOURCES) {
    const rawBuy = Math.max(0, Math.floor(batch.bought?.[res] ?? 0));
    const rawSell = Math.max(0, Math.floor(batch.sold?.[res] ?? 0));
    if (rawBuy === 0 && rawSell === 0) continue;

    let used = Math.max(0, Math.floor(nextKingdomCounts[res] ?? 0));
    let remaining = Math.max(0, ONLINE_BOURSE_DAILY_KINGDOM_CAP - used);
    if (remaining <= 0) continue;

    const addBuy = Math.min(rawBuy, remaining);
    remaining -= addBuy;
    used += addBuy;

    const addSell = Math.min(rawSell, remaining);
    remaining -= addSell;
    used += addSell;

    if (addBuy > 0) {
      nextBought[res] = (nextBought[res] ?? 0) + addBuy;
      appliedAny = true;
    }
    if (addSell > 0) {
      nextSold[res] = (nextSold[res] ?? 0) + addSell;
      appliedAny = true;
    }
    if (addBuy > 0 || addSell > 0) {
      nextKingdomCounts[res] = used;
    }
  }

  return { nextBought, nextSold, nextKingdomCounts, appliedAny };
}

export function normalizeWorldBourseDoc(raw: Partial<WorldBourse>): WorldBourse {
  const prices: PriceMap = { ...BASE_BUY_PRICES, ...(raw.prices ?? {}) };
  const previousPrices: PriceMap = {
    ...prices,
    ...(raw.previousPrices ?? {}),
  };
  return {
    day:
      typeof raw.day === 'number' && Number.isFinite(raw.day) && raw.day >= 1
        ? Math.trunc(raw.day)
        : 1,
    prices,
    previousPrices,
    inflationIndex:
      typeof raw.inflationIndex === 'number' &&
      Number.isFinite(raw.inflationIndex)
        ? Math.round(raw.inflationIndex)
        : computeInflationIndex(prices),
    dailyBought: { ...createEmptyTradeVolumes(), ...(raw.dailyBought ?? {}) },
    dailySold: { ...createEmptyTradeVolumes(), ...(raw.dailySold ?? {}) },
    lastRollEpochDay:
      typeof raw.lastRollEpochDay === 'number'
        ? Math.trunc(raw.lastRollEpochDay)
        : undefined,
    updatedAt:
      typeof raw.updatedAt === 'number' ? Math.trunc(raw.updatedAt) : undefined,
  };
}

/**
 * Element 3.1: Real-time listener on `worldBourse/current`.
 * No-op in local mode.
 */
export async function subscribeWorldBourse(
  onUpdate: (bourse: WorldBourse) => void
): Promise<() => void> {
  if (!isOnlineWorldEnabled()) return () => {};
  const services = await getFirebaseServices();
  if (!services) return () => {};

  const { doc, onSnapshot } = await import('firebase/firestore');
  const bourseRef = doc(services.db, 'worldBourse', 'current');
  return onSnapshot(
    bourseRef,
    (snap) => {
      if (snap.exists()) {
        onUpdate(normalizeWorldBourseDoc(snap.data() as Partial<WorldBourse>));
      }
    },
    () => {
      // Non-fatal: keep last known prices without crashing local play
    }
  );
}

/**
 * Element 3.2: Ensure `worldBourse/current` exists and roll the world day idempotently
 * inside a Firestore transaction if a new UTC world day has started.
 * Only writes if doc.day still equals the day read inside the transaction.
 */
export async function ensureAndRollWorldBourse(
  nowMs = Date.now()
): Promise<WorldBourse | null> {
  if (!isOnlineWorldEnabled()) return null;
  try {
    const services = await getFirebaseServices();
    if (!services) return null;

    const { doc, runTransaction } = await import('firebase/firestore');
    const bourseRef = doc(services.db, 'worldBourse', 'current');
    const currentEpochDay = getWorldEpochDay(nowMs);

    return await runTransaction(services.db, async (tx) => {
      const snap = await tx.get(bourseRef);
      if (!snap.exists()) {
        const initial = createInitialWorldBourse(nowMs);
        tx.set(bourseRef, serializeWorldBourseForFirestore(initial, nowMs));
        return initial;
      }

      const current = normalizeWorldBourseDoc(
        snap.data() as Partial<WorldBourse>
      );
      const docEpochDay = current.lastRollEpochDay ?? 0;

      if (currentEpochDay > docEpochDay) {
        const rolled = computeWorldBourseRoll(current, nowMs);
        // Transaction atomicity guarantees doc.day == current.day (exactly one roll per world day)
        tx.set(bourseRef, serializeWorldBourseForFirestore(rolled.bourse, nowMs));
        return rolled.bourse;
      }

      return current;
    });
  } catch {
    return null;
  }
}

/**
 * Element 3.3 & Harden 3:
 * Pushes trade volume deltas (player or People's Bank bot) into `worldBourse/current`
 * inside a Firestore transaction paired with `worldBourseVolumes/{day}_{uid}` so a single
 * kingdom can NEVER contribute more than 500 units per resource per world day.
 * Security: NEVER writes prices, day, or inflationIndex.
 */
export async function pushWorldBourseVolumeDeltas(
  uid: string,
  batch: VolumeDeltaBatch
): Promise<Partial<Record<TradedResourceKey, number>> | null> {
  if (!isOnlineWorldEnabled() || !uid) return null;
  try {
    const services = await getFirebaseServices();
    if (!services) return null;

    const { doc, runTransaction } = await import('firebase/firestore');
    const bourseRef = doc(services.db, 'worldBourse', 'current');

    return await runTransaction(services.db, async (tx) => {
      const nowMs = Date.now();
      const bourseSnap = await tx.get(bourseRef);
      if (!bourseSnap.exists()) {
        const initial = createInitialWorldBourse(nowMs);
        tx.set(bourseRef, serializeWorldBourseForFirestore(initial, nowMs));
        return {};
      }
      const current = normalizeWorldBourseDoc(
        bourseSnap.data() as Partial<WorldBourse>
      );

      const volDocId = `${current.day}_${uid}`;
      const volRef = doc(services.db, 'worldBourseVolumes', volDocId);
      const volSnap = await tx.get(volRef);
      const prevCounts: Partial<Record<TradedResourceKey, number>> =
        volSnap.exists()
          ? ((volSnap.data() as Partial<WorldBourseKingdomVolume>).counts ?? {})
          : {};

      const applied = applyCappedVolumeDeltas(current, prevCounts, batch);
      if (!applied.appliedAny) {
        return prevCounts;
      }

      const nextVolDoc: WorldBourseKingdomVolume = {
        uid,
        day: current.day,
        counts: applied.nextKingdomCounts,
        updatedAt: Math.trunc(nowMs),
      };

      // Shape A update: prices, day, inflationIndex are untouched
      const nextBourseDoc = serializeWorldBourseForFirestore(
        {
          ...current,
          dailyBought: applied.nextBought,
          dailySold: applied.nextSold,
        },
        nowMs
      );
      tx.set(bourseRef, nextBourseDoc);
      tx.set(volRef, nextVolDoc);

      return applied.nextKingdomCounts;
    });
  } catch {
    return null;
  }
}

export async function fetchMyWorldBourseUsage(
  uid: string,
  worldDay: number
): Promise<Partial<Record<TradedResourceKey, number>>> {
  if (!isOnlineWorldEnabled() || !uid || worldDay < 1) return {};
  try {
    const services = await getFirebaseServices();
    if (!services) return {};
    const { doc, getDoc } = await import('firebase/firestore');
    const volRef = doc(services.db, 'worldBourseVolumes', `${worldDay}_${uid}`);
    const snap = await getDoc(volRef);
    if (!snap.exists()) return {};
    return (snap.data() as Partial<WorldBourseKingdomVolume>).counts ?? {};
  } catch {
    return {};
  }
}
