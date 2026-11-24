export type CubeOwner = 'player' | 'neutral';

export type ThemeCategory =
  | 'food'
  | 'mines'
  | 'industry'
  | 'trade'
  | 'welfare';

export type ThemeId =
  | 'palace'
  // Category A: Food & Farming
  | 'wheat_farm'
  | 'farm'
  | 'orchard'
  | 'pasture'
  | 'sea'
  | 'well'
  | 'bakery'
  | 'restaurant'
  | 'cafe'
  // Category B: Mines & Raw Wealth
  | 'forest'
  | 'quarry'
  | 'iron_mine'
  | 'copper_mine'
  | 'gold_mine'
  | 'gem_mine'
  | 'oil_well'
  // Category C: Building & Industry
  | 'house'
  | 'warehouse_bldg'
  | 'workshop'
  | 'jeweler'
  // Category D: Investment & Trade
  | 'shop'
  | 'grand_market'
  | 'trade_office'
  | 'hotel'
  // Category E: Welfare & Community
  | 'mosque'
  | 'theater'
  | 'garden'
  | 'clinic'
  | 'school';

export type ThemeFootprint = 'full' | 'half';

export type ResourceKey =
  | 'fish'
  | 'crops'
  | 'wheat'
  | 'fruit'
  | 'meat'
  | 'bread'
  | 'wood'
  | 'water'
  | 'stone'
  | 'iron'
  | 'copper'
  | 'goldOre'
  | 'gem'
  | 'tools'
  | 'jewelry'
  | 'oil'
  | 'cotton'
  | 'clothes';

export type TradedResourceKey =
  | 'fish'
  | 'crops'
  | 'wheat'
  | 'fruit'
  | 'meat'
  | 'bread'
  | 'wood'
  | 'water'
  | 'stone'
  | 'iron'
  | 'copper'
  | 'goldOre'
  | 'gem'
  | 'tools'
  | 'jewelry'
  | 'oil';

export type FoodResourceKey =
  | 'fish'
  | 'crops'
  | 'wheat'
  | 'fruit'
  | 'meat'
  | 'bread';

export type SlotIndex = 0 | 1;

export type ShortageReason =
  | 'no_water'
  | 'no_crops'
  | 'no_wheat'
  | 'no_bread_meat'
  | 'no_iron_wood'
  | 'no_gold_gem'
  | 'no_surplus_food'
  | null;

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
  // Phase 2 terrain & world features
  isRocky: boolean;
  isVillage: boolean;
  villageName: string | null;
  villageLoyaltyDays: number;
  // Prompt 4 Private Sector fields
  privateOwnerId?: number | null;
  privateIntendedTheme?: ThemeId | null;
  privateBuildRetries?: number;
}

export interface ThemeInputSpec {
  resource: TradedResourceKey;
  amount: number;
}

