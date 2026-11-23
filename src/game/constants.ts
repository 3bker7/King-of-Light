import type {
  FoodResourceKey,
  PriceMap,
  ResourceKey,
  ThemeDefinition,
  ThemeId,
  TradedResourceKey,
  TradeVolumeMap,
  Warehouse,
} from './types';

// Grid and world geometry
export const GRID_SIZE = 12;
export const TOTAL_CUBES = GRID_SIZE * GRID_SIZE;
export const START_OWNED_MIN_ROW = 9;
export const START_OWNED_MIN_COL = 9;
export const STARTING_HOUSES_ROW = 10;
export const STARTING_HOUSES_COL = 10;

// Expansion
export const CUBE_PURCHASE_COST = 30;

// Time and persistence
export const TICK_MS = 1000;
export const TICKS_PER_DAY = 300; // 5 real minutes = 1 game day
export const SAVE_KEY = 'noor-alshaab-save-v1';
export const SAVE_THROTTLE_MS = 2000;
export const MAX_OFFLINE_SECONDS = 28800; // 8 hours cap
export const AWAY_MODAL_MIN_SECONDS = 60;
export const MAX_OFFLINE_POP_DELTA = 6;
export const READY_PULSE_WINDOW_SECONDS = 5;

// New game starting resources
export const STARTING_GOLD = 500;
export const STARTING_CROPS = 20;
export const STARTING_WATER = 10;
export const STARTING_POPULATION = 10;
export const STARTING_REPUTATION = 50;
export const STARTING_DAY = 1;

// Adjacency bonus (Sea)
export const SEA_ADJACENCY_BONUS_STEP = 0.25;
export const SEA_ADJACENCY_BONUS_MAX = 1.0;

// People, Needs, Satisfaction, Reputation
export const HOUSE_CAPACITY = 5;
export const FOOD_PER_PERSON_PER_DAY = 1;
export const PEOPLE_PER_WATER_PER_DAY = 2;

export const WEIGHT_FOOD = 0.45;
export const WEIGHT_WATER = 0.20;
export const WEIGHT_HOUSING = 0.20;
export const WEIGHT_ENTERTAINMENT = 0.15;

export const ENTERTAINMENT_SEA_BONUS = 40;
export const ENTERTAINMENT_SHOP_BONUS = 30;
export const ENTERTAINMENT_VARIETY_BONUS = 30;
export const ENTERTAINMENT_VARIETY_MIN_TYPES = 2;

export const HUNGER_SATISFACTION_CAP = 30;

export const GROWTH_SATISFACTION_MIN = 60;
export const SHRINK_SATISFACTION_BELOW = 35;
export const POPULATION_CHANGE_STEP = 2;
export const LEVEL_1_POPULATION_FLOOR = 5;
export const REPUTATION_DRIFT_FACTOR = 0.1;

// Bourse (Market)
export const BASE_BUY_PRICES: PriceMap = {
  fish: 6,
  crops: 5,
  meat: 9,
  wood: 4,
  water: 2,
  bread: 12,
  cotton: 8,
  clothes: 20,
  oil: 25,
  stone: 7,
};

export const ALL_RESOURCES: ResourceKey[] = [
  'fish',
  'crops',
  'meat',
  'wood',
  'water',
  'bread',
  'cotton',
  'clothes',
  'oil',
  'stone',
];

export const TRADED_RESOURCES: TradedResourceKey[] = [
  'fish',
  'crops',
  'meat',
  'wood',
  'water',
];

// Food strictly counts Fish + Crops + Meat + Bread (Water NEVER counts as food)
export const FOOD_RESOURCES: FoodResourceKey[] = [
  'fish',
  'crops',
  'meat',
  'bread',
];

// Shop surplus food conversion order
export const SHOP_FOOD_PRIORITY: TradedResourceKey[] = [
  'fish',
  'crops',
  'meat',
];

export const SELL_PRICE_RATIO = 0.7;
export const MIN_BOURSE_PRICE = 1;
export const MAX_BOURSE_PRICE_MULTIPLIER = 3;

