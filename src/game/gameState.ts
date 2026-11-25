import {
  ARREARS_SATISFACTION_CAP,
  createEmptyTradeVolumes,
  createInitialPrices,
  createInitialWarehouse,
  GRID_SIZE,
  LEVEL_1_FOOD_TARGET,
  LEVEL_1_SATISFACTION_TARGET,
  LEVEL_2_CUBES_TARGET,
  LEVEL_2_GOLD_TARGET,
  LEVEL_2_POPULATION_TARGET,
  MAX_LEDGER_ENTRIES,
  MONTH_DAYS,
  OBJECTIVE_REWARDS,
  SEEDED_ROCKY_COORDS,
  SEEDED_VILLAGE_COORDS,
  START_OWNED_MIN_COL,
  START_OWNED_MIN_ROW,
  STARTING_DAY,
  STARTING_GOLD,
  STARTING_HOUSES_COL,
  STARTING_HOUSES_ROW,
  STARTING_PALACE_COL,
  STARTING_PALACE_ROW,
  STARTING_POPULATION,
  STARTING_REPUTATION,
  THEMES,
  TICKS_PER_DAY,
  VILLAGE_JOIN_MIN_REPUTATION,
  VILLAGE_JOIN_REQUIRED_DAYS,
  VILLAGE_NAMES,
} from './constants';
import { sanitizeOfficeFaxesOnHydrate } from './advisor';
import {
  BANK_START_GOLD,
  PALACE_START_GOLD,
  TRUST_START,
  executeBuybackCube,
  executeRepayLoanFull,
  executeTakeLoan,
} from './bank';
import {
  generateInitialCitizens,
  reconcileCitizens,
  sanitizeCitizensOnHydrate,
  sumCitizenWealth,
} from './citizens';
import {
  getGrossPayrollBase,
  logDecree,
  sanitizeDecreesOnHydrate,
} from './decrees';
import {
  executeTrade,
  getEffectiveBuyPrice,
  rolloverBoursePrices,
} from './economy';
import { runMonthlyProcessor } from './monthlyProcessor';
import {
  computeNeedsAndSatisfaction,
  getTotalFood,
  processDayRolloverPeople,
} from './people';
import {
  cleanupEmigratedPrivateOwners,
  syncPrivateAds,
} from './privateJobs';
import {
  resolveLandRequest,
  sanitizePrivateLandOnHydrate,
} from './privateLand';
import {
  advanceProductionTick,
  canPlaceThemeOnCube,
  checkMaterialCosts,
  getCubePurchasePrice,
  isAdjacentToOwned,
  isPurchasableNeutralCube,
} from './production';
import { clearSavedGame } from './save';
import { createZeroLastMonthStats } from './spending';
import { STRINGS } from './strings';
import {
  computeTaxMoodDelta,
  DEFAULT_TAX_POLICY,
  normalizeTaxPolicy,
  projectTaxPolicyMonthlyImpact,
  sanitizeTaxPolicyOnHydrate,
} from './taxPolicy';
import type {
  AudioCue,
  Cube,
  GameState,
  LastMonthStats,
  LedgerEntry,
  LedgerKind,
  ObjectiveState,
  OfficeFaxStatus,
  PersistedSaveData,
  PrivateAd,
  SlotIndex,
  TaxPolicyMode,
  ThemeId,
  ToastItem,
  ToastTone,
  TradedResourceKey,
} from './types';

let toastCounter = 1;
let audioCounter = 1;
let ledgerCounter = 1;

function createToast(
  message: string,
  tone: ToastTone,
  focusCubeId?: number
): ToastItem {
  toastCounter += 1;
  return { id: `toast-${toastCounter}`, message, tone, focusCubeId };
}

function appendToasts(existing: ToastItem[], additions: ToastItem[]): ToastItem[] {
  if (additions.length === 0) return existing;
  return [...existing, ...additions].slice(-4);
}

function appendLedger(
  existing: LedgerEntry[],
  day: number,
  kind: LedgerKind,
  amount: number,
  labelAr: string
): LedgerEntry[] {
  ledgerCounter += 1;
  const entry: LedgerEntry = {
    id: `led-${day}-${ledgerCounter}`,
    day,
    kind,
    amount,
    labelAr,
  };
  const next = [...existing, entry];
  return next.length > MAX_LEDGER_ENTRIES
    ? next.slice(next.length - MAX_LEDGER_ENTRIES)
    : next;
}

function applyArrearsCap(satisfaction: number, arrears: number): number {
  return arrears > 0
    ? Math.min(ARREARS_SATISFACTION_CAP, satisfaction)
    : satisfaction;
}

function createInitialObjectives(): ObjectiveState[] {
  return [
    {
      id: 'build_sea',
      level: 1,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.build_sea,
    },
    {
      id: 'build_farm',
      level: 1,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.build_farm,
    },
    {
      id: 'hold_30_food',
      level: 1,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.hold_30_food,
    },
    {
      id: 'reach_60_satisfaction',
      level: 1,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.reach_60_satisfaction,
    },
    {
      id: 'reach_25_pop',
      level: 2,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.reach_25_pop,
    },
    {
      id: 'own_15_cubes',
      level: 2,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.own_15_cubes,
    },
    {
      id: 'hold_200_gold',
      level: 2,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.hold_200_gold,
    },
  ];
}

export function createInitialCubes(now: number): Cube[] {
  const rockySet = new Set(SEEDED_ROCKY_COORDS.map(([r, c]) => `${r},${c}`));
  const villageMap = new Map<string, string>();
  SEEDED_VILLAGE_COORDS.forEach(([r, c], idx) => {
    villageMap.set(`${r},${c}`, VILLAGE_NAMES[idx % VILLAGE_NAMES.length]);
  });

  const cubes: Cube[] = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const id = row * GRID_SIZE + col;
      const key = `${row},${col}`;
      const isOwned =
        row >= START_OWNED_MIN_ROW && col >= START_OWNED_MIN_COL;
      const isPalace =
        row === STARTING_PALACE_ROW && col === STARTING_PALACE_COL;
      const isStartingHouses =
        row === STARTING_HOUSES_ROW && col === STARTING_HOUSES_COL;
      const villageName = !isOwned ? villageMap.get(key) ?? null : null;

      cubes.push({
        id,
        row,
        col,
        owner: isOwned ? 'player' : 'neutral',
        themeId: isPalace ? 'palace' : isStartingHouses ? 'house' : null,
        secondThemeId: isStartingHouses ? 'house' : null,
        builtAt: isPalace || isStartingHouses ? now : null,
        secondBuiltAt: isStartingHouses ? now : null,
        progress: 0,
        secondProgress: 0,
        shortage: null,
        secondShortage: null,
        isRocky: rockySet.has(key),
        isVillage: villageName !== null,
        villageName,
        villageLoyaltyDays: 0,
        privateOwnerId: null,
        privateIntendedTheme: null,
        privateBuildRetries: 0,
      });
    }
  }
  return cubes;
}

