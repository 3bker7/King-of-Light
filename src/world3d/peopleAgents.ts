import * as THREE from 'three';
import type { CitizenInfo, CitizenRoleId } from '../components/CitizenCard';
import {
  CAMP_CAPACITY,
  CAMP_CITIZEN_CARD_TEXT_AR,
  computeCampToHouseWalk,
} from '../game/arrivalCamp';
import { ageYears } from '../game/citizens';
import { CLOCK_CONSTANTS } from '../game/clock';
import { THEMES } from '../game/constants';
import { FEMALE_NAMES, MALE_NAMES } from '../game/names';
import { generateTraits } from '../game/personality';
import { findPalaceCube, makeSlotKey } from '../game/production';
import {
  getCitizenShift,
  getSchedulePhase,
  type SchedulePhase,
  type ScheduleStateView,
} from '../game/schedules';
import type {
  ActivePrayerSession,
  ArrivalCamp,
  Citizen,
  Cube,
  SlotIndex,
  ThemeId,
} from '../game/types';
import {
  type AnchorPoint,
  type BuildingAnchors,
  getBuildingAnchors,
  isPointInsideAnyBuildingFootprint,
  isPointOverWater,
  WALKABLE_FIELD_THEMES,
} from './anchors';
import {
  buildStreetGrid,
  computeStreetPath,
  isCellWalkable,
  type StreetGrid,
} from './streetPathing';
import {
  cellToWorldCenter,
  getTerrainHeightAt,
  WATER_SURFACE_Y,
  worldToCell,
} from './worldMath';

export type { CitizenInfo, CitizenRoleId };

const MAX_VISIBLE_AGENTS = 36;
const ADULT_MESH_SCALE = 1.6;
const CHILD_RELATIVE_SCALE = 0.6;
const ENTER_DOOR_DURATION = 0.2; // 200ms step-forward shrink into front door

type RoutineState =
  | 'AT_HOME'
  | 'ENTERING_HOME'
  | 'TO_WORK'
  | 'WORKING'
  | 'TO_BREAK'
  | 'ON_BREAK'
  | 'TO_HOME'
  | 'PLAYING'
  | 'PATROL'
  | 'WAITING'
  | 'TO_PRAYER'
  | 'ENTERING_MOSQUE'
  | 'PRAYING'
  | 'RETURNING_FROM_PRAYER';

type BreakThemeId =
  | 'mosque'
  | 'restaurant'
  | 'cafe'
  | 'garden'
  | 'grand_market'
  | 'shop'
  | 'theater'
  | 'palace';

export interface HomeAnchorSpot {
  cubeId: number;
  doorstep: AnchorPoint;
  faceTarget: AnchorPoint;
  approachOffset: { dRow: number; dCol: number };
}

export interface WorkAnchorSpot {
  cubeId: number;
  themeId: ThemeId;
  doorstep: AnchorPoint;
  workSpots: AnchorPoint[];
  faceTarget: AnchorPoint;
  approachOffset: { dRow: number; dCol: number };
}

export interface BreakAnchorSpot {
  cubeId: number;
  themeId: BreakThemeId;
  doorstep: AnchorPoint;
  faceTarget: AnchorPoint;
  approachOffset: { dRow: number; dCol: number };
}

interface LivingAgent {
  id: number;
  citizenId: number | null;
  name: string;
  isFemale: boolean;
  role: CitizenRoleId;
  group: THREE.Group;
  bodyPivot: THREE.Group;
  castingPivot: THREE.Group | null;
  x: number;
  z: number;
  waypoints: AnchorPoint[];
  waypointIdx: number;
  pathReachable: boolean;
  speed: number;
  state: RoutineState;
  lastSchedulePhase: SchedulePhase;
  stateTimer: number;
  enterDoorTimer: number;
  enterStartX: number;
  enterStartZ: number;
  walkPhase: number;
  workPhase: number;
  workSpotIdx: number;
  workSpotSwitchTimer: number;
  homeSpot: HomeAnchorSpot;
  workSpot: WorkAnchorSpot | null;
  activeBreakSpot: BreakAnchorSpot | null;
  targetThemeId: ThemeId | null;
  activeFaceTarget: AnchorPoint | null;
  playKind: 'house' | 'school' | 'garden';
  patrolStep: number;
  patrolAtPalace: boolean;
  // V5 Prompt 2 Element 2: Prayer mosque flow state
  prayerSessionId: number | null;
  prayerMosqueSpot: BreakAnchorSpot | null;
  prayerTimer: number;
  prayerReturnTarget: 'work' | 'break' | 'home' | 'school' | null;
}

const CAMP_AGENT_ID_OFFSET = 100000;

interface CampAgent {
  agentId: number;
  citizenId: number;
  name: string;
  role: CitizenRoleId;
  group: THREE.Group;
  bodyPivot: THREE.Group;
  x: number;
  z: number;
  mode: 'CAMPING' | 'WALKING_TO_HOUSE' | 'ENTERING_NEW_HOUSE';
  campCubeId: number;
  houseCubeId: number | null;
  waypoints: AnchorPoint[];
  waypointIdx: number;
  faceTarget: AnchorPoint;
  walkPhase: number;
  enterDoorTimer: number;
  enterStartX: number;
  enterStartZ: number;
  speed: number;
}

const ROLE_LABELS_AR: Record<CitizenRoleId, string> = {
  farmer: 'مزارع',
  fisher: 'صياد',
  miner: 'عامل منجم',
  woodcutter: 'حطّاب',
  baker: 'خبّاز',
  shopkeeper: 'تاجر',
  manager: 'إداري',
  man: 'مواطن',
  woman: 'مواطنة',
  child: 'طفل',
  elder: 'شيخ كبير',
  police: 'حارس أمن داخلي',
};

// Element 4.1 & 4.2: Complete per-theme truthful text tables for ALL 29 ThemeIds (zero generic fallback)
export const WAITING_NO_PATH_TEXT = 'ينتظر — لا يوجد طريق سالك الآن';
export const AT_HOME_TEXT = 'في بيته يستريح';
export const SLEEPING_AT_HOME_TEXT = 'نائم في بيته';
export const TO_PRAYER_TEXT = 'في طريقه إلى المسجد للصلاة';
export const PRAYING_IN_MOSQUE_TEXT = 'يصلّي في المسجد';
export const RETURNING_FROM_PRAYER_TEXT = 'عائد من الصلاة';

export const THEME_GOING_TEXT: Record<ThemeId, string> = {
  palace: 'في طريقه إلى ساحة قصر الحاكم',
  wheat_farm: 'في طريقه إلى مزرعة القمح',
  farm: 'في طريقه إلى مزرعته',
  orchard: 'في طريقه إلى بستان الفواكه',
  pasture: 'في طريقه إلى المرعى',
  sea: 'في طريقه إلى شاطئ البحر',
  well: 'في طريقه إلى بئر الماء',
  bakery: 'في طريقه إلى المخبز',
  restaurant: 'في طريقه إلى المطعم',
  cafe: 'في طريقه إلى المقهى',
  forest: 'في طريقه إلى غابة الأخشاب',
  quarry: 'في طريقه إلى محجر الحجر',
  iron_mine: 'في طريقه إلى منجم الحديد',
  copper_mine: 'في طريقه إلى منجم النحاس',
  gold_mine: 'في طريقه إلى منجم الذهب',
  gem_mine: 'في طريقه إلى منجم الأحجار الكريمة',
  oil_well: 'في طريقه إلى بئر النفط',
  house: 'في طريقه إلى بيته',
  warehouse_bldg: 'في طريقه إلى المخزن',
  workshop: 'في طريقه إلى الورشة',
  jeweler: 'في طريقه إلى محل الصياغة',
  shop: 'في طريقه إلى المحل التجاري',
  grand_market: 'في طريقه إلى السوق الكبير',
  trade_office: 'في طريقه إلى مكتب التجارة',
  hotel: 'رايح يشتغل في الفندق',
  mosque: 'في طريقه إلى المسجد',
  theater: 'في طريقه إلى المسرح',
  garden: 'في طريقه إلى الحديقة',
  clinic: 'في طريقه إلى العيادة',
  school: 'في طريقه إلى المدرسة',
};

export const THEME_ARRIVED_TEXT: Record<ThemeId, string> = {
  palace: 'في ساحة قصر الحاكم',
  wheat_farm: 'يحصد سنابل القمح في الحقل',
  farm: 'يحرث أرض مزرعته',
  orchard: 'يقطف الثمار في بستان الفواكه',
  pasture: 'يرعى المواشي داخل المرعى',
  sea: 'يصيد على شاطئ البحر',
  well: 'يستقي الماء من بئر الماء',
  bakery: 'يخبز الخبز عند باب المخبز',
  restaurant: 'يجهّز الطعام عند مدخل المطعم',
  cafe: 'يعدّ القهوة عند مدخل المقهى',
  forest: 'يجمع الأخشاب عند طرف الغابة',
  quarry: 'يقطع الحجارة عند مدخل المحجر',
  iron_mine: 'يستخرج الخام عند مدخل منجم الحديد',
  copper_mine: 'يستخرج الخام عند مدخل منجم النحاس',
  gold_mine: 'يستخرج التبر عند مدخل منجم الذهب',
  gem_mine: 'يفرز الجواهر عند مدخل منجم الأحجار الكريمة',
  oil_well: 'يراقب الضخ عند مدخل بئر النفط',
  house: AT_HOME_TEXT,
  warehouse_bldg: 'ينظّم البضائع عند باب المخزن',
  workshop: 'يصنع الأدوات عند مدخل الورشة',
  jeweler: 'يعرض الحلي عند باب محل الصياغة',
  shop: 'يبيع البضائع عند واجهة المحل التجاري',
  grand_market: 'يدير التجارة عند بوابة السوق الكبير',
  trade_office: 'يتابع الصفقات عند مدخل مكتب التجارة',
  hotel: 'يستقبل ضيوف الفندق',
  mosque: 'يصلّي ويطمئن عند ساحة المسجد',
  theater: 'ينظّم العرض عند مدخل المسرح',
  garden: 'يستريح بين أشجار الحديقة',
  clinic: 'يساعد المرضى عند باب العيادة',
  school: 'يعلّم التلاميذ عند مدخل المدرسة',
};

// V5 Prompt 5 Element 5: Deterministic truthful Arabic speech variety (3 variants per state)
export const WORKING_FALLBACK_VARIANTS: readonly [string, string, string] = [
  'منهمك في عمله',
  'يؤدي عمله الآن',
  'يعمل بنشاط في موقعه',
];

export const GOING_HOME_VARIANTS: readonly [string, string, string] = [
  THEME_GOING_TEXT.house,
  'عائد إلى بيته الآن',
  'متجه إلى منزله للراحة',
];

/**
 * Deterministic 32-bit hash selector for daily speech phrasing:
 * stable for the same (citizenId, gameDay) all day; varies across days and citizens.
 */
export function pickSpeechVariantIndex(
  citizenId: number,
  gameDay: number,
  count = 3
): number {
  const safeCount = Math.max(1, Math.trunc(count));
  const safeId = Number.isFinite(citizenId) ? Math.trunc(citizenId) : 0;
  const safeDay = Number.isFinite(gameDay) ? Math.trunc(gameDay) : 1;
  let h = (Math.imul(safeId, 37) + Math.imul(safeDay, 17)) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) % safeCount;
}

/**
 * Returns the 3 truthful Arabic variants for walking to a specific workplace theme.
 */
export function getGoingToWorkVariants(
  workTheme: ThemeId
): readonly [string, string, string] {
  const base = THEME_GOING_TEXT[workTheme];
  const place =
    workTheme === 'hotel'
      ? 'الفندق'
      : base.replace(/^في طريقه إلى\s+/, '');
  return [
    base,
    `متجه إلى ${place} لبدء عمله`,
    `يغادر نحو ${place} للعمل`,
  ];
}

/**
 * Pure truthful speech formatter for TO_WORK, WORKING (fallback only when no per-theme line exists), and TO_HOME.
 */
export function formatAgentSpeechVariant(
  kind: 'to_work' | 'working' | 'to_home',
  citizenId: number,
  gameDay: number,
  workTheme?: ThemeId | null
): string {
  const idx = pickSpeechVariantIndex(citizenId, gameDay, 3);
  if (kind === 'to_home') {
    return GOING_HOME_VARIANTS[idx];
  }
  if (kind === 'to_work') {
    const theme: ThemeId = workTheme ?? 'palace';
    return getGoingToWorkVariants(theme)[idx];
  }
  // WORKING: per-theme THEME_ARRIVED_TEXT remains authoritative whenever present
  if (workTheme && THEME_ARRIVED_TEXT[workTheme]) {
    return THEME_ARRIVED_TEXT[workTheme];
  }
  return WORKING_FALLBACK_VARIANTS[idx];
}

const BREAK_ARRIVED_TEXT: Record<BreakThemeId, string> = {
  mosque: 'يصلّي ويطمئن عند ساحة المسجد',
  restaurant: 'يتناول وجبة عند مدخل المطعم',
  cafe: 'يشرب القهوة عند مدخل المقهى',
  garden: 'يستريح بين أشجار الحديقة',
  grand_market: 'يتسوّق عند بوابة السوق الكبير',
  shop: 'يتسوّق عند واجهة المحل التجاري',
  theater: 'يحضر عرضاً عند مدخل المسرح',
  palace: 'في ساحة قصر الحاكم',
};