export const LEVEL_1_PRICE_DRIFT_RANGE = 0.07;
export const LEVEL_2_PRICE_DRIFT_RANGE = 0.15;
export const BOURSE_VOLUME_THRESHOLD = 20;
export const BOURSE_VOLUME_MODIFIER = 0.1;

export const TRADE_BATCH_QUANTITIES = [1, 10] as const;

// Themes exact specification table
export const THEMES: Record<ThemeId, ThemeDefinition> = {
  sea: {
    id: 'sea',
    footprint: 'full',
    cost: 40,
    cycleSeconds: 60,
    outputResource: 'fish',
    outputAmount: 2,
    workers: 0,
    unlockLevel: 1,
  },
  well: {
    id: 'well',
    footprint: 'half',
    cost: 20,
    cycleSeconds: 45,
    outputResource: 'water',
    outputAmount: 3,
    workers: 0,
    unlockLevel: 1,
  },
  farm: {
    id: 'farm',
    footprint: 'full',
    cost: 30,
    cycleSeconds: 90,
    outputResource: 'crops',
    outputAmount: 3,
    inputResource: 'water',
    inputAmount: 1,
    workers: 2,
    unlockLevel: 1,
  },
  forest: {
    id: 'forest',
    footprint: 'full',
    cost: 20,
    cycleSeconds: 75,
    outputResource: 'wood',
    outputAmount: 2,
    workers: 1,
    unlockLevel: 2,
  },
  pasture: {
    id: 'pasture',
    footprint: 'full',
    cost: 45,
    cycleSeconds: 120,
    outputResource: 'meat',
    outputAmount: 2,
    inputResource: 'crops',
    inputAmount: 1,
    workers: 2,
    unlockLevel: 2,
  },
  house: {
    id: 'house',
    footprint: 'half',
    cost: 25,
    cycleSeconds: null,
    shelters: HOUSE_CAPACITY,
    workers: 0,
    unlockLevel: 1,
  },
  shop: {
    id: 'shop',
    footprint: 'half',
    cost: 60,
    cycleSeconds: 60,
    shopGoldPerCycle: 4,
    workers: 1,
    unlockLevel: 2,
  },
};

export const THEME_ORDER: ThemeId[] = [
  'sea',
  'well',
  'farm',
  'house',
  'forest',
  'pasture',
  'shop',
];

// Worker staffing priority order when population < worker need
export const WORKER_PRIORITY_ORDER: ThemeId[] = [
  'well',
  'farm',
  'sea',
  'pasture',
  'forest',
  'shop',
];

// Objectives & Rewards
export const LEVEL_1_FOOD_TARGET = 30;
export const LEVEL_1_SATISFACTION_TARGET = 60;

export const LEVEL_2_POPULATION_TARGET = 25;
export const LEVEL_2_CUBES_TARGET = 15;
export const LEVEL_2_GOLD_TARGET = 200;

export const OBJECTIVE_REWARDS = {
  build_sea: 20,
  build_farm: 20,
  hold_30_food: 30,
  reach_60_satisfaction: 50,
  reach_25_pop: 0,
  own_15_cubes: 0,
  hold_200_gold: 0,
} as const;

export function createEmptyWarehouse(): Warehouse {
  return {
    fish: 0,
    crops: 0,
    meat: 0,
    wood: 0,
    water: 0,
    bread: 0,
    cotton: 0,
    clothes: 0,
    oil: 0,
    stone: 0,
  };
}

export function createInitialWarehouse(): Warehouse {
  const warehouse = createEmptyWarehouse();
  warehouse.crops = STARTING_CROPS;
  warehouse.water = STARTING_WATER;
  return warehouse;
}

export function createEmptyTradeVolumes(): TradeVolumeMap {
  return {
    fish: 0,
    crops: 0,
    meat: 0,
    wood: 0,
    water: 0,
  };
}

export function createInitialPrices(): PriceMap {
  return { ...BASE_BUY_PRICES };
}
