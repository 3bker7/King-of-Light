import type {
  FoodResourceKey,
  PriceMap,
  ResourceKey,
  ThemeCategory,
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
export const STARTING_PALACE_ROW = 10;
export const STARTING_PALACE_COL = 10;
export const STARTING_HOUSES_ROW = 10;
export const STARTING_HOUSES_COL = 11;

// Expansion & Distance Pricing (WP3)
export const CUBE_PURCHASE_BASE_COST = 30;
export const CUBE_DISTANCE_PRICE_STEP = 0.15;
export const CUBE_PRICE_ROUND_STEP = 5;

// Independent Villages (WP3)
export const VILLAGE_JOIN_MIN_REPUTATION = 55;
export const VILLAGE_JOIN_REQUIRED_DAYS = 2;
export const VILLAGE_NAMES = [
  'الواحة',
  'النخيل',
  'الرمال',
  'العين',
  'الغدير',
  'الصفا',
];

// Time and persistence
export const TICK_MS = 1000;
export const TICKS_PER_DAY = 300; // 5 real minutes = 1 game day
export const SAVE_KEY = 'noor-alshaab-save-v1';
export const SAVE_VERSION = 2;
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

// Adjacency & Aura bonuses
export const SEA_ADJACENCY_BONUS_STEP = 0.25;
export const SEA_ADJACENCY_BONUS_MAX = 1.0;
export const WAREHOUSE_AURA_RANGE = 2;
export const WAREHOUSE_GOLD_BONUS = 0.25;
export const GRAND_MARKET_AURA_RANGE = 3;
export const GRAND_MARKET_SHOP_BONUS = 0.5;
export const GRAND_MARKET_SELL_BONUS = 0.1;
export const TRADE_OFFICE_BUY_DISCOUNT = 0.05;
export const SCHOOL_REPUTATION_MULTIPLIER = 1.5;

// People, Needs, Satisfaction, Reputation
export const HOUSE_CAPACITY = 5;
export const FOOD_PER_PERSON_PER_DAY = 1;
export const PEOPLE_PER_WATER_PER_DAY = 2;

export const WEIGHT_FOOD = 0.45;
export const WEIGHT_WATER = 0.20;
export const WEIGHT_HOUSING = 0.20;
export const WEIGHT_ENTERTAINMENT = 0.15;

// Exact Phase 2 Entertainment Formula (WP4)
export const ENTERTAINMENT_SEA_BONUS = 25;
export const ENTERTAINMENT_SHOP_OR_MARKET_BONUS = 15;
export const ENTERTAINMENT_THEATER_BONUS = 30;
export const ENTERTAINMENT_MOSQUE_BONUS = 30;
export const ENTERTAINMENT_VARIETY_BONUS = 15;
export const ENTERTAINMENT_CAFE_BONUS = 10;
export const ENTERTAINMENT_RESTAURANT_BONUS = 15;
export const ENTERTAINMENT_VARIETY_MIN_TYPES = 2;

export const HUNGER_SATISFACTION_CAP = 30;

export const GROWTH_SATISFACTION_MIN = 60;
export const SHRINK_SATISFACTION_BELOW = 35;
export const POPULATION_CHANGE_STEP = 2;
export const LEVEL_1_POPULATION_FLOOR = 5;
export const REPUTATION_DRIFT_FACTOR = 0.1;

// Bourse (Market) Base Buy Prices
export const BASE_BUY_PRICES: PriceMap = {
  fish: 6,
  crops: 5,
  wheat: 5,
  fruit: 8,
  meat: 9,
  bread: 12,
  wood: 4,
  water: 2,
  stone: 7,
  iron: 14,
  copper: 18,
  goldOre: 60,
  gem: 120,
  tools: 40,
  jewelry: 220,
  oil: 25,
  cotton: 8,
  clothes: 20,
};

export const ALL_RESOURCES: ResourceKey[] = [
  'fish',
  'crops',
  'wheat',
  'fruit',
  'meat',
  'bread',
  'wood',
  'water',
  'stone',
  'iron',
  'copper',
  'goldOre',
  'gem',
  'tools',
  'jewelry',
  'oil',
  'cotton',
  'clothes',
];

export const TRADED_RESOURCES: TradedResourceKey[] = [
  'fish',
  'crops',
  'wheat',
  'fruit',
  'meat',
  'bread',
  'wood',
  'water',
  'stone',
  'iron',
  'copper',
  'goldOre',
  'gem',
  'tools',
  'jewelry',
  'oil',
];

// Food strictly counts Fish + Crops + Wheat + Fruit + Meat + Bread (Water NEVER counts as food)
export const FOOD_RESOURCES: FoodResourceKey[] = [
  'fish',
  'crops',
  'wheat',
  'fruit',
  'meat',
  'bread',
];

// Shop surplus food conversion priority order
export const SHOP_FOOD_PRIORITY: TradedResourceKey[] = [
  'fish',
  'crops',
  'wheat',
  'fruit',
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

export const CATEGORY_ORDER: ThemeCategory[] = [
  'food',
  'mines',
  'industry',
  'trade',
  'welfare',
];

// Complete Phase 2 Building Catalog
export const THEMES: Record<ThemeId, ThemeDefinition> = {
  palace: {
    id: 'palace',
    category: null,
    footprint: 'full',
    cost: 0,
    cycleSeconds: null,
    workers: 0,
    unlockLevel: 1,
    nonDemolishable: true,
  },

  // CATEGORY A — Food & Farming
  wheat_farm: {
    id: 'wheat_farm',
    category: 'food',
    footprint: 'full',
    cost: 30,
    cycleSeconds: 90,
    outputResource: 'wheat',
    outputAmount: 3,
    inputs: [{ resource: 'water', amount: 1 }],
    workers: 2,
    unlockLevel: 1,
  },
  farm: {
    id: 'farm',
    category: 'food',
    footprint: 'full',
    cost: 30,
    cycleSeconds: 90,
    outputResource: 'crops',
    outputAmount: 3,
    inputs: [{ resource: 'water', amount: 1 }],
    workers: 2,
    unlockLevel: 1,
  },
  orchard: {
    id: 'orchard',
    category: 'food',
    footprint: 'full',
    cost: 55,
    cycleSeconds: 150,
    outputResource: 'fruit',
    outputAmount: 3,
    workers: 2,
    unlockLevel: 2,
  },
  pasture: {
    id: 'pasture',
    category: 'food',
    footprint: 'full',
    cost: 45,
    cycleSeconds: 120,
    outputResource: 'meat',
    outputAmount: 2,
    inputs: [{ resource: 'crops', amount: 1 }],
    workers: 2,
    unlockLevel: 2,
  },
  sea: {
    id: 'sea',
    category: 'food',
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
    category: 'food',
    footprint: 'half',
    cost: 20,
    cycleSeconds: 45,
    outputResource: 'water',
    outputAmount: 3,
    workers: 0,
    unlockLevel: 1,
  },
  bakery: {
    id: 'bakery',
    category: 'food',
    footprint: 'half',
    cost: 70,
    cycleSeconds: 60,
    outputResource: 'bread',
    outputAmount: 2,
    inputs: [{ resource: 'wheat', amount: 2 }],
    workers: 1,
    unlockLevel: 2,
  },
  restaurant: {
    id: 'restaurant',
    category: 'food',
    footprint: 'half',
    cost: 120,
    cycleSeconds: 120,
    inputs: [
      { resource: 'bread', amount: 1 },
      { resource: 'meat', amount: 1 },
    ],
    goldPerCycle: 14,
    workers: 2,
    unlockLevel: 2,
  },
  cafe: {
    id: 'cafe',
    category: 'food',
    footprint: 'half',
    cost: 90,
    cycleSeconds: 120,
    inputs: [{ resource: 'water', amount: 1 }],
    goldPerCycle: 6,
    workers: 1,
    unlockLevel: 2,
  },

  // CATEGORY B — Mines & Raw Wealth
  forest: {
    id: 'forest',
    category: 'mines',
    footprint: 'full',
    cost: 20,
    cycleSeconds: 75,
    outputResource: 'wood',
    outputAmount: 2,
    workers: 1,
    unlockLevel: 2,
  },
  quarry: {
    id: 'quarry',
    category: 'mines',
    footprint: 'full',
    cost: 50,
    cycleSeconds: 100,
    outputResource: 'stone',
    outputAmount: 2,
    workers: 2,
    unlockLevel: 2,
  },
  iron_mine: {
    id: 'iron_mine',
    category: 'mines',
    footprint: 'full',
    cost: 110,
    cycleSeconds: 140,
    outputResource: 'iron',
    outputAmount: 2,
    workers: 3,
    unlockLevel: 2,
    rockyOnly: true,
  },
  copper_mine: {
    id: 'copper_mine',
    category: 'mines',
    footprint: 'full',
    cost: 130,
    cycleSeconds: 150,
    outputResource: 'copper',
    outputAmount: 2,
    workers: 3,
    unlockLevel: 2,
    rockyOnly: true,
  },
  gold_mine: {
    id: 'gold_mine',
    category: 'mines',
    footprint: 'full',
    cost: 220,
    cycleSeconds: 200,
    outputResource: 'goldOre',
    outputAmount: 1,
    workers: 3,
    unlockLevel: 2,
    rockyOnly: true,
  },
  gem_mine: {
    id: 'gem_mine',
    category: 'mines',
    footprint: 'full',
    cost: 300,
    cycleSeconds: 260,
    outputResource: 'gem',
    outputAmount: 1,
    workers: 2,
    unlockLevel: 2,
    rockyOnly: true,
  },
  oil_well: {
    id: 'oil_well',
    category: 'mines',
    footprint: 'full',
    cost: 180,
    cycleSeconds: 180,
    outputResource: 'oil',
    outputAmount: 2,
    workers: 2,
    unlockLevel: 2,
  },

  // CATEGORY C — Building & Industry
  house: {
    id: 'house',
    category: 'industry',
    footprint: 'half',
    cost: 25,
    cycleSeconds: null,
    shelters: HOUSE_CAPACITY,
    workers: 0,
    unlockLevel: 1,
  },
  warehouse_bldg: {
    id: 'warehouse_bldg',
    category: 'industry',
    footprint: 'full',
    cost: 80,
    cycleSeconds: null,
    workers: 1,
    unlockLevel: 2,
  },
  workshop: {
    id: 'workshop',
    category: 'industry',
    footprint: 'full',
    cost: 160,
    materialCosts: { wood: 4, stone: 2 },
    cycleSeconds: 150,
    outputResource: 'tools',
    outputAmount: 2,
    inputs: [
      { resource: 'iron', amount: 1 },
      { resource: 'wood', amount: 1 },
    ],
    workers: 3,
    unlockLevel: 2,
  },
  jeweler: {
    id: 'jeweler',
    category: 'industry',
    footprint: 'half',
    cost: 200,
    cycleSeconds: 240,
    outputResource: 'jewelry',
    outputAmount: 1,
    inputs: [
      { resource: 'goldOre', amount: 1 },
      { resource: 'gem', amount: 1 },
    ],
    workers: 1,
    unlockLevel: 2,
  },

  // CATEGORY D — Investment & Trade
  shop: {
    id: 'shop',
    category: 'trade',
    footprint: 'half',
    cost: 60,
    cycleSeconds: 60,
    goldPerCycle: 4,
    workers: 1,
    unlockLevel: 2,
  },
  grand_market: {
    id: 'grand_market',
    category: 'trade',
    footprint: 'full',
    cost: 260,
    materialCosts: { wood: 6, stone: 4 },
    cycleSeconds: null,
    workers: 3,
    unlockLevel: 2,
  },
  trade_office: {
    id: 'trade_office',
    category: 'trade',
    footprint: 'half',
    cost: 150,
    cycleSeconds: null,
    workers: 1,
    unlockLevel: 2,
  },

  // CATEGORY E — Welfare & Community
  mosque: {
    id: 'mosque',
    category: 'welfare',
    footprint: 'full',
    cost: 250,
    materialCosts: { stone: 6, wood: 2 },
    cycleSeconds: null,
    workers: 0,
    unlockLevel: 2,
  },
  theater: {
    id: 'theater',
    category: 'welfare',
    footprint: 'full',
    cost: 200,
    materialCosts: { wood: 4 },
    cycleSeconds: null,
    workers: 2,
    unlockLevel: 2,
  },
  garden: {
    id: 'garden',
    category: 'welfare',
    footprint: 'half',
    cost: 60,
    cycleSeconds: null,
    workers: 0,
    unlockLevel: 2,
  },
  clinic: {
    id: 'clinic',
    category: 'welfare',
    footprint: 'half',
    cost: 140,
    cycleSeconds: null,
    workers: 1,
    unlockLevel: 2,
  },
  school: {
    id: 'school',
    category: 'welfare',
    footprint: 'full',
    cost: 180,
    cycleSeconds: null,
    workers: 1,
    unlockLevel: 2,
  },
};

export const CATEGORY_THEMES: Record<ThemeCategory, ThemeId[]> = {
  food: [
    'wheat_farm',
    'farm',
    'orchard',
    'pasture',
    'sea',
    'well',
    'bakery',
    'restaurant',
    'cafe',
  ],
  mines: [
    'forest',
    'quarry',
    'iron_mine',
    'copper_mine',
    'gold_mine',
    'gem_mine',
    'oil_well',
  ],
  industry: ['house', 'warehouse_bldg', 'workshop', 'jeweler'],
  trade: ['shop', 'grand_market', 'trade_office'],
  welfare: ['mosque', 'theater', 'garden', 'clinic', 'school'],
};

// Material producer map for WP6 smart navigation
export const MATERIAL_PRODUCER_THEME: Partial<Record<TradedResourceKey, ThemeId>> = {
  wood: 'forest',
  stone: 'quarry',
  iron: 'iron_mine',
  copper: 'copper_mine',
  goldOre: 'gold_mine',
  gem: 'gem_mine',
  wheat: 'wheat_farm',
  crops: 'farm',
  water: 'well',
  bread: 'bakery',
  meat: 'pasture',
};

// Deterministic worker staffing priority order
export const WORKER_PRIORITY_ORDER: ThemeId[] = [
  'well',
  'wheat_farm',
  'farm',
  'sea',
  'orchard',
  'pasture',
  'bakery',
  'forest',
  'quarry',
  'clinic',
  'school',
  'iron_mine',
  'copper_mine',
  'gold_mine',
  'gem_mine',
  'oil_well',
  'warehouse_bldg',
  'workshop',
  'jeweler',
  'shop',
  'restaurant',
  'cafe',
  'grand_market',
  'trade_office',
  'theater',
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

// Deterministic seeded rocky cells (~14) and independent villages (~6) on the 12x12 world
// Row 9..11, Col 9..11 is the starting owned 3x3; (10,10) is Palace, (10,11) is starting Houses.
export const SEEDED_ROCKY_COORDS: ReadonlyArray<[number, number]> = [
  [9, 9], // 1 rocky spot inside starting territory so players can discover rocky ground early
  [8, 10],
  [10, 8],
  [7, 11],
  [11, 7],
  [6, 8],
  [8, 6],
  [5, 10],
  [4, 7],
  [7, 4],
  [3, 9],
  [5, 3],
  [2, 5],
  [1, 8],
];

export const SEEDED_VILLAGE_COORDS: ReadonlyArray<[number, number]> = [
  [8, 9], // Close northern border village
  [9, 8], // Close western border village
  [6, 10],
  [10, 6],
  [5, 5],
  [3, 7],
];

export function createEmptyWarehouse(): Warehouse {
  return {
    fish: 0,
    crops: 0,
    wheat: 0,
    fruit: 0,
    meat: 0,
    bread: 0,
    wood: 0,
    water: 0,
    stone: 0,
    iron: 0,
    copper: 0,
    goldOre: 0,
    gem: 0,
    tools: 0,
    jewelry: 0,
    oil: 0,
    cotton: 0,
    clothes: 0,
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
    wheat: 0,
    fruit: 0,
    meat: 0,
    bread: 0,
    wood: 0,
    water: 0,
    stone: 0,
    iron: 0,
    copper: 0,
    goldOre: 0,
    gem: 0,
    tools: 0,
    jewelry: 0,
    oil: 0,
  };
}

export function createInitialPrices(): PriceMap {
  return { ...BASE_BUY_PRICES };
}