export function themeToWorkerRole(themeId: ThemeId): CitizenRoleId | null {
  switch (themeId) {
    case 'farm':
    case 'wheat_farm':
    case 'orchard':
    case 'pasture':
      return 'farmer';
    case 'sea':
      return 'fisher';
    case 'quarry':
    case 'iron_mine':
    case 'copper_mine':
    case 'gold_mine':
    case 'gem_mine':
    case 'oil_well':
      return 'miner';
    case 'forest':
      return 'woodcutter';
    case 'bakery':
    case 'restaurant':
    case 'cafe':
      return 'baker';
    case 'shop':
    case 'grand_market':
    case 'jeweler':
    case 'workshop':
      return 'shopkeeper';
    case 'trade_office':
    case 'hotel':
    case 'warehouse_bldg':
    case 'clinic':
    case 'school':
    case 'theater':
      return 'manager';
    default:
      return null;
  }
}

function getBaseSpeedForRole(role: CitizenRoleId): number {
  switch (role) {
    case 'elder':
      return 1.1;
    case 'manager':
      return 2.3;
    case 'child':
      return 2.6;
    default:
      return 2.0;
  }
}

function getMoodFromSatisfaction(satisfaction: number): {
  moodAr: string;
  moodTone: 'good' | 'neutral' | 'low';
} {
  if (satisfaction >= 75) {
    return { moodAr: 'سعيد جداً ومطمئن', moodTone: 'good' };
  }
  if (satisfaction >= 55) {
    return { moodAr: 'مرتاح وسعيد', moodTone: 'good' };
  }
  if (satisfaction >= 35) {
    return { moodAr: 'حاله متوسط', moodTone: 'neutral' };
  }
  return { moodAr: 'قلق وغير راضٍ', moodTone: 'low' };
}

