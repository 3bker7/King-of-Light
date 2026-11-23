import {
  AWAY_MODAL_MIN_SECONDS,
  BASE_BUY_PRICES,
  createEmptyTradeVolumes,
  LEVEL_1_POPULATION_FLOOR,
  MAX_OFFLINE_POP_DELTA,
  MAX_OFFLINE_SECONDS,
  SAVE_KEY,
  SHOP_FOOD_PRIORITY,
  THEMES,
  TICKS_PER_DAY,
  TOTAL_CUBES,
  TRADED_RESOURCES,
} from './constants';
import { rolloverBoursePrices } from './economy';
import { computeNeedsAndSatisfaction, getTotalFood, processDayRolloverPeople } from './people';
import { computeStaffing, getSeaFishOutput, makeSlotKey } from './production';
import type {
  AwayReportData,
  Cube,
  GameState,
  PersistedSaveData,
  PriceMoveSummary,
  SlotIndex,
  ThemeId,
  TradedResourceKey,
} from './types';

// Anti-cheat note: production timestamps derive from Date.now deltas; a future stage will move to server time.

export function serializeGameState(state: GameState, now: number): PersistedSaveData {
  return {
    version: 1,
    cubes: state.cubes,
    warehouse: state.warehouse,
    gold: state.gold,
    population: state.population,
    satisfaction: state.satisfaction,
    reputation: state.reputation,
    hungerFlag: state.hungerFlag,
    day: state.day,
    tickInDay: state.tickInDay,
    prices: state.prices,
    previousPrices: state.previousPrices,
    dailyBought: state.dailyBought,
    dailySold: state.dailySold,
    tickerMessage: state.tickerMessage,
    level: state.level,
    objectives: state.objectives,
    level2CompletedShown: state.level2CompletedShown,
    muted: state.muted,
    lastSavedAt: now,
  };
}

export function saveGameToStorage(state: GameState): void {
  try {
    const payload = serializeGameState(state, Date.now());
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export function clearSavedGame(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function loadPersistedSave(): PersistedSaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSaveData>;
    if (
      !parsed ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.cubes) ||
      parsed.cubes.length !== TOTAL_CUBES ||
      !parsed.warehouse ||
      typeof parsed.gold !== 'number'
    ) {
      return null;
    }
    return parsed as PersistedSaveData;
  } catch {
    return null;
  }
}