export function createFreshGameState(now = Date.now()): GameState {
  const cubes = createInitialCubes(now);
  const warehouse = createInitialWarehouse();
  const prices = createInitialPrices();
  const evalNeeds = computeNeedsAndSatisfaction(
    cubes,
    warehouse,
    STARTING_POPULATION,
    false
  );
  const initialPop = generateInitialCitizens(cubes, STARTING_POPULATION, 0, 0);

  return {
    cubes,
    warehouse,
    gold: STARTING_GOLD,
    population: STARTING_POPULATION,
    satisfaction: evalNeeds.satisfaction,
    reputation: STARTING_REPUTATION,
    hungerFlag: false,
    needs: evalNeeds.needs,
    day: STARTING_DAY,
    tickInDay: 0,
    prices,
    previousPrices: { ...prices },
    dailyBought: createEmptyTradeVolumes(),
    dailySold: createEmptyTradeVolumes(),
    tickerMessage: STRINGS.bourse.defaultTicker,
    level: 1,
    objectives: createInitialObjectives(),
    villagesJoined: 0,
    lastJoinedVillageCubeId: null,
    lastJoinedVillageSeq: 0,
    level2UnlockedNotice: false,
    level2CompletedNotice: false,
    level2CompletedShown: false,
    muted: false,
    lastSavedAt: now,
    toasts: [],
    pendingAudioCue: null,
    citizenWealth: sumCitizenWealth(initialPop.citizens),
    arrears: 0,
    lastPayroll: null,
    dailyShopGold: 0,
    inflationIndex: 100,
    ledger: [],
    lastInflationWarnMonth: 0,
    citizens: initialPop.citizens,
    nextCitizenId: initialPop.nextCitizenId,
    totalMonths: 0,
    officeFaxes: [],
    policeRecords: [],
    lastMonthStats: createZeroLastMonthStats(),
    monthlyBusinessTax: 0,
    landRequests: [],
    privateAds: [],
    lastSpentMonth: 0,
    palaceOfPeople: { gold: PALACE_START_GOLD },
    bankTrust: TRUST_START,
    bankLoans: [],
    peoplesBank: { gold: BANK_START_GOLD, portfolio: {}, totalTrades: 0, lastTradeMonth: null, lastTradeAr: null },
    lastBankNetWorthWarnMonth: 0,
    advisorBriefing: null,
    taxPolicy: { ...DEFAULT_TAX_POLICY },
    decrees: [],
  };
}