function deterministicUnit(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export class PeopleAgentsManager {
  public readonly group = new THREE.Group();

  private readonly agents: LivingAgent[] = [];
  private readonly sharedGeos: THREE.BufferGeometry[] = [];
  private readonly sharedMats: THREE.Material[] = [];

  // Shared geometries (Element 5: x1.25 wider robes/dresses, x1.6 adult scale, larger shadow/ring/hit)
  private readonly robeGeo: THREE.CylinderGeometry;
  private readonly dressConeGeo: THREE.CylinderGeometry;
  private readonly headGeo: THREE.SphereGeometry;
  private readonly turbanGeo: THREE.CylinderGeometry;
  private readonly strawHatBrimGeo: THREE.CylinderGeometry;
  private readonly strawHatTopGeo: THREE.CylinderGeometry;
  private readonly helmetGeo: THREE.SphereGeometry;
  private readonly apronGeo: THREE.BoxGeometry;
  private readonly packGeo: THREE.BoxGeometry;
  private readonly headscarfGeo: THREE.SphereGeometry;
  private readonly caneGeo: THREE.CylinderGeometry;
  private readonly fishingRodGeo: THREE.CylinderGeometry;
  private readonly policeCapGeo: THREE.CylinderGeometry;
  private readonly capVisorGeo: THREE.BoxGeometry;
  private readonly basketGeo: THREE.CylinderGeometry;
  private readonly collarGeo: THREE.CylinderGeometry;
  private readonly shadowGeo: THREE.PlaneGeometry;
  private readonly hitCylinderGeo: THREE.CylinderGeometry;
  private readonly selectRingGeo: THREE.RingGeometry;

  // Shared materials
  private readonly skinMat: THREE.MeshStandardMaterial;
  private readonly farmerMat: THREE.MeshStandardMaterial;
  private readonly strawMat: THREE.MeshStandardMaterial;
  private readonly fisherMat: THREE.MeshStandardMaterial;
  private readonly minerMat: THREE.MeshStandardMaterial;
  private readonly helmetMat: THREE.MeshStandardMaterial;
  private readonly woodcutterMat: THREE.MeshStandardMaterial;
  private readonly leatherMat: THREE.MeshStandardMaterial;
  private readonly bakerMat: THREE.MeshStandardMaterial;
  private readonly apronWhiteMat: THREE.MeshStandardMaterial;
  private readonly shopkeeperMat: THREE.MeshStandardMaterial;
  private readonly apronAccentMat: THREE.MeshStandardMaterial;
  private readonly managerMat: THREE.MeshStandardMaterial;
  private readonly goldTrimMat: THREE.MeshStandardMaterial;
  private readonly manMats: THREE.MeshStandardMaterial[];
  private readonly womanMats: THREE.MeshStandardMaterial[];
  private readonly scarfMats: THREE.MeshStandardMaterial[];
  private readonly childMats: THREE.MeshStandardMaterial[];
  private readonly elderMat: THREE.MeshStandardMaterial;
  private readonly policeMat: THREE.MeshStandardMaterial;
  private readonly policeCapMat: THREE.MeshStandardMaterial;
  private readonly caneMat: THREE.MeshStandardMaterial;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly hitMat: THREE.MeshBasicMaterial;
  private readonly selectRingMat: THREE.MeshBasicMaterial;

  private readonly selectedRingMesh: THREE.Mesh;
  private selectedAgentId: number | null = null;
  private nextAgentId = 1;

  // World data rebuilt from Element 1 building anchors + Element 2 street grid
  private houseSpots: HomeAnchorSpot[] = [];
  private breakSpots: BreakAnchorSpot[] = [];
  private schoolSpots: BreakAnchorSpot[] = [];
  private gardenSpots: BreakAnchorSpot[] = [];
  private freeStreetCenters: AnchorPoint[] = [];
  private palaceSpot: BreakAnchorSpot = {
    cubeId: 130,
    themeId: 'palace',
    doorstep: { x: 45, z: 49.5 },
    faceTarget: { x: 45, z: 45 },
    approachOffset: { dRow: 1, dCol: 0 },
  };
  private seaCoords: AnchorPoint[] = [];
  private streetGrid: StreetGrid | null = null;
  private lastCubes: Cube[] = [];
  private lastSatisfaction = 60;
  private lastRoleSignature = '';
  private campAgents = new Map<number, CampAgent>();
  private prevCampResidentIds = new Set<number>();
  private prevCampCubeId: number | null = null;
  private initialCampSyncDone = false;
  // V5 Prompt 1 Element S1: Living Clock + Registry Citizen schedule wiring
  private clockSecondsOfDay: number = CLOCK_CONSTANTS.DEFAULT_START_SECONDS_OF_DAY;
  private totalMonths = 0;
  private gameDay = 1;
  private lastPopulation = 0;
  private lastStaffedSlots: Set<string> = new Set();
  private lastCitizens: Citizen[] = [];
  private citizenById = new Map<number, Citizen>();
  // V5 Prompt 2 Element 2: Mosque anchors, prayer completion callback & off-screen attendee timers
  private mosqueSpots = new Map<number, BreakAnchorSpot>();
  private onPrayerCompleted?: (sessionId: number, citizenId: number) => void;
  private offscreenPrayerTimers = new Map<
    number,
    { sessionId: number; mosqueCubeId: number; remaining: number }
  >();
  private offscreenPrayerDispatchedKey: string | null = null;

  constructor(blobShadowTexture: THREE.CanvasTexture | null) {
    // Element 5.1: Widen robe/dress geometries by x1.25 for chunkier Stronghold silhouettes
    this.robeGeo = new THREE.CylinderGeometry(0.225, 0.35, 0.94, 8);
    this.robeGeo.translate(0, 0.47, 0);

    this.dressConeGeo = new THREE.CylinderGeometry(0.175, 0.45, 0.96, 9);
    this.dressConeGeo.translate(0, 0.48, 0);

    this.headGeo = new THREE.SphereGeometry(0.21, 9, 7);
    this.headGeo.translate(0, 1.12, 0);

    this.turbanGeo = new THREE.CylinderGeometry(0.235, 0.225, 0.14, 8);
    this.turbanGeo.translate(0, 1.26, 0);

    this.strawHatBrimGeo = new THREE.CylinderGeometry(0.39, 0.39, 0.045, 10);
    this.strawHatBrimGeo.translate(0, 1.24, 0);

    this.strawHatTopGeo = new THREE.CylinderGeometry(0.17, 0.23, 0.14, 8);
    this.strawHatTopGeo.translate(0, 1.32, 0);

    this.helmetGeo = new THREE.SphereGeometry(
      0.245,
      9,
      6,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.58
    );
    this.helmetGeo.translate(0, 1.15, 0);

    // Accessories offset slightly outward to clear the 1.25x wider robe cleanly
    this.apronGeo = new THREE.BoxGeometry(0.31, 0.52, 0.06);
    this.apronGeo.translate(0, 0.44, 0.28);

    this.packGeo = new THREE.BoxGeometry(0.28, 0.38, 0.17);
    this.packGeo.translate(0, 0.64, -0.28);

    this.headscarfGeo = new THREE.SphereGeometry(
      0.245,
      9,
      6,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.72
    );
    this.headscarfGeo.translate(0, 1.13, -0.02);

    this.caneGeo = new THREE.CylinderGeometry(0.032, 0.026, 0.86, 6);
    this.caneGeo.translate(0.33, 0.43, 0.18);

    // Non-weapon bamboo fishing pole held by the fisher for casting-arm bob animation (Element 3.3)
    this.fishingRodGeo = new THREE.CylinderGeometry(0.014, 0.026, 1.25, 6);
    this.fishingRodGeo.rotateX(Math.PI * 0.38);
    this.fishingRodGeo.translate(0, 0.18, 0.56);

    this.policeCapGeo = new THREE.CylinderGeometry(0.22, 0.23, 0.12, 8);
    this.policeCapGeo.translate(0, 1.28, 0);

    this.capVisorGeo = new THREE.BoxGeometry(0.24, 0.035, 0.15);
    this.capVisorGeo.translate(0, 1.23, 0.19);

    this.basketGeo = new THREE.CylinderGeometry(0.17, 0.13, 0.25, 8);
    this.basketGeo.translate(-0.33, 0.48, 0.06);

    this.collarGeo = new THREE.CylinderGeometry(0.245, 0.27, 0.1, 8);
    this.collarGeo.translate(0, 0.9, 0);

    // Element 5.1: Blob shadow grows 1.1 -> 1.7 plane
    this.shadowGeo = new THREE.PlaneGeometry(1.7, 1.7);
    this.shadowGeo.rotateX(-Math.PI / 2);

    // Element 5.3: Raycast hit cylinder grows to radius 0.95, height 2.9
    this.hitCylinderGeo = new THREE.CylinderGeometry(0.95, 0.95, 2.9, 8);
    this.hitCylinderGeo.translate(0, 1.45, 0);

    // Element 5.1: Selection ring grows 0.9 -> 1.4 outer radius
    this.selectRingGeo = new THREE.RingGeometry(1.0, 1.4, 28);
    this.selectRingGeo.rotateX(-Math.PI / 2);

    this.sharedGeos.push(
      this.robeGeo,
      this.dressConeGeo,
      this.headGeo,
      this.turbanGeo,
      this.strawHatBrimGeo,
      this.strawHatTopGeo,
      this.helmetGeo,
      this.apronGeo,
      this.packGeo,
      this.headscarfGeo,
      this.caneGeo,
      this.fishingRodGeo,
      this.policeCapGeo,
      this.capVisorGeo,
      this.basketGeo,
      this.collarGeo,
      this.shadowGeo,
      this.hitCylinderGeo,
      this.selectRingGeo
    );

    // Distinct role clothing materials (zero weapons)
    this.skinMat = new THREE.MeshStandardMaterial({ color: 0xd2a47c, roughness: 0.85 });
    this.farmerMat = new THREE.MeshStandardMaterial({ color: 0x5c7a44, roughness: 0.88 });
    this.strawMat = new THREE.MeshStandardMaterial({ color: 0xd9b866, roughness: 0.9 });
    this.fisherMat = new THREE.MeshStandardMaterial({ color: 0x2f6d94, roughness: 0.85 });
    this.minerMat = new THREE.MeshStandardMaterial({ color: 0x6b635a, roughness: 0.9 });
    this.helmetMat = new THREE.MeshStandardMaterial({
      color: 0x9b948a,
      roughness: 0.55,
      metalness: 0.3,
    });
    this.woodcutterMat = new THREE.MeshStandardMaterial({ color: 0x7b502c, roughness: 0.9 });
    this.leatherMat = new THREE.MeshStandardMaterial({ color: 0x4b2f19, roughness: 0.86 });
    this.bakerMat = new THREE.MeshStandardMaterial({ color: 0xeee2c4, roughness: 0.88 });
    this.apronWhiteMat = new THREE.MeshStandardMaterial({ color: 0xfbf7ee, roughness: 0.85 });
    this.shopkeeperMat = new THREE.MeshStandardMaterial({ color: 0xe3cca0, roughness: 0.86 });
    this.apronAccentMat = new THREE.MeshStandardMaterial({ color: 0x9c4636, roughness: 0.84 });
    this.managerMat = new THREE.MeshStandardMaterial({ color: 0x243b55, roughness: 0.78 });
    this.goldTrimMat = new THREE.MeshStandardMaterial({
      color: 0xd8ab3d,
      roughness: 0.4,
      metalness: 0.35,
    });

    this.manMats = [
      new THREE.MeshStandardMaterial({ color: 0x9b7e58, roughness: 0.88 }),
      new THREE.MeshStandardMaterial({ color: 0x8a6244, roughness: 0.88 }),
      new THREE.MeshStandardMaterial({ color: 0x6e7855, roughness: 0.88 }),
    ];

    this.womanMats = [
      new THREE.MeshStandardMaterial({ color: 0x9e4c5b, roughness: 0.86 }),
      new THREE.MeshStandardMaterial({ color: 0x4f747b, roughness: 0.86 }),
      new THREE.MeshStandardMaterial({ color: 0xb56d49, roughness: 0.86 }),
      new THREE.MeshStandardMaterial({ color: 0x775a78, roughness: 0.86 }),
    ];

    this.scarfMats = [
      new THREE.MeshStandardMaterial({ color: 0xf2e8d2, roughness: 0.86 }),
      new THREE.MeshStandardMaterial({ color: 0xd9bc84, roughness: 0.86 }),
    ];

    this.childMats = [
      new THREE.MeshStandardMaterial({ color: 0xe8ab3d, roughness: 0.84 }),
      new THREE.MeshStandardMaterial({ color: 0x52a674, roughness: 0.84 }),
      new THREE.MeshStandardMaterial({ color: 0xd96b52, roughness: 0.84 }),
      new THREE.MeshStandardMaterial({ color: 0x4b93ba, roughness: 0.84 }),
    ];

    this.elderMat = new THREE.MeshStandardMaterial({ color: 0xd5d0c4, roughness: 0.9 });
    this.policeMat = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.78 });
    this.policeCapMat = new THREE.MeshStandardMaterial({ color: 0x142640, roughness: 0.65 });
    this.caneMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2d, roughness: 0.9 });

    // Element 6.3: Blob shadows larger (1.7 plane) with opacity 0.55
    this.shadowMat = new THREE.MeshBasicMaterial({
      ...(blobShadowTexture ? { map: blobShadowTexture } : {}),
      color: blobShadowTexture ? 0xffffff : 0x221b12,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.hitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    this.selectRingMat = new THREE.MeshBasicMaterial({
      color: 0xf2c95e,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });

    this.selectedRingMesh = new THREE.Mesh(this.selectRingGeo, this.selectRingMat);
    this.selectedRingMesh.visible = false;
    this.selectedRingMesh.renderOrder = 22;
    this.group.add(this.selectedRingMesh);

    this.sharedMats.push(
      this.skinMat,
      this.farmerMat,
      this.strawMat,
      this.fisherMat,
      this.minerMat,
      this.helmetMat,
      this.woodcutterMat,
      this.leatherMat,
      this.bakerMat,
      this.apronWhiteMat,
      this.shopkeeperMat,
      this.apronAccentMat,
      this.managerMat,
      this.goldTrimMat,
      ...this.manMats,
      ...this.womanMats,
      ...this.scarfMats,
      ...this.childMats,
      this.elderMat,
      this.policeMat,
      this.policeCapMat,
      this.caneMat,
      this.shadowMat,
      this.hitMat,
      this.selectRingMat
    );
  }

  private createAgentMesh(
    agentId: number,
    role: CitizenRoleId,
    variantIdx: number
  ): { root: THREE.Group; bodyPivot: THREE.Group; castingPivot: THREE.Group | null } {
    const root = new THREE.Group();
    root.userData.agentId = agentId;

    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.position.y = 0.05;
    if (role === 'child') {
      shadow.scale.setScalar(0.68);
    }
    shadow.userData.agentId = agentId;
    root.add(shadow);

    // Element 5.3: Generous invisible raycast hit cylinder (r=0.95, h=2.9)
    const hitMesh = new THREE.Mesh(this.hitCylinderGeo, this.hitMat);
    hitMesh.userData.agentId = agentId;
    root.add(hitMesh);

    const bodyPivot = new THREE.Group();
    bodyPivot.userData.agentId = agentId;
    // Element 5.1: Scale every agent mesh x1.6 (child keeps 0.6 relative scale on top)
    bodyPivot.scale.setScalar(
      role === 'child' ? ADULT_MESH_SCALE * CHILD_RELATIVE_SCALE : ADULT_MESH_SCALE
    );
    root.add(bodyPivot);

    let castingPivot: THREE.Group | null = null;

    const addPart = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      parent: THREE.Object3D = bodyPivot,
      cast = true
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.userData.agentId = agentId;
      parent.add(m);
      return m;
    };

    // Body + accessory per role (strictly zero weapons)
    switch (role) {
      case 'farmer':
        addPart(this.robeGeo, this.farmerMat);
        addPart(this.headGeo, this.skinMat);
        addPart(this.strawHatBrimGeo, this.strawMat);
        addPart(this.strawHatTopGeo, this.strawMat);
        break;
      case 'fisher': {
        addPart(this.robeGeo, this.fisherMat);
        addPart(this.headGeo, this.skinMat);
        addPart(this.turbanGeo, this.strawMat);
        addPart(this.basketGeo, this.strawMat);
        castingPivot = new THREE.Group();
        castingPivot.position.set(0.28, 0.72, 0.14);
        castingPivot.userData.agentId = agentId;
        bodyPivot.add(castingPivot);
        addPart(this.fishingRodGeo, this.caneMat, castingPivot);
        break;
      }
      case 'miner':
        addPart(this.robeGeo, this.minerMat);
        addPart(this.headGeo, this.skinMat);
        addPart(this.helmetGeo, this.helmetMat);
        break;
      case 'woodcutter':
        addPart(this.robeGeo, this.woodcutterMat);
        addPart(this.headGeo, this.skinMat);
        addPart(this.packGeo, this.leatherMat);
        break;
      case 'baker':
        addPart(this.robeGeo, this.bakerMat);
        addPart(this.headGeo, this.skinMat);
        addPart(this.apronGeo, this.apronWhiteMat);
        addPart(this.turbanGeo, this.apronWhiteMat);
        break;
      case 'shopkeeper':
        addPart(this.robeGeo, this.shopkeeperMat);
        addPart(this.headGeo, this.skinMat);
        addPart(this.apronGeo, this.apronAccentMat);
        addPart(this.turbanGeo, this.bakerMat);
        break;
      case 'manager':
        addPart(this.robeGeo, this.managerMat);
        addPart(this.headGeo, this.skinMat);
        addPart(this.collarGeo, this.goldTrimMat);
        addPart(this.turbanGeo, this.bakerMat);
        break;
      case 'woman':
        addPart(this.dressConeGeo, this.womanMats[variantIdx % this.womanMats.length]);
        addPart(this.headGeo, this.skinMat);
        addPart(this.headscarfGeo, this.scarfMats[variantIdx % this.scarfMats.length]);
        break;
      case 'child':
        addPart(this.robeGeo, this.childMats[variantIdx % this.childMats.length]);
        addPart(this.headGeo, this.skinMat);
        break;
      case 'elder':
        addPart(this.robeGeo, this.elderMat);
        addPart(this.headGeo, this.skinMat);
        addPart(this.turbanGeo, this.apronWhiteMat);
        addPart(this.caneGeo, this.caneMat);
        bodyPivot.rotation.x = 0.14;
        break;
      case 'police':
        addPart(this.robeGeo, this.policeMat);
        addPart(this.headGeo, this.skinMat);
        addPart(this.policeCapGeo, this.policeCapMat);
        addPart(this.capVisorGeo, this.policeCapMat);
        addPart(this.collarGeo, this.goldTrimMat);
        break;
      case 'man':
      default:
        addPart(this.robeGeo, this.manMats[variantIdx % this.manMats.length]);
        addPart(this.headGeo, this.skinMat);
        addPart(this.turbanGeo, this.bakerMat);
        break;
    }

    return { root, bodyPivot, castingPivot };
  }

  private getLandHeight(x: number, z: number): number {
    // Element 2.4: Land height everywhere on valid walkable paths (never dip into seabed)
    return Math.max(WATER_SURFACE_Y + 0.08, getTerrainHeightAt(x, z, this.seaCoords));
  }

  private pickNearestBreakSpot(
    fromX: number,
    fromZ: number,
    preferCalm = false
  ): BreakAnchorSpot {
    const pool = preferCalm
      ? this.breakSpots.filter(
          (b) =>
            b.themeId === 'mosque' ||
            b.themeId === 'garden' ||
            b.themeId === 'palace'
        )
      : this.breakSpots;
    const list = pool.length > 0 ? pool : this.breakSpots;
    if (list.length === 0) {
      return this.palaceSpot;
    }

    let best = list[0];
    let bestDist = Infinity;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const d = Math.hypot(b.doorstep.x - fromX, b.doorstep.z - fromZ);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  private routeAgentTo(
    agent: LivingAgent,
    destAnchor: AnchorPoint,
    targetThemeId: ThemeId | null,
    faceTarget: AnchorPoint | null,
    destCubeId?: number,
    destApproachOffset?: { dRow: number; dCol: number }
  ): void {
    agent.targetThemeId = targetThemeId;
    agent.activeFaceTarget = faceTarget;
    agent.waypointIdx = 0;

    if (!this.streetGrid) {
      agent.waypoints = [];
      agent.pathReachable = false;
      agent.state = 'WAITING';
      agent.stateTimer = 4.0;
      return;
    }

    const result = computeStreetPath(
      this.streetGrid,
      agent.x,
      agent.z,
      destAnchor,
      {
        destCubeId,
        destThemeId: targetThemeId,
        destApproachOffset,
      }
    );

    agent.waypoints = result.waypoints;
    agent.pathReachable = result.reachable;

    if (!result.reachable && result.waypoints.length === 0) {
      agent.state = 'WAITING';
      agent.stateTimer = 4.0 + Math.random() * 2.5;
    }
  }

  private ensureVisibleAtDoorstepIfLeavingHome(agent: LivingAgent): void {
    if (!agent.group.visible) {
      const anchor =
        agent.role === 'police' ? this.palaceSpot : agent.homeSpot;
      agent.x = anchor.doorstep.x;
      agent.z = anchor.doorstep.z;
      const y = this.getLandHeight(agent.x, agent.z);
      agent.group.position.set(agent.x, y, agent.z);
      agent.group.scale.setScalar(1);
      agent.group.visible = true;
    }
  }

  private buildScheduleStateView(): ScheduleStateView {
    return {
      clock: {
        secondsOfDay: this.clockSecondsOfDay,
        totalGameSeconds: 0,
      },
      cubes: this.lastCubes,
      totalMonths: this.totalMonths,
      population: this.lastPopulation,
      citizens: this.lastCitizens,
    };
  }

  private resolveAgentSchedule(agent: LivingAgent): {
    phase: SchedulePhase;
    isStudent: boolean;
    hasRealShift: boolean;
  } {
    const view = this.buildScheduleStateView();
    let citizen =
      agent.citizenId !== null
        ? this.citizenById.get(agent.citizenId) ?? null
        : null;

    if (!citizen) {
      // Visual-only fallback for palace guards (no police_post slot in build) or shoreline fishers
      const synthAge =
        agent.role === 'child' ? 9 : agent.role === 'elder' ? 62 : 28;
      const synthBirthMonth = this.totalMonths - synthAge;
      citizen = {
        id: agent.id,
        name: agent.name,
        gender: agent.isFemale ? 'f' : 'm',
        birthMonth: synthBirthMonth,
        householdId: 0,
        homeCubeId: agent.homeSpot.cubeId,
        spouseId: null,
        parentIds: null,
        jobCubeId:
          agent.role === 'police' || agent.role === 'child'
            ? null
            : agent.workSpot?.cubeId ?? null,
        jobThemeId:
          agent.role === 'police' || agent.role === 'child'
            ? null
            : agent.workSpot?.themeId ?? null,
        wealth: 0,
        attrs: {
          physical: 50,
          professional: 50,
          social: 50,
          health: 50,
          intelligence: 50,
        },
        traits: generateTraits(agent.id, synthBirthMonth),
        memories: [],
        opinionOfKing: 0,
        cvFiled: false,
        housingRequestMonth: null,
      };
    }

    const shift = getCitizenShift(citizen, view, this.lastStaffedSlots);
    const phase = getSchedulePhase(citizen, view, this.lastStaffedSlots);
    return {
      phase,
      isStudent: shift?.template === 'SCHOOL',
      hasRealShift: shift !== null,
    };
  }

  private tuckAgentIndoors(agent: LivingAgent): void {
    const anchor =
      agent.role === 'police' ? this.palaceSpot : agent.homeSpot;
    agent.x = anchor.doorstep.x;
    agent.z = anchor.doorstep.z;
    const y = this.getLandHeight(agent.x, agent.z);
    agent.group.position.set(agent.x, y, agent.z);
    agent.group.scale.setScalar(1);
    agent.group.visible = false;
    agent.state = 'AT_HOME';
    agent.stateTimer = 3.0;
    agent.waypoints = [];
    agent.waypointIdx = 0;
    agent.activeBreakSpot = null;
    agent.targetThemeId = 'house';
    agent.activeFaceTarget = anchor.faceTarget;
  }

  private routeAgentHome(agent: LivingAgent): void {
    if (agent.state === 'AT_HOME' && !agent.group.visible) {
      agent.stateTimer = 3.0;
      return;
    }
    if (agent.state === 'ENTERING_HOME' || agent.state === 'TO_HOME') {
      return;
    }
    const anchor =
      agent.role === 'police' ? this.palaceSpot : agent.homeSpot;
    agent.activeBreakSpot = null;
    agent.state = 'TO_HOME';
    agent.stateTimer = 0;
    this.routeAgentTo(
      agent,
      anchor.doorstep,
      agent.role === 'police' ? 'palace' : 'house',
      anchor.faceTarget,
      anchor.cubeId,
      anchor.approachOffset
    );
  }

  public setOnPrayerCompleted(
    cb?: (sessionId: number, citizenId: number) => void
  ): void {
    this.onPrayerCompleted = cb;
  }

  private isInPrayerFlow(state: RoutineState): boolean {
    return (
      state === 'TO_PRAYER' ||
      state === 'ENTERING_MOSQUE' ||
      state === 'PRAYING' ||
      state === 'RETURNING_FROM_PRAYER'
    );
  }

  private routeReturnFromPrayer(agent: LivingAgent): void {
    const { phase, isStudent, hasRealShift } = this.resolveAgentSchedule(agent);
    agent.lastSchedulePhase = phase;
    agent.activeBreakSpot = null;
    agent.state = 'RETURNING_FROM_PRAYER';
    agent.stateTimer = 0;

    if (
      (phase === 'commute' || phase === 'working') &&
      hasRealShift &&
      agent.workSpot &&
      !isStudent
    ) {
      agent.prayerReturnTarget = 'work';
      agent.workSpotIdx = agent.id % agent.workSpot.workSpots.length;
      const targetPt =
        agent.workSpot.workSpots[agent.workSpotIdx] ?? agent.workSpot.doorstep;
      this.routeAgentTo(
        agent,
        targetPt,
        agent.workSpot.themeId,
        agent.workSpot.faceTarget,
        agent.workSpot.cubeId,
        agent.workSpot.approachOffset
      );
      return;
    }

    if (
      (phase === 'school' || (phase === 'commute' && isStudent)) &&
      this.schoolSpots.length > 0
    ) {
      agent.prayerReturnTarget = 'school';
      const s = this.schoolSpots[agent.id % this.schoolSpots.length];
      agent.playKind = 'school';
      this.routeAgentTo(
        agent,
        s.doorstep,
        'school',
        s.faceTarget,
        s.cubeId,
        s.approachOffset
      );
      return;
    }

    if (phase === 'evening') {
      agent.prayerReturnTarget = 'break';
      const b = this.pickNearestBreakSpot(
        agent.x,
        agent.z,
        agent.role === 'elder'
      );
      agent.activeBreakSpot = b;
      this.routeAgentTo(
        agent,
        b.doorstep,
        b.themeId,
        b.faceTarget,
        b.cubeId,
        b.approachOffset
      );
      return;
    }

    // sleep or home_morning -> walk home cleanly
    agent.prayerReturnTarget = 'home';
    const anchor = agent.role === 'police' ? this.palaceSpot : agent.homeSpot;
    this.routeAgentTo(
      agent,
      anchor.doorstep,
      agent.role === 'police' ? 'palace' : 'house',
      anchor.faceTarget,
      anchor.cubeId,
      anchor.approachOffset
    );
  }

  private syncActivePrayer(session: ActivePrayerSession | null): void {
    if (!session || session.logged) {
      this.offscreenPrayerTimers.clear();
      this.offscreenPrayerDispatchedKey = null;
      for (let i = 0; i < this.agents.length; i++) {
        const a = this.agents[i];
        if (a.state === 'TO_PRAYER') {
          a.prayerMosqueSpot = null;
          a.prayerReturnTarget = null;
          this.assignNextRoutine(a);
        }
      }
      return;
    }

    const attendeeMosque = new Map<number, number>();
    for (let i = 0; i < session.attendees.length; i++) {
      const att = session.attendees[i];
      attendeeMosque.set(att.citizenId, att.mosqueCubeId);
    }
    const completedSet = new Set<number>(session.completedCitizenIds);
    const visibleCitizenIds = new Set<number>();

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (a.citizenId === null) continue;
      visibleCitizenIds.add(a.citizenId);

      const mosqueCubeId = attendeeMosque.get(a.citizenId);
      if (mosqueCubeId === undefined || completedSet.has(a.citizenId)) continue;
      if (a.prayerSessionId === session.id) continue;

      const mosqueSpot = this.mosqueSpots.get(mosqueCubeId);
      if (!mosqueSpot) continue;

      this.ensureVisibleAtDoorstepIfLeavingHome(a);
      a.prayerSessionId = session.id;
      a.prayerMosqueSpot = mosqueSpot;
      a.prayerTimer = 0;
      a.prayerReturnTarget = null;
      a.activeBreakSpot = null;
      a.state = 'TO_PRAYER';
      a.stateTimer = 0;
      a.bodyPivot.rotation.x = a.role === 'elder' ? 0.14 : 0;
      a.bodyPivot.rotation.z = 0;
      if (a.castingPivot) {
        a.castingPivot.rotation.x = 0;
      }

      this.routeAgentTo(
        a,
        mosqueSpot.doorstep,
        'mosque',
        mosqueSpot.faceTarget,
        mosqueSpot.cubeId,
        mosqueSpot.approachOffset
      );
    }

    // Prune any offscreen prayer timers for citizens no longer alive in the registry
    if (this.lastCitizens.length > 0 || this.citizenById.size === 0) {
      for (const cid of this.offscreenPrayerTimers.keys()) {
        if (!this.citizenById.has(cid)) {
          this.offscreenPrayerTimers.delete(cid);
        }
      }
    }

    // For kingdoms with > MAX_VISIBLE_AGENTS citizens (or visual police offset), track off-screen selected attendees
    // using real street-grid reachability + realistic walk time + 1 game-minute prayer duration (never teleporting)
    const dispatchKey = `${session.id}`;
    if (this.offscreenPrayerDispatchedKey !== dispatchKey) {
      this.offscreenPrayerTimers.clear();
      this.offscreenPrayerDispatchedKey = dispatchKey;

      for (let i = 0; i < session.attendees.length; i++) {
        const att = session.attendees[i];
        if (
          completedSet.has(att.citizenId) ||
          visibleCitizenIds.has(att.citizenId)
        ) {
          continue;
        }
        const mosqueSpot = this.mosqueSpots.get(att.mosqueCubeId);
        if (!mosqueSpot || !this.streetGrid) continue;
        const cit = this.citizenById.get(att.citizenId);
        if (!cit) continue;
        const startCubeId = cit.jobCubeId ?? cit.homeCubeId ?? this.palaceSpot.cubeId;
        const startCube = this.lastCubes[startCubeId];
        const startPt = startCube
          ? cellToWorldCenter(startCube.row, startCube.col)
          : this.palaceSpot.doorstep;
        const path = computeStreetPath(
          this.streetGrid,
          startPt.x,
          startPt.z,
          mosqueSpot.doorstep,
          {
            destCubeId: mosqueSpot.cubeId,
            destThemeId: 'mosque',
            destApproachOffset: mosqueSpot.approachOffset,
          }
        );
        if (!path.reachable) continue;
        let pathLen = 0;
        let px = startPt.x;
        let pz = startPt.z;
        for (let w = 0; w < path.waypoints.length; w++) {
          pathLen += Math.hypot(path.waypoints[w].x - px, path.waypoints[w].z - pz);
          px = path.waypoints[w].x;
          pz = path.waypoints[w].z;
        }
        const walkSeconds = pathLen / 2.0;
        this.offscreenPrayerTimers.set(att.citizenId, {
          sessionId: session.id,
          mosqueCubeId: att.mosqueCubeId,
          remaining: walkSeconds + CLOCK_CONSTANTS.REAL_SECONDS_PER_GAME_MINUTE,
        });
      }
    }
  }

  private enforceScheduleTransition(agent: LivingAgent): void {
    if (this.isInPrayerFlow(agent.state)) {
      return;
    }
    const { phase, isStudent, hasRealShift } = this.resolveAgentSchedule(agent);
    agent.lastSchedulePhase = phase;

    if (phase === 'sleep') {
      if (agent.state === 'AT_HOME') {
        this.tuckAgentIndoors(agent);
      } else {
        this.routeAgentHome(agent);
      }
      return;
    }

    if (phase === 'commute' || phase === 'working') {
      if (isStudent && this.schoolSpots.length > 0) {
        if (agent.state !== 'PLAYING' || agent.playKind !== 'school') {
          this.ensureVisibleAtDoorstepIfLeavingHome(agent);
          const s = this.schoolSpots[agent.id % this.schoolSpots.length];
          agent.state = 'PLAYING';
          agent.stateTimer = 0;
          agent.playKind = 'school';
          this.routeAgentTo(
            agent,
            s.doorstep,
            'school',
            s.faceTarget,
            s.cubeId,
            s.approachOffset
          );
        }
        return;
      }
      if (hasRealShift && agent.workSpot) {
        if (agent.state !== 'TO_WORK' && agent.state !== 'WORKING') {
          this.ensureVisibleAtDoorstepIfLeavingHome(agent);
          agent.activeBreakSpot = null;
          agent.state = 'TO_WORK';
          agent.stateTimer = 0;
          agent.workSpotIdx = agent.id % agent.workSpot.workSpots.length;
          const targetPt =
            agent.workSpot.workSpots[agent.workSpotIdx] ??
            agent.workSpot.doorstep;
          this.routeAgentTo(
            agent,
            targetPt,
            agent.workSpot.themeId,
            agent.workSpot.faceTarget,
            agent.workSpot.cubeId,
            agent.workSpot.approachOffset
          );
        }
        return;
      }
    }

    if (phase === 'school' && this.schoolSpots.length > 0) {
      if (agent.state !== 'PLAYING' || agent.playKind !== 'school') {
        this.ensureVisibleAtDoorstepIfLeavingHome(agent);
        const s = this.schoolSpots[agent.id % this.schoolSpots.length];
        agent.state = 'PLAYING';
        agent.stateTimer = 0;
        agent.playKind = 'school';
        this.routeAgentTo(
          agent,
          s.doorstep,
          'school',
          s.faceTarget,
          s.cubeId,
          s.approachOffset
        );
      }
      return;
    }

    if (phase === 'home_morning' && hasRealShift) {
      if (agent.state === 'AT_HOME') {
        agent.stateTimer = 3.0;
      } else {
        this.routeAgentHome(agent);
      }
      return;
    }

    if (phase === 'evening' && (agent.state === 'WORKING' || agent.state === 'TO_WORK')) {
      agent.stateTimer = 0;
      this.assignNextRoutine(agent);
    }
  }

  public setClockSeconds(secondsOfDay: number): void {
    const prevMinute = Math.floor(this.clockSecondsOfDay / 60);
    this.clockSecondsOfDay = secondsOfDay;
    const nextMinute = Math.floor(this.clockSecondsOfDay / 60);
    if (prevMinute === nextMinute) return;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (this.isInPrayerFlow(a.state)) continue;
      const { phase } = this.resolveAgentSchedule(a);
      if (phase !== a.lastSchedulePhase) {
        this.enforceScheduleTransition(a);
      }
    }
  }

  private assignNextRoutine(agent: LivingAgent): void {
    const { phase, isStudent, hasRealShift } = this.resolveAgentSchedule(agent);
    agent.lastSchedulePhase = phase;

    // Sleep (22:00–05:00 for all non-NIGHT citizens): remain indoors invisible, or walk straight home
    if (phase === 'sleep') {
      if (agent.state === 'AT_HOME') {
        this.tuckAgentIndoors(agent);
      } else {
        this.routeAgentHome(agent);
      }
      return;
    }

    // Morning before shift for scheduled workers/students: remain resting at home until commute window
    if (phase === 'home_morning' && hasRealShift) {
      if (agent.state === 'AT_HOME') {
        this.tuckAgentIndoors(agent);
      } else {
        this.routeAgentHome(agent);
      }
      return;
    }

    // Commute or active work shift for citizens with real registry jobs
    if ((phase === 'commute' || phase === 'working') && hasRealShift && agent.workSpot && !isStudent) {
      if (agent.state === 'WORKING') {
        agent.stateTimer = 5.2 + Math.random() * 3.5;
        return;
      }
      this.ensureVisibleAtDoorstepIfLeavingHome(agent);
      agent.activeBreakSpot = null;
      agent.state = 'TO_WORK';
      agent.stateTimer = 0;
      agent.workSpotIdx = agent.id % agent.workSpot.workSpots.length;
      const targetPt = agent.workSpot.workSpots[agent.workSpotIdx] ?? agent.workSpot.doorstep;
      this.routeAgentTo(
        agent,
        targetPt,
        agent.workSpot.themeId,
        agent.workSpot.faceTarget,
        agent.workSpot.cubeId,
        agent.workSpot.approachOffset
      );
      return;
    }

    // Student commute / active school hours when a staffed school exists
    if ((phase === 'school' || (phase === 'commute' && isStudent)) && this.schoolSpots.length > 0) {
      if (agent.state === 'PLAYING' && agent.playKind === 'school' && agent.waypoints.length === 0) {
        agent.stateTimer = 4.0 + Math.random() * 2.5;
        return;
      }
      this.ensureVisibleAtDoorstepIfLeavingHome(agent);
      agent.activeBreakSpot = null;
      const s = this.schoolSpots[agent.id % this.schoolSpots.length];
      agent.state = 'PLAYING';
      agent.stateTimer = 0;
      agent.playKind = 'school';
      this.routeAgentTo(
        agent,
        s.doorstep,
        'school',
        s.faceTarget,
        s.cubeId,
        s.approachOffset
      );
      return;
    }

    this.ensureVisibleAtDoorstepIfLeavingHome(agent);
    agent.activeBreakSpot = null;

    if (agent.role === 'police') {
      agent.state = 'PATROL';
      agent.patrolStep += 1;
      if (agent.patrolStep % 2 === 0 || this.freeStreetCenters.length === 0) {
        agent.patrolAtPalace = true;
        this.routeAgentTo(
          agent,
          this.palaceSpot.doorstep,
          'palace',
          this.palaceSpot.faceTarget,
          this.palaceSpot.cubeId,
          this.palaceSpot.approachOffset
        );
      } else {
        agent.patrolAtPalace = false;
        const streetPt =
          this.freeStreetCenters[
            (agent.patrolStep * 3 + agent.id) % this.freeStreetCenters.length
          ];
        this.routeAgentTo(agent, streetPt, null, null);
      }
      return;
    }

    if (agent.role === 'child') {
      agent.state = 'PLAYING';
      const roll = Math.random();
      if (this.gardenSpots.length > 0 && roll < 0.55) {
        const g = this.gardenSpots[agent.id % this.gardenSpots.length];
        agent.playKind = 'garden';
        this.routeAgentTo(
          agent,
          g.doorstep,
          'garden',
          g.faceTarget,
          g.cubeId,
          g.approachOffset
        );
      } else {
        agent.playKind = 'house';
        const h =
          this.houseSpots.length > 0
            ? this.houseSpots[(agent.id + Math.floor(Math.random() * this.houseSpots.length)) % this.houseSpots.length]
            : agent.homeSpot;
        this.routeAgentTo(
          agent,
          h.doorstep,
          'house',
          h.faceTarget,
          h.cubeId,
          h.approachOffset
        );
      }
      return;
    }

    if (agent.role === 'elder') {
      if (agent.state === 'AT_HOME' || agent.state === 'WAITING') {
        const b = this.pickNearestBreakSpot(agent.x, agent.z, true);
        agent.activeBreakSpot = b;
        agent.state = 'TO_BREAK';
        this.routeAgentTo(
          agent,
          b.doorstep,
          b.themeId,
          b.faceTarget,
          b.cubeId,
          b.approachOffset
        );
      } else {
        agent.state = 'TO_HOME';
        this.routeAgentTo(
          agent,
          agent.homeSpot.doorstep,
          'house',
          agent.homeSpot.faceTarget,
          agent.homeSpot.cubeId,
          agent.homeSpot.approachOffset
        );
      }
      return;
    }

    // Evening / post-work routine for workers (shift ended, before 22:00 sleep)
    if (agent.workSpot && hasRealShift) {
      if (agent.state === 'WORKING' || agent.state === 'AT_HOME' || agent.state === 'WAITING') {
        const b = this.pickNearestBreakSpot(agent.x, agent.z, false);
        agent.activeBreakSpot = b;
        agent.state = 'TO_BREAK';
        this.routeAgentTo(
          agent,
          b.doorstep,
          b.themeId,
          b.faceTarget,
          b.cubeId,
          b.approachOffset
        );
        return;
      }
      agent.state = 'TO_HOME';
      this.routeAgentTo(
        agent,
        agent.homeSpot.doorstep,
        'house',
        agent.homeSpot.faceTarget,
        agent.homeSpot.cubeId,
        agent.homeSpot.approachOffset
      );
      return;
    }

    // General townsfolk (unemployed adults without assigned workplace — never routed to a workplace)
    if (agent.state === 'AT_HOME' || agent.state === 'WAITING') {
      const b = this.pickNearestBreakSpot(agent.x, agent.z, false);
      agent.activeBreakSpot = b;
      agent.state = 'TO_BREAK';
      this.routeAgentTo(
        agent,
        b.doorstep,
        b.themeId,
        b.faceTarget,
        b.cubeId,
        b.approachOffset
      );
    } else {
      agent.state = 'TO_HOME';
      this.routeAgentTo(
        agent,
        agent.homeSpot.doorstep,
        'house',
        agent.homeSpot.faceTarget,
        agent.homeSpot.cubeId,
        agent.homeSpot.approachOffset
      );
    }
  }

  public sync(
    cubes: Cube[],
    population: number,
    satisfaction: number,
    staffedSlots: Set<string>,
    seaCoords: AnchorPoint[],
    camp?: ArrivalCamp,
    citizens?: Citizen[],
    clockSecondsOfDay?: number,
    totalMonths?: number,
    activePrayer?: ActivePrayerSession | null,
    gameDay?: number
  ): void {
    this.lastCubes = cubes;
    this.lastPopulation = population;
    this.lastSatisfaction = satisfaction;
    this.lastStaffedSlots = staffedSlots;
    this.seaCoords = seaCoords;
    if (typeof clockSecondsOfDay === 'number' && Number.isFinite(clockSecondsOfDay)) {
      this.clockSecondsOfDay = clockSecondsOfDay;
    }
    if (typeof totalMonths === 'number' && Number.isFinite(totalMonths)) {
      this.totalMonths = totalMonths;
    }
    if (typeof gameDay === 'number' && Number.isFinite(gameDay)) {
      this.gameDay = Math.max(1, Math.trunc(gameDay));
    }
    this.lastCitizens = citizens ?? [];
    this.citizenById.clear();
    if (citizens) {
      for (let i = 0; i < citizens.length; i++) {
        this.citizenById.set(citizens[i].id, citizens[i]);
      }
      // Immediately drop any offscreen prayer timer for a citizen no longer in the living registry
      for (const cid of this.offscreenPrayerTimers.keys()) {
        if (!this.citizenById.has(cid)) {
          this.offscreenPrayerTimers.delete(cid);
        }
      }
    }
    this.houseSpots = [];
    this.breakSpots = [];
    this.schoolSpots = [];
    this.gardenSpots = [];
    this.freeStreetCenters = [];
    this.mosqueSpots.clear();

    // Element 2.1: Rebuild 12x12 walkability street grid from current cubes
    this.streetGrid = buildStreetGrid(cubes, seaCoords);

    const staffedWorkSlots: Array<{
      role: CitizenRoleId;
      spot: WorkAnchorSpot;
      count: number;
    }> = [];
    const workSpotByCubeTheme = new Map<string, WorkAnchorSpot>();

    // Rebuild Palace courtyard anchor first
    const palaceCube = findPalaceCube(cubes);
    if (palaceCube) {
      const palaceCellPos = cellToWorldCenter(palaceCube.row, palaceCube.col);
      const palaceAnchors = getBuildingAnchors(
        'palace',
        'full',
        0,
        palaceCellPos,
        { cubes, seaCoords, row: palaceCube.row, col: palaceCube.col }
      );
      this.palaceSpot = {
        cubeId: palaceCube.id,
        themeId: 'palace',
        doorstep: palaceAnchors.doorstep,
        faceTarget: palaceAnchors.faceTarget,
        approachOffset: palaceAnchors.approachOffset,
      };
    }

    // Element 1.2: Rebuild houseSpots, breakSpots, schoolSpots, gardenSpots, and workSpots from building anchors
    for (let i = 0; i < cubes.length; i++) {
      const c = cubes[i];
      if (c.owner !== 'player') continue;
      const cellCenter = cellToWorldCenter(c.row, c.col);

      if (isCellWalkable(this.streetGrid, c.row, c.col)) {
        this.freeStreetCenters.push(cellCenter);
      }

      const slotEntries: Array<{ slot: SlotIndex; themeId: ThemeId | null }> = [
        { slot: 0, themeId: c.themeId },
        { slot: 1, themeId: c.secondThemeId },
      ];

      for (let s = 0; s < slotEntries.length; s++) {
        const entry = slotEntries[s];
        if (!entry.themeId) continue;

        const def = THEMES[entry.themeId];
        const anchors: BuildingAnchors = getBuildingAnchors(
          entry.themeId,
          def.footprint,
          entry.slot,
          cellCenter,
          { cubes, seaCoords, row: c.row, col: c.col }
        );

        if (entry.themeId === 'house') {
          this.houseSpots.push({
            cubeId: c.id,
            doorstep: anchors.doorstep,
            faceTarget: anchors.faceTarget,
            approachOffset: anchors.approachOffset,
          });
        } else if (entry.themeId === 'school') {
          const spot: BreakAnchorSpot = {
            cubeId: c.id,
            themeId: 'palace', // placeholder unused; schoolSpots used for children
            doorstep: anchors.doorstep,
            faceTarget: anchors.faceTarget,
            approachOffset: anchors.approachOffset,
          };
          this.schoolSpots.push(spot);
        } else if (entry.themeId === 'garden') {
          const spot: BreakAnchorSpot = {
            cubeId: c.id,
            themeId: 'garden',
            doorstep: anchors.doorstep,
            faceTarget: anchors.faceTarget,
            approachOffset: anchors.approachOffset,
          };
          this.gardenSpots.push(spot);
          this.breakSpots.push(spot);
        } else if (
          entry.themeId === 'mosque' ||
          entry.themeId === 'restaurant' ||
          entry.themeId === 'cafe' ||
          entry.themeId === 'grand_market' ||
          entry.themeId === 'shop' ||
          entry.themeId === 'theater'
        ) {
          const spot: BreakAnchorSpot = {
            cubeId: c.id,
            themeId: entry.themeId,
            doorstep: anchors.doorstep,
            faceTarget: anchors.faceTarget,
            approachOffset: anchors.approachOffset,
          };
          this.breakSpots.push(spot);
          if (entry.themeId === 'mosque') {
            this.mosqueSpots.set(c.id, spot);
          }
        }

        // Staffed workplace assignment (sea spawns a visible shoreline fisher even though workers === 0)
        const role = themeToWorkerRole(entry.themeId);
        const slotKey = makeSlotKey(c.id, entry.slot);
        if (role && (entry.themeId === 'sea' || staffedSlots.has(slotKey))) {
          const desired = entry.themeId === 'sea' ? 1 : Math.min(2, Math.max(1, def.workers));
          const workSpot: WorkAnchorSpot = {
            cubeId: c.id,
            themeId: entry.themeId,
            doorstep: anchors.doorstep,
            workSpots: anchors.workSpots,
            faceTarget: anchors.faceTarget,
            approachOffset: anchors.approachOffset,
          };
          workSpotByCubeTheme.set(`${c.id}:${entry.themeId}`, workSpot);
          staffedWorkSlots.push({
            role,
            spot: workSpot,
            count: desired,
          });
        }
      }
    }

    // Palace courtyard is always a valid open-air break destination
    this.breakSpots.push(this.palaceSpot);

    // Fallback home spot if the player demolished all houses
    const fallbackHome: HomeAnchorSpot =
      this.houseSpots.length > 0
        ? this.houseSpots[0]
        : {
            cubeId: this.palaceSpot.cubeId,
            doorstep: this.palaceSpot.doorstep,
            faceTarget: this.palaceSpot.faceTarget,
            approachOffset: this.palaceSpot.approachOffset,
          };

    // Visible agents capped at min(living population, 36); never exceed living registry count
    const effectivePopulation =
      citizens !== undefined ? Math.min(population, citizens.length) : population;
    const targetCount = Math.min(
      MAX_VISIBLE_AGENTS,
      Math.max(0, Math.floor(effectivePopulation))
    );
    const campSet = new Set<number>(camp?.residentIds ?? []);
    const availableCitizens = (citizens ?? []).filter((c) => !campSet.has(c.id));
    const claimedCitizenIds = new Set<number>();

    const claimCitizen = (predicate: (c: Citizen) => boolean): Citizen | null => {
      for (let k = 0; k < availableCitizens.length; k++) {
        const c = availableCitizens[k];
        if (claimedCitizenIds.has(c.id)) continue;
        if (predicate(c)) {
          claimedCitizenIds.add(c.id);
          return c;
        }
      }
      return null;
    };

    const desiredSpecs: Array<{
      role: CitizenRoleId;
      workSpot: WorkAnchorSpot | null;
      citizen: Citizen | null;
    }> = [];

    // Internal security police officers (1-2 depending on population)
    if (targetCount >= 6) {
      desiredSpecs.push({ role: 'police', workSpot: null, citizen: null });
    }
    if (targetCount >= 22) {
      desiredSpecs.push({ role: 'police', workSpot: null, citizen: null });
    }

    // Staffed workers — bound to real registry citizens employed at each exact cube + theme
    for (let i = 0; i < staffedWorkSlots.length; i++) {
      const ws = staffedWorkSlots[i];
      for (let k = 0; k < ws.count; k++) {
        if (desiredSpecs.length >= targetCount) break;
        const bound = claimCitizen(
          (c) =>
            c.jobCubeId === ws.spot.cubeId &&
            c.jobThemeId === ws.spot.themeId &&
            ageYears(c, this.totalMonths) >= 14
        );
        desiredSpecs.push({ role: ws.role, workSpot: ws.spot, citizen: bound });
      }
      if (desiredSpecs.length >= targetCount) break;
    }

    // Fill remaining visible citizens with real registry townsfolk (children, elders, unemployed adults)
    const familyCycle: CitizenRoleId[] = ['woman', 'child', 'man', 'woman', 'elder', 'child'];
    let cycleIdx = 0;
    while (desiredSpecs.length < targetCount) {
      const preferredRole = familyCycle[cycleIdx % familyCycle.length];
      let bound: Citizen | null = null;
      let resolvedRole: CitizenRoleId = preferredRole;

      if (preferredRole === 'child') {
        bound = claimCitizen((c) => ageYears(c, this.totalMonths) < 14);
      } else if (preferredRole === 'elder') {
        bound = claimCitizen(
          (c) => ageYears(c, this.totalMonths) >= 55 && c.jobCubeId === null
        );
      } else if (preferredRole === 'woman') {
        bound = claimCitizen(
          (c) =>
            ageYears(c, this.totalMonths) >= 14 &&
            c.gender === 'f' &&
            c.jobCubeId === null
        );
      } else {
        bound = claimCitizen(
          (c) =>
            ageYears(c, this.totalMonths) >= 14 &&
            c.gender === 'm' &&
            c.jobCubeId === null
        );
      }

      let resolvedWorkSpot: WorkAnchorSpot | null = null;
      if (!bound) {
        bound = claimCitizen((c) => c.jobCubeId === null);
        if (bound) {
          const age = ageYears(bound, this.totalMonths);
          resolvedRole =
            age < 14
              ? 'child'
              : age >= 55
                ? 'elder'
                : bound.gender === 'f'
                  ? 'woman'
                  : 'man';
        }
      }

      if (!bound) {
        bound = claimCitizen(() => true);
        if (bound) {
          const age = ageYears(bound, this.totalMonths);
          const jobRole = bound.jobThemeId
            ? themeToWorkerRole(bound.jobThemeId)
            : null;
          resolvedRole =
            jobRole ??
            (age < 14
              ? 'child'
              : age >= 55
                ? 'elder'
                : bound.gender === 'f'
                  ? 'woman'
                  : 'man');
          if (bound.jobCubeId !== null && bound.jobThemeId !== null) {
            resolvedWorkSpot =
              workSpotByCubeTheme.get(`${bound.jobCubeId}:${bound.jobThemeId}`) ??
              null;
          }
        }
      }

      desiredSpecs.push({
        role: resolvedRole,
        workSpot: resolvedWorkSpot,
        citizen: bound,
      });
      cycleIdx += 1;
    }

    const roleSig = desiredSpecs
      .map(
        (s) =>
          `${s.role}:${s.citizen ? s.citizen.id : '-'}:${s.workSpot ? `${s.workSpot.cubeId}:${s.workSpot.doorstep.x.toFixed(1)},${s.workSpot.doorstep.z.toFixed(1)}` : '-'}`
      )
      .join('|');
    const gridSig = `${seaCoords.length}:${this.houseSpots.length}:${this.freeStreetCenters.length}`;
    const fullSig = `${roleSig}#${gridSig}`;

    // Drop any agent whose bound citizen is no longer in the living registry (death / emigration)
    let droppedDeceased = false;
    if (citizens !== undefined) {
      for (let i = this.agents.length - 1; i >= 0; i--) {
        const a = this.agents[i];
        if (a.citizenId !== null && !this.citizenById.has(a.citizenId)) {
          this.group.remove(a.group);
          if (this.selectedAgentId === a.id) {
            this.selectedAgentId = null;
            this.selectedRingMesh.visible = false;
          }
          this.agents.splice(i, 1);
          droppedDeceased = true;
        }
      }
    }

    if (
      droppedDeceased ||
      fullSig !== this.lastRoleSignature ||
      this.agents.length !== targetCount
    ) {
      this.lastRoleSignature = fullSig;

      // Match existing agents stably by citizenId so a death removes ONLY the dead citizen's agent
      // (preventing surviving agents from swapping IDs or hijacking an open CitizenCard)
      const existingByCitizenId = new Map<number, LivingAgent>();
      const existingUnbound: LivingAgent[] = [];
      for (let i = 0; i < this.agents.length; i++) {
        const a = this.agents[i];
        if (a.citizenId !== null) {
          existingByCitizenId.set(a.citizenId, a);
        } else {
          existingUnbound.push(a);
        }
      }
      const nextAgents: LivingAgent[] = [];
      const consumedAgentIds = new Set<number>();

      for (let i = 0; i < targetCount; i++) {
        const spec = desiredSpecs[i];
        const homeByCube =
          spec.citizen && spec.citizen.homeCubeId !== null
            ? this.houseSpots.find((h) => h.cubeId === spec.citizen!.homeCubeId) ?? null
            : null;
        const home =
          homeByCube ??
          (this.houseSpots.length > 0
            ? this.houseSpots[i % this.houseSpots.length]
            : fallbackHome);

        let existing: LivingAgent | undefined;
        if (spec.citizen) {
          existing = existingByCitizenId.get(spec.citizen.id);
          if (existing) {
            existingByCitizenId.delete(spec.citizen.id);
          }
        } else {
          const idx = existingUnbound.findIndex((a) => a.role === spec.role);
          if (idx >= 0) {
            existing = existingUnbound.splice(idx, 1)[0];
          } else if (existingUnbound.length > 0) {
            existing = existingUnbound.shift();
          }
        }
        if (existing) {
          consumedAgentIds.add(existing.id);
          existing.homeSpot = home;
          existing.citizenId = spec.citizen?.id ?? null;
          if (spec.citizen) {
            existing.name = spec.citizen.name;
            existing.isFemale = spec.citizen.gender === 'f';
          }
          const workChanged =
            existing.workSpot?.cubeId !== spec.workSpot?.cubeId ||
            existing.workSpot?.themeId !== spec.workSpot?.themeId;
          existing.workSpot = spec.workSpot;

          // If a new building or sea was built under an agent, nudge cleanly to doorstep
          const strandedOnWater = isPointOverWater(existing.x, existing.z, seaCoords);
          const allowedFieldId =
            existing.state === 'WORKING' &&
            existing.workSpot &&
            WALKABLE_FIELD_THEMES.has(existing.workSpot.themeId)
              ? existing.workSpot.cubeId
              : undefined;
          const strandedInWall = isPointInsideAnyBuildingFootprint(
            existing.x,
            existing.z,
            cubes,
            allowedFieldId
          );
          if (strandedOnWater || strandedInWall) {
            existing.x = home.doorstep.x;
            existing.z = home.doorstep.z;
            const y = this.getLandHeight(existing.x, existing.z);
            existing.group.position.set(existing.x, y, existing.z);
            existing.group.visible = true;
            existing.group.scale.setScalar(1);
            existing.state = 'AT_HOME';
            existing.stateTimer = 0.25;
            existing.waypoints = [];
          }

          if (existing.role !== spec.role) {
            this.group.remove(existing.group);
            existing.role = spec.role;
            existing.isFemale = spec.citizen
              ? spec.citizen.gender === 'f'
              : spec.role === 'woman' || (spec.role === 'child' && existing.id % 2 === 1);
            existing.name = spec.citizen
              ? spec.citizen.name
              : existing.isFemale
                ? FEMALE_NAMES[existing.id % FEMALE_NAMES.length]
                : MALE_NAMES[existing.id % MALE_NAMES.length];
            const baseSpeed = getBaseSpeedForRole(spec.role);
            const speedVar = 0.85 + deterministicUnit(existing.id * 7 + 3) * 0.3;
            existing.speed = baseSpeed * speedVar;

            const built = this.createAgentMesh(existing.id, spec.role, existing.id);
            const y = this.getLandHeight(existing.x, existing.z);
            built.root.position.set(existing.x, y, existing.z);
            this.group.add(built.root);
            existing.group = built.root;
            existing.bodyPivot = built.bodyPivot;
            existing.castingPivot = built.castingPivot;
            existing.state = 'AT_HOME';
            existing.stateTimer = 0.2;
            this.assignNextRoutine(existing);
          } else if (workChanged && existing.workSpot) {
            existing.state = 'AT_HOME';
            existing.stateTimer = 0.1;
            this.assignNextRoutine(existing);
          } else if (
            existing.state !== 'AT_HOME' &&
            existing.state !== 'ENTERING_HOME' &&
            existing.state !== 'ENTERING_MOSQUE' &&
            existing.state !== 'PRAYING' &&
            existing.stateTimer <= 0
          ) {
            // Re-validate active path against updated street grid (e.g. player just built a sea or building)
            const lastWp = existing.waypoints[existing.waypoints.length - 1];
            if (lastWp) {
              const destCubeId =
                existing.state === 'TO_PRAYER'
                  ? existing.prayerMosqueSpot?.cubeId
                  : existing.workSpot?.cubeId;
              this.routeAgentTo(
                existing,
                lastWp,
                existing.targetThemeId,
                existing.activeFaceTarget,
                destCubeId
              );
            }
          }
          nextAgents.push(existing);
        } else {
          const id = this.nextAgentId++;
          const isFemale = spec.citizen
            ? spec.citizen.gender === 'f'
            : spec.role === 'woman' || (spec.role === 'child' && id % 2 === 1);
          const name = spec.citizen
            ? spec.citizen.name
            : isFemale
              ? FEMALE_NAMES[id % FEMALE_NAMES.length]
              : MALE_NAMES[id % MALE_NAMES.length];
          const baseSpeed = getBaseSpeedForRole(spec.role);
          const speedVar = 0.85 + deterministicUnit(id * 7 + 3) * 0.3; // +-15%

          // Spawn cleanly on valid doorstep / palace courtyard anchor (never inside walls or water)
          const startAnchor =
            spec.role === 'police' ? this.palaceSpot.doorstep : home.doorstep;
          const built = this.createAgentMesh(id, spec.role, id);
          const startY = this.getLandHeight(startAnchor.x, startAnchor.z);
          built.root.position.set(startAnchor.x, startY, startAnchor.z);
          this.group.add(built.root);

          const agent: LivingAgent = {
            id,
            citizenId: spec.citizen?.id ?? null,
            name,
            isFemale,
            role: spec.role,
            group: built.root,
            bodyPivot: built.bodyPivot,
            castingPivot: built.castingPivot,
            x: startAnchor.x,
            z: startAnchor.z,
            waypoints: [],
            waypointIdx: 0,
            pathReachable: true,
            speed: baseSpeed * speedVar,
            state: 'AT_HOME',
            lastSchedulePhase: 'home_morning',
            stateTimer: deterministicUnit(id * 11) * 1.2,
            enterDoorTimer: 0,
            enterStartX: startAnchor.x,
            enterStartZ: startAnchor.z,
            walkPhase: id * 1.1,
            workPhase: id * 0.7,
            workSpotIdx: 0,
            workSpotSwitchTimer: 0,
            homeSpot: home,
            workSpot: spec.workSpot,
            activeBreakSpot: null,
            targetThemeId: 'house',
            activeFaceTarget: home.faceTarget,
            playKind: 'house',
            patrolStep: id,
            patrolAtPalace: true,
            prayerSessionId: null,
            prayerMosqueSpot: null,
            prayerTimer: 0,
            prayerReturnTarget: null,
          };
          this.assignNextRoutine(agent);
          nextAgents.push(agent);
        }
      }

      // Remove any remaining old agents that were not reused
      for (let i = 0; i < this.agents.length; i++) {
        const old = this.agents[i];
        if (!consumedAgentIds.has(old.id)) {
          this.group.remove(old.group);
          if (this.selectedAgentId === old.id) {
            this.selectedAgentId = null;
            this.selectedRingMesh.visible = false;
          }
        }
      }
      this.agents.length = 0;
      for (let i = 0; i < nextAgents.length; i++) {
        this.agents.push(nextAgents[i]);
      }
    } else {
      // Even when roster signature is unchanged, ensure schedule phases stay aligned with latest clock
      for (let i = 0; i < this.agents.length; i++) {
        const a = this.agents[i];
        if (this.isInPrayerFlow(a.state)) continue;
        const { phase } = this.resolveAgentSchedule(a);
        if (phase !== a.lastSchedulePhase) {
          this.enforceScheduleTransition(a);
        }
      }
    }

    // Safety guard: if a mosque was demolished while an agent was walking to / praying in it, release cleanly
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (
        (a.state === 'TO_PRAYER' ||
          a.state === 'ENTERING_MOSQUE' ||
          a.state === 'PRAYING') &&
        a.prayerMosqueSpot &&
        !this.mosqueSpots.has(a.prayerMosqueSpot.cubeId)
      ) {
        a.group.visible = true;
        a.group.scale.setScalar(1);
        a.prayerMosqueSpot = null;
        a.prayerReturnTarget = null;
        a.prayerTimer = 0;
        this.assignNextRoutine(a);
      }
    }

    this.syncActivePrayer(activePrayer ?? null);
    this.syncCampAgents(cubes, seaCoords, camp, citizens);
  }

  private syncCampAgents(
    cubes: Cube[],
    seaCoords: AnchorPoint[],
    camp: ArrivalCamp | undefined,
    citizens: Citizen[] | undefined
  ): void {
    const campCubeId = camp?.cubeId ?? null;
    const residentIds = (camp?.residentIds ?? []).slice(0, CAMP_CAPACITY);
    const residentSet = new Set<number>(residentIds);
    const citizenById = new Map<number, Citizen>();
    if (citizens) {
      for (let i = 0; i < citizens.length; i++) {
        citizenById.set(citizens[i].id, citizens[i]);
      }
    }

    // 1. Check previously camping citizens who left the camp: if deceased/removed drop immediately; if granted a house live, walk them via street A*
    for (const [citId, agent] of this.campAgents.entries()) {
      const stillAlive = citizens === undefined || citizenById.has(citId);
      if (!stillAlive) {
        this.group.remove(agent.group);
        if (this.selectedAgentId === agent.agentId) {
          this.selectedAgentId = null;
          this.selectedRingMesh.visible = false;
        }
        this.campAgents.delete(citId);
        continue;
      }
      if (residentSet.has(citId)) continue;
      if (agent.mode === 'WALKING_TO_HOUSE' || agent.mode === 'ENTERING_NEW_HOUSE') {
        continue;
      }

      const cit = citizenById.get(citId);
      if (
        this.initialCampSyncDone &&
        cit &&
        cit.homeCubeId !== null &&
        cubes[cit.homeCubeId]?.owner === 'player'
      ) {
        const walk = computeCampToHouseWalk(
          cubes,
          seaCoords,
          agent.campCubeId,
          cit.homeCubeId
        );
        const houseCube = cubes[cit.homeCubeId];
        const houseCenter = cellToWorldCenter(houseCube.row, houseCube.col);
        if (walk.reachable && walk.waypoints.length > 0) {
          agent.mode = 'WALKING_TO_HOUSE';
          agent.houseCubeId = cit.homeCubeId;
          agent.waypoints = walk.waypoints;
          agent.waypointIdx = 0;
          agent.faceTarget = houseCenter;
          continue;
        }
      }

      // Otherwise remove cleanly
      this.group.remove(agent.group);
      if (this.selectedAgentId === agent.agentId) {
        this.selectedAgentId = null;
        this.selectedRingMesh.visible = false;
      }
      this.campAgents.delete(citId);
    }

    // 2. Spawn or reposition current camp residents around tents & campfire on camp.cubeId
    if (campCubeId !== null && residentIds.length > 0) {
      const campCube = cubes[campCubeId];
      if (campCube && campCube.owner === 'player') {
        const center = cellToWorldCenter(campCube.row, campCube.col);
        const firePos: AnchorPoint = { x: center.x, z: center.z + 1.15 };
        // Six clean spots around campfire & tent entrances, strictly inside the land cube
        const spotOffsets: ReadonlyArray<{ dx: number; dz: number }> = [
          { dx: -1.45, dz: 0.45 },
          { dx: 1.45, dz: 0.55 },
          { dx: -1.1, dz: 2.25 },
          { dx: 1.15, dz: 2.25 },
          { dx: -2.4, dz: -0.2 },
          { dx: 2.4, dz: -0.1 },
        ];

        for (let idx = 0; idx < residentIds.length; idx++) {
          const citId = residentIds[idx];
          const cit = citizenById.get(citId);
          if (citizens !== undefined && !cit) continue;
          const spot = spotOffsets[idx % spotOffsets.length];
          const wx = center.x + spot.dx;
          const wz = center.z + spot.dz;
          const wy = this.getLandHeight(wx, wz);

          const existing = this.campAgents.get(citId);
          if (existing) {
            if (existing.mode === 'CAMPING') {
              existing.campCubeId = campCubeId;
              existing.x = wx;
              existing.z = wz;
              existing.faceTarget = firePos;
              existing.group.position.set(wx, wy, wz);
              existing.group.rotation.y = Math.atan2(
                firePos.x - wx,
                firePos.z - wz
              );
            }
          } else {
            const agentId = CAMP_AGENT_ID_OFFSET + citId;
            const role: CitizenRoleId = cit
              ? cit.gender === 'f'
                ? 'woman'
                : 'man'
              : idx % 2 === 0
                ? 'man'
                : 'woman';
            const name =
              cit?.name ??
              (role === 'woman'
                ? FEMALE_NAMES[citId % FEMALE_NAMES.length]
                : MALE_NAMES[citId % MALE_NAMES.length]);

            const built = this.createAgentMesh(agentId, role, citId);
            built.root.position.set(wx, wy, wz);
            built.root.rotation.y = Math.atan2(firePos.x - wx, firePos.z - wz);
            this.group.add(built.root);

            this.campAgents.set(citId, {
              agentId,
              citizenId: citId,
              name,
              role,
              group: built.root,
              bodyPivot: built.bodyPivot,
              x: wx,
              z: wz,
              mode: 'CAMPING',
              campCubeId,
              houseCubeId: null,
              waypoints: [],
              waypointIdx: 0,
              faceTarget: firePos,
              walkPhase: citId * 0.9,
              enterDoorTimer: 0,
              enterStartX: wx,
              enterStartZ: wz,
              speed: 2.25,
            });
          }
        }
      }
    }

    this.prevCampResidentIds = residentSet;
    this.prevCampCubeId = campCubeId;
    this.initialCampSyncDone = true;
  }

  public setSelectedAgent(agentId: number | null): void {
    this.selectedAgentId = agentId;
    if (agentId === null) {
      this.selectedRingMesh.visible = false;
    }
  }

  public getAgentPosition(agentId: number, out: THREE.Vector3): boolean {
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (a.id === agentId) {
        out.set(a.x, a.group.position.y, a.z);
        return true;
      }
    }
    for (const c of this.campAgents.values()) {
      if (c.agentId === agentId) {
        out.set(c.x, c.group.position.y, c.z);
        return true;
      }
    }
    return false;
  }

  /**
   * Read-only snapshot for Element 8 geometric verification tests.
   */
  public getDebugAnchors(): {
    houseSpots: HomeAnchorSpot[];
    breakSpots: BreakAnchorSpot[];
    schoolSpots: BreakAnchorSpot[];
    gardenSpots: BreakAnchorSpot[];
    palaceSpot: BreakAnchorSpot;
    workSpots: WorkAnchorSpot[];
    streetGrid: StreetGrid | null;
  } {
    const workSpots: WorkAnchorSpot[] = [];
    for (let i = 0; i < this.agents.length; i++) {
      const ws = this.agents[i].workSpot;
      if (ws) workSpots.push(ws);
    }
    return {
      houseSpots: this.houseSpots,
      breakSpots: this.breakSpots,
      schoolSpots: this.schoolSpots,
      gardenSpots: this.gardenSpots,
      palaceSpot: this.palaceSpot,
      workSpots,
      streetGrid: this.streetGrid,
    };
  }

  public getAgentSnapshots(): Array<{
    id: number;
    citizenId: number | null;
    role: CitizenRoleId;
    state: RoutineState;
    visible: boolean;
    phase: SchedulePhase;
    workThemeId: ThemeId | null;
    destinationAr: string;
  }> {
    return this.agents.map((a) => {
      const info = this.getAgentInfo(a.id);
      return {
        id: a.id,
        citizenId: a.citizenId,
        role: a.role,
        state: a.state,
        visible: a.group.visible,
        phase: this.resolveAgentSchedule(a).phase,
        workThemeId: a.workSpot?.themeId ?? null,
        destinationAr: info?.destinationAr ?? '',
      };
    });
  }

  /**
   * Element 4.1: Truthful Arabic card text derived strictly from the agent's actual current leg,
   * target anchor theme, and current visibility/waiting state. Zero generic fallback.
   */
  public getAgentInfo(agentId: number): CitizenInfo | null {
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (a.id !== agentId) continue;

      const { phase } = this.resolveAgentSchedule(a);
      let destinationAr: string;
      switch (a.state) {
        case 'WAITING':
          destinationAr = WAITING_NO_PATH_TEXT;
          break;
        case 'AT_HOME':
          destinationAr =
            phase === 'sleep' ? SLEEPING_AT_HOME_TEXT : AT_HOME_TEXT;
          break;
        case 'ENTERING_HOME':
        case 'TO_HOME':
          destinationAr =
            a.role === 'police'
              ? THEME_GOING_TEXT.palace
              : formatAgentSpeechVariant(
                  'to_home',
                  a.citizenId ?? a.id,
                  this.gameDay
                );
          break;
        case 'TO_WORK': {
          const workTheme: ThemeId = a.targetThemeId ?? a.workSpot?.themeId ?? 'palace';
          destinationAr = formatAgentSpeechVariant(
            'to_work',
            a.citizenId ?? a.id,
            this.gameDay,
            workTheme
          );
          break;
        }
        case 'WORKING': {
          const workTheme: ThemeId = a.targetThemeId ?? a.workSpot?.themeId ?? 'palace';
          destinationAr = formatAgentSpeechVariant(
            'working',
            a.citizenId ?? a.id,
            this.gameDay,
            workTheme
          );
          break;
        }
        case 'TO_BREAK': {
          const breakTheme: BreakThemeId = a.activeBreakSpot?.themeId ?? 'palace';
          destinationAr = THEME_GOING_TEXT[breakTheme];
          break;
        }
        case 'ON_BREAK': {
          const breakTheme: BreakThemeId = a.activeBreakSpot?.themeId ?? 'palace';
          destinationAr = BREAK_ARRIVED_TEXT[breakTheme];
          break;
        }
        case 'PLAYING': {
          if (a.stateTimer > 0) {
            destinationAr =
              a.playKind === 'school'
                ? phase === 'school'
                  ? 'يتعلّم في المدرسة'
                  : 'يلعب عند مدخل المدرسة'
                : a.playKind === 'garden'
                  ? 'يلعب بين أشجار الحديقة'
                  : 'يلعب قرب باب البيت';
          } else {
            const playTheme: ThemeId =
              a.playKind === 'school'
                ? 'school'
                : a.playKind === 'garden'
                  ? 'garden'
                  : 'house';
            destinationAr = THEME_GOING_TEXT[playTheme];
          }
          break;
        }
        case 'PATROL': {
          if (a.patrolAtPalace) {
            destinationAr =
              a.stateTimer > 0
                ? 'يحرس ساحة قصر الحاكم'
                : THEME_GOING_TEXT.palace;
          } else {
            const curCell = worldToCell(a.x, a.z);
            const curCube = curCell ? this.lastCubes[curCell.id] : undefined;
            destinationAr =
              curCube?.themeId && curCube.themeId !== 'sea'
                ? `يتفقد الأمن قرب ${THEME_GOING_TEXT[curCube.themeId].replace('في طريقه إلى ', '')}`
                : 'في جولة أمنية بشوارع المملكة';
          }
          break;
        }
        case 'TO_PRAYER':
        case 'ENTERING_MOSQUE':
          destinationAr = TO_PRAYER_TEXT;
          break;
        case 'PRAYING':
          destinationAr = PRAYING_IN_MOSQUE_TEXT;
          break;
        case 'RETURNING_FROM_PRAYER':
          destinationAr = RETURNING_FROM_PRAYER_TEXT;
          break;
      }

      const prayerStatus: CitizenInfo['prayerStatus'] =
        a.state === 'TO_PRAYER' || a.state === 'ENTERING_MOSQUE'
          ? 'to_prayer'
          : a.state === 'PRAYING'
            ? 'praying'
            : a.state === 'RETURNING_FROM_PRAYER'
              ? 'returning'
              : null;

      const mood = getMoodFromSatisfaction(this.lastSatisfaction);
      return {
        id: a.id,
        citizenId: a.citizenId,
        name: a.name,
        role: a.role,
        roleLabelAr: ROLE_LABELS_AR[a.role],
        destinationAr,
        moodAr: mood.moodAr,
        moodTone: mood.moodTone,
        workThemeId: a.workSpot?.themeId ?? null,
        prayerStatus,
        x: a.x,
        z: a.z,
      };
    }

    // Element 3.2: Truthful Arabic card text for Arrival Camp residents
    for (const c of this.campAgents.values()) {
      if (c.agentId !== agentId) continue;
      const mood = getMoodFromSatisfaction(this.lastSatisfaction);
      return {
        id: c.agentId,
        citizenId: c.citizenId,
        name: c.name,
        role: c.role,
        roleLabelAr: ROLE_LABELS_AR[c.role],
        destinationAr:
          c.mode === 'CAMPING'
            ? CAMP_CITIZEN_CARD_TEXT_AR
            : THEME_GOING_TEXT.house,
        moodAr: mood.moodAr,
        moodTone: mood.moodTone,
        workThemeId: null,
        x: c.x,
        z: c.z,
      };
    }
    return null;
  }

  private facePoint(agent: LivingAgent, target: AnchorPoint | null): void {
    if (!target) return;
    const dx = target.x - agent.x;
    const dz = target.z - agent.z;
    if (dx * dx + dz * dz > 0.0001) {
      agent.group.rotation.y = Math.atan2(dx, dz);
    }
  }

  public update(dt: number): void {
    let selectedFound = false;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];

      // Element 3.1: 200ms step-forward shrink into house front door -> invisible inside home
      if (a.state === 'ENTERING_HOME') {
        a.enterDoorTimer -= dt;
        const progress = THREE.MathUtils.clamp(
          1 - a.enterDoorTimer / ENTER_DOOR_DURATION,
          0,
          1
        );
        const doorAnchor =
          a.role === 'police' ? this.palaceSpot : a.homeSpot;
        const fx = doorAnchor.faceTarget.x - a.enterStartX;
        const fz = doorAnchor.faceTarget.z - a.enterStartZ;
        const flen = Math.hypot(fx, fz) || 1;
        const stepIn = 0.55 * progress;
        const curX = a.enterStartX + (fx / flen) * stepIn;
        const curZ = a.enterStartZ + (fz / flen) * stepIn;
        const groundY = this.getLandHeight(a.enterStartX, a.enterStartZ);
        a.group.position.set(curX, groundY, curZ);
        a.group.rotation.y = Math.atan2(fx, fz);
        a.group.scale.setScalar(Math.max(0.05, 1 - progress * 0.95));

        if (a.enterDoorTimer <= 0) {
          a.x = doorAnchor.doorstep.x;
          a.z = doorAnchor.doorstep.z;
          a.group.position.set(a.x, groundY, a.z);
          a.group.scale.setScalar(1);
          a.group.visible = false;
          a.state = 'AT_HOME';
          a.stateTimer = 2.4 + Math.random() * 2.0;
        }
      } else if (a.state === 'ENTERING_MOSQUE') {
        // V5 Prompt 2 Element 2: 200ms step-forward shrink into mosque front door -> invisible inside during prayer
        a.enterDoorTimer -= dt;
        const progress = THREE.MathUtils.clamp(
          1 - a.enterDoorTimer / ENTER_DOOR_DURATION,
          0,
          1
        );
        const mosqueAnchor = a.prayerMosqueSpot ?? this.palaceSpot;
        const fx = mosqueAnchor.faceTarget.x - a.enterStartX;
        const fz = mosqueAnchor.faceTarget.z - a.enterStartZ;
        const flen = Math.hypot(fx, fz) || 1;
        const stepIn = 0.55 * progress;
        const curX = a.enterStartX + (fx / flen) * stepIn;
        const curZ = a.enterStartZ + (fz / flen) * stepIn;
        const groundY = this.getLandHeight(a.enterStartX, a.enterStartZ);
        a.group.position.set(curX, groundY, curZ);
        a.group.rotation.y = Math.atan2(fx, fz);
        a.group.scale.setScalar(Math.max(0.05, 1 - progress * 0.95));

        if (a.enterDoorTimer <= 0) {
          a.x = mosqueAnchor.doorstep.x;
          a.z = mosqueAnchor.doorstep.z;
          a.group.position.set(a.x, groundY, a.z);
          a.group.scale.setScalar(1);
          a.group.visible = false;
          a.state = 'PRAYING';
          a.prayerTimer = CLOCK_CONSTANTS.REAL_SECONDS_PER_GAME_MINUTE;
        }
      } else if (a.state === 'PRAYING') {
        // V5 Prompt 2 Element 2: Inside mosque for exactly 1 game-minute (20 real seconds)
        a.prayerTimer -= dt;
        a.group.visible = false;
        if (a.prayerTimer <= 0) {
          const mosqueAnchor = a.prayerMosqueSpot ?? this.palaceSpot;
          a.x = mosqueAnchor.doorstep.x;
          a.z = mosqueAnchor.doorstep.z;
          const groundY = this.getLandHeight(a.x, a.z);
          a.group.position.set(a.x, groundY, a.z);
          a.group.scale.setScalar(1);
          a.group.visible = true;
          if (a.prayerSessionId !== null && a.citizenId !== null) {
            this.onPrayerCompleted?.(a.prayerSessionId, a.citizenId);
          }
          this.routeReturnFromPrayer(a);
        }
      } else if (a.stateTimer > 0) {
        // Stationary timed states (AT_HOME, WORKING, ON_BREAK, PLAYING pause, PATROL pause, WAITING)
        a.stateTimer -= dt;

        if (a.state === 'WORKING') {
          // Element 3.3: Field themes rotate slowly among their workSpots during the shift
          if (
            a.workSpot &&
            WALKABLE_FIELD_THEMES.has(a.workSpot.themeId) &&
            a.workSpot.workSpots.length > 1
          ) {
            a.workSpotSwitchTimer -= dt;
            const currentSpot = a.workSpot.workSpots[a.workSpotIdx] ?? a.workSpot.doorstep;
            const dSpotX = currentSpot.x - a.x;
            const dSpotZ = currentSpot.z - a.z;
            const dSpot = Math.hypot(dSpotX, dSpotZ);

            if (dSpot > 0.25) {
              const step = Math.min(dSpot, a.speed * 0.65 * dt);
              a.x += (dSpotX / dSpot) * step;
              a.z += (dSpotZ / dSpot) * step;
              a.walkPhase += dt * 7.2;
              const groundY = this.getLandHeight(a.x, a.z);
              const bob = Math.abs(Math.sin(a.walkPhase)) * 0.14;
              a.group.position.set(a.x, groundY + bob, a.z);
              a.group.rotation.y = Math.atan2(dSpotX, dSpotZ);
            } else {
              a.workPhase += dt * 5.0;
              a.bodyPivot.rotation.x = 0.22 + Math.sin(a.workPhase) * 0.18;
              if (a.workSpotSwitchTimer <= 0) {
                a.workSpotIdx = (a.workSpotIdx + 1) % a.workSpot.workSpots.length;
                a.workSpotSwitchTimer = 2.6 + Math.random() * 1.4;
              }
            }
          } else {
            // Doorstep themes face the building; fisher faces the water with casting-arm bob
            this.facePoint(a, a.activeFaceTarget);
            a.workPhase += dt * 5.0;
            if (a.role === 'fisher' && a.castingPivot) {
              // Casting-arm bob animation on the beach facing water
              a.castingPivot.rotation.x = -0.22 + Math.sin(a.workPhase * 0.85) * 0.36;
              a.bodyPivot.rotation.x = Math.sin(a.workPhase * 0.85) * 0.08;
            } else if (a.role === 'farmer') {
              a.bodyPivot.rotation.x = 0.22 + Math.sin(a.workPhase) * 0.18;
            } else if (a.role === 'miner' || a.role === 'woodcutter') {
              a.bodyPivot.rotation.x = Math.sin(a.workPhase * 1.35) * 0.26;
            } else {
              a.bodyPivot.rotation.z = Math.sin(a.workPhase * 0.9) * 0.07;
            }
          }
        } else {
          if (a.state === 'ON_BREAK') {
            this.facePoint(a, a.activeFaceTarget);
          }
          a.bodyPivot.rotation.x = a.role === 'elder' ? 0.14 : 0;
          a.bodyPivot.rotation.z = 0;
          if (a.castingPivot) {
            a.castingPivot.rotation.x = 0;
          }
        }

        if (a.stateTimer <= 0) {
          a.bodyPivot.rotation.x = a.role === 'elder' ? 0.14 : 0;
          a.bodyPivot.rotation.z = 0;
          if (a.castingPivot) {
            a.castingPivot.rotation.x = 0;
          }
          this.assignNextRoutine(a);
        }
      } else {
        // Walking along Element 2 A* street waypoints
        const wp = a.waypoints[a.waypointIdx];
        if (!wp) {
          if (!a.pathReachable) {
            a.state = 'WAITING';
            a.stateTimer = 4.0 + Math.random() * 2.5;
          } else {
            this.assignNextRoutine(a);
          }
        } else {
          const dx = wp.x - a.x;
          const dz = wp.z - a.z;
          const dist = Math.hypot(dx, dz);

          if (dist < 0.35) {
            a.x = wp.x;
            a.z = wp.z;
            const groundY = this.getLandHeight(a.x, a.z);
            a.group.position.set(a.x, groundY, a.z);
            a.waypointIdx += 1;

            if (a.waypointIdx >= a.waypoints.length) {
              if (!a.pathReachable) {
                // Element 2.5: Reached nearest free cell to isolated target -> wait cleanly
                a.state = 'WAITING';
                a.stateTimer = 4.0 + Math.random() * 2.5;
              } else if (a.state === 'TO_WORK') {
                a.state = 'WORKING';
                a.stateTimer = 5.2 + Math.random() * 3.5;
                a.workSpotSwitchTimer = 2.4 + Math.random() * 1.2;
                this.facePoint(a, a.activeFaceTarget);
              } else if (a.state === 'TO_BREAK') {
                a.state = 'ON_BREAK';
                a.stateTimer = 2.8 + Math.random() * 2.4;
                this.facePoint(a, a.activeFaceTarget);
              } else if (a.state === 'TO_PRAYER') {
                // V5 Prompt 2 Element 2: Arrived at mosque doorstep -> step into mosque door
                a.state = 'ENTERING_MOSQUE';
                a.enterDoorTimer = ENTER_DOOR_DURATION;
                a.enterStartX = a.x;
                a.enterStartZ = a.z;
              } else if (a.state === 'RETURNING_FROM_PRAYER') {
                const returnTarget = a.prayerReturnTarget;
                a.prayerMosqueSpot = null;
                a.prayerReturnTarget = null;
                if (returnTarget === 'work') {
                  a.state = 'WORKING';
                  a.stateTimer = 5.2 + Math.random() * 3.5;
                  a.workSpotSwitchTimer = 2.4 + Math.random() * 1.2;
                  this.facePoint(a, a.activeFaceTarget);
                } else if (returnTarget === 'break') {
                  a.state = 'ON_BREAK';
                  a.stateTimer = 2.8 + Math.random() * 2.4;
                  this.facePoint(a, a.activeFaceTarget);
                } else if (returnTarget === 'school') {
                  a.state = 'PLAYING';
                  a.playKind = 'school';
                  a.stateTimer = 3.0 + Math.random() * 2.0;
                  this.facePoint(a, a.activeFaceTarget);
                } else {
                  a.state = 'ENTERING_HOME';
                  a.enterDoorTimer = ENTER_DOOR_DURATION;
                  a.enterStartX = a.x;
                  a.enterStartZ = a.z;
                }
              } else if (a.state === 'TO_HOME') {
                // Element 3.1: Arrived at house doorstep -> 200ms step-forward shrink -> invisible inside
                a.state = 'ENTERING_HOME';
                a.enterDoorTimer = ENTER_DOOR_DURATION;
                a.enterStartX = a.x;
                a.enterStartZ = a.z;
              } else if (a.state === 'PLAYING') {
                a.stateTimer = 1.2 + Math.random() * 1.5;
                this.facePoint(a, a.activeFaceTarget);
              } else if (a.state === 'PATROL') {
                a.stateTimer = 1.4 + Math.random() * 1.5;
                if (a.patrolAtPalace) {
                  this.facePoint(a, this.palaceSpot.faceTarget);
                }
              } else {
                this.assignNextRoutine(a);
              }
            }
          } else {
            const step = Math.min(dist, a.speed * dt);
            a.x += (dx / dist) * step;
            a.z += (dz / dist) * step;

            // Element 5.2: Scaled walk bob & stride matching x1.6 body size (speeds unchanged)
            const strideFreq =
              a.role === 'child' ? 10.2 : a.role === 'elder' ? 5.2 : 7.4;
            a.walkPhase += dt * strideFreq;
            const groundY = this.getLandHeight(a.x, a.z);
            const bobAmp =
              a.role === 'elder' ? 0.08 : a.role === 'child' ? 0.12 : 0.17;
            const bob = Math.abs(Math.sin(a.walkPhase)) * bobAmp;
            a.group.position.set(a.x, groundY + bob, a.z);
            a.group.rotation.y = Math.atan2(dx, dz);
          }
        }
      }

      if (this.selectedAgentId !== null && a.id === this.selectedAgentId) {
        selectedFound = true;
        const groundY = this.getLandHeight(a.x, a.z);
        this.selectedRingMesh.position.set(a.x, groundY + 0.12, a.z);
        // Hide selection ring while citizen is visibly indoors (card remains open with "في بيته يستريح")
        this.selectedRingMesh.visible = a.group.visible;
      }
    }

    // Element 3.2: Update Arrival Camp residents (campfire idle + walk via street A* to granted house)
    const finishedCampIds: number[] = [];
    for (const [citId, c] of this.campAgents.entries()) {
      if (c.mode === 'CAMPING') {
        c.walkPhase += dt * 1.8;
        c.bodyPivot.rotation.z = Math.sin(c.walkPhase) * 0.035;
      } else if (c.mode === 'WALKING_TO_HOUSE') {
        const wp = c.waypoints[c.waypointIdx];
        if (!wp) {
          c.mode = 'ENTERING_NEW_HOUSE';
          c.enterDoorTimer = ENTER_DOOR_DURATION;
          c.enterStartX = c.x;
          c.enterStartZ = c.z;
        } else {
          const dx = wp.x - c.x;
          const dz = wp.z - c.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.35) {
            c.x = wp.x;
            c.z = wp.z;
            const gy = this.getLandHeight(c.x, c.z);
            c.group.position.set(c.x, gy, c.z);
            c.waypointIdx += 1;
            if (c.waypointIdx >= c.waypoints.length) {
              c.mode = 'ENTERING_NEW_HOUSE';
              c.enterDoorTimer = ENTER_DOOR_DURATION;
              c.enterStartX = c.x;
              c.enterStartZ = c.z;
            }
          } else {
            const step = Math.min(dist, c.speed * dt);
            c.x += (dx / dist) * step;
            c.z += (dz / dist) * step;
            c.walkPhase += dt * 7.4;
            const gy = this.getLandHeight(c.x, c.z);
            const bob = Math.abs(Math.sin(c.walkPhase)) * 0.16;
            c.group.position.set(c.x, gy + bob, c.z);
            c.group.rotation.y = Math.atan2(dx, dz);
          }
        }
      } else if (c.mode === 'ENTERING_NEW_HOUSE') {
        c.enterDoorTimer -= dt;
        const progress = THREE.MathUtils.clamp(
          1 - c.enterDoorTimer / ENTER_DOOR_DURATION,
          0,
          1
        );
        const fx = c.faceTarget.x - c.enterStartX;
        const fz = c.faceTarget.z - c.enterStartZ;
        const flen = Math.hypot(fx, fz) || 1;
        const stepIn = 0.55 * progress;
        const curX = c.enterStartX + (fx / flen) * stepIn;
        const curZ = c.enterStartZ + (fz / flen) * stepIn;
        const gy = this.getLandHeight(c.enterStartX, c.enterStartZ);
        c.group.position.set(curX, gy, curZ);
        c.group.rotation.y = Math.atan2(fx, fz);
        c.group.scale.setScalar(Math.max(0.05, 1 - progress * 0.95));
        if (c.enterDoorTimer <= 0) {
          finishedCampIds.push(citId);
        }
      }

      if (this.selectedAgentId !== null && c.agentId === this.selectedAgentId) {
        selectedFound = true;
        const gy = this.getLandHeight(c.x, c.z);
        this.selectedRingMesh.position.set(c.x, gy + 0.12, c.z);
        this.selectedRingMesh.visible = c.group.visible;
      }
    }

    for (let i = 0; i < finishedCampIds.length; i++) {
      const citId = finishedCampIds[i];
      const c = this.campAgents.get(citId);
      if (c) {
        this.group.remove(c.group);
        this.campAgents.delete(citId);
      }
    }

    // Advance off-screen reachable prayer attendees (only active when kingdom pop > visible agent cap)
    if (this.offscreenPrayerTimers.size > 0) {
      const doneOffscreen: Array<{ sessionId: number; citizenId: number }> = [];
      for (const [citId, entry] of this.offscreenPrayerTimers.entries()) {
        if (!this.mosqueSpots.has(entry.mosqueCubeId)) {
          this.offscreenPrayerTimers.delete(citId);
          continue;
        }
        entry.remaining -= dt;
        if (entry.remaining <= 0) {
          doneOffscreen.push({ sessionId: entry.sessionId, citizenId: citId });
          this.offscreenPrayerTimers.delete(citId);
        }
      }
      for (let i = 0; i < doneOffscreen.length; i++) {
        this.onPrayerCompleted?.(
          doneOffscreen[i].sessionId,
          doneOffscreen[i].citizenId
        );
      }
    }

    if (this.selectedAgentId !== null && !selectedFound) {
      this.selectedAgentId = null;
      this.selectedRingMesh.visible = false;
    }
  }

  public dispose(): void {
    for (const a of this.agents) {
      this.group.remove(a.group);
    }
    this.agents.length = 0;
    for (const c of this.campAgents.values()) {
      this.group.remove(c.group);
    }
    this.campAgents.clear();
    this.group.remove(this.selectedRingMesh);
    this.sharedGeos.forEach((g) => g.dispose());
    this.sharedMats.forEach((m) => m.dispose());
  }
}