export function simulateOfflineProgress(
  saved: PersistedSaveData,
  now: number
): { restored: PersistedSaveData; awayReport: AwayReportData | null } {
  const rawElapsedSeconds = Math.max(0, Math.floor((now - saved.lastSavedAt) / 1000));
  const elapsedSeconds = Math.min(MAX_OFFLINE_SECONDS, rawElapsedSeconds);

  if (elapsedSeconds <= 0) {
    return { restored: { ...saved, lastSavedAt: now }, awayReport: null };
  }

  const nextCubes: Cube[] = saved.cubes.map((c) => ({ ...c }));
  let nextWarehouse = { ...saved.warehouse };
  let nextGold = Math.max(0, saved.gold);
  const startPopulation = Math.max(0, saved.population);
  let nextPopulation = startPopulation;
  let nextReputation = saved.reputation;
  let nextHungerFlag = saved.hungerFlag;
  let nextPrices = { ...BASE_BUY_PRICES, ...saved.prices };
  let nextPreviousPrices = { ...BASE_BUY_PRICES, ...saved.previousPrices };
  let nextDailyBought = { ...createEmptyTradeVolumes(), ...saved.dailyBought };
  let nextDailySold = { ...createEmptyTradeVolumes(), ...saved.dailySold };
  let nextTicker = saved.tickerMessage;

  const pricesBeforeAway = { ...nextPrices };
  const resourcesProduced: Partial<Record<TradedResourceKey, number>> = {};
  let goldEarnedByShops = 0;

  // Aggregate cycle math per staffed theme (never loops per second).
  const staffing = computeStaffing(nextCubes, nextPopulation);

  interface OfflineSlotTask {
    cube: Cube;
    slot: SlotIndex;
    themeId: ThemeId;
    cycles: number;
    remainder: number;
  }

  const tasks: OfflineSlotTask[] = [];
  for (const cube of nextCubes) {
    if (cube.owner !== 'player') continue;
    const slots: Array<{ slot: SlotIndex; themeId: ThemeId | null; progress: number }> = [
      { slot: 0, themeId: cube.themeId, progress: cube.progress },
      { slot: 1, themeId: cube.secondThemeId, progress: cube.secondProgress },
    ];
    for (const s of slots) {
      if (!s.themeId) continue;
      const def = THEMES[s.themeId];
      if (def.cycleSeconds === null) continue;
      if (!staffing.staffedSlots.has(makeSlotKey(cube.id, s.slot))) continue;

      const totalProg = s.progress + elapsedSeconds;
      const cycles = Math.floor(totalProg / def.cycleSeconds);
      const remainder = totalProg % def.cycleSeconds;
      tasks.push({ cube, slot: s.slot, themeId: s.themeId, cycles, remainder });
    }
  }

  const addProduced = (key: TradedResourceKey, amount: number) => {
    if (amount <= 0) return;
    nextWarehouse[key] += amount;
    resourcesProduced[key] = (resourcesProduced[key] ?? 0) + amount;
  };

  // Phase 1: independent producers (well, sea, forest)
  for (const t of tasks) {
    if (t.themeId === 'well') {
      addProduced('water', t.cycles * (THEMES.well.outputAmount ?? 3));
      if (t.slot === 0) t.cube.progress = t.remainder;
      else t.cube.secondProgress = t.remainder;
    } else if (t.themeId === 'sea') {
      const perCycle = getSeaFishOutput(nextCubes, t.cube).amount;
      addProduced('fish', t.cycles * perCycle);
      t.cube.progress = t.remainder;
    } else if (t.themeId === 'forest') {
      addProduced('wood', t.cycles * (THEMES.forest.outputAmount ?? 2));
      t.cube.progress = t.remainder;
    }
  }

  // Phase 2: water-consuming farms
  for (const t of tasks) {
    if (t.themeId !== 'farm') continue;
    const waterPerCycle = THEMES.farm.inputAmount ?? 1;
    const affordableCycles = Math.min(
      t.cycles,
      Math.floor(nextWarehouse.water / waterPerCycle)
    );
    nextWarehouse.water = Math.max(0, nextWarehouse.water - affordableCycles * waterPerCycle);
    addProduced('crops', affordableCycles * (THEMES.farm.outputAmount ?? 3));
    t.cube.progress = t.remainder;
    t.cube.shortage = affordableCycles < t.cycles ? 'no_water' : null;
  }

  // Phase 3: crops-consuming pastures
  for (const t of tasks) {
    if (t.themeId !== 'pasture') continue;
    const cropsPerCycle = THEMES.pasture.inputAmount ?? 1;
    const affordableCycles = Math.min(
      t.cycles,
      Math.floor(nextWarehouse.crops / cropsPerCycle)
    );
    nextWarehouse.crops = Math.max(0, nextWarehouse.crops - affordableCycles * cropsPerCycle);
    addProduced('meat', affordableCycles * (THEMES.pasture.outputAmount ?? 2));
    t.cube.progress = t.remainder;
    t.cube.shortage = affordableCycles < t.cycles ? 'no_crops' : null;
  }

  // Phase 4: shops converting surplus food (Fish -> Crops -> Meat) into 4 gold
  for (const t of tasks) {
    if (t.themeId !== 'shop') continue;
    let executed = 0;
    for (let i = 0; i < t.cycles; i++) {
      if (getTotalFood(nextWarehouse) <= nextPopulation) break;
      const targetFood = SHOP_FOOD_PRIORITY.find((k) => nextWarehouse[k] >= 1);
      if (!targetFood) break;
      nextWarehouse[targetFood] = Math.max(0, nextWarehouse[targetFood] - 1);
      const gain = THEMES.shop.shopGoldPerCycle ?? 4;
      nextGold += gain;
      goldEarnedByShops += gain;
      executed += 1;
    }
    const shortage = executed < t.cycles ? 'no_surplus_food' : null;
    if (t.slot === 0) {
      t.cube.progress = t.remainder;
      t.cube.shortage = shortage;
    } else {
      t.cube.secondProgress = t.remainder;
      t.cube.secondShortage = shortage;
    }
  }

  // Proportional day rollovers (max 96 days over 8 hours)
  const totalTicks = saved.tickInDay + elapsedSeconds;
  const daysElapsed = Math.floor(totalTicks / TICKS_PER_DAY);
  const nextTickInDay = totalTicks % TICKS_PER_DAY;
  const nextDay = saved.day + daysElapsed;

  for (let d = 0; d < daysElapsed; d++) {
    const peopleRes = processDayRolloverPeople(
      nextCubes,
      nextWarehouse,
      nextPopulation,
      nextReputation,
      saved.level
    );
    nextWarehouse = peopleRes.warehouse;
    nextPopulation = peopleRes.population;
    nextReputation = peopleRes.reputation;
    nextHungerFlag = peopleRes.hungerFlag;

    const bourseRes = rolloverBoursePrices(
      nextPrices,
      nextDailyBought,
      nextDailySold,
      saved.level
    );
    nextPrices = bourseRes.prices;
    nextPreviousPrices = bourseRes.previousPrices;
    nextTicker = bourseRes.tickerMessage;
    nextDailyBought = createEmptyTradeVolumes();
    nextDailySold = createEmptyTradeVolumes();
  }

  // Cap net population change during offline simulation at +/- 6 (respecting Level 1 floor).
  const rawPopDelta = nextPopulation - startPopulation;
  const clampedPopDelta = Math.max(
    -MAX_OFFLINE_POP_DELTA,
    Math.min(MAX_OFFLINE_POP_DELTA, rawPopDelta)
  );
  const popFloor = saved.level === 1 ? LEVEL_1_POPULATION_FLOOR : 0;
  nextPopulation = Math.max(popFloor, startPopulation + clampedPopDelta);
  const finalPopDelta = nextPopulation - startPopulation;

  const finalEval = computeNeedsAndSatisfaction(
    nextCubes,
    nextWarehouse,
    nextPopulation,
    nextHungerFlag
  );

  // Biggest net price move over the offline window
  let biggestPriceMove: PriceMoveSummary | null = null;
  if (daysElapsed > 0) {
    for (const res of TRADED_RESOURCES) {
      const before = pricesBeforeAway[res];
      const after = nextPrices[res];
      const pct = before > 0 ? ((after - before) / before) * 100 : 0;
      if (
        !biggestPriceMove ||
        Math.abs(pct) > Math.abs(biggestPriceMove.percentChange)
      ) {
        biggestPriceMove = {
          resource: res,
          previousPrice: before,
          newPrice: after,
          percentChange: pct,
        };
      }
    }
  }

  const restored: PersistedSaveData = {
    ...saved,
    cubes: nextCubes,
    warehouse: nextWarehouse,
    gold: Math.max(0, nextGold),
    population: nextPopulation,
    satisfaction: finalEval.satisfaction,
    reputation: nextReputation,
    hungerFlag: nextHungerFlag,
    day: nextDay,
    tickInDay: nextTickInDay,
    prices: nextPrices,
    previousPrices: nextPreviousPrices,
    dailyBought: nextDailyBought,
    dailySold: nextDailySold,
    tickerMessage: nextTicker,
    lastSavedAt: now,
  };

  const awayReport: AwayReportData | null =
    rawElapsedSeconds >= AWAY_MODAL_MIN_SECONDS
      ? {
          elapsedSeconds,
          daysElapsed,
          goldEarnedByShops,
          resourcesProduced,
          populationDelta: finalPopDelta,
          biggestPriceMove,
        }
      : null;

  return { restored, awayReport };
}