export function hydrateGameState(saved: PersistedSaveData): GameState {
  const arrears = typeof saved.arrears === 'number' ? Math.max(0, saved.arrears) : 0;
  const safeDay = Math.max(1, saved.day);
  const safePop = Math.max(0, saved.population);
  const savedTotalMonths =
    typeof saved.totalMonths === 'number' && Number.isFinite(saved.totalMonths)
      ? Math.max(0, Math.trunc(saved.totalMonths))
      : 0;
  const totalMonths = Math.max(
    savedTotalMonths,
    Math.floor((safeDay - 1) / MONTH_DAYS)
  );
  const savedCitizenWealth =
    typeof saved.citizenWealth === 'number' && Number.isFinite(saved.citizenWealth)
      ? Math.max(0, Math.floor(saved.citizenWealth))
      : 0;
  const savedPoliceRecords = Array.isArray(saved.policeRecords)
    ? saved.policeRecords
    : [];
  const savedOfficeFaxes = sanitizeOfficeFaxesOnHydrate(saved.officeFaxes);
  const taxPolicy = sanitizeTaxPolicyOnHydrate(saved.taxPolicy);
  const decrees = sanitizeDecreesOnHydrate(saved.decrees);
  const advisorBriefing = saved.advisorBriefing ?? null;

  const sanitized = sanitizeCitizensOnHydrate(
    saved.citizens,
    totalMonths,
    saved.cubes,
    safePop,
    savedCitizenWealth,
    savedPoliceRecords
  );

  // Element 6.2 & H3: Sanitize private plots, land requests & private ads on hydrate
  const cleanPrivate = sanitizePrivateLandOnHydrate(
    saved.cubes,
    sanitized.citizens,
    saved.landRequests
  );
  const rawPrivateAds: PrivateAd[] = Array.isArray(saved.privateAds)
    ? saved.privateAds
    : [];
  const syncedAds = syncPrivateAds({
    cubes: cleanPrivate.cubes,
    citizens: sanitized.citizens,
    privateAds: rawPrivateAds,
    totalMonths,
  });

  const rawStats = saved.lastMonthStats as Partial<LastMonthStats> | undefined;
  const lastMonthStats: LastMonthStats =
    rawStats && typeof rawStats === 'object'
      ? {
          foodRevenue:
            typeof rawStats.foodRevenue === 'number' && Number.isFinite(rawStats.foodRevenue)
              ? Math.max(0, Math.floor(rawStats.foodRevenue))
              : 0,
          leisureRevenue:
            typeof rawStats.leisureRevenue === 'number' && Number.isFinite(rawStats.leisureRevenue)
              ? Math.max(0, Math.floor(rawStats.leisureRevenue))
              : 0,
          businessTax:
            typeof rawStats.businessTax === 'number' && Number.isFinite(rawStats.businessTax)
              ? Math.max(0, Math.floor(rawStats.businessTax))
              : 0,
          importSink:
            typeof rawStats.importSink === 'number' && Number.isFinite(rawStats.importSink)
              ? Math.max(0, Math.floor(rawStats.importSink))
              : 0,
          leisureSink:
            typeof rawStats.leisureSink === 'number' && Number.isFinite(rawStats.leisureSink)
              ? Math.max(0, Math.floor(rawStats.leisureSink))
              : 0,
          unmetFood:
            typeof rawStats.unmetFood === 'number' && Number.isFinite(rawStats.unmetFood)
              ? Math.max(0, Math.floor(rawStats.unmetFood))
              : 0,
          taxWithheld:
            typeof rawStats.taxWithheld === 'number' && Number.isFinite(rawStats.taxWithheld)
              ? Math.max(0, Math.floor(rawStats.taxWithheld))
              : 0,
          grantsPaid:
            typeof rawStats.grantsPaid === 'number' && Number.isFinite(rawStats.grantsPaid)
              ? Math.max(0, Math.floor(rawStats.grantsPaid))
              : 0,
        }
      : createZeroLastMonthStats();

  const hydratedCitizenWealth = sumCitizenWealth(syncedAds.citizens);
  const taxMoodDelta = computeTaxMoodDelta(
    taxPolicy,
    hydratedCitizenWealth,
    safePop
  );
  const evalNeeds = computeNeedsAndSatisfaction(
    cleanPrivate.cubes,
    saved.warehouse,
    safePop,
    saved.hungerFlag,
    taxMoodDelta
  );

  const defaultObjectives = createInitialObjectives();
  const mergedObjectives = defaultObjectives.map((def) => {
    const found = saved.objectives?.find((o) => o.id === def.id);
    return found ? { ...def, completed: Boolean(found.completed) } : def;
  });

  const rawSavedLedger = Array.isArray(saved.ledger)
    ? saved.ledger.slice(-MAX_LEDGER_ENTRIES)
    : [];
  for (const entry of rawSavedLedger) {
    if (entry && typeof entry.id === 'string') {
      const match = /^led-\d+-(\d+)/.exec(entry.id);
      if (match) {
        const seq = Number(match[1]);
        if (Number.isFinite(seq) && seq > ledgerCounter) {
          ledgerCounter = seq;
        }
      }
    }
  }
  const seenLedgerIds = new Set<string>();
  const savedLedger = rawSavedLedger.map((entry) => {
    let id =
      typeof entry.id === 'string' && entry.id.length > 0
        ? entry.id
        : `led-${entry.day}-${++ledgerCounter}`;
    if (seenLedgerIds.has(id)) {
      ledgerCounter += 1;
      id = `led-${entry.day}-${ledgerCounter}`;
    }
    seenLedgerIds.add(id);
    return id === entry.id ? entry : { ...entry, id };
  });

  const nextCitizenId = Math.max(
    sanitized.nextCitizenId,
    typeof saved.nextCitizenId === 'number' && Number.isFinite(saved.nextCitizenId)
      ? Math.floor(saved.nextCitizenId)
      : 1
  );

  return {
    cubes: cleanPrivate.cubes,
    warehouse: saved.warehouse,
    gold: Math.max(0, saved.gold),
    population: safePop,
    satisfaction: applyArrearsCap(evalNeeds.satisfaction, arrears),
    reputation: Math.max(0, Math.min(100, saved.reputation)),
    hungerFlag: Boolean(saved.hungerFlag),
    needs: evalNeeds.needs,
    day: safeDay,
    tickInDay: Math.max(0, saved.tickInDay % TICKS_PER_DAY),
    prices: saved.prices,
    previousPrices: saved.previousPrices,
    dailyBought: saved.dailyBought,
    dailySold: saved.dailySold,
    tickerMessage: saved.tickerMessage || STRINGS.bourse.defaultTicker,
    level: saved.level === 2 ? 2 : 1,
    objectives: mergedObjectives,
    villagesJoined: saved.villagesJoined ?? 0,
    lastJoinedVillageCubeId: null,
    lastJoinedVillageSeq: 0,
    level2UnlockedNotice: false,
    level2CompletedNotice: false,
    level2CompletedShown: Boolean(saved.level2CompletedShown),
    muted: Boolean(saved.muted),
    lastSavedAt: saved.lastSavedAt,
    toasts: [],
    pendingAudioCue: null,
    citizenWealth: hydratedCitizenWealth,
    arrears,
    lastPayroll: saved.lastPayroll ?? null,
    dailyShopGold:
      typeof saved.dailyShopGold === 'number' ? Math.max(0, saved.dailyShopGold) : 0,
    inflationIndex:
      typeof saved.inflationIndex === 'number' ? saved.inflationIndex : 100,
    ledger: savedLedger,
    lastInflationWarnMonth:
      typeof saved.lastInflationWarnMonth === 'number'
        ? saved.lastInflationWarnMonth
        : 0,
    citizens: syncedAds.citizens,
    nextCitizenId,
    totalMonths,
    officeFaxes: savedOfficeFaxes,
    policeRecords: sanitized.policeRecords,
    lastMonthStats,
    monthlyBusinessTax:
      typeof saved.monthlyBusinessTax === 'number' &&
      Number.isFinite(saved.monthlyBusinessTax)
        ? Math.max(0, Math.floor(saved.monthlyBusinessTax))
        : 0,
    landRequests: cleanPrivate.landRequests,
    privateAds: syncedAds.privateAds,
    lastSpentMonth:
      typeof saved.lastSpentMonth === 'number' &&
      Number.isFinite(saved.lastSpentMonth)
        ? Math.max(0, Math.trunc(saved.lastSpentMonth))
        : 0,
    palaceOfPeople: saved.palaceOfPeople ?? { gold: PALACE_START_GOLD },
    bankTrust:
      typeof saved.bankTrust === 'number'
        ? Math.max(0, Math.min(100, Math.floor(saved.bankTrust)))
        : TRUST_START,
    bankLoans: Array.isArray(saved.bankLoans) ? saved.bankLoans : [],
    peoplesBank: saved.peoplesBank ?? {
      gold: BANK_START_GOLD,
      portfolio: {},
      totalTrades: 0,
      lastTradeMonth: null,
      lastTradeAr: null,
    },
    lastBankNetWorthWarnMonth:
      typeof saved.lastBankNetWorthWarnMonth === 'number'
        ? saved.lastBankNetWorthWarnMonth
        : 0,
    advisorBriefing,
    taxPolicy,
    decrees,
  };
}

function isObjectiveSatisfied(state: GameState, objectiveId: string): boolean {
  switch (objectiveId) {
    case 'build_sea':
      return state.cubes.some(
        (c) => c.owner === 'player' && c.themeId === 'sea'
      );
    case 'build_farm':
      return state.cubes.some(
        (c) =>
          c.owner === 'player' &&
          (c.themeId === 'farm' || c.themeId === 'wheat_farm')
      );
    case 'hold_30_food':
      // Strictly counts Fish + Crops + Wheat + Fruit + Meat + Bread (Water never counts)
      return getTotalFood(state.warehouse) >= LEVEL_1_FOOD_TARGET;
    case 'reach_60_satisfaction':
      return state.satisfaction >= LEVEL_1_SATISFACTION_TARGET;
    case 'reach_25_pop':
      return state.population >= LEVEL_2_POPULATION_TARGET;
    case 'own_15_cubes':
      return (
        state.cubes.filter((c) => c.owner === 'player').length >=
        LEVEL_2_CUBES_TARGET
      );
    case 'hold_200_gold':
      return state.gold >= LEVEL_2_GOLD_TARGET;
    default:
      return false;
  }
}

