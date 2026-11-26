export type CubeOwner = 'player' | 'neutral' | 'bank';

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
  // Prompt 5 Bank & Collateral fields
  collateralLoanId?: string | null;
  bankSeizedMonth?: number | null;
  bankAskPrice?: number | null;
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
  // Prompt 7 Arrival Camp marker (derived view over housing queue head)
  inCamp?: boolean;
  // Prompt 8 Visa 12-month cooldown marker (hydrate default null)
  lastVisaMonth?: number | null;
  // V5 Prompt 2 Prayer efficiency buff expiry (absolute totalGameMinutes; hydrate default 0)
  prayerBuffUntil?: number;
}

export type OfficeFaxStatus = 'unread' | 'read' | 'acted' | 'dismissed';

export interface OfficeFax {
  id: string;
  month: number;
  office: 'housing' | 'labor' | 'bank';
  textAr: string;
  actionThemeId?: ThemeId;
  status: OfficeFaxStatus;
}

export type AdvisorAction =
  | { type: 'arm_theme'; themeId: ThemeId }
  | { type: 'open_bourse' }
  | { type: 'open_bank' }
  | { type: 'focus_cube'; cubeId: number }
  | { type: 'none' };

export interface FaxAdvice {
  dataAr: string;
  recommendationAr: string;
  action: AdvisorAction;
  resolved: boolean;
}

export type BriefSeverity = 'critical' | 'high' | 'medium' | 'positive' | 'info';

export interface BriefLine {
  severity: BriefSeverity;
  textAr: string;
  action: AdvisorAction;
}

export interface AdvisorBriefing {
  month: number;
  lines: BriefLine[];
  topAction: AdvisorAction;
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
  taxWithheld: number;
  grantsPaid: number;
}

export type TaxPolicyMode = 'none' | 'grant' | 'take';

export interface TaxPolicy {
  mode: TaxPolicyMode;
  percent: number;
}

export type DecreeKind =
  | 'tax_policy'
  | 'land_sale'
  | 'land_reject'
  | 'loan_taken'
  | 'loan_repaid'
  | 'advisor_action';

export interface Decree {
  id: string;
  month: number;
  kind: DecreeKind;
  labelAr: string;
  projectedAr: string;
  projectedValue: number | null;
  actualValue: number | null;
  actualAr: string | null;
  taxMode?: TaxPolicyMode;
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

export interface GameClock {
  secondsOfDay: number; // 0..86399
  totalGameSeconds: number;
}

export type PrayerKey = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export interface PrayerLogEntry {
  day: number;
  key: PrayerKey;
  attendance: number;
}

export interface ActivePrayerSession {
  id: number;
  day: number;
  key: PrayerKey;
  nameAr: string;
  triggerAbsMinute: number;
  deadlineAbsMinute: number;
  attendees: Array<{ citizenId: number; mosqueCubeId: number }>;
  completedCitizenIds: number[];
  logged: boolean;
}

export interface PrayerBannerEvent {
  id: number;
  day: number;
  key: PrayerKey;
  nameAr: string;
  selectedCount: number;
  hasStaffedMosque: boolean;
}

export interface AwayReportData {
  elapsedSeconds: number;
  daysElapsed: number;
  wasCapped?: boolean;
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
  // Prompt 5 Bank offline report fields
  loanInstallmentsPaid?: number;
  loanDeferredAdded?: number;
  bankTradesCount?: number;
  // Prompt 7 Province offline events
  provinceEvents?: ProvinceEvent[];
  // Prompt 8 Online away-report world settlements
  worldSummary?: WorldAwaySummary;
}

export interface EmbassyPlotMarker {
  agreementId: string;
  cubeId: number;
  guestUid: string;
  guestNameAr?: string;
  guestColor?: string;
}

export interface VisaGrantRecord {
  id: string;
  month: number;
  citizenName: string;
  toUid: string;
  toKingdomNameAr?: string;
  direction: 'out' | 'in';
}

export interface WorldAwaySummary {
  feesPaid: number;
  arrearsAdded: number;
  settlementsPaid: number;
  settlementsCollected: number;
  visasDeparted: number;
  visasArrived: number;
  marketReturnsUnits: number;
  lines: string[];
}

export interface Province {
  id: string;
  centerCubeId: number;
  nameAr: string;
  cubeIds: number[];
  landCubeIds: number[];
  seaCubeIds: number[];
  houseCount: number;
  population: number;
  staffedWorkplaces: number;
  privatePlots: number;
  color: string;
}

export type ProvinceEventKind =
  | 'village_joined'
  | 'village_defected'
  | 'province_formed'
  | 'province_dissolved'
  | 'camp_full';

export interface ProvinceEvent {
  id: string;
  month: number;
  kind: ProvinceEventKind;
  centerCubeId: number;
  labelAr: string;
}

export interface ArrivalCamp {
  cubeId: number | null;
  residentIds: number[];
}

export interface PalaceOfPeople {
  gold: number;
  totalSinksCollected?: number;
}

export interface BankLoan {
  id: string;
  principal: number;
  profit: number;
  repayable: number;
  termMonths: number;
  startMonth: number;
  monthsElapsed: number;
  collateralCubeIds: number[];
  missedCount: number;
  deferredDue: number;
  paidSoFar: number;
  status: 'active' | 'repaid' | 'defaulted';
}

export interface PeoplesBank {
  gold: number;
  portfolio: Partial<Record<TradedResourceKey, number>>;
  totalTrades: number;
  lastTradeMonth: number | null;
  lastTradeAr: string | null;
}

export type ToastTone = 'info' | 'success' | 'warning';

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
  focusCubeId?: number;
}

