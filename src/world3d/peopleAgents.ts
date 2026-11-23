import * as THREE from 'three';
import type { CitizenInfo, CitizenRoleId } from '../components/CitizenCard';
import { THEMES } from '../game/constants';
import { findPalaceCube, makeSlotKey } from '../game/production';
import type { Cube, ThemeId } from '../game/types';
import { cellSlotToWorld, cellToWorldCenter, getTerrainHeightAt } from './worldMath';

export type { CitizenInfo, CitizenRoleId };

const MAX_VISIBLE_AGENTS = 36;

type RoutineState =
  | 'AT_HOME'
  | 'TO_WORK'
  | 'WORKING'
  | 'TO_BREAK'
  | 'ON_BREAK'
  | 'TO_HOME'
  | 'PLAYING'
  | 'PATROL';

type BreakSpotKind =
  | 'mosque'
  | 'restaurant'
  | 'cafe'
  | 'garden'
  | 'grand_market'
  | 'shop'
  | 'theater'
  | 'palace';

interface SpotInfo {
  x: number;
  z: number;
  cubeId: number;
  themeId: ThemeId;
}

interface BreakSpot {
  x: number;
  z: number;
  kind: BreakSpotKind;
}

interface Waypoint {
  x: number;
  z: number;
}

interface LivingAgent {
  id: number;
  name: string;
  isFemale: boolean;
  role: CitizenRoleId;
  group: THREE.Group;
  bodyPivot: THREE.Group;
  x: number;
  z: number;
  waypoints: Waypoint[];
  waypointIdx: number;
  speed: number;
  lateralOffset: number;
  state: RoutineState;
  stateTimer: number;
  walkPhase: number;
  workPhase: number;
  homeSpot: { x: number; z: number };
  workSpot: SpotInfo | null;
  breakKind: BreakSpotKind;
  playKind: 'houses' | 'school' | 'garden';
  patrolStep: number;
}

const MALE_NAMES = [
  'أحمد',
  'سالم',
  'يوسف',
  'طارق',
  'كريم',
  'ناصر',
  'خالد',
  'عمر',
  'زيد',
  'بدر',
  'سعيد',
  'حسن',
  'ماجد',
  'رامي',
  'نبيل',
  'وليد',
  'فارس',
  'رشيد',
  'سامي',
  'منصور',
  'جاسم',
  'عدنان',
  'هشام',
  'محمود',
];

const FEMALE_NAMES = [
  'ليلى',
  'سلمى',
  'نور',
  'مريم',
  'هند',
  'دلال',
  'آمنة',
  'زينب',
  'ريم',
  'سارة',
  'فاطمة',
  'ياسمين',
  'رقية',
  'ندى',
  'حليمة',
  'سميرة',
];

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

function themeToWorkerRole(themeId: ThemeId): CitizenRoleId | null {
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
    case 'warehouse_bldg':
    case 'clinic':
    case 'school':
    case 'theater':
      return 'manager';
    default:
      return null;
  }
}

function getWorkDestinationText(
  role: CitizenRoleId,
  themeId: ThemeId | null,
  workingNow: boolean
): string {
  const prefix = workingNow ? 'يشتغل في ' : 'رايح يشتغل في ';
  switch (themeId) {
    case 'wheat_farm':
      return `${prefix}مزرعة القمح`;
    case 'farm':
      return `${prefix}مزرعته`;
    case 'orchard':
      return `${prefix}بستان الفواكه`;
    case 'pasture':
      return `${prefix}المرعى`;
    case 'sea':
      return workingNow ? 'يصيد السمك عند البحر' : 'رايح يصيد عند البحر';
    case 'forest':
      return `${prefix}غابة الأخشاب`;
    case 'quarry':
      return `${prefix}محجر الحجر`;
    case 'iron_mine':
      return `${prefix}منجم الحديد`;
    case 'copper_mine':
      return `${prefix}منجم النحاس`;
    case 'gold_mine':
      return `${prefix}منجم الذهب`;
    case 'gem_mine':
      return `${prefix}منجم الأحجار الكريمة`;
    case 'oil_well':
      return `${prefix}بئر البترول`;
    case 'bakery':
      return `${prefix}المخبز`;
    case 'restaurant':
      return `${prefix}المطعم`;
    case 'cafe':
      return `${prefix}المقهى`;
    case 'workshop':
      return `${prefix}الورشة`;
    case 'jeweler':
      return `${prefix}محل الصياغة`;
    case 'shop':
      return `${prefix}المحل التجاري`;
    case 'grand_market':
      return `${prefix}سوق المدينة`;
    case 'trade_office':
      return `${prefix}مكتب التجارة`;
    case 'warehouse_bldg':
      return `${prefix}المخزن`;
    case 'clinic':
      return `${prefix}العيادة`;
    case 'school':
      return `${prefix}المدرسة`;
    case 'theater':
      return `${prefix}المسرح`;
    default:
      return role === 'farmer' ? `${prefix}مزرعته` : `${prefix}عمله`;
  }
}

