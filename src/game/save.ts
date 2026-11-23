import {
  AWAY_MODAL_MIN_SECONDS,
  BASE_BUY_PRICES,
  createEmptyTradeVolumes,
  createEmptyWarehouse,
  GRID_SIZE,
  LEVEL_1_POPULATION_FLOOR,
  MAX_OFFLINE_POP_DELTA,
  MAX_OFFLINE_SECONDS,
  SAVE_KEY,
  SAVE_VERSION,
  SEEDED_ROCKY_COORDS,
  SEEDED_VILLAGE_COORDS,
  SHOP_FOOD_PRIORITY,
  THEMES,
  TICKS_PER_DAY,
  TOTAL_CUBES,
  TRADED_RESOURCES,
  VILLAGE_JOIN_MIN_REPUTATION,
  VILLAGE_JOIN_REQUIRED_DAYS,
  VILLAGE_NAMES,
} from './constants';
import { rolloverBoursePrices } from './economy';
import { computeNeedsAndSatisfaction, getTotalFood, processDayRolloverPeople } from './people';
import {
  computeStaffing,
  getGoldServiceAuraBonus,
  getSeaFishOutput,
  isAdjacentToOwned,
  makeSlotKey,
} from './production';
import { STRINGS } from './strings';
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
    version: SAVE_VERSION,
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
    villagesJoined: state.villagesJoined,
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

// Migrates v1 saves seamlessly into v2: fills new resources/prices, seeds rocky cells & villages,
// and places the Ruler's Palace on the empty owned cell nearest the centroid (or centroid with full refund).
function migrateSaveToV2(raw: PersistedSaveData): PersistedSaveData {
  const rockySet = new Set(SEEDED_ROCKY_COORDS.map(([r, c]) => `${r},${c}`));
  const villageMap = new Map<string, string>();
  SEEDED_VILLAGE_COORDS.forEach(([r, c], idx) => {
    villageMap.set(`${r},${c}`, VILLAGE_NAMES[idx % VILLAGE_NAMES.length]);
  });

  let gold = Math.max(0, raw.gold);

  const cubes: Cube[] = raw.cubes.map((c) => {
    const key = `${c.row},${c.col}`;
    const vName = villageMap.get(key) ?? null;
    const canBeVillage = c.owner === 'neutral' && vName !== null && !c.themeId;

    return {
      ...c,
      isRocky: typeof c.isRocky === 'boolean' ? c.isRocky : rockySet.has(key),
      isVillage: typeof c.isVillage === 'boolean' ? c.isVillage : canBeVillage,
      villageName:
        typeof c.villageName === 'string'
          ? c.villageName
          : canBeVillage
            ? vName
            : null,
      villageLoyaltyDays:
        typeof c.villageLoyaltyDays === 'number' ? c.villageLoyaltyDays : 0,
    };
  });

  // Ensure the Palace exists on an owned cell
  const hasPalace = cubes.some((c) => c.owner === 'player' && c.themeId === 'palace');
  if (!hasPalace) {
    const owned = cubes.filter((c) => c.owner === 'player');
    if (owned.length > 0) {
      const avgRow = owned.reduce((s, c) => s + c.row, 0) / owned.length;
      const avgCol = owned.reduce((s, c) => s + c.col, 0) / owned.length;

      const distSq = (c: Cube) =>
        (c.row - avgRow) * (c.row - avgRow) + (c.col - avgCol) * (c.col - avgCol);

      const emptyOwned = owned
        .filter((c) => c.themeId === null && c.secondThemeId === null)
        .sort((a, b) => distSq(a) - distSq(b));

      const target =
        emptyOwned.length > 0
          ? emptyOwned[0]
          : [...owned].sort((a, b) => distSq(a) - distSq(b))[0];

      // Refund any themes at full gold cost if we had to occupy the centroid cell
      if (target.themeId && THEMES[target.themeId]) {
        gold += THEMES[target.themeId].cost;
      }
      if (target.secondThemeId && THEMES[target.secondThemeId]) {
        gold += THEMES[target.secondThemeId].cost;
      }

      const idx = target.row * GRID_SIZE + target.col;
      cubes[idx] = {
        ...target,
        themeId: 'palace',
        secondThemeId: null,
        builtAt: Date.now(),
        secondBuiltAt: null,
        progress: 0,
        secondProgress: 0,
        shortage: null,
        secondShortage: null,
        isVillage: false,
        villageName: null,
        villageLoyaltyDays: 0,
      };
    }
  }

  return {
    ...raw,
    version: SAVE_VERSION,
    cubes,
    gold,
    warehouse: { ...createEmptyWarehouse(), ...raw.warehouse },
    prices: { ...BASE_BUY_PRICES, ...raw.prices },
    previousPrices: { ...BASE_BUY_PRICES, ...raw.previousPrices },
    dailyBought: { ...createEmptyTradeVolumes(), ...raw.dailyBought },
    dailySold: { ...createEmptyTradeVolumes(), ...raw.dailySold },
    villagesJoined: typeof raw.villagesJoined === 'number' ? raw.villagesJoined : 0,
  };
}