export interface ThemeDefinition {
  id: ThemeId;
  category: ThemeCategory | null;
  footprint: ThemeFootprint;
  cost: number;
  materialCosts?: Partial<Record<TradedResourceKey, number>>;
  cycleSeconds: number | null;
  outputResource?: TradedResourceKey;
  outputAmount?: number;
  inputs?: ThemeInputSpec[];
  goldPerCycle?: number;
  workers: number;
  shelters?: number;
  unlockLevel: 1 | 2;
  rockyOnly?: boolean;
  nonDemolishable?: boolean;
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

export type LedgerKind =
  | 'land'
  | 'build'
  | 'trade'
  | 'shop'
  | 'objective'
  | 'payroll'
  | 'materials'
  | 'gift';

export interface LedgerEntry {
  id: string;
  day: number;
  kind: LedgerKind;
  amount: number;
  labelAr: string;
}

export interface PayrollRecord {
  day: number;
  workers: number;
  due: number;
  paid: number;
}

export type CitizenAttrKey =
  | 'physical'
  | 'professional'
  | 'social'
  | 'health'
  | 'intelligence';

export type CitizenAttrs = Record<CitizenAttrKey, number>;

export interface Citizen {
  id: number;
  name: string;
  gender: 'm' | 'f';
  birthMonth: number;
  householdId: number;
  homeCubeId: number | null;
  spouseId: number | null;
  parentIds: [number, number] | null;
  jobCubeId: number | null;
  jobSlot?: SlotIndex | null;
  jobThemeId: ThemeId | null;
  wealth: number;
  attrs: CitizenAttrs;
  cvFiled: boolean;
  cvFiledMonth?: number | null;
  housingRequestMonth: number | null;
  marriedMonth?: number | null;
  // Prompt 4 Private Sector fields
  deniedLandMonth?: number | null;
  employerId?: number | null;
}

export interface OfficeFax {
  id: string;
  month: number;
  office: 'housing' | 'labor';
  textAr: string;
  actionThemeId?: ThemeId;
}

export type PoliceRecordKind =
  | 'birth'
  | 'marriage'
  | 'housing'
  | 'dissolution'
  | 'land_sale';

export interface PoliceRecord {
  id: string;
  month: number;
  kind: PoliceRecordKind;
  textAr: string;
  citizenIds: number[];
}

export interface LastMonthStats {
  foodRevenue: number;
  leisureRevenue: number;
  businessTax: number;
  importSink: number;
  leisureSink: number;
  unmetFood: number;
}

export interface LandRequest {
  id: string;
  citizenId: number;
  cubeId: number;
  price: number;
  month: number;
  businessThemeId: ThemeId;
}

export interface PrivateAd {
  id: string;
  ownerId: number;
  cubeId: number;
  themeId: ThemeId;
  wage: number;
  filledBy: number | null;
}

export interface AwayReportData {
  elapsedSeconds: number;
  daysElapsed: number;
  goldEarnedByShops: number;
  resourcesProduced: Partial<Record<TradedResourceKey, number>>;
  populationDelta: number;
  biggestPriceMove: PriceMoveSummary | null;
  payrollPaid: number;
  arrearsAdded: number;
  births: number;
  cvsFiled: number;
  marriages: number;
  housingGranted: number;
  faxesSent: number;
  citizenSpentTotal?: number;
  businessTaxTotal?: number;
}

export type ToastTone = 'info' | 'success' | 'warning';

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
  focusCubeId?: number;
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
  villagesJoined: number;
  lastJoinedVillageCubeId: number | null;
  lastJoinedVillageSeq: number;
  // Milestone alerts shown as clickable buttons (never auto-opening modals)
  level2UnlockedNotice: boolean;
  level2CompletedNotice: boolean;
  level2CompletedShown: boolean;
  muted: boolean;
  lastSavedAt: number;
  toasts: ToastItem[];
  pendingAudioCue: { id: number; cue: AudioCue } | null;
  // Prompt 2 Economic Spine fields
  citizenWealth: number;
  arrears: number;
  lastPayroll: PayrollRecord | null;
  dailyShopGold: number;
  inflationIndex: number;
  ledger: LedgerEntry[];
  lastInflationWarnMonth: number;
  // Prompt 3 Citizen Lifecycle & Palace Offices fields
  citizens: Citizen[];
  nextCitizenId: number;
  totalMonths: number;
  officeFaxes: OfficeFax[];
  policeRecords: PoliceRecord[];
  // Prompt 4 Private Sector fields
  lastMonthStats: LastMonthStats;
  monthlyBusinessTax: number;
  landRequests: LandRequest[];
  privateAds: PrivateAd[];
  lastSpentMonth: number;
}

export interface PersistedSaveData {
  version: 1 | 2;
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
  villagesJoined?: number;
  level2CompletedShown: boolean;
  muted: boolean;
  lastSavedAt: number;
  // Prompt 2 optional persisted fields (backward-compatible with v1/v2 saves)
  citizenWealth?: number;
  arrears?: number;
  lastPayroll?: PayrollRecord | null;
  dailyShopGold?: number;
  inflationIndex?: number;
  ledger?: LedgerEntry[];
  lastInflationWarnMonth?: number;
  // Prompt 3 optional persisted fields (backward-compatible with v1/v2 saves)
  citizens?: Citizen[];
  nextCitizenId?: number;
  totalMonths?: number;
  officeFaxes?: OfficeFax[];
  policeRecords?: PoliceRecord[];
  // Prompt 4 optional persisted fields (backward-compatible with v1/v2 saves)
  lastMonthStats?: LastMonthStats;
  monthlyBusinessTax?: number;
  landRequests?: LandRequest[];
  privateAds?: PrivateAd[];
  lastSpentMonth?: number;
}

export interface StaffingStatus {
  totalWorkersNeeded: number;
  totalWorkersEmployed: number;
  staffedSlots: Set<string>;
}