function evaluateObjectivesAndProgression(state: GameState): GameState {
  let gold = state.gold;
  let warehouse = state.warehouse;
  let ledger = state.ledger;
  let level = state.level;
  let level2UnlockedNotice = state.level2UnlockedNotice;
  let level2CompletedNotice = state.level2CompletedNotice;
  let level2CompletedShown = state.level2CompletedShown;
  let pendingAudioCue = state.pendingAudioCue;
  const newToasts: ToastItem[] = [];

  let prevLevel1Completed = true;
  const nextObjectives = state.objectives.map((obj) => {
    if (obj.completed) {
      return obj;
    }
    if (obj.level > level) return obj;
    if (obj.level === 1 && !prevLevel1Completed) {
      return obj;
    }
    if (!isObjectiveSatisfied(state, obj.id)) {
      if (obj.level === 1) prevLevel1Completed = false;
      return obj;
    }

    gold += obj.rewardGold;
    if (obj.rewardGold > 0) {
      ledger = appendLedger(
        ledger,
        state.day,
        'objective',
        obj.rewardGold,
        'مكافأة هدف'
      );
    }
    const label = STRINGS.objectives.items[obj.id] ?? obj.id;
    newToasts.push(
      createToast(STRINGS.toasts.objectiveCompleted(label, obj.rewardGold), 'success')
    );
    audioCounter += 1;
    pendingAudioCue = { id: audioCounter, cue: 'reward' };
    return { ...obj, completed: true };
  });

  // Never auto-open modals on state changes! Set clickable notice + toast instead.
  if (level === 1) {
    const level1AllDone = nextObjectives
      .filter((o) => o.level === 1)
      .every((o) => o.completed);
    if (level1AllDone) {
      level = 2;
      level2UnlockedNotice = true;
      // Element 2.2: One-time Level 2 materials gift (+8 wood, +4 stone; no ledger entry)
      warehouse = {
        ...warehouse,
        wood: (warehouse.wood ?? 0) + 8,
        stone: (warehouse.stone ?? 0) + 4,
      };
      newToasts.push(createToast(STRINGS.toasts.level2Unlocked, 'success'));
      newToasts.push(
        createToast('هدية المستوى الثاني: +8 خشب، +4 حجر', 'success')
      );
      audioCounter += 1;
      pendingAudioCue = { id: audioCounter, cue: 'levelUp' };
    }
  }

  if (level === 2 && !level2CompletedShown) {
    const level2AllDone = nextObjectives
      .filter((o) => o.level === 2)
      .every((o) => o.completed);
    if (level2AllDone) {
      level2CompletedNotice = true;
      level2CompletedShown = true;
      newToasts.push(createToast(STRINGS.toasts.level2Completed, 'success'));
      audioCounter += 1;
      pendingAudioCue = { id: audioCounter, cue: 'levelUp' };
    }
  }

  return {
    ...state,
    gold,
    warehouse,
    ledger,
    level,
    objectives: nextObjectives,
    level2UnlockedNotice,
    level2CompletedNotice,
    level2CompletedShown,
    toasts: appendToasts(state.toasts, newToasts),
    pendingAudioCue,
  };
}

export type GameAction =
  | { type: 'TICK' }
  | { type: 'PLACE_THEME'; cubeId: number; themeId: ThemeId }
  | { type: 'DEMOLISH_THEME'; cubeId: number; slot: SlotIndex }
  | { type: 'BUY_CUBE'; cubeId: number }
  | {
      type: 'TRADE_RESOURCE';
      resource: TradedResourceKey;
      side: 'buy' | 'sell';
      quantity: number | 'max';
    }
  | {
      type: 'BUY_MATERIALS';
      items: Partial<Record<TradedResourceKey, number>>;
    }
  | {
      type: 'RESOLVE_LAND_REQUEST';
      requestId: string;
      approve: boolean;
    }
  | {
      type: 'TAKE_LOAN';
      principal: number;
      termMonths: 3 | 6 | 12;
      collateralCubeIds: number[];
    }
  | { type: 'REPAY_LOAN_FULL' }
  | { type: 'BUYBACK_CUBE'; cubeId: number }
  | { type: 'SET_TAX_POLICY'; mode: TaxPolicyMode; percent: number }
  | { type: 'SET_FAX_STATUS'; faxId: string; status: OfficeFaxStatus }
  | { type: 'MARK_ALL_FAXES_READ' }
  | {
      type: 'LOG_ADVISOR_ACTION';
      labelAr: string;
      projectedAr: string;
      faxId?: string;
    }
  | { type: 'DISMISS_TOAST'; id: string }
  | { type: 'CLEAR_LEVEL2_NOTICE' }
  | { type: 'CLEAR_LEVEL2_COMPLETED_NOTICE' }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'NEW_GAME' };