export function loadPersistedSave(): PersistedSaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSaveData>;
    if (
      !parsed ||
      (parsed.version !== 1 && parsed.version !== 2) ||
      !Array.isArray(parsed.cubes) ||
      parsed.cubes.length !== TOTAL_CUBES ||
      !parsed.warehouse ||
      typeof parsed.gold !== 'number'
    ) {
      return null;
    }
    return migrateSaveToV2(parsed as PersistedSaveData);
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
  let nextWarehouse = { ...createEmptyWarehouse(), ...saved.warehouse };
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
  let nextVillagesJoined = saved.villagesJoined ?? 0;

  const pricesBeforeAway = { ...nextPrices };
  const resourcesProduced: Partial<Record<TradedResourceKey, number>> = {};
  let goldEarnedByShops = 0;

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
    nextWarehouse[key] = (nextWarehouse[key] ?? 0) + amount;
    resourcesProduced[key] = (resourcesProduced[key] ?? 0) + amount;
  };

  const setSlotProgress = (t: OfflineSlotTask, shortage: Cube['shortage']) => {
    if (t.slot === 0) {
      t.cube.progress = t.remainder;
      t.cube.shortage = shortage;
    } else {
      t.cube.secondProgress = t.remainder;
      t.cube.secondShortage = shortage;
    }
  };

  // Phase 1: independent producers (no inputs)
  for (const t of tasks) {
    const def = THEMES[t.themeId];
    if (t.themeId === 'sea') {
      const perCycle = getSeaFishOutput(nextCubes, t.cube).amount;
      addProduced('fish', t.cycles * perCycle);
      setSlotProgress(t, null);
    } else if (
      t.themeId !== 'shop' &&
      (!def.inputs || def.inputs.length === 0) &&
      def.outputResource &&
      def.outputAmount
    ) {
      addProduced(def.outputResource, t.cycles * def.outputAmount);
      setSlotProgress(t, null);
    }
  }

  // Phase 2: input-consuming producers (farms, pastures, bakeries, workshops, jewelers, cafes, restaurants)
  const orderedConsumers: ThemeId[] = [
    'wheat_farm',
    'farm',
    'pasture',
    'bakery',
    'workshop',
    'jeweler',
    'cafe',
    'restaurant',
  ];

  for (const targetTheme of orderedConsumers) {
    for (const t of tasks) {
      if (t.themeId !== targetTheme) continue;
      const def = THEMES[t.themeId];
      const inputs = def.inputs ?? [];
      let affordable = t.cycles;
      for (const inp of inputs) {
        affordable = Math.min(
          affordable,
          Math.floor((nextWarehouse[inp.resource] ?? 0) / inp.amount)
        );
      }
      for (const inp of inputs) {
        nextWarehouse[inp.resource] = Math.max(
          0,
          (nextWarehouse[inp.resource] ?? 0) - affordable * inp.amount
        );
      }
      if (def.outputResource && def.outputAmount) {
        addProduced(def.outputResource, affordable * def.outputAmount);
      }
      if (def.goldPerCycle && affordable > 0) {
        const auraBonus = getGoldServiceAuraBonus(nextCubes, t.cube, t.themeId);
        const gain = affordable * Math.round(def.goldPerCycle * (1 + auraBonus));
        nextGold += gain;
        goldEarnedByShops += gain;
      }
      const shortage: Cube['shortage'] =
        affordable < t.cycles
          ? t.themeId === 'pasture'
            ? 'no_crops'
            : t.themeId === 'bakery'
              ? 'no_wheat'
              : t.themeId === 'restaurant'
                ? 'no_bread_meat'
                : t.themeId === 'workshop'
                  ? 'no_iron_wood'
                  : t.themeId === 'jeweler'
                    ? 'no_gold_gem'
                    : 'no_water'
          : null;
      setSlotProgress(t, shortage);
    }
  }

  // Phase 3: shops converting surplus food
  for (const t of tasks) {
    if (t.themeId !== 'shop') continue;
    const auraBonus = getGoldServiceAuraBonus(nextCubes, t.cube, 'shop');
    const goldPer = Math.round((THEMES.shop.goldPerCycle ?? 4) * (1 + auraBonus));
    let executed = 0;
    for (let i = 0; i < t.cycles; i++) {
      if (getTotalFood(nextWarehouse) <= nextPopulation) break;
      const targetFood = SHOP_FOOD_PRIORITY.find((k) => (nextWarehouse[k] ?? 0) >= 1);
      if (!targetFood) break;
      nextWarehouse[targetFood] = Math.max(0, nextWarehouse[targetFood] - 1);
      nextGold += goldPer;
      goldEarnedByShops += goldPer;
      executed += 1;
    }
    setSlotProgress(t, executed < t.cycles ? 'no_surplus_food' : null);
  }

  // Proportional day rollovers
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

    // Update independent villages loyalty across offline days
    for (let i = 0; i < nextCubes.length; i++) {
      const c = nextCubes[i];
      if (!c.isVillage || c.owner === 'player') continue;
      if (isAdjacentToOwned(nextCubes, c) && nextReputation >= VILLAGE_JOIN_MIN_REPUTATION) {
        c.villageLoyaltyDays += 1;
        if (c.villageLoyaltyDays >= VILLAGE_JOIN_REQUIRED_DAYS) {
          c.owner = 'player';
          c.isVillage = false;
          c.themeId = 'house';
          c.secondThemeId = 'house';
          c.builtAt = now;
          c.secondBuiltAt = now;
          nextVillagesJoined += 1;
          if (c.villageName) {
            nextTicker = STRINGS.bourse.tickerVillageJoined(c.villageName);
          }
        }
      } else {
        c.villageLoyaltyDays = 0;
      }
    }

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
    version: SAVE_VERSION,
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
    villagesJoined: nextVillagesJoined,
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