function getBreakDestinationText(
  kind: BreakSpotKind,
  isFemale: boolean,
  arrived: boolean
): string {
  if (arrived) {
    switch (kind) {
      case 'mosque':
        return isFemale ? 'تصلي في المسجد' : 'يصلي في المسجد';
      case 'restaurant':
        return isFemale ? 'تتناول الطعام في المطعم' : 'يتناول الطعام في المطعم';
      case 'cafe':
        return isFemale ? 'تستريح في المقهى' : 'يشرب قهوة في المقهى';
      case 'garden':
        return isFemale ? 'تستريح في الحديقة' : 'يستريح في الحديقة';
      case 'grand_market':
      case 'shop':
        return isFemale ? 'تتسوق في السوق' : 'يتسوق في السوق';
      case 'theater':
        return isFemale ? 'تحضر عرضاً في المسرح' : 'يحضر عرضاً في المسرح';
      case 'palace':
        return isFemale ? 'في ساحة القصر' : 'في ساحة القصر';
    }
  }
  switch (kind) {
    case 'mosque':
      return isFemale ? 'رايحة تصلي في المسجد' : 'رايح يصلي في المسجد';
    case 'restaurant':
      return isFemale ? 'رايحة تتغدى في المطعم' : 'رايح يتغدى في المطعم';
    case 'cafe':
      return isFemale ? 'رايحة المقهى' : 'رايح يشرب قهوة في المقهى';
    case 'garden':
      return isFemale ? 'رايحة تستريح في الحديقة' : 'رايح يستريح في الحديقة';
    case 'grand_market':
    case 'shop':
      return isFemale ? 'رايحة تتسوق في السوق' : 'رايح يتسوق في السوق';
    case 'theater':
      return isFemale ? 'رايحة المسرح' : 'رايح المسرح';
    case 'palace':
      return isFemale ? 'رايحة ساحة القصر' : 'رايح ساحة القصر';
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

  // Shared geometries
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

  // World data cached on sync (zero per-frame allocations)
  private houseSpots: Array<{ x: number; z: number }> = [];
  private breakSpots: BreakSpot[] = [];
  private schoolSpots: Array<{ x: number; z: number }> = [];
  private gardenSpots: Array<{ x: number; z: number }> = [];
  private mosqueSpots: Array<{ x: number; z: number }> = [];
  private ownedCenters: Array<{ x: number; z: number }> = [];
  private palaceCenter = { x: 45, z: 45 };
  private seaCoords: Array<{ x: number; z: number }> = [];
  private ownedMinX = 35;
  private ownedMaxX = 55;
  private ownedMinZ = 35;
  private ownedMaxZ = 55;
  private lastSatisfaction = 60;
  private lastRoleSignature = '';

  constructor(blobShadowTexture: THREE.CanvasTexture) {
    // Shared character part geometries
    this.robeGeo = new THREE.CylinderGeometry(0.18, 0.28, 0.94, 7);
    this.robeGeo.translate(0, 0.47, 0);

    this.dressConeGeo = new THREE.CylinderGeometry(0.14, 0.36, 0.96, 8);
    this.dressConeGeo.translate(0, 0.48, 0);

    this.headGeo = new THREE.SphereGeometry(0.2, 8, 6);
    this.headGeo.translate(0, 1.12, 0);

    this.turbanGeo = new THREE.CylinderGeometry(0.22, 0.21, 0.14, 7);
    this.turbanGeo.translate(0, 1.26, 0);

    this.strawHatBrimGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.04, 9);
    this.strawHatBrimGeo.translate(0, 1.24, 0);

    this.strawHatTopGeo = new THREE.CylinderGeometry(0.16, 0.22, 0.14, 8);
    this.strawHatTopGeo.translate(0, 1.32, 0);

    this.helmetGeo = new THREE.SphereGeometry(0.23, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.58);
    this.helmetGeo.translate(0, 1.15, 0);

    this.apronGeo = new THREE.BoxGeometry(0.26, 0.52, 0.06);
    this.apronGeo.translate(0, 0.44, 0.22);

    this.packGeo = new THREE.BoxGeometry(0.24, 0.36, 0.16);
    this.packGeo.translate(0, 0.64, -0.22);

    this.headscarfGeo = new THREE.SphereGeometry(0.235, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.72);
    this.headscarfGeo.translate(0, 1.13, -0.02);

    this.caneGeo = new THREE.CylinderGeometry(0.028, 0.024, 0.86, 5);
    this.caneGeo.translate(0.27, 0.43, 0.16);

    this.policeCapGeo = new THREE.CylinderGeometry(0.21, 0.22, 0.12, 8);
    this.policeCapGeo.translate(0, 1.28, 0);

    this.capVisorGeo = new THREE.BoxGeometry(0.22, 0.03, 0.14);
    this.capVisorGeo.translate(0, 1.23, 0.18);

    this.basketGeo = new THREE.CylinderGeometry(0.16, 0.12, 0.24, 7);
    this.basketGeo.translate(0.26, 0.48, 0.06);

    this.collarGeo = new THREE.CylinderGeometry(0.21, 0.23, 0.1, 8);
    this.collarGeo.translate(0, 0.9, 0);

    this.shadowGeo = new THREE.PlaneGeometry(1.1, 1.1);
    this.shadowGeo.rotateX(-Math.PI / 2);

    this.hitCylinderGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.85, 6);
    this.hitCylinderGeo.translate(0, 0.92, 0);

    this.selectRingGeo = new THREE.RingGeometry(0.65, 0.9, 24);
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
      this.policeCapGeo,
      this.capVisorGeo,
      this.basketGeo,
      this.collarGeo,
      this.shadowGeo,
      this.hitCylinderGeo,
      this.selectRingGeo
    );

    // Distinct role clothing materials
    this.skinMat = new THREE.MeshStandardMaterial({ color: 0xd2a47c, roughness: 0.85 });
    this.farmerMat = new THREE.MeshStandardMaterial({ color: 0x5c7a44, roughness: 0.88 });
    this.strawMat = new THREE.MeshStandardMaterial({ color: 0xd9b866, roughness: 0.9 });
    this.fisherMat = new THREE.MeshStandardMaterial({ color: 0x2f6d94, roughness: 0.85 });
    this.minerMat = new THREE.MeshStandardMaterial({ color: 0x6b635a, roughness: 0.9 });
    this.helmetMat = new THREE.MeshStandardMaterial({ color: 0x9b948a, roughness: 0.55, metalness: 0.3 });
    this.woodcutterMat = new THREE.MeshStandardMaterial({ color: 0x7b502c, roughness: 0.9 });
    this.leatherMat = new THREE.MeshStandardMaterial({ color: 0x4b2f19, roughness: 0.86 });
    this.bakerMat = new THREE.MeshStandardMaterial({ color: 0xeee2c4, roughness: 0.88 });
    this.apronWhiteMat = new THREE.MeshStandardMaterial({ color: 0xfbf7ee, roughness: 0.85 });
    this.shopkeeperMat = new THREE.MeshStandardMaterial({ color: 0xe3cca0, roughness: 0.86 });
    this.apronAccentMat = new THREE.MeshStandardMaterial({ color: 0x9c4636, roughness: 0.84 });
    this.managerMat = new THREE.MeshStandardMaterial({ color: 0x243b55, roughness: 0.78 });
    this.goldTrimMat = new THREE.MeshStandardMaterial({ color: 0xd8ab3d, roughness: 0.4, metalness: 0.35 });

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

    this.shadowMat = new THREE.MeshBasicMaterial({
      map: blobShadowTexture,
      transparent: true,
      opacity: 0.68,
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
  ): { root: THREE.Group; bodyPivot: THREE.Group } {
    const root = new THREE.Group();
    root.userData.agentId = agentId;

    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.position.y = 0.05;
    shadow.userData.agentId = agentId;
    root.add(shadow);

    // Generous invisible raycast hit target so clicking moving citizens is reliable
    const hitMesh = new THREE.Mesh(this.hitCylinderGeo, this.hitMat);
    hitMesh.userData.agentId = agentId;
    root.add(hitMesh);

    const bodyPivot = new THREE.Group();
    bodyPivot.userData.agentId = agentId;
    root.add(bodyPivot);

    const addPart = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.userData.agentId = agentId;
      bodyPivot.add(m);
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
      case 'fisher':
        addPart(this.robeGeo, this.fisherMat);
        addPart(this.headGeo, this.skinMat);
        addPart(this.turbanGeo, this.strawMat);
        addPart(this.basketGeo, this.strawMat);
        break;
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
        bodyPivot.scale.setScalar(0.6);
        break;
      case 'elder':
        addPart(this.robeGeo, this.elderMat);
        addPart(this.headGeo, this.skinMat);
        addPart(this.turbanGeo, this.apronWhiteMat);
        addPart(this.caneGeo, this.caneMat);
        bodyPivot.rotation.x = 0.14; // gentle elder stoop
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

    return { root, bodyPivot };
  }

  private clampOwned(x: number, z: number): { x: number; z: number } {
    return {
      x: THREE.MathUtils.clamp(x, this.ownedMinX, this.ownedMaxX),
      z: THREE.MathUtils.clamp(z, this.ownedMinZ, this.ownedMaxZ),
    };
  }

  private isNearWater(x: number, z: number): boolean {
    for (let i = 0; i < this.seaCoords.length; i++) {
      const sc = this.seaCoords[i];
      if (Math.abs(x - sc.x) < 4.5 && Math.abs(z - sc.z) < 4.5) {
        return true;
      }
    }
    return false;
  }

  private pickNearestBreakSpot(fromX: number, fromZ: number, preferCalm = false): BreakSpot {
    const pool = preferCalm
      ? this.breakSpots.filter(
          (b) => b.kind === 'mosque' || b.kind === 'garden' || b.kind === 'palace'
        )
      : this.breakSpots;
    const list = pool.length > 0 ? pool : this.breakSpots;
    if (list.length === 0) {
      return { x: this.palaceCenter.x, z: this.palaceCenter.z + 3.2, kind: 'palace' };
    }

    let best = list[0];
    let bestDist = Infinity;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const d = Math.hypot(b.x - fromX, b.z - fromZ);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  private buildPathViaPalace(
    fromX: number,
    fromZ: number,
    destX: number,
    destZ: number,
    lateralOffset: number
  ): Waypoint[] {
    const dTotal = Math.hypot(destX - fromX, destZ - fromZ);
    const dFromPalace = Math.hypot(fromX - this.palaceCenter.x, fromZ - this.palaceCenter.z);
    const dToPalace = Math.hypot(destX - this.palaceCenter.x, destZ - this.palaceCenter.z);

    // Offset destination slightly so agents stand around doors/edges, not inside building centers
    const clampedDest = this.clampOwned(
      destX + lateralOffset * 0.85,
      destZ + Math.cos(lateralOffset * 2.1) * 1.4
    );

    // Route through Palace courtyard hub along dirt avenues when crossing distinct cells
    if (dTotal > 10.5 && dFromPalace > 5.5 && dToPalace > 5.5) {
      const hub = this.clampOwned(
        this.palaceCenter.x + lateralOffset * 1.6,
        this.palaceCenter.z + 3.4 + lateralOffset * 0.8
      );
      return [hub, clampedDest];
    }
    return [clampedDest];
  }

  private assignNextRoutine(agent: LivingAgent): void {
    const jitter = (Math.random() - 0.5) * 2.8;

    if (agent.role === 'police') {
      agent.state = 'PATROL';
      agent.patrolStep += 1;
      if (agent.patrolStep % 2 === 0 || this.ownedCenters.length === 0) {
        const dest = this.clampOwned(
          this.palaceCenter.x + Math.cos(agent.patrolStep * 1.3) * 4.4,
          this.palaceCenter.z + Math.sin(agent.patrolStep * 1.3) * 4.4
        );
        agent.waypoints = [dest];
      } else {
        const spot =
          this.ownedCenters[
            (agent.patrolStep * 3 + agent.id) % this.ownedCenters.length
          ];
        agent.waypoints = this.buildPathViaPalace(
          agent.x,
          agent.z,
          spot.x + jitter * 0.5,
          spot.z + jitter * 0.5,
          agent.lateralOffset
        );
      }
      agent.waypointIdx = 0;
      return;
    }

    if (agent.role === 'child') {
      agent.state = 'PLAYING';
      const roll = Math.random();
      if (this.schoolSpots.length > 0 && roll < 0.4) {
        const s = this.schoolSpots[agent.id % this.schoolSpots.length];
        agent.playKind = 'school';
        agent.waypoints = this.buildPathViaPalace(
          agent.x,
          agent.z,
          s.x + jitter,
          s.z + jitter,
          agent.lateralOffset
        );
      } else if (this.gardenSpots.length > 0 && roll < 0.7) {
        const g = this.gardenSpots[agent.id % this.gardenSpots.length];
        agent.playKind = 'garden';
        agent.waypoints = this.buildPathViaPalace(
          agent.x,
          agent.z,
          g.x + jitter,
          g.z + jitter,
          agent.lateralOffset
        );
      } else {
        agent.playKind = 'houses';
        const h =
          this.houseSpots.length > 0
            ? this.houseSpots[Math.floor(Math.random() * this.houseSpots.length)]
            : agent.homeSpot;
        agent.waypoints = [this.clampOwned(h.x + jitter * 1.3, h.z + jitter * 1.3)];
      }
      agent.waypointIdx = 0;
      return;
    }

    if (agent.role === 'elder') {
      if (agent.state === 'AT_HOME' || agent.state === 'TO_HOME') {
        const b = this.pickNearestBreakSpot(agent.x, agent.z, true);
        agent.breakKind = b.kind;
        agent.state = 'TO_BREAK';
        agent.waypoints = this.buildPathViaPalace(
          agent.x,
          agent.z,
          b.x + jitter * 0.5,
          b.z + jitter * 0.5,
          agent.lateralOffset
        );
        agent.waypointIdx = 0;
      } else {
        agent.state = 'TO_HOME';
        agent.waypoints = this.buildPathViaPalace(
          agent.x,
          agent.z,
          agent.homeSpot.x + jitter * 0.4,
          agent.homeSpot.z + jitter * 0.4,
          agent.lateralOffset
        );
        agent.waypointIdx = 0;
      }
      return;
    }

    // Workers with real staffed buildings: AT_HOME -> TO_WORK -> WORKING -> TO_BREAK -> ON_BREAK -> TO_HOME
    if (agent.workSpot) {
      if (agent.state === 'AT_HOME') {
        agent.state = 'TO_WORK';
        // Stand beside sea shore if fisher, otherwise near building edge
        const offsetX = agent.workSpot.themeId === 'sea' ? 4.8 : jitter * 0.55;
        const offsetZ = agent.workSpot.themeId === 'sea' ? 4.8 : jitter * 0.55;
        agent.waypoints = this.buildPathViaPalace(
          agent.x,
          agent.z,
          agent.workSpot.x + offsetX,
          agent.workSpot.z + offsetZ,
          agent.lateralOffset
        );
        agent.waypointIdx = 0;
        return;
      }
      if (agent.state === 'WORKING') {
        const b = this.pickNearestBreakSpot(agent.x, agent.z, false);
        agent.breakKind = b.kind;
        agent.state = 'TO_BREAK';
        agent.waypoints = this.buildPathViaPalace(
          agent.x,
          agent.z,
          b.x + jitter * 0.5,
          b.z + jitter * 0.5,
          agent.lateralOffset
        );
        agent.waypointIdx = 0;
        return;
      }
      if (agent.state === 'ON_BREAK') {
        agent.state = 'TO_HOME';
        agent.waypoints = this.buildPathViaPalace(
          agent.x,
          agent.z,
          agent.homeSpot.x + jitter * 0.4,
          agent.homeSpot.z + jitter * 0.4,
          agent.lateralOffset
        );
        agent.waypointIdx = 0;
        return;
      }
    }

    // General townsfolk (man / woman without assigned workplace)
    if (agent.state === 'AT_HOME') {
      const b = this.pickNearestBreakSpot(agent.x, agent.z, false);
      agent.breakKind = b.kind;
      agent.state = 'TO_BREAK';
      agent.waypoints = this.buildPathViaPalace(
        agent.x,
        agent.z,
        b.x + jitter * 0.6,
        b.z + jitter * 0.6,
        agent.lateralOffset
      );
      agent.waypointIdx = 0;
    } else {
      agent.state = 'TO_HOME';
      agent.waypoints = this.buildPathViaPalace(
        agent.x,
        agent.z,
        agent.homeSpot.x + jitter * 0.4,
        agent.homeSpot.z + jitter * 0.4,
        agent.lateralOffset
      );
      agent.waypointIdx = 0;
    }
  }

  public sync(
    cubes: Cube[],
    population: number,
    satisfaction: number,
    staffedSlots: Set<string>,
    seaCoords: Array<{ x: number; z: number }>
  ): void {
    this.lastSatisfaction = satisfaction;
    this.seaCoords = seaCoords;
    this.houseSpots = [];
    this.breakSpots = [];
    this.schoolSpots = [];
    this.gardenSpots = [];
    this.mosqueSpots = [];
    this.ownedCenters = [];

    const staffedWorkSlots: Array<{ role: CitizenRoleId; spot: SpotInfo; count: number }> = [];

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const c of cubes) {
      if (c.owner !== 'player') continue;
      const center = cellToWorldCenter(c.row, c.col);
      this.ownedCenters.push(center);
      if (center.x < minX) minX = center.x;
      if (center.x > maxX) maxX = center.x;
      if (center.z < minZ) minZ = center.z;
      if (center.z > maxZ) maxZ = center.z;

      const slotEntries: Array<{ slot: 0 | 1; themeId: ThemeId | null }> = [
        { slot: 0, themeId: c.themeId },
        { slot: 1, themeId: c.secondThemeId },
      ];

      for (const entry of slotEntries) {
        if (!entry.themeId) continue;
        const t = entry.themeId;
        const def = THEMES[t];
        const pos = cellSlotToWorld(c.row, c.col, def.footprint, entry.slot);

        if (t === 'house') {
          this.houseSpots.push(pos);
        } else if (t === 'mosque') {
          this.mosqueSpots.push(pos);
          this.breakSpots.push({ x: pos.x, z: pos.z, kind: 'mosque' });
        } else if (t === 'garden') {
          this.gardenSpots.push(pos);
          this.breakSpots.push({ x: pos.x, z: pos.z, kind: 'garden' });
        } else if (t === 'school') {
          this.schoolSpots.push(pos);
        } else if (
          t === 'restaurant' ||
          t === 'cafe' ||
          t === 'grand_market' ||
          t === 'shop' ||
          t === 'theater'
        ) {
          this.breakSpots.push({ x: pos.x, z: pos.z, kind: t });
        }

        // Collect real staffed workplaces (plus sea fishing spots)
        const role = themeToWorkerRole(t);
        if (role) {
          const isStaffed =
            def.workers === 0 || staffedSlots.has(makeSlotKey(c.id, entry.slot));
          if (isStaffed) {
            const workerSeats = t === 'sea' ? 1 : Math.max(1, def.workers);
            staffedWorkSlots.push({
              role,
              spot: { x: pos.x, z: pos.z, cubeId: c.id, themeId: t },
              count: workerSeats,
            });
          }
        }
      }
    }

    if (Number.isFinite(minX)) {
      this.ownedMinX = minX - 3.6;
      this.ownedMaxX = maxX + 3.6;
      this.ownedMinZ = minZ - 3.6;
      this.ownedMaxZ = maxZ + 3.6;
    }

    const palace = findPalaceCube(cubes);
    if (palace) {
      this.palaceCenter = cellToWorldCenter(palace.row, palace.col);
    }
    this.breakSpots.push({
      x: this.palaceCenter.x,
      z: this.palaceCenter.z + 3.6,
      kind: 'palace',
    });

    // Strict visible cap: min(population, 36)
    const targetCount = Math.min(MAX_VISIBLE_AGENTS, Math.max(0, Math.floor(population)));

    // Build desired role + workplace blueprint for the targetCount visible citizens
    const desiredSpecs: Array<{ role: CitizenRoleId; workSpot: SpotInfo | null }> = [];

    // 1) Internal civic police patrolling from Palace (1 at pop >= 4, 2 at pop >= 14)
    const policeCount = targetCount >= 14 ? 2 : targetCount >= 4 ? 1 : 0;
    for (let i = 0; i < policeCount && desiredSpecs.length < targetCount; i++) {
      desiredSpecs.push({ role: 'police', workSpot: null });
    }

    // 2) Assign workers to real staffed buildings
    for (const ws of staffedWorkSlots) {
      for (let i = 0; i < ws.count && desiredSpecs.length < targetCount; i++) {
        // Reserve a few slots for town families (women, children, elders) if pop >= 6
        const reserve = targetCount >= 10 ? 4 : targetCount >= 6 ? 2 : 0;
        if (desiredSpecs.length >= targetCount - reserve) break;
        desiredSpecs.push({ role: ws.role, workSpot: ws.spot });
      }
    }

    // 3) Fill remaining visible citizens with women, children, elders, and men
    const familyCycle: CitizenRoleId[] = ['woman', 'child', 'man', 'woman', 'elder', 'child'];
    let cycleIdx = 0;
    while (desiredSpecs.length < targetCount) {
      desiredSpecs.push({
        role: familyCycle[cycleIdx % familyCycle.length],
        workSpot: null,
      });
      cycleIdx += 1;
    }

    const roleSig = desiredSpecs
      .map((s) => `${s.role}:${s.workSpot ? s.workSpot.cubeId : '-'}`)
      .join('|');

    // Update existing agents' home/work bindings cleanly; rebuild mesh only when role changes
    if (roleSig !== this.lastRoleSignature || this.agents.length !== targetCount) {
      this.lastRoleSignature = roleSig;

      // Trim excess agents cleanly if population dropped
      while (this.agents.length > targetCount) {
        const removed = this.agents.pop();
        if (removed) {
          this.group.remove(removed.group);
          if (this.selectedAgentId === removed.id) {
            this.selectedAgentId = null;
            this.selectedRingMesh.visible = false;
          }
        }
      }

      // Update existing agents or spawn new ones
      for (let i = 0; i < targetCount; i++) {
        const spec = desiredSpecs[i];
        const home =
          this.houseSpots.length > 0
            ? this.houseSpots[i % this.houseSpots.length]
            : this.palaceCenter;

        const existing = this.agents[i];
        if (existing) {
          existing.homeSpot = home;
          const workChanged =
            existing.workSpot?.cubeId !== spec.workSpot?.cubeId ||
            existing.workSpot?.themeId !== spec.workSpot?.themeId;
          existing.workSpot = spec.workSpot;

          if (existing.role !== spec.role) {
            // Replace mesh in-place keeping stable agent id & position
            this.group.remove(existing.group);
            existing.role = spec.role;
            existing.isFemale =
              spec.role === 'woman' || (spec.role === 'child' && existing.id % 2 === 1);
            existing.name = existing.isFemale
              ? FEMALE_NAMES[existing.id % FEMALE_NAMES.length]
              : MALE_NAMES[existing.id % MALE_NAMES.length];
            const baseSpeed = getBaseSpeedForRole(spec.role);
            const speedVar = 0.85 + deterministicUnit(existing.id * 7 + 3) * 0.3;
            existing.speed = baseSpeed * speedVar;

            const built = this.createAgentMesh(existing.id, spec.role, existing.id);
            const y = getTerrainHeightAt(existing.x, existing.z, this.seaCoords);
            built.root.position.set(existing.x, y, existing.z);
            this.group.add(built.root);
            existing.group = built.root;
            existing.bodyPivot = built.bodyPivot;
            existing.state = 'AT_HOME';
            existing.stateTimer = 0.2;
            this.assignNextRoutine(existing);
          } else if (workChanged && existing.workSpot) {
            existing.state = 'AT_HOME';
            existing.stateTimer = 0.1;
            this.assignNextRoutine(existing);
          }
        } else {
          const id = this.nextAgentId++;
          const isFemale =
            spec.role === 'woman' || (spec.role === 'child' && id % 2 === 1);
          const name = isFemale
            ? FEMALE_NAMES[id % FEMALE_NAMES.length]
            : MALE_NAMES[id % MALE_NAMES.length];
          const baseSpeed = getBaseSpeedForRole(spec.role);
          const speedVar = 0.85 + deterministicUnit(id * 7 + 3) * 0.3; // +-15%
          const lateralOffset = (deterministicUnit(id * 13 + 5) - 0.5) * 3.2;

          const startPos = this.clampOwned(
            (spec.role === 'police' ? this.palaceCenter.x : home.x) +
              (deterministicUnit(id * 3) - 0.5) * 4.0,
            (spec.role === 'police' ? this.palaceCenter.z : home.z) +
              (deterministicUnit(id * 5) - 0.5) * 4.0
          );

          const built = this.createAgentMesh(id, spec.role, id);
          const startY = getTerrainHeightAt(startPos.x, startPos.z, this.seaCoords);
          built.root.position.set(startPos.x, startY, startPos.z);
          this.group.add(built.root);

          const agent: LivingAgent = {
            id,
            name,
            isFemale,
            role: spec.role,
            group: built.root,
            bodyPivot: built.bodyPivot,
            x: startPos.x,
            z: startPos.z,
            waypoints: [],
            waypointIdx: 0,
            speed: baseSpeed * speedVar,
            lateralOffset,
            state: 'AT_HOME',
            stateTimer: deterministicUnit(id * 11) * 1.4,
            walkPhase: id * 1.1,
            workPhase: id * 0.7,
            homeSpot: home,
            workSpot: spec.workSpot,
            breakKind: 'palace',
            playKind: 'houses',
            patrolStep: id,
          };
          this.assignNextRoutine(agent);
          this.agents.push(agent);
        }
      }
    }
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
    return false;
  }

  public getAgentInfo(agentId: number): CitizenInfo | null {
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (a.id !== agentId) continue;

      let destinationAr = '';
      switch (a.state) {
        case 'TO_WORK':
          destinationAr = getWorkDestinationText(a.role, a.workSpot?.themeId ?? null, false);
          break;
        case 'WORKING':
          destinationAr = getWorkDestinationText(a.role, a.workSpot?.themeId ?? null, true);
          break;
        case 'TO_BREAK':
          destinationAr = getBreakDestinationText(a.breakKind, a.isFemale, false);
          break;
        case 'ON_BREAK':
          destinationAr = getBreakDestinationText(a.breakKind, a.isFemale, true);
          break;
        case 'TO_HOME':
          destinationAr = a.isFemale ? 'راجعة بيتها' : 'راجع بيته';
          break;
        case 'AT_HOME':
          destinationAr = a.isFemale ? 'تستريح في بيتها' : 'يستريح في بيته';
          break;
        case 'PLAYING':
          destinationAr =
            a.playKind === 'school'
              ? 'يلعب ويتعلم عند المدرسة'
              : a.playKind === 'garden'
                ? 'يلعب في الحديقة'
                : 'يلعب قرب البيوت';
          break;
        case 'PATROL':
          destinationAr =
            a.patrolStep % 2 === 0
              ? 'في جولة حراسة بساحة القصر'
              : 'يتفقد أحياء المملكة بسلام';
          break;
      }

      const mood = getMoodFromSatisfaction(this.lastSatisfaction);
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        roleLabelAr: ROLE_LABELS_AR[a.role],
        destinationAr,
        moodAr: mood.moodAr,
        moodTone: mood.moodTone,
        workThemeId: a.workSpot?.themeId ?? null,
        x: a.x,
        z: a.z,
      };
    }
    return null;
  }

  public update(dt: number): void {
    let selectedFound = false;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];

      // Stationary timed states (AT_HOME, WORKING, ON_BREAK)
      if (a.stateTimer > 0) {
        a.stateTimer -= dt;

        // Role-specific working animation at the agent's real building
        if (a.state === 'WORKING') {
          a.workPhase += dt * 5.2;
          if (a.role === 'farmer') {
            a.bodyPivot.rotation.x = 0.22 + Math.sin(a.workPhase) * 0.18;
          } else if (a.role === 'miner' || a.role === 'woodcutter') {
            a.bodyPivot.rotation.x = Math.sin(a.workPhase * 1.4) * 0.28;
          } else {
            a.bodyPivot.rotation.z = Math.sin(a.workPhase * 0.9) * 0.08;
          }
        } else {
          a.bodyPivot.rotation.x = a.role === 'elder' ? 0.14 : 0;
          a.bodyPivot.rotation.z = 0;
        }

        if (a.stateTimer <= 0) {
          a.bodyPivot.rotation.x = a.role === 'elder' ? 0.14 : 0;
          a.bodyPivot.rotation.z = 0;
          this.assignNextRoutine(a);
        }
      } else {
        // Walking along waypoints
        const wp = a.waypoints[a.waypointIdx];
        if (!wp) {
          this.assignNextRoutine(a);
        } else {
          const dx = wp.x - a.x;
          const dz = wp.z - a.z;
          const dist = Math.hypot(dx, dz);

          if (dist < 0.5) {
            a.waypointIdx += 1;
            if (a.waypointIdx >= a.waypoints.length) {
              // Arrived at destination -> enter dwell / work / break / home state
              if (a.state === 'TO_WORK') {
                a.state = 'WORKING';
                a.stateTimer = 4.5 + Math.random() * 3.5;
              } else if (a.state === 'TO_BREAK') {
                a.state = 'ON_BREAK';
                a.stateTimer = 2.6 + Math.random() * 2.4;
              } else if (a.state === 'TO_HOME') {
                a.state = 'AT_HOME';
                a.stateTimer = 1.8 + Math.random() * 2.0;
              } else if (a.state === 'PLAYING') {
                a.stateTimer = 0.9 + Math.random() * 1.4;
              } else if (a.state === 'PATROL') {
                a.stateTimer = 1.0 + Math.random() * 1.2;
              } else {
                this.assignNextRoutine(a);
              }
            }
          } else {
            const step = Math.min(dist, a.speed * dt);
            const nextX = a.x + (dx / dist) * step;
            const nextZ = a.z + (dz / dist) * step;

            if (this.isNearWater(nextX, nextZ)) {
              // Gently skirt around water bodies
              a.waypointIdx += 1;
              if (a.waypointIdx >= a.waypoints.length) {
                if (a.state === 'TO_WORK') {
                  a.state = 'WORKING';
                  a.stateTimer = 4.5 + Math.random() * 3.5;
                } else {
                  this.assignNextRoutine(a);
                }
              }
            } else {
              a.x = nextX;
              a.z = nextZ;
              a.walkPhase += dt * (a.role === 'child' ? 11.5 : a.role === 'elder' ? 6.0 : 8.5);
              const groundY = getTerrainHeightAt(a.x, a.z, this.seaCoords);
              const bob = Math.abs(Math.sin(a.walkPhase)) * (a.role === 'elder' ? 0.05 : 0.11);
              a.group.position.set(a.x, groundY + bob, a.z);
              a.group.rotation.y = Math.atan2(dx, dz);
            }
          }
        }
      }

      if (this.selectedAgentId !== null && a.id === this.selectedAgentId) {
        selectedFound = true;
        const groundY = getTerrainHeightAt(a.x, a.z, this.seaCoords);
        this.selectedRingMesh.position.set(a.x, groundY + 0.12, a.z);
        this.selectedRingMesh.visible = true;
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
    this.group.remove(this.selectedRingMesh);
    this.sharedGeos.forEach((g) => g.dispose());
    this.sharedMats.forEach((m) => m.dispose());
  }
}