function makeCue(cue: AudioCue) {
  audioCounter += 1;
  return { id: audioCounter, cue };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'TICK': {
      const prod = advanceProductionTick(
        state.cubes,
        state.warehouse,
        state.gold,
        state.population,
        state.citizens
      );

      let nextCubes = prod.cubes;
      let nextWarehouse = prod.warehouse;
      let nextGold = prod.gold;
      let nextDailyShopGold = state.dailyShopGold + prod.royalShopGoldDelta;
      let nextMonthlyBusinessTax = state.monthlyBusinessTax + prod.businessTaxDelta;
      let nextPopulation = state.population;
      let nextReputation = state.reputation;
      let nextHungerFlag = state.hungerFlag;
      let nextDay = state.day;
      let nextTickInDay = state.tickInDay + 1;
      let nextPrices = state.prices;
      let nextPreviousPrices = state.previousPrices;
      let nextDailyBought = state.dailyBought;
      let nextDailySold = state.dailySold;
      let nextTicker = state.tickerMessage;
      let nextVillagesJoined = state.villagesJoined;
      let lastJoinedVillageCubeId = state.lastJoinedVillageCubeId;
      let lastJoinedVillageSeq = state.lastJoinedVillageSeq;
      let nextCitizenWealth = state.citizenWealth;
      let nextArrears = state.arrears;
      let nextLastPayroll = state.lastPayroll;
      let nextInflationIndex = state.inflationIndex;
      let nextLedger = state.ledger;
      let nextLastInflationWarnMonth = state.lastInflationWarnMonth;
      let nextCitizens = state.citizens;
      let nextCitizenId = state.nextCitizenId;
      let nextTotalMonths = state.totalMonths;
      let nextOfficeFaxes = state.officeFaxes;
      let nextPoliceRecords = state.policeRecords;
      let nextLastMonthStats = state.lastMonthStats;
      let nextLandRequests = state.landRequests;
      let nextPrivateAds = state.privateAds;
      let nextLastSpentMonth = state.lastSpentMonth;
      let nextPalaceOfPeople = state.palaceOfPeople;
      let nextBankTrust = state.bankTrust;
      let nextBankLoans = state.bankLoans;
      let nextPeoplesBank = state.peoplesBank;
      let nextLastBankNetWorthWarnMonth = state.lastBankNetWorthWarnMonth;
      let nextAdvisorBriefing = state.advisorBriefing;
      let nextDecrees = state.decrees;
      const newToasts: ToastItem[] = [];
      let pendingAudioCue = state.pendingAudioCue;

      // Credit 90% private-business cycle revenue directly to owning citizens
      const creditKeys = Object.keys(prod.privateOwnerCredits);
      if (creditKeys.length > 0) {
        nextCitizens = nextCitizens.map((c) => {
          const bonus = prod.privateOwnerCredits[c.id];
          return bonus ? { ...c, wealth: c.wealth + bonus } : c;
        });
        nextCitizenWealth = sumCitizenWealth(nextCitizens);
      }

      if (nextTickInDay >= TICKS_PER_DAY) {
        // Element 3.5: Flush accumulated royal shop/service gold into treasury ledger
        if (nextDailyShopGold > 0) {
          nextLedger = appendLedger(
            nextLedger,
            state.day,
            'shop',
            nextDailyShopGold,
            'دخل المحلات والخدمات'
          );
          nextDailyShopGold = 0;
        }

        nextTickInDay = 0;
        nextDay += 1;

        const dayTaxMoodDelta = computeTaxMoodDelta(
          state.taxPolicy,
          nextCitizenWealth,
          nextPopulation
        );
        const peopleRes = processDayRolloverPeople(
          nextCubes,
          nextWarehouse,
          nextPopulation,
          nextReputation,
          state.level,
          dayTaxMoodDelta
        );
        nextWarehouse = peopleRes.warehouse;
        nextPopulation = peopleRes.population;
        nextReputation = peopleRes.reputation;
        nextHungerFlag = peopleRes.hungerFlag;

        // Element 1.5 & 7.2: Restore citizens.length === population & clean up emigrated private owners
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

        if (peopleRes.hungerFlag) {
          newToasts.push(createToast(STRINGS.toasts.hungerOccurred, 'warning'));
        }
        if (peopleRes.popEvent === 'grow') {
          newToasts.push(createToast(STRINGS.toasts.newFamilies, 'success'));
        } else if (peopleRes.popEvent === 'shrink') {
          newToasts.push(createToast(STRINGS.toasts.familiesLeft, 'warning'));
        }

        const bourseRes = rolloverBoursePrices(
          nextPrices,
          nextDailyBought,
          nextDailySold,
          state.level
        );
        nextPrices = bourseRes.prices;
        nextPreviousPrices = bourseRes.previousPrices;
        nextTicker = bourseRes.tickerMessage;
        nextInflationIndex = bourseRes.inflationIndex;
        nextDailyBought = createEmptyTradeVolumes();
        nextDailySold = createEmptyTradeVolumes();

        // Element 5.3: Once per month, warn if inflation index > 130 at rollover
        const currentMonth = Math.floor((nextDay - 1) / MONTH_DAYS) + 1;
        if (
          nextInflationIndex > 130 &&
          nextLastInflationWarnMonth < currentMonth
        ) {
          nextLastInflationWarnMonth = currentMonth;
          newToasts.push(
            createToast(
              `تحذير الخزنة: مؤشر الغلاء مرتفع (${nextInflationIndex}) — راجع نشرة البورصة`,
              'warning'
            )
          );
        }

        // Unified monthly heartbeat on days 31, 61, 91...
        if ((nextDay - 1) % MONTH_DAYS === 0 && nextDay > 1) {
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
            taxPolicy: state.taxPolicy,
            decrees: nextDecrees,
            advisorBriefing: nextAdvisorBriefing,
            hungerFlag: nextHungerFlag,
            isOffline: false,
            day: nextDay,
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

          for (const item of mp.ledgerItems) {
            nextLedger = appendLedger(
              nextLedger,
              item.day,
              item.kind,
              item.amount,
              item.labelAr
            );
          }

          if (nextArrears === 0) {
            newToasts.push(
              createToast(
                `تم صرف رواتب الشهر: ${mp.paid} ذهب لـ${mp.lastPayroll.workers} عامل`,
                'info'
              )
            );
          } else {
            newToasts.push(
              createToast(
                `تحذير: الخزنة لم تكفِ الرواتب — متأخرات ${nextArrears} ذهب`,
                'warning'
              )
            );
          }

          if (mp.summary.landRequestsGenerated > 0) {
            newToasts.push(
              createToast('وصل طلب جديد لشراء أرض في القصر الملكي', 'info')
            );
          }
        }

        // WP3 Independent Village Loyalty Check at Day Rollover
        const now = Date.now();
        let villageJoinedThisDay = false;
        nextCubes = nextCubes.map((cube) => {
          if (!cube.isVillage || cube.owner === 'player') return cube;
          if (
            isAdjacentToOwned(nextCubes, cube) &&
            nextReputation >= VILLAGE_JOIN_MIN_REPUTATION
          ) {
            const nextDays = cube.villageLoyaltyDays + 1;
            if (nextDays >= VILLAGE_JOIN_REQUIRED_DAYS) {
              villageJoinedThisDay = true;
              nextVillagesJoined += 1;
              lastJoinedVillageCubeId = cube.id;
              lastJoinedVillageSeq += 1;
              const vName = cube.villageName ?? 'الواحة';
              nextTicker = STRINGS.bourse.tickerVillageJoined(vName);
              newToasts.push(
                createToast(STRINGS.toasts.villageJoined(vName), 'success', cube.id)
              );
              return {
                ...cube,
                owner: 'player' as const,
                isVillage: false,
                villageLoyaltyDays: 0,
                themeId: 'house' as const,
                secondThemeId: 'house' as const,
                builtAt: now,
                secondBuiltAt: now,
                progress: 0,
                secondProgress: 0,
              };
            }
            return { ...cube, villageLoyaltyDays: nextDays };
          }
          if (cube.villageLoyaltyDays !== 0) {
            return { ...cube, villageLoyaltyDays: 0 };
          }
          return cube;
        });

        pendingAudioCue = makeCue(villageJoinedThisDay ? 'levelUp' : 'day');
      }

      const tickTaxMoodDelta = computeTaxMoodDelta(
        state.taxPolicy,
        nextCitizenWealth,
        nextPopulation
      );
      const evalNeeds = computeNeedsAndSatisfaction(
        nextCubes,
        nextWarehouse,
        nextPopulation,
        nextHungerFlag,
        tickTaxMoodDelta
      );

      const updated: GameState = {
        ...state,
        cubes: nextCubes,
        warehouse: nextWarehouse,
        gold: Math.max(0, nextGold),
        population: Math.max(0, nextPopulation),
        satisfaction: applyArrearsCap(evalNeeds.satisfaction, nextArrears),
        reputation: nextReputation,
        hungerFlag: nextHungerFlag,
        needs: evalNeeds.needs,
        day: nextDay,
        tickInDay: nextTickInDay,
        prices: nextPrices,
        previousPrices: nextPreviousPrices,
        dailyBought: nextDailyBought,
        dailySold: nextDailySold,
        tickerMessage: nextTicker,
        villagesJoined: nextVillagesJoined,
        lastJoinedVillageCubeId,
        lastJoinedVillageSeq,
        citizenWealth: nextCitizenWealth,
        arrears: nextArrears,
        lastPayroll: nextLastPayroll,
        dailyShopGold: nextDailyShopGold,
        inflationIndex: nextInflationIndex,
        ledger: nextLedger,
        lastInflationWarnMonth: nextLastInflationWarnMonth,
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
        decrees: nextDecrees,
        toasts: appendToasts(state.toasts, newToasts),
        pendingAudioCue,
      };

      return evaluateObjectivesAndProgression(updated);
    }

    case 'PLACE_THEME': {
      const cube = state.cubes[action.cubeId];
      if (!cube) return state;

      const theme = THEMES[action.themeId];
      if (state.gold < theme.cost) {
        return {
          ...state,
          toasts: appendToasts(state.toasts, [
            createToast(STRINGS.toasts.notEnoughGold, 'warning'),
          ]),
          pendingAudioCue: makeCue('error'),
        };
      }

      const matCheck = checkMaterialCosts(
        state.warehouse,
        action.themeId,
        state.level
      );
      if (!matCheck.ok) {
        return {
          ...state,
          toasts: appendToasts(state.toasts, [
            createToast(STRINGS.toasts.notEnoughMaterials, 'warning'),
          ]),
          pendingAudioCue: makeCue('error'),
        };
      }

      if (cube.collateralLoanId != null) {
        return {
          ...state,
          toasts: appendToasts(state.toasts, [
            createToast('لا يمكن البناء على أرض مرهونة للبنك الشرعي', 'warning'),
          ]),
          pendingAudioCue: makeCue('error'),
        };
      }

      const check = canPlaceThemeOnCube(cube, action.themeId, state.level);
      if (!check.valid || check.targetSlot === null) {
        const msg =
          check.reason === 'rocky_required'
            ? STRINGS.toasts.rockyRequired
            : STRINGS.toasts.invalidPlacement;
        return {
          ...state,
          toasts: appendToasts(state.toasts, [createToast(msg, 'warning')]),
          pendingAudioCue: makeCue('error'),
        };
      }

      const nextWarehouse = { ...state.warehouse };
      // Element 2.1: Material costs apply ONLY in Level 2+; waived completely in Level 1
      if (state.level >= 2 && theme.materialCosts) {
        for (const [res, amt] of Object.entries(theme.materialCosts) as Array<
          [TradedResourceKey, number]
        >) {
          if (amt > 0) {
            nextWarehouse[res] = Math.max(0, (nextWarehouse[res] ?? 0) - amt);
          }
        }
      }

      const now = Date.now();
      const nextCubes = state.cubes.map((c) => {
        if (c.id !== action.cubeId) return c;
        if (check.targetSlot === 0) {
          return {
            ...c,
            themeId: action.themeId,
            builtAt: now,
            progress: 0,
            shortage: null,
          };
        }
        return {
          ...c,
          secondThemeId: action.themeId,
          secondBuiltAt: now,
          secondProgress: 0,
          secondShortage: null,
        };
      });

      const evalNeeds = computeNeedsAndSatisfaction(
        nextCubes,
        nextWarehouse,
        state.population,
        state.hungerFlag,
        computeTaxMoodDelta(state.taxPolicy, state.citizenWealth, state.population)
      );

      const nextLedger =
        theme.cost > 0
          ? appendLedger(
              state.ledger,
              state.day,
              'build',
              -theme.cost,
              `بناء ${STRINGS.themes[action.themeId].name}`
            )
          : state.ledger;

      const updated: GameState = {
        ...state,
        cubes: nextCubes,
        warehouse: nextWarehouse,
        gold: Math.max(0, state.gold - theme.cost),
        satisfaction: applyArrearsCap(evalNeeds.satisfaction, state.arrears),
        needs: evalNeeds.needs,
        ledger: nextLedger,
        pendingAudioCue: makeCue('build'),
      };

      return evaluateObjectivesAndProgression(updated);
    }

    case 'DEMOLISH_THEME': {
      const cube = state.cubes[action.cubeId];
      if (!cube || cube.owner !== 'player') return state;
      // Element 5.2 & H5: Crown cannot demolish or confiscate private property or collateral
      if (typeof cube.privateOwnerId === 'number' || cube.collateralLoanId != null) return state;
      if (action.slot === 0 && cube.themeId && THEMES[cube.themeId].nonDemolishable) {
        return state;
      }

      const nextCubes = state.cubes.map((c) => {
        if (c.id !== action.cubeId) return c;
        if (action.slot === 0) {
          if (c.secondThemeId) {
            return {
              ...c,
              themeId: c.secondThemeId,
              builtAt: c.secondBuiltAt,
              progress: c.secondProgress,
              shortage: c.secondShortage,
              secondThemeId: null,
              secondBuiltAt: null,
              secondProgress: 0,
              secondShortage: null,
            };
          }
          return {
            ...c,
            themeId: null,
            builtAt: null,
            progress: 0,
            shortage: null,
          };
        }
        return {
          ...c,
          secondThemeId: null,
          secondBuiltAt: null,
          secondProgress: 0,
          secondShortage: null,
        };
      });

      const evalNeeds = computeNeedsAndSatisfaction(
        nextCubes,
        state.warehouse,
        state.population,
        state.hungerFlag,
        computeTaxMoodDelta(state.taxPolicy, state.citizenWealth, state.population)
      );

      return {
        ...state,
        cubes: nextCubes,
        satisfaction: applyArrearsCap(evalNeeds.satisfaction, state.arrears),
        needs: evalNeeds.needs,
      };
    }

    case 'BUY_CUBE': {
      const cube = state.cubes[action.cubeId];
      if (!cube || !isPurchasableNeutralCube(state.cubes, cube)) return state;

      const price = getCubePurchasePrice(state.cubes, cube);
      if (state.gold < price) {
        return {
          ...state,
          toasts: appendToasts(state.toasts, [
            createToast(STRINGS.toasts.notEnoughGold, 'warning'),
          ]),
          pendingAudioCue: makeCue('error'),
        };
      }

      const nextCubes = state.cubes.map((c) =>
        c.id === action.cubeId ? { ...c, owner: 'player' as const } : c
      );

      const nextLedger = appendLedger(
        state.ledger,
        state.day,
        'land',
        -price,
        'شراء أرض'
      );

      const updated: GameState = {
        ...state,
        cubes: nextCubes,
        gold: Math.max(0, state.gold - price),
        ledger: nextLedger,
        toasts: appendToasts(state.toasts, [
          createToast(STRINGS.toasts.cubePurchased, 'success'),
        ]),
        pendingAudioCue: makeCue('build'),
      };

      return evaluateObjectivesAndProgression(updated);
    }

    case 'TRADE_RESOURCE': {
      if (state.level < 2) return state;
      const result = executeTrade(
        state.cubes,
        state.gold,
        state.warehouse,
        state.prices,
        state.dailyBought,
        state.dailySold,
        action.resource,
        action.side,
        action.quantity
      );
      if (result.tradedQty <= 0) {
        return {
          ...state,
          pendingAudioCue: makeCue('error'),
        };
      }

      const goldDelta = result.gold - state.gold;
      const nextLedger =
        goldDelta !== 0
          ? appendLedger(state.ledger, state.day, 'trade', goldDelta, 'بورصة')
          : state.ledger;

      const evalNeeds = computeNeedsAndSatisfaction(
        state.cubes,
        result.warehouse,
        state.population,
        state.hungerFlag,
        computeTaxMoodDelta(state.taxPolicy, state.citizenWealth, state.population)
      );

      const updated: GameState = {
        ...state,
        gold: result.gold,
        warehouse: result.warehouse,
        dailyBought: result.dailyBought,
        dailySold: result.dailySold,
        satisfaction: applyArrearsCap(evalNeeds.satisfaction, state.arrears),
        needs: evalNeeds.needs,
        ledger: nextLedger,
        pendingAudioCue: makeCue('trade'),
      };

      return evaluateObjectivesAndProgression(updated);
    }

    case 'BUY_MATERIALS': {
      const entries = (
        Object.entries(action.items) as Array<[TradedResourceKey, number | undefined]>
      ).filter((entry): entry is [TradedResourceKey, number] =>
        typeof entry[1] === 'number' && entry[1] > 0
      );
      if (entries.length === 0) return state;

      let total = 0;
      for (const [res, qty] of entries) {
        const unitPrice = getEffectiveBuyPrice(state.prices[res], state.cubes);
        total += unitPrice * qty;
      }

      if (total <= 0) return state;
      if (state.gold < total) {
        return {
          ...state,
          toasts: appendToasts(state.toasts, [
            createToast(STRINGS.toasts.notEnoughGold, 'warning'),
          ]),
          pendingAudioCue: makeCue('error'),
        };
      }

      const nextWarehouse = { ...state.warehouse };
      const nextBought = { ...state.dailyBought };
      for (const [res, qty] of entries) {
        nextWarehouse[res] = (nextWarehouse[res] ?? 0) + qty;
        nextBought[res] = (nextBought[res] ?? 0) + qty;
      }

      const nextLedger = appendLedger(
        state.ledger,
        state.day,
        'materials',
        -total,
        'شراء خامات'
      );

      const evalNeeds = computeNeedsAndSatisfaction(
        state.cubes,
        nextWarehouse,
        state.population,
        state.hungerFlag,
        computeTaxMoodDelta(state.taxPolicy, state.citizenWealth, state.population)
      );

      const updated: GameState = {
        ...state,
        gold: Math.max(0, state.gold - total),
        warehouse: nextWarehouse,
        dailyBought: nextBought,
        satisfaction: applyArrearsCap(evalNeeds.satisfaction, state.arrears),
        needs: evalNeeds.needs,
        ledger: nextLedger,
        pendingAudioCue: makeCue('trade'),
      };

      return evaluateObjectivesAndProgression(updated);
    }

    case 'RESOLVE_LAND_REQUEST': {
      const targetRequest = state.landRequests.find(
        (r) => r.id === action.requestId
      );
      const res = resolveLandRequest({
        cubes: state.cubes,
        citizens: state.citizens,
        landRequests: state.landRequests,
        gold: state.gold,
        policeRecords: state.policeRecords,
        totalMonths: state.totalMonths,
        requestId: action.requestId,
        approve: action.approve,
      });

      if (!res.resolved) {
        if (res.landRequests === state.landRequests) {
          return state;
        }
        return {
          ...state,
          landRequests: res.landRequests,
          toasts: appendToasts(state.toasts, [
            createToast('تعذّر تنفيذ طلب الأرض لانتفاء الشروط', 'warning'),
          ]),
          pendingAudioCue: makeCue('error'),
        };
      }

      let nextLedger = state.ledger;
      if (res.ledgerItem) {
        nextLedger = appendLedger(
          nextLedger,
          state.day,
          res.ledgerItem.kind,
          res.ledgerItem.amount,
          res.ledgerItem.labelAr
        );
      }

      const saleAmount = targetRequest?.price ?? res.ledgerItem?.amount ?? 0;
      const nextDecrees = res.approved
        ? logDecree(state.decrees, {
            month: state.totalMonths,
            kind: 'land_sale',
            labelAr: 'الموافقة على بيع أرض لمواطن',
            projectedAr: `إيراد فوري +${saleAmount} ذهب وضريبة أعمال 10% مستقبلاً`,
            projectedValue: saleAmount,
          })
        : logDecree(state.decrees, {
            month: state.totalMonths,
            kind: 'land_reject',
            labelAr: 'رفض طلب شراء أرض',
            projectedAr: 'الاحتفاظ بالأرض لخزينة التاج',
            projectedValue: null,
          });

      const toastMsg = res.approved
        ? `تم بيع الأرض بنجاح (+${res.ledgerItem?.amount ?? 0} ذهب)`
        : 'تم رفض طلب شراء الأرض';

      const updated: GameState = {
        ...state,
        cubes: res.cubes,
        citizens: res.citizens,
        gold: res.gold,
        citizenWealth: res.citizenWealth,
        landRequests: res.landRequests,
        policeRecords: res.policeRecords,
        ledger: nextLedger,
        decrees: nextDecrees,
        toasts: appendToasts(state.toasts, [
          createToast(toastMsg, res.approved ? 'success' : 'info'),
        ]),
        pendingAudioCue: makeCue(res.approved ? 'trade' : 'day'),
      };

      return evaluateObjectivesAndProgression(updated);
    }

    case 'TAKE_LOAN': {
      const res = executeTakeLoan(state, action);
      if (!res.success) {
        return {
          ...state,
          toasts: appendToasts(state.toasts, [
            createToast(res.errorAr ?? 'تعذر طلب التمويل', 'warning'),
          ]),
          pendingAudioCue: makeCue('error'),
        };
      }
      const newLoan = res.state.bankLoans[res.state.bankLoans.length - 1];
      const nextDecrees = newLoan
        ? logDecree(res.state.decrees, {
            month: state.totalMonths,
            kind: 'loan_taken',
            labelAr: `تمويل من البنك الشرعي (${newLoan.principal} ذهب)`,
            projectedAr: `سيولة +${newLoan.principal} ذهب، إجمالي السداد ${newLoan.repayable} ذهب على ${newLoan.termMonths} أشهر`,
            projectedValue: newLoan.principal,
          })
        : res.state.decrees;
      const updated = {
        ...res.state,
        decrees: nextDecrees,
        toasts: appendToasts(res.state.toasts, [
          createToast('تم استلام تمويل البنك الشرعي بنجاح', 'success'),
        ]),
        pendingAudioCue: makeCue('trade'),
      };
      return evaluateObjectivesAndProgression(updated);
    }

    case 'REPAY_LOAN_FULL': {
      const res = executeRepayLoanFull(state);
      if (!res.success) {
        return {
          ...state,
          toasts: appendToasts(state.toasts, [
            createToast(res.errorAr ?? 'تعذر سداد التمويل', 'warning'),
          ]),
          pendingAudioCue: makeCue('error'),
        };
      }
      const nextDecrees = logDecree(res.state.decrees, {
        month: state.totalMonths,
        kind: 'loan_repaid',
        labelAr: 'سداد مبكر كامل لتمويل البنك الشرعي',
        projectedAr: 'ثقة البنك +10 وتحرير الأراضي المرهونة',
        projectedValue: 10,
      });
      const updated = {
        ...res.state,
        decrees: nextDecrees,
        toasts: appendToasts(res.state.toasts, [
          createToast('تم السداد الكامل للتمويل وارتفعت ثقة البنك الشرعي', 'success'),
        ]),
        pendingAudioCue: makeCue('reward'),
      };
      return evaluateObjectivesAndProgression(updated);
    }

    case 'BUYBACK_CUBE': {
      const res = executeBuybackCube(state, action.cubeId);
      if (!res.success) {
        return {
          ...state,
          toasts: appendToasts(state.toasts, [
            createToast(res.errorAr ?? 'تعذر استرداد الأرض', 'warning'),
          ]),
          pendingAudioCue: makeCue('error'),
        };
      }
      const updated = {
        ...res.state,
        toasts: appendToasts(res.state.toasts, [
          createToast('تم استرداد الأرض بنجاح من بنك الشعب', 'success'),
        ]),
        pendingAudioCue: makeCue('trade'),
      };
      return evaluateObjectivesAndProgression(updated);
    }

    case 'SET_TAX_POLICY': {
      const nextPolicy = normalizeTaxPolicy(action.mode, action.percent);
      if (
        nextPolicy.mode === state.taxPolicy.mode &&
        nextPolicy.percent === state.taxPolicy.percent
      ) {
        return state;
      }

      const grossBase = getGrossPayrollBase({
        lastPayroll: state.lastPayroll,
        cubes: state.cubes,
        population: state.population,
        privateAds: state.privateAds,
      });
      const projectedImpact = projectTaxPolicyMonthlyImpact(
        nextPolicy,
        grossBase
      );
      const moodDelta = computeTaxMoodDelta(
        nextPolicy,
        state.citizenWealth,
        state.population
      );

      const labelAr =
        nextPolicy.mode === 'take'
          ? `ضريبة مرتبات ${nextPolicy.percent}%`
          : nextPolicy.mode === 'grant'
            ? `منحة ملكية على المرتبات ${nextPolicy.percent}%`
            : 'إلغاء ضريبة ومنحة المرتبات';

      const projectedAr =
        nextPolicy.mode === 'take'
          ? `وارد متوقع +${projectedImpact} ذهب/شهر، وأثر المزاج ${moodDelta}`
          : nextPolicy.mode === 'grant'
            ? `كلفة متوقعة ${projectedImpact} ذهب/شهر، وأثر المزاج +${moodDelta}`
            : 'أثر الخزنة 0 ذهب/شهر، وأثر المزاج 0';

      const nextDecrees = logDecree(state.decrees, {
        month: state.totalMonths,
        kind: 'tax_policy',
        labelAr,
        projectedAr,
        projectedValue: projectedImpact,
        taxMode: nextPolicy.mode,
      });

      const evalNeeds = computeNeedsAndSatisfaction(
        state.cubes,
        state.warehouse,
        state.population,
        state.hungerFlag,
        moodDelta
      );

      const updated: GameState = {
        ...state,
        taxPolicy: nextPolicy,
        decrees: nextDecrees,
        satisfaction: applyArrearsCap(evalNeeds.satisfaction, state.arrears),
        needs: evalNeeds.needs,
        toasts: appendToasts(state.toasts, [
          createToast(`تم اعتماد السياسة المالية: ${labelAr}`, 'info'),
        ]),
        pendingAudioCue: makeCue('day'),
      };

      return evaluateObjectivesAndProgression(updated);
    }

    case 'SET_FAX_STATUS': {
      const validStatuses: ReadonlySet<OfficeFaxStatus> = new Set([
        'unread',
        'read',
        'acted',
        'dismissed',
      ]);
      if (!validStatuses.has(action.status)) return state;
      let changed = false;
      const nextFaxes = state.officeFaxes.map((f) => {
        if (f.id !== action.faxId) return f;
        // Acted faxes never regress to unread
        if (f.status === 'acted' && action.status === 'unread') return f;
        if (f.status === action.status) return f;
        changed = true;
        return { ...f, status: action.status };
      });
      return changed ? { ...state, officeFaxes: nextFaxes } : state;
    }

    case 'MARK_ALL_FAXES_READ': {
      let changed = false;
      const nextFaxes = state.officeFaxes.map((f) => {
        if (f.status !== 'unread') return f;
        changed = true;
        return { ...f, status: 'read' as const };
      });
      return changed ? { ...state, officeFaxes: nextFaxes } : state;
    }

    case 'LOG_ADVISOR_ACTION': {
      const nextFaxes = action.faxId
        ? state.officeFaxes.map((f) =>
            f.id === action.faxId ? { ...f, status: 'acted' as const } : f
          )
        : state.officeFaxes;
      const nextDecrees = logDecree(state.decrees, {
        month: state.totalMonths,
        kind: 'advisor_action',
        labelAr: action.labelAr,
        projectedAr: action.projectedAr,
        projectedValue: null,
      });
      return {
        ...state,
        officeFaxes: nextFaxes,
        decrees: nextDecrees,
      };
    }

    case 'DISMISS_TOAST': {
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.id),
      };
    }

    case 'CLEAR_LEVEL2_NOTICE': {
      return { ...state, level2UnlockedNotice: false };
    }

    case 'CLEAR_LEVEL2_COMPLETED_NOTICE': {
      return { ...state, level2CompletedNotice: false };
    }

    case 'TOGGLE_MUTE': {
      return { ...state, muted: !state.muted };
    }

    case 'NEW_GAME': {
      clearSavedGame();
      return createFreshGameState(Date.now());
    }

    default:
      return state;
  }
}
