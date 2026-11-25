import {
  ARREARS_SATISFACTION_CAP,
  AWAY_MODAL_MIN_SECONDS,
  BASE_BUY_PRICES,
  createEmptyTradeVolumes,
  createEmptyWarehouse,
  GRID_SIZE,
  LEVEL_1_POPULATION_FLOOR,
  MAX_LEDGER_ENTRIES,
  MAX_OFFLINE_POP_DELTA,
  MAX_OFFLINE_SECONDS,
  MONTH_DAYS,
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
import {
  appendOrMergeFaxes,
  sanitizeOfficeFaxesOnHydrate,
} from './advisor';
import {
  sanitizeArrivalCampOnHydrate,
  syncArrivalCamp,
} from './arrivalCamp';
import {
  BANK_START_GOLD,
  PALACE_START_GOLD,
  TRUST_START,
  sanitizeBankCubesOnHydrate,
} from './bank';
import {
  reconcileCitizens,
  sanitizeCitizensOnHydrate,
  sumCitizenWealth,
} from './citizens';
import { sanitizeDecreesOnHydrate } from './decrees';
import { computeInflationIndex, rolloverBoursePrices } from './economy';
import { runMonthlyProcessor } from './monthlyProcessor';
import { computeNeedsAndSatisfaction, getTotalFood, processDayRolloverPeople } from './people';
import { cleanupEmigratedPrivateOwners, syncPrivateAds } from './privateJobs';
import { sanitizePrivateLandOnHydrate } from './privateLand';
import {
  computeStaffing,
  findPalaceCube,
  getGoldServiceAuraBonus,
  getSeaFishOutput,
  isAdjacentToOwned,
  makeSlotKey,
} from './production';
import {
  computeProvinces,
  createProvinceEvent,
  diffProvincesForEvents,
  findProvinceForCube,
  formatProvinceTitle,
  PALACE_PROVINCE_NAME,
  recordProvinceEvents,
  sanitizeProvinceEventsOnHydrate,
} from './provinces';
import { createZeroLastMonthStats } from './spending';
import { STRINGS } from './strings';
import { computeTaxMoodDelta, sanitizeTaxPolicyOnHydrate } from './taxPolicy';
import type {
  AdvisorBriefing,
  AwayReportData,
  BankLoan,
  Cube,
  Decree,
  GameState,
  LastMonthStats,
  LedgerEntry,
  OfficeFax,
  PalaceOfPeople,
  PayrollRecord,
  PeoplesBank,
  PersistedSaveData,
  PoliceRecord,
  PriceMoveSummary,
  PrivateAd,
  ProvinceEvent,
  SlotIndex,
  TaxPolicy,
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
    citizenWealth: state.citizenWealth,
    arrears: state.arrears,
    lastPayroll: state.lastPayroll,
    dailyShopGold: state.dailyShopGold,
    inflationIndex: state.inflationIndex,
    ledger: state.ledger,
    lastInflationWarnMonth: state.lastInflationWarnMonth,
    citizens: state.citizens,
    nextCitizenId: state.nextCitizenId,
    totalMonths: state.totalMonths,
    officeFaxes: state.officeFaxes,
    policeRecords: state.policeRecords,
    lastMonthStats: state.lastMonthStats,
    monthlyBusinessTax: state.monthlyBusinessTax,
    landRequests: state.landRequests,
    privateAds: state.privateAds,
    lastSpentMonth: state.lastSpentMonth,
    palaceOfPeople: state.palaceOfPeople,
    bankTrust: state.bankTrust,
    bankLoans: state.bankLoans,
    peoplesBank: state.peoplesBank,
    lastBankNetWorthWarnMonth: state.lastBankNetWorthWarnMonth,
    advisorBriefing: state.advisorBriefing,
    taxPolicy: state.taxPolicy,
    decrees: state.decrees,
    camp: state.camp,
    pendingArrivals: state.pendingArrivals,
    provinceEvents: state.provinceEvents,
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
      privateOwnerId:
        typeof c.privateOwnerId === 'number' ? c.privateOwnerId : null,
      privateIntendedTheme: c.privateIntendedTheme ?? null,
      privateBuildRetries:
        typeof c.privateBuildRetries === 'number' ? c.privateBuildRetries : 0,
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
        privateOwnerId: null,
        privateIntendedTheme: null,
        privateBuildRetries: 0,
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

function sanitizeLastMonthStats(raw: Partial<LastMonthStats> | undefined): LastMonthStats {
  const zero = createZeroLastMonthStats();
  if (!raw || typeof raw !== 'object') return zero;
  return {
    foodRevenue: typeof raw.foodRevenue === 'number' && Number.isFinite(raw.foodRevenue) ? Math.max(0, Math.floor(raw.foodRevenue)) : 0,
    leisureRevenue: typeof raw.leisureRevenue === 'number' && Number.isFinite(raw.leisureRevenue) ? Math.max(0, Math.floor(raw.leisureRevenue)) : 0,
    businessTax: typeof raw.businessTax === 'number' && Number.isFinite(raw.businessTax) ? Math.max(0, Math.floor(raw.businessTax)) : 0,
    importSink: typeof raw.importSink === 'number' && Number.isFinite(raw.importSink) ? Math.max(0, Math.floor(raw.importSink)) : 0,
    leisureSink: typeof raw.leisureSink === 'number' && Number.isFinite(raw.leisureSink) ? Math.max(0, Math.floor(raw.leisureSink)) : 0,
    unmetFood: typeof raw.unmetFood === 'number' && Number.isFinite(raw.unmetFood) ? Math.max(0, Math.floor(raw.unmetFood)) : 0,
    taxWithheld: typeof raw.taxWithheld === 'number' && Number.isFinite(raw.taxWithheld) ? Math.max(0, Math.floor(raw.taxWithheld)) : 0,
    grantsPaid: typeof raw.grantsPaid === 'number' && Number.isFinite(raw.grantsPaid) ? Math.max(0, Math.floor(raw.grantsPaid)) : 0,
  };
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

  let nextCubes: Cube[] = saved.cubes.map((c) => ({ ...c }));
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
  let nextCitizenWealth =
    typeof saved.citizenWealth === 'number' ? Math.max(0, saved.citizenWealth) : 0;
  const startArrears =
    typeof saved.arrears === 'number' ? Math.max(0, saved.arrears) : 0;
  let nextArrears = startArrears;
  let nextLastPayroll: PayrollRecord | null = saved.lastPayroll ?? null;
  let nextInflationIndex =
    typeof saved.inflationIndex === 'number'
      ? saved.inflationIndex
      : computeInflationIndex(nextPrices);
  const nextLedger: LedgerEntry[] = Array.isArray(saved.ledger)
    ? [...saved.ledger]
    : [];

  // Element 6.2 & H6: Monotonic totalMonths + sanitize citizens, private plots & ads BEFORE offline production
  const savedTotalMonths =
    typeof saved.totalMonths === 'number' && Number.isFinite(saved.totalMonths)
      ? Math.max(0, Math.trunc(saved.totalMonths))
      : 0;
  const startTotalMonths = Math.max(
    savedTotalMonths,
    Math.floor((Math.max(1, saved.day) - 1) / MONTH_DAYS)
  );
  let nextTotalMonths = startTotalMonths;

  const savedPoliceRecords: PoliceRecord[] = Array.isArray(saved.policeRecords)
    ? saved.policeRecords
    : [];
  const savedOfficeFaxes: OfficeFax[] = sanitizeOfficeFaxesOnHydrate(
    saved.officeFaxes
  );

  const hydratedCitizens = sanitizeCitizensOnHydrate(
    saved.citizens,
    startTotalMonths,
    nextCubes,
    startPopulation,
    nextCitizenWealth,
    savedPoliceRecords
  );
  let nextCitizens = hydratedCitizens.citizens;
  let nextCitizenId = Math.max(
    hydratedCitizens.nextCitizenId,
    typeof saved.nextCitizenId === 'number' && Number.isFinite(saved.nextCitizenId)
      ? Math.floor(saved.nextCitizenId)
      : 1
  );
  nextCitizenWealth = hydratedCitizens.citizenWealth;
  let nextPoliceRecords = hydratedCitizens.policeRecords;
  let nextOfficeFaxes: OfficeFax[] = [...savedOfficeFaxes];

  // Sanitize private plots, land requests & ads before offline staffing/production
  const cleanPrivate = sanitizePrivateLandOnHydrate(
    nextCubes,
    nextCitizens,
    saved.landRequests
  );
  nextCubes = sanitizeBankCubesOnHydrate(cleanPrivate.cubes, startTotalMonths);
  let nextLandRequests = cleanPrivate.landRequests;

  const initialPrivateAds: PrivateAd[] = Array.isArray(saved.privateAds)
    ? saved.privateAds
    : [];
  const syncedAds = syncPrivateAds({
    cubes: nextCubes,
    citizens: nextCitizens,
    privateAds: initialPrivateAds,
    totalMonths: startTotalMonths,
  });
  let nextPrivateAds = syncedAds.privateAds;
  nextCitizens = syncedAds.citizens;

  let nextLastMonthStats = sanitizeLastMonthStats(saved.lastMonthStats);
  let nextMonthlyBusinessTax =
    typeof saved.monthlyBusinessTax === 'number' &&
    Number.isFinite(saved.monthlyBusinessTax)
      ? Math.max(0, Math.floor(saved.monthlyBusinessTax))
      : 0;
  let nextLastSpentMonth =
    typeof saved.lastSpentMonth === 'number' &&
    Number.isFinite(saved.lastSpentMonth)
      ? Math.max(0, Math.trunc(saved.lastSpentMonth))
      : 0;

  let nextPalaceOfPeople: PalaceOfPeople = saved.palaceOfPeople ?? {
    gold: PALACE_START_GOLD,
  };
  let nextBankTrust =
    typeof saved.bankTrust === 'number'
      ? Math.max(0, Math.min(100, Math.floor(saved.bankTrust)))
      : TRUST_START;
  let nextBankLoans: BankLoan[] = Array.isArray(saved.bankLoans)
    ? saved.bankLoans.map((l) => ({ ...l }))
    : [];
  let nextPeoplesBank: PeoplesBank = saved.peoplesBank ?? {
    gold: BANK_START_GOLD,
    portfolio: {},
    totalTrades: 0,
    lastTradeMonth: null,
    lastTradeAr: null,
  };
  let nextLastBankNetWorthWarnMonth =
    typeof saved.lastBankNetWorthWarnMonth === 'number'
      ? saved.lastBankNetWorthWarnMonth
      : 0;
  const nextTaxPolicy: TaxPolicy = sanitizeTaxPolicyOnHydrate(saved.taxPolicy);
  let nextDecrees: Decree[] = sanitizeDecreesOnHydrate(saved.decrees);
  let nextAdvisorBriefing: AdvisorBriefing | null = saved.advisorBriefing ?? null;

  // Prompt 7 Element 5: Sanitize provinceEvents & arrival camp before offline loops (provinces always derived fresh)
  let nextProvinceEvents: ProvinceEvent[] = sanitizeProvinceEventsOnHydrate(
    saved.provinceEvents,
    nextCubes.length
  );
  let currentProvinces = computeProvinces({
    cubes: nextCubes,
    citizens: nextCitizens,
    population: nextPopulation,
  });
  const hydratedCamp = sanitizeArrivalCampOnHydrate(
    nextCitizens,
    nextCubes,
    startTotalMonths,
    saved.camp
  );
  nextCitizens = hydratedCamp.citizens;
  let nextCamp = hydratedCamp.camp;
  let nextPendingArrivals = hydratedCamp.pendingArrivals;
  const offlineProvinceEvents: ProvinceEvent[] = [];

  const pricesBeforeAway = { ...nextPrices };
  const resourcesProduced: Partial<Record<TradedResourceKey, number>> = {};
  let goldEarnedByShops = 0;

  // Map citizens by id for private offline revenue credits
  const citizenById = new Map<number, (typeof nextCitizens)[number]>();
  for (const c of nextCitizens) {
    citizenById.set(c.id, c);
  }

  // Helper: route offline goldPerCycle to royal treasury OR 90/10 private owner + businessTax
  const creditServiceGold = (cube: Cube, cycles: number, perCycleGold: number) => {
    if (cycles <= 0 || perCycleGold <= 0) return;
    if (typeof cube.privateOwnerId === 'number') {
      const owner = citizenById.get(cube.privateOwnerId);
      const ownerPerCycle = Math.floor(perCycleGold * 0.9);
      const taxPerCycle = perCycleGold - ownerPerCycle;
      const totalOwner = cycles * ownerPerCycle;
      const totalTax = cycles * taxPerCycle;
      if (owner && totalOwner > 0) {
        owner.wealth += totalOwner;
      }
      if (totalTax > 0) {
        nextGold += totalTax;
        nextMonthlyBusinessTax += totalTax;
      }
    } else {
      const gain = cycles * perCycleGold;
      nextGold += gain;
      goldEarnedByShops += gain;
    }
  };

  // Element 6.2: Pass nextCitizens so unfilled private businesses produce 0 offline
  const staffing = computeStaffing(nextCubes, nextPopulation, nextCitizens);

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
      (!def.inputs || def.inputs.length === 0)
    ) {
      if (def.outputResource && def.outputAmount) {
        addProduced(def.outputResource, t.cycles * def.outputAmount);
      }
      if (def.goldPerCycle && t.cycles > 0) {
        const auraBonus = getGoldServiceAuraBonus(nextCubes, t.cube, t.themeId);
        const perCycleGold = Math.round(def.goldPerCycle * (1 + auraBonus));
        creditServiceGold(t.cube, t.cycles, perCycleGold);
      }
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
        const perCycleGold = Math.round(def.goldPerCycle * (1 + auraBonus));
        creditServiceGold(t.cube, affordable, perCycleGold);
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
      creditServiceGold(t.cube, 1, goldPer);
      executed += 1;
    }
    setSlotProgress(t, executed < t.cycles ? 'no_surplus_food' : null);
  }

  nextCitizenWealth = sumCitizenWealth(nextCitizens);

  // Proportional day rollovers
  const totalTicks = saved.tickInDay + elapsedSeconds;
  const daysElapsed = Math.floor(totalTicks / TICKS_PER_DAY);
  const nextTickInDay = totalTicks % TICKS_PER_DAY;
  const nextDay = saved.day + daysElapsed;

  for (let d = 0; d < daysElapsed; d++) {
    const dayTaxMoodDelta = computeTaxMoodDelta(
      nextTaxPolicy,
      nextCitizenWealth,
      nextPopulation
    );
    const peopleRes = processDayRolloverPeople(
      nextCubes,
      nextWarehouse,
      nextPopulation,
      nextReputation,
      saved.level,
      dayTaxMoodDelta
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

          // Prompt 7 Element 5.3: Record offline village join & any resulting province formation idempotently
          const curDay = saved.day + d + 1;
          const curEventMonth =
            Math.floor((Math.max(1, curDay) - 1) / MONTH_DAYS) + 1;
          const prevProvs = currentProvinces;
          currentProvinces = computeProvinces({
            cubes: nextCubes,
            citizens: nextCitizens,
            population: nextPopulation,
          });
          const joinedProv = findProvinceForCube(currentProvinces, c.id);
          const provTitle = formatProvinceTitle(
            joinedProv ? joinedProv.nameAr : PALACE_PROVINCE_NAME
          );
          const joinLabel = c.villageName
            ? `انضمت قرية ${c.villageName} إلى ${provTitle}`
            : `انضمت قرية جديدة إلى ${provTitle}`;
          const joinAdditions: ProvinceEvent[] = [
            createProvinceEvent('village_joined', curEventMonth, c.id, joinLabel),
            ...diffProvincesForEvents(prevProvs, currentProvinces, curEventMonth),
          ];
          const recEv = recordProvinceEvents(nextProvinceEvents, joinAdditions);
          nextProvinceEvents = recEv.events;
          if (recEv.added.length > 0) {
            offlineProvinceEvents.push(...recEv.added);
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
    nextInflationIndex = bourseRes.inflationIndex;
    nextDailyBought = createEmptyTradeVolumes();
    nextDailySold = createEmptyTradeVolumes();
  }

  // Clamp offline population before running monthly processor so all offices see final population
  const rawPopDelta = nextPopulation - startPopulation;
  const clampedPopDelta = Math.max(
    -MAX_OFFLINE_POP_DELTA,
    Math.min(MAX_OFFLINE_POP_DELTA, rawPopDelta)
  );
  const popFloor = saved.level === 1 ? LEVEL_1_POPULATION_FLOOR : 0;
  nextPopulation = Math.max(popFloor, startPopulation + clampedPopDelta);
  const finalPopDelta = nextPopulation - startPopulation;

  const targetTotalMonths = Math.floor((Math.max(1, nextDay) - 1) / MONTH_DAYS);
  const monthsToRun = Math.min(3, Math.max(0, targetTotalMonths - startTotalMonths));

  let births = 0;
  let cvsFiled = 0;
  let marriages = 0;
  let housingGranted = 0;
  let faxesSent = 0;
  let citizenSpentTotal = 0;
  let businessTaxTotal = 0;
  let loanInstallmentsPaid = 0;
  let loanDeferredAdded = 0;
  let bankTradesCount = 0;

  // Reconcile offline population delta into citizens before monthly ticks (and for sub-month away periods)
  if (nextCitizens.length !== nextPopulation) {
    const prevBeforeRec = nextCitizens;
    const rec = reconcileCitizens({
      citizens: nextCitizens,
      nextCitizenId,
      population: nextPopulation,
      totalMonths: nextTotalMonths,
      citizenWealth: nextCitizenWealth,
      policeRecords: nextPoliceRecords,
    });
    nextCitizens = rec.citizens;
    nextCitizenId = rec.nextCitizenId;
    nextCitizenWealth = rec.citizenWealth;
    nextPoliceRecords = rec.policeRecords;
    births += rec.birthsCount;
    cvsFiled += rec.cvsFiledCount;

    const emig = cleanupEmigratedPrivateOwners({
      cubes: nextCubes,
      previousCitizens: prevBeforeRec,
      citizens: nextCitizens,
      privateAds: nextPrivateAds,
      policeRecords: nextPoliceRecords,
      totalMonths: nextTotalMonths,
    });
    nextCubes = emig.cubes;
    nextCitizens = emig.citizens;
    nextPrivateAds = emig.privateAds;
    nextPoliceRecords = emig.policeRecords;
  }

  // Element 6.1: Run the SAME unified monthly processor for each full month crossed (cap 3).
  // Land requests may generate or expire offline, and are NEVER auto-approved.
  let payrollPaid = 0;
  for (let m = 0; m < monthsToRun; m++) {
    const monthBoundaryDay = (startTotalMonths + m + 1) * MONTH_DAYS + 1;
    const mp = runMonthlyProcessor({
      cubes: nextCubes,
      warehouse: nextWarehouse,
      prices: nextPrices,
      inflationIndex: nextInflationIndex,
      population: nextPopulation,
      gold: nextGold,
      arrears: nextArrears,
      citizenWealth: nextCitizenWealth,
      citizens: nextCitizens,
      nextCitizenId,
      totalMonths: nextTotalMonths,
      officeFaxes: nextOfficeFaxes,
      policeRecords: nextPoliceRecords,
      monthlyBusinessTax: nextMonthlyBusinessTax,
      landRequests: nextLandRequests,
      privateAds: nextPrivateAds,
      lastSpentMonth: nextLastSpentMonth,
      palaceOfPeople: nextPalaceOfPeople,
      bankTrust: nextBankTrust,
      bankLoans: nextBankLoans,
      peoplesBank: nextPeoplesBank,
      dailyBought: nextDailyBought,
      dailySold: nextDailySold,
      lastBankNetWorthWarnMonth: nextLastBankNetWorthWarnMonth,
      taxPolicy: nextTaxPolicy,
      decrees: nextDecrees,
      advisorBriefing: nextAdvisorBriefing,
      provinces: currentProvinces,
      camp: nextCamp,
      provinceEvents: nextProvinceEvents,
      hungerFlag: nextHungerFlag,
      skipBriefing: m < monthsToRun - 1,
      isOffline: true,
      day: monthBoundaryDay,
      now,
    });
    nextTotalMonths = mp.totalMonths;
    nextCubes = mp.cubes;
    nextWarehouse = mp.warehouse;
    nextGold = mp.gold;
    nextArrears = mp.arrears;
    nextCitizenWealth = mp.citizenWealth;
    nextLastPayroll = mp.lastPayroll;
    nextCitizens = mp.citizens;
    nextCitizenId = mp.nextCitizenId;
    nextOfficeFaxes = mp.officeFaxes;
    nextPoliceRecords = mp.policeRecords;
    nextLastMonthStats = mp.lastMonthStats;
    nextMonthlyBusinessTax = mp.monthlyBusinessTax;
    nextLandRequests = mp.landRequests;
    nextPrivateAds = mp.privateAds;
    nextLastSpentMonth = mp.lastSpentMonth;
    nextPalaceOfPeople = mp.palaceOfPeople;
    nextBankTrust = mp.bankTrust;
    nextBankLoans = mp.bankLoans;
    nextPeoplesBank = mp.peoplesBank;
    nextDailyBought = mp.dailyBought as any;
    nextDailySold = mp.dailySold as any;
    nextLastBankNetWorthWarnMonth = mp.lastBankNetWorthWarnMonth;
    nextAdvisorBriefing = mp.advisorBriefing;
    nextDecrees = mp.decrees;
    currentProvinces = mp.provinces;
    nextCamp = mp.camp;
    nextPendingArrivals = mp.pendingArrivals;
    nextProvinceEvents = mp.provinceEvents;
    if (mp.addedProvinceEvents.length > 0) {
      offlineProvinceEvents.push(...mp.addedProvinceEvents);
    }
    if (mp.offlineBankStats) {
      loanInstallmentsPaid += mp.offlineBankStats.loanInstallmentsPaid;
      loanDeferredAdded += mp.offlineBankStats.loanDeferredAdded;
      bankTradesCount += mp.offlineBankStats.bankTradesCount;
    }

    payrollPaid += mp.paid;
    births += mp.summary.births;
    cvsFiled += mp.summary.cvsFiled;
    marriages += mp.summary.marriages;
    housingGranted += mp.summary.housingGranted;
    faxesSent += mp.summary.faxesSent;
    citizenSpentTotal += mp.citizenSpentTotal;
    businessTaxTotal += mp.businessTaxCollected;

    nextLedger.push(...mp.ledgerItems);
  }
  const arrearsAdded = Math.max(0, nextArrears - startArrears);
  nextCitizenWealth = sumCitizenWealth(nextCitizens);

  // Prompt 7 Element 5.3: Final camp & province event reconciliation after offline loops (covers sub-month away periods)
  const finalProvinces = computeProvinces({
    cubes: nextCubes,
    citizens: nextCitizens,
    population: nextPopulation,
  });
  const finalCampSync = syncArrivalCamp(
    nextCitizens,
    nextCubes,
    nextTotalMonths,
    nextCamp.cubeId
  );
  nextCitizens = finalCampSync.citizens;
  nextCamp = finalCampSync.camp;
  nextPendingArrivals = finalCampSync.pendingArrivals;

  const finalEventMonth = Math.max(
    1,
    Math.floor((Math.max(1, nextDay) - 1) / MONTH_DAYS) + 1
  );
  const finalDiffEvs: ProvinceEvent[] = diffProvincesForEvents(
    currentProvinces,
    finalProvinces,
    finalEventMonth
  );
  if (nextPendingArrivals > 0) {
    const palaceCube = findPalaceCube(nextCubes);
    const campRefCubeId = nextCamp.cubeId ?? palaceCube?.id ?? 0;
    finalDiffEvs.push(
      createProvinceEvent(
        'camp_full',
        finalEventMonth,
        campRefCubeId,
        `مخيم الوصول ممتلئ — ${nextPendingArrivals} قادم في الطريق`
      )
    );
  }
  if (finalDiffEvs.length > 0) {
    const recFinal = recordProvinceEvents(nextProvinceEvents, finalDiffEvs);
    nextProvinceEvents = recFinal.events;
    if (recFinal.added.length > 0) {
      offlineProvinceEvents.push(...recFinal.added);
    }
  }

  // Element 6.1 & H5: On return, if deferredDue > 0 after offline months, warn king (merged via offline flood control)
  const activeLoanOnReturn = nextBankLoans.find((l) => l.status === 'active');
  if (activeLoanOnReturn && activeLoanOnReturn.deferredDue > 0 && monthsToRun > 0) {
    nextOfficeFaxes = appendOrMergeFaxes(
      nextOfficeFaxes,
      [
        {
          id: `fax-bank-offline-${nextTotalMonths}`,
          month: nextTotalMonths,
          office: 'bank',
          textAr: `تراكمت أقساط بقيمة ${activeLoanOnReturn.deferredDue} أثناء غيابك — تُدفع مع قسط الشهر القادم`,
          status: 'unread',
        },
      ],
      true
    );
    if (nextOfficeFaxes.length > 30) {
      nextOfficeFaxes = nextOfficeFaxes.slice(nextOfficeFaxes.length - 30);
    }
  }

  if (goldEarnedByShops > 0) {
    nextLedger.push({
      id: `offline-shop-${nextDay}`,
      day: nextDay,
      kind: 'shop',
      amount: goldEarnedByShops,
      labelAr: 'دخل المحلات والخدمات',
    });
  }

  const trimmedLedger =
    nextLedger.length > MAX_LEDGER_ENTRIES
      ? nextLedger.slice(nextLedger.length - MAX_LEDGER_ENTRIES)
      : nextLedger;

  const finalTaxMoodDelta = computeTaxMoodDelta(
    nextTaxPolicy,
    nextCitizenWealth,
    nextPopulation
  );
  const finalEval = computeNeedsAndSatisfaction(
    nextCubes,
    nextWarehouse,
    nextPopulation,
    nextHungerFlag,
    finalTaxMoodDelta
  );
  const finalSatisfaction =
    nextArrears > 0
      ? Math.min(ARREARS_SATISFACTION_CAP, finalEval.satisfaction)
      : finalEval.satisfaction;

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
    satisfaction: finalSatisfaction,
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
    citizenWealth: nextCitizenWealth,
    arrears: nextArrears,
    lastPayroll: nextLastPayroll,
    dailyShopGold: 0,
    inflationIndex: nextInflationIndex,
    ledger: trimmedLedger,
    citizens: nextCitizens,
    nextCitizenId,
    totalMonths: nextTotalMonths,
    officeFaxes: nextOfficeFaxes,
    policeRecords: nextPoliceRecords,
    lastMonthStats: nextLastMonthStats,
    monthlyBusinessTax: nextMonthlyBusinessTax,
    landRequests: nextLandRequests,
    privateAds: nextPrivateAds,
    lastSpentMonth: nextLastSpentMonth,
    palaceOfPeople: nextPalaceOfPeople,
    bankTrust: nextBankTrust,
    bankLoans: nextBankLoans,
    peoplesBank: nextPeoplesBank,
    lastBankNetWorthWarnMonth: nextLastBankNetWorthWarnMonth,
    advisorBriefing: nextAdvisorBriefing,
    taxPolicy: nextTaxPolicy,
    decrees: nextDecrees,
    camp: nextCamp,
    pendingArrivals: nextPendingArrivals,
    provinceEvents: nextProvinceEvents,
    lastSavedAt: now,
  };
  // H5: Ensure derived `provinces` is NEVER carried through into persisted save data
  delete (restored as unknown as Record<string, unknown>).provinces;

  const awayReport: AwayReportData | null =
    rawElapsedSeconds >= AWAY_MODAL_MIN_SECONDS
      ? {
          elapsedSeconds,
          daysElapsed,
          goldEarnedByShops,
          resourcesProduced,
          populationDelta: finalPopDelta,
          biggestPriceMove,
          payrollPaid,
          arrearsAdded,
          births,
          cvsFiled,
          marriages,
          housingGranted,
          faxesSent,
          citizenSpentTotal,
          businessTaxTotal,
          loanInstallmentsPaid,
          loanDeferredAdded,
          bankTradesCount,
          provinceEvents: offlineProvinceEvents,
        }
      : null;

  return { restored, awayReport };
}