export type AudioCue =
  | 'build'
  | 'reward'
  | 'day'
  | 'levelUp'
  | 'trade'
  | 'error'
  | 'prayer';

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
  clock: GameClock;
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
  // Prompt 5 Bank & Palace of the People fields
  palaceOfPeople: PalaceOfPeople;
  bankTrust: number;
  bankLoans: BankLoan[];
  peoplesBank: PeoplesBank;
  lastBankNetWorthWarnMonth?: number;
  // Prompt 6 Advisor, Tax Policy & Decree Log fields
  advisorBriefing: AdvisorBriefing | null;
  taxPolicy: TaxPolicy;
  decrees: Decree[];
  // Prompt 7 Provinces, Arrival Camp & Province Events
  provinces: Province[];
  camp: ArrivalCamp;
  pendingArrivals: number;
  provinceEvents: ProvinceEvent[];
  lastDefectedCubeId: number | null;
  lastDefectedSeq: number;
  // Prompt 8 Shared World optional local profile & world position (null/undefined in local mode)
  myWorldPos?: { wx: number; wy: number } | null;
  kingdomNameAr?: string;
  rulerName?: string;
  // Prompt 8 Part 3 state fields (hydrate defaults: embassyPlots [], borderOpen true)
  embassyPlots: EmbassyPlotMarker[];
  borderOpen: boolean;
  visaHistory?: VisaGrantRecord[];
  lastMarketClaimAt?: number;
  lastEmbassyPaymentAt?: number;
  lastImportedFoodUnits?: number;
  // V5 Prompt 2 Prayer state fields (hydrate defaults: [], null, {})
  prayerLog: PrayerLogEntry[];
  lastPrayerTriggerKey: string | null;
  prayerBonusPool: Record<number, number>;
  // Transient live-only prayer state (never persisted; never triggered offline)
  activePrayer: ActivePrayerSession | null;
  prayerBanner: PrayerBannerEvent | null;
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
  clock?: GameClock;
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
  // Prompt 5 optional persisted fields
  palaceOfPeople?: PalaceOfPeople;
  bankTrust?: number;
  bankLoans?: BankLoan[];
  peoplesBank?: PeoplesBank;
  lastBankNetWorthWarnMonth?: number;
  // Prompt 6 optional persisted fields
  advisorBriefing?: AdvisorBriefing | null;
  taxPolicy?: TaxPolicy;
  decrees?: Decree[];
  // Prompt 7 optional persisted fields (provinces themselves are NEVER persisted; always recomputed on load)
  camp?: ArrivalCamp;
  pendingArrivals?: number;
  provinceEvents?: ProvinceEvent[];
  // Prompt 8 optional persisted world spawn position & profile names
  myWorldPos?: { wx: number; wy: number } | null;
  kingdomNameAr?: string;
  rulerName?: string;
  embassyPlots?: EmbassyPlotMarker[];
  borderOpen?: boolean;
  visaHistory?: VisaGrantRecord[];
  lastMarketClaimAt?: number;
  lastEmbassyPaymentAt?: number;
  // V5 Prompt 2 optional persisted prayer fields
  prayerLog?: PrayerLogEntry[];
  lastPrayerTriggerKey?: string | null;
  prayerBonusPool?: Record<number, number>;
}

export interface StaffingStatus {
  totalWorkersNeeded: number;
  totalWorkersEmployed: number;
  staffedSlots: Set<string>;
}
