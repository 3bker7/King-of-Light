export type CubeOwner = 'player' | 'neutral';

export type ThemeId =
  | 'sea'
  | 'well'
  | 'farm'
  | 'forest'
  | 'pasture'
  | 'house'
  | 'shop';

export type ThemeFootprint = 'full' | 'half';

export type ResourceKey =
  | 'fish'
  | 'crops'
  | 'meat'
  | 'wood'
  | 'water'
  | 'bread'
  | 'cotton'
  | 'clothes'
  | 'oil'
  | 'stone';

export type TradedResourceKey = 'fish' | 'crops' | 'meat' | 'wood' | 'water';

export type FoodResourceKey = 'fish' | 'crops' | 'meat' | 'bread';

export type SlotIndex = 0 | 1;

export type ShortageReason = 'no_water' | 'no_crops' | 'no_surplus_food' | null;

export interface Cube {
  id: number;
  row: number;
  col: number;
  owner: CubeOwner;
  themeId: ThemeId | null;
  secondThemeId: ThemeId | null;
  builtAt: number | null;
  secondBuiltAt: number | null;
  progress: number;
  secondProgress: number;
  shortage: ShortageReason;
  secondShortage: ShortageReason;
}

export interface ThemeDefinition {
  id: ThemeId;
  footprint: ThemeFootprint;
  cost: number;
  cycleSeconds: number | null;
  outputResource?: TradedResourceKey;
  outputAmount?: number;
  inputResource?: TradedResourceKey;
  inputAmount?: number;
  workers: number;
  shelters?: number;
  shopGoldPerCycle?: number;
  unlockLevel: 1 | 2;
}

export type Warehouse = Record<ResourceKey, number>;

export type PriceMap = Record<ResourceKey, number>;

export type TradeVolumeMap = Record<TradedResourceKey, number>;

export interface NeedsBreakdown {
  food: number;
  water: number;
  housing: number;
  entertainment: number;
}

export interface ObjectiveState {
  id: string;
  level: 1 | 2;
  completed: boolean;
  rewardGold: number;
}

export interface PriceMoveSummary {
  resource: TradedResourceKey;
  previousPrice: number;
  newPrice: number;
  percentChange: number;
}

export interface AwayReportData {
  elapsedSeconds: number;
  daysElapsed: number;
  goldEarnedByShops: number;
  resourcesProduced: Partial<Record<TradedResourceKey, number>>;
  populationDelta: number;
  biggestPriceMove: PriceMoveSummary | null;
}

export type ToastTone = 'info' | 'success' | 'warning';

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

export type AudioCue = 'build' | 'reward' | 'day' | 'levelUp' | 'trade' | 'error';

export interface GameState {
  cubes: Cube[];
  warehouse: Warehouse;
  gold: number;
  population: number;
  satisfaction: number;
  reputation: number;
  hungerFlag: boolean;
  needs: NeedsBreakdown;
  day: number;
  tickInDay: number;
  prices: PriceMap;
  previousPrices: PriceMap;
  dailyBought: TradeVolumeMap;
  dailySold: TradeVolumeMap;
  tickerMessage: string;
  level: 1 | 2;
  objectives: ObjectiveState[];
  level2ModalOpen: boolean;
  level2CompletedModalOpen: boolean;
  level2CompletedShown: boolean;
  muted: boolean;
  lastSavedAt: number;
  toasts: ToastItem[];
  pendingAudioCue: { id: number; cue: AudioCue } | null;
}

export interface PersistedSaveData {
  version: 1;
  cubes: Cube[];
  warehouse: Warehouse;
  gold: number;
  population: number;
  satisfaction: number;
  reputation: number;
  hungerFlag: boolean;
  day: number;
  tickInDay: number;
  prices: PriceMap;
  previousPrices: PriceMap;
  dailyBought: TradeVolumeMap;
  dailySold: TradeVolumeMap;
  tickerMessage: string;
  level: 1 | 2;
  objectives: ObjectiveState[];
  level2CompletedShown: boolean;
  muted: boolean;
  lastSavedAt: number;
}

export interface StaffingStatus {
  totalWorkersNeeded: number;
  totalWorkersEmployed: number;
  staffedSlots: Set<string>;
}
