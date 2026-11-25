import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { THEMES } from '../game/constants';
import {
  canPlaceThemeOnCube,
  getCubePurchasePrice,
  isPurchasableNeutralCube,
  makeSlotKey,
} from '../game/production';
import type {
  ArrivalCamp,
  Citizen,
  Cube,
  Province,
  SlotIndex,
  ThemeId,
} from '../game/types';
import {
  computeProvinceDressingPlan,
  computeProvinceRoads,
  getCenterFlagWorldOffset,
  type ProvinceRoadSpec,
} from './provinceVisuals';
import {
  applyUnstaffedVisual,
  type BuildingLibrary,
  type BuildingVisualHandle,
  createBuildingLibrary,
  createBuildingVisual,
  disposeBuildingVisual,
  updateFarmCropGrowth,
  updateProgressRing,
} from './buildings';
import { type CitizenInfo, PeopleAgentsManager } from './peopleAgents';
import {
  createAwningTexture,
  createBlobShadowTexture,
  createFootprintDecalTexture,
  createPriceTagTexture,
  createSandBumpTexture,
  createSandTexture,
  createSkyTexture,
  createSoftCircleTexture,
  createUnstaffedBadgeTexture,
  createWaterWaveTexture,
} from './textures';
import { WildernessProps } from './wilderness';
import {
  buildRoundedLoopShape,
  CELL_SIZE,
  cellSlotToWorld,
  cellToWorldCenter,
  extractUnionLoops,
  getOwnedBlendAt,
  getOwnedTerritoryBounds,
  getTerrainHeightAt,
  offsetPolygonLoop,
  PLAYABLE_HALF,
  sampleRoundedLoopPoints3D,
  TERRAIN_SEGMENTS,
  TERRAIN_SIZE,
  WATER_SURFACE_Y,
  worldToCell,
} from './worldMath';

export interface WorldSyncPayload {
  cubes: Cube[];
  level: 1 | 2;
  population: number;
  satisfaction: number;
  selectedCubeId: number | null;
  selectedCitizenId: number | null;
  followCitizenId: number | null;
  activeBuildTheme: ThemeId | null;
  staffedSlots: Set<string>;
  // Prompt 7: Provinces, Arrival Camp & Visual Merge
  provinces?: Province[];
  camp?: ArrivalCamp;
  citizens?: Citizen[];
  lastJoinedVillageCubeId?: number | null;
  lastJoinedVillageSeq?: number;
  lastDefectedCubeId?: number | null;
  lastDefectedSeq?: number;
}

interface ProvinceFlagAnim {
  root: THREE.Group;
  pennantMesh: THREE.Mesh;
  pennantMat: THREE.MeshStandardMaterial;
  targetColor: THREE.Color;
  startColor: THREE.Color | null;
  colorLerpAge: number;
  baseY: number;
  phase: number;
  cubeId: number;
  provinceId: string;
}

interface HouseBannerAnim {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  targetColor: THREE.Color;
  startColor: THREE.Color | null;
  colorLerpAge: number;
  phase: number;
  cubeId: number;
}

interface ActiveProvinceRoad {
  provinceId: string;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  totalIndices: number;
  drawAge: number;
  drawDuration: number;
}

interface FadingObject {
  root: THREE.Object3D;
  materials: THREE.Material[];
  age: number;
  duration: number;
  lowerY: boolean;
  startY: number;
}

interface DustParticle {
  sprite: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  baseScale: number;
}

interface SeaSparkle {
  sprite: THREE.Sprite;
  baseX: number;
  baseZ: number;
  phase: number;
  speed: number;
}

const HORIZON_COLOR = 0xe8d9b0;

// Fixed RTS isometric angles: azimuth 45 deg, elevation 32 deg
const ISO_ELEVATION = THREE.MathUtils.degToRad(32);
const ISO_AZIMUTH = THREE.MathUtils.degToRad(45);
const CAM_DISTANCE = 155;
const CAM_DIR = new THREE.Vector3(
  Math.cos(ISO_ELEVATION) * Math.sin(ISO_AZIMUTH),
  Math.sin(ISO_ELEVATION),
  Math.cos(ISO_ELEVATION) * Math.cos(ISO_AZIMUTH)
).normalize();

// Screen-plane pan axes for fixed azimuth 45 deg
const CAM_RIGHT = new THREE.Vector3(1, 0, -1).normalize();
const CAM_FORWARD = new THREE.Vector3(-1, 0, -1).normalize();

const MIN_FRUSTUM_HEIGHT = 48; // ~6 cells across
const MAX_FRUSTUM_HEIGHT = 136; // full island view
const PAN_LIMIT = PLAYABLE_HALF + 8;

function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

interface PurchasableTagItem {
  sprite: THREE.Sprite;
  baseY: number;
  phase: number;
}

// Element 5.2: Cached golden pennant texture for built private-sector buildings
function createPrivatePennantTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 64, 64);
    // Pole
    ctx.fillStyle = '#6E4C1B';
    ctx.fillRect(14, 10, 4, 48);
    // Finial orb
    ctx.beginPath();
    ctx.arc(16, 9, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#F6D377';
    ctx.fill();
    // Golden swallowtail pennant
    ctx.beginPath();
    ctx.moveTo(18, 13);
    ctx.lineTo(54, 21);
    ctx.lineTo(44, 28);
    ctx.lineTo(54, 35);
    ctx.lineTo(18, 41);
    ctx.closePath();
    ctx.fillStyle = '#E8B844';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#9E6E19';
    ctx.stroke();
    // Inner teal diamond emblem
    ctx.beginPath();
    ctx.moveTo(31, 22);
    ctx.lineTo(37, 27);
    ctx.lineTo(31, 32);
    ctx.lineTo(25, 27);
    ctx.closePath();
    ctx.fillStyle = '#14524A';
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createBankPennantTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 64, 64);
    // Dark silver pole
    ctx.fillStyle = '#4A5568';
    ctx.fillRect(14, 10, 4, 48);
    // Silver orb
    ctx.beginPath();
    ctx.arc(16, 9, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#E2E8F0';
    ctx.fill();
    // Silver swallowtail pennant
    ctx.beginPath();
    ctx.moveTo(18, 13);
    ctx.lineTo(54, 21);
    ctx.lineTo(44, 28);
    ctx.lineTo(54, 35);
    ctx.lineTo(18, 41);
    ctx.closePath();
    ctx.fillStyle = '#CBD5E1';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#64748B';
    ctx.stroke();
    // Inner dark teal diamond emblem
    ctx.beginPath();
    ctx.moveTo(31, 22);
    ctx.lineTo(37, 27);
    ctx.lineTo(31, 32);
    ctx.lineTo(25, 27);
    ctx.closePath();
    ctx.fillStyle = '#14524A';
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class WorldEngine {
  private readonly container: HTMLElement;
  private readonly onCubeClick: (cubeId: number) => void;
  private readonly onCitizenClick?: (agentId: number) => void;
  private readonly isSoftwareGl: boolean;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly envTexture: THREE.Texture;

  private readonly sandTexture: THREE.CanvasTexture;
  private readonly sandBumpTexture: THREE.CanvasTexture;
  private readonly waterTexture: THREE.CanvasTexture;
  private readonly skyTexture: THREE.CanvasTexture;
  private readonly awningTexture: THREE.CanvasTexture;
  private readonly dustTexture: THREE.CanvasTexture;
  private readonly unstaffedTexture: THREE.CanvasTexture;
  private readonly footprintTexture: THREE.CanvasTexture;
  private readonly blobShadowTexture: THREE.CanvasTexture;
  private readonly privatePennantTexture: THREE.CanvasTexture;
  private readonly bankPennantTexture: THREE.CanvasTexture;

  private readonly buildingLib: BuildingLibrary;
  private readonly wilderness: WildernessProps;
  private readonly peopleAgents: PeopleAgentsManager;

  private readonly terrainGeometry: THREE.PlaneGeometry;
  private readonly terrainMaterial: THREE.MeshStandardMaterial;
  private readonly terrainMesh: THREE.Mesh;

  private readonly boundaryGroup = new THREE.Group();
  private readonly provinceRoadsGroup = new THREE.Group();
  private readonly fadingFxGroup = new THREE.Group();
  private readonly waterGroup = new THREE.Group();
  private readonly buildingsGroup = new THREE.Group();
  private readonly provinceDressGroup = new THREE.Group();
  private readonly campGroup = new THREE.Group();
  private readonly purchasableGroup = new THREE.Group();
  private readonly privatePennantGroup = new THREE.Group();
  private readonly bankPennantGroup = new THREE.Group();
  private readonly fxGroup = new THREE.Group();

  private readonly waterMaterial: THREE.MeshStandardMaterial;
  private readonly foamMaterial: THREE.MeshBasicMaterial;
  private readonly purchasableShimmerGeo: THREE.PlaneGeometry;
  private readonly purchasableShimmerMat: THREE.MeshBasicMaterial;
  private readonly priceTagCache = new Map<number, THREE.CanvasTexture>();
  private purchasableSprites: PurchasableTagItem[] = [];
  private privatePennants: PurchasableTagItem[] = [];
  private bankPennants: PurchasableTagItem[] = [];
  private provinceFlags: ProvinceFlagAnim[] = [];
  private houseBanners: HouseBannerAnim[] = [];
  private activeProvinceRoads = new Map<string, ActiveProvinceRoad>();
  private fadingObjects: FadingObject[] = [];
  private readonly provinceHighlightRingMesh: THREE.Mesh;
  private readonly provinceHighlightRingMat: THREE.MeshBasicMaterial;
  private provinceHighlightCubeId: number | null = null;
  private provinceHighlightTimer = 0;

  private readonly hoverDecalMesh: THREE.Mesh;
  private readonly hoverDecalMat: THREE.MeshBasicMaterial;
  private readonly selectionRingMesh: THREE.Mesh;
  private readonly selectionRingMat: THREE.MeshBasicMaterial;

  private readonly buildingsMap = new Map<string, BuildingVisualHandle>();
  private readonly dustParticles: DustParticle[] = [];
  private seaSparkles: SeaSparkle[] = [];

  private latestState: WorldSyncPayload | null = null;
  private seaCoords: Array<{ x: number; z: number }> = [];
  private lastSeaSignature = '';
  private lastOwnedSignature = '';
  private lastVillageSignature = '';
  private lastPrivateSignature = '';
  private lastBankSignature = '';
  private lastProvinceSignature = '';
  private lastRoadSignature = '';
  private lastCampSignature = '';
  private campFlameMesh: THREE.Mesh | null = null;
  private campGlowLight: THREE.PointLight | null = null;
  private lastJoinedSeqSeen = 0;
  private lastDefectedSeqSeen = 0;
  private prevOwnedCubeIds = new Set<number>();
  private initialSyncDone = false;

  // Camera pan/zoom state (damped)
  private currentTarget = new THREE.Vector3(45, 0, 45);
  private desiredTarget = new THREE.Vector3(45, 0, 45);
  private currentFrustumHeight = 64;
  private desiredFrustumHeight = 64;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private followAgentId: number | null = null;
  private readonly scratchFollowPos = new THREE.Vector3();

  // Input / interaction state
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly scratchHit = new THREE.Vector3();
  private hoveredCubeId: number | null = null;
  private lastHoverRaycastTime = 0;

  private isDragging = false;
  private dragMoved = false;
  private dragButton = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private activePointers = new Map<number, { x: number; y: number }>();
  private pinchStartDist = 0;
  private pinchStartFrustum = 64;
  private readonly pressedKeys = new Set<string>();

  private frameId = 0;
  private lastFrameTime = performance.now();
  private elapsedTime = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    initialPayload: WorldSyncPayload,
    onCubeClick: (cubeId: number) => void,
    onCitizenClick?: (agentId: number) => void
  ) {
    this.container = container;
    this.onCubeClick = onCubeClick;
    this.onCitizenClick = onCitizenClick;
    this.isSoftwareGl = detectSoftwareWebGL();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    this.container.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.skyTexture = createSkyTexture();
    this.scene.background = this.skyTexture;
    this.scene.fog = new THREE.Fog(HORIZON_COLOR, 148, 295);

    // Procedural Studio Environment Map for crisp PBR reflections
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTexture;
    pmremGenerator.dispose();

    // Fixed Orthographic Isometric Camera
    this.camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 1, 600);

    // Element 6.1: Warm golden-hour DirectionalLight at lower Crusader angle + sky/ground HemisphereLight
    const hemiLight = new THREE.HemisphereLight(0xcfe8ef, 0xcaa96a, 0.75);
    this.scene.add(hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffd9a0, 2.3);
    this.sunLight.position.set(70, 78, 40);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 15;
    this.sunLight.shadow.camera.far = 260;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Procedural Canvas Textures
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.sandTexture = createSandTexture(maxAniso);
    this.sandBumpTexture = createSandBumpTexture(maxAniso);
    this.waterTexture = createWaterWaveTexture(maxAniso);
    this.awningTexture = createAwningTexture(maxAniso);
    this.dustTexture = createSoftCircleTexture();
    this.unstaffedTexture = createUnstaffedBadgeTexture();
    this.footprintTexture = createFootprintDecalTexture();
    this.blobShadowTexture = createBlobShadowTexture();
    this.privatePennantTexture = createPrivatePennantTexture();
    this.bankPennantTexture = createBankPennantTexture();

    this.buildingLib = createBuildingLibrary(
      this.awningTexture,
      this.unstaffedTexture
    );
    this.peopleAgents = new PeopleAgentsManager(this.blobShadowTexture);

    // Continuous smooth desert terrain mesh
    this.terrainGeometry = new THREE.PlaneGeometry(
      TERRAIN_SIZE,
      TERRAIN_SIZE,
      TERRAIN_SEGMENTS,
      TERRAIN_SEGMENTS
    );
    this.terrainGeometry.rotateX(-Math.PI / 2);
    const vertCount = this.terrainGeometry.attributes.position.count;
    this.terrainGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3)
    );

    this.terrainMaterial = new THREE.MeshStandardMaterial({
      map: this.sandTexture,
      bumpMap: this.sandBumpTexture,
      bumpScale: 0.25,
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.0,
    });
    this.terrainMesh = new THREE.Mesh(this.terrainGeometry, this.terrainMaterial);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = false;
    this.scene.add(this.terrainMesh);

    // Water materials (shared across merged lake meshes)
    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x2e86ab,
      map: this.waterTexture,
      transparent: true,
      opacity: 0.9,
      roughness: 0.15,
      metalness: 0.04,
    });
    this.foamMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    // Organic feathered placement hover decal (never a square border)
    const decalGeo = new THREE.PlaneGeometry(10.5, 10.5);
    decalGeo.rotateX(-Math.PI / 2);
    this.hoverDecalMat = new THREE.MeshBasicMaterial({
      map: this.footprintTexture,
      color: 0xfff0be,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.hoverDecalMesh = new THREE.Mesh(decalGeo, this.hoverDecalMat);
    this.hoverDecalMesh.visible = false;
    this.hoverDecalMesh.renderOrder = 10;

    // Ground selection ring (soft golden circle, never a box outline)
    const selGeo = new THREE.RingGeometry(4.45, 5.05, 48);
    selGeo.rotateX(-Math.PI / 2);
    this.selectionRingMat = new THREE.MeshBasicMaterial({
      color: 0xe6b84b,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.selectionRingMesh = new THREE.Mesh(selGeo, this.selectionRingMat);
    this.selectionRingMesh.visible = false;
    this.selectionRingMesh.renderOrder = 12;

    // Element 3: Shared golden shimmer geometry & material for purchasable adjacent land
    this.purchasableShimmerGeo = new THREE.PlaneGeometry(9.6, 9.6);
    this.purchasableShimmerGeo.rotateX(-Math.PI / 2);
    this.purchasableShimmerMat = new THREE.MeshBasicMaterial({
      map: this.footprintTexture,
      color: 0xf4c859,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    // Province center highlight ring (3s golden pulse when clicked from Province Panel)
    const provHlGeo = new THREE.RingGeometry(2.6, 3.35, 36);
    provHlGeo.rotateX(-Math.PI / 2);
    this.provinceHighlightRingMat = new THREE.MeshBasicMaterial({
      color: 0xf6cf65,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.provinceHighlightRingMesh = new THREE.Mesh(
      provHlGeo,
      this.provinceHighlightRingMat
    );
    this.provinceHighlightRingMesh.visible = false;
    this.provinceHighlightRingMesh.renderOrder = 13;

    this.wilderness = new WildernessProps();
    this.scene.add(
      this.wilderness.group,
      this.waterGroup,
      this.provinceRoadsGroup,
      this.fadingFxGroup,
      this.boundaryGroup,
      this.purchasableGroup,
      this.buildingsGroup,
      this.provinceDressGroup,
      this.campGroup,
      this.privatePennantGroup,
      this.bankPennantGroup,
      this.peopleAgents.group,
      this.fxGroup,
      this.hoverDecalMesh,
      this.selectionRingMesh,
      this.provinceHighlightRingMesh
    );

    // Frame camera on owned territory right on load
    this.frameOwnedTerritory(initialPayload.cubes, true);
    this.syncState(initialPayload);
    this.initialSyncDone = true;

    this.updateSize();
    this.updateCameraTransform();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.resizeObserver = new ResizeObserver(() => this.updateSize());
    this.resizeObserver.observe(this.container);

    this.bindEvents();
    this.startLoop();
  }

  public frameOwnedTerritory(cubes: Cube[], immediate = false): void {
    this.followAgentId = null;
    const bounds = getOwnedTerritoryBounds(cubes);
    this.desiredTarget.set(bounds.centerX, 0, bounds.centerZ);
    const desiredFrustum = THREE.MathUtils.clamp(
      bounds.span * 1.95,
      MIN_FRUSTUM_HEIGHT,
      92
    );
    this.desiredFrustumHeight = desiredFrustum;
    if (immediate) {
      this.currentTarget.copy(this.desiredTarget);
      this.currentFrustumHeight = desiredFrustum;
    }
    this.refitSunShadowCamera(cubes);
  }

  // Element 6.2: Refit sun orthographic shadow frustum tightly around owned territory + 12u margin
  private refitSunShadowCamera(cubes: Cube[]): void {
    const bounds = getOwnedTerritoryBounds(cubes);
    const frustumWidth = bounds.span + 24; // +12 units margin on every side
    const half = frustumWidth / 2;

    this.sunLight.target.position.set(bounds.centerX, 0, bounds.centerZ);
    this.sunLight.position.set(bounds.centerX + 70, 78, bounds.centerZ + 40);
    this.sunLight.target.updateMatrixWorld();

    const shadowCam = this.sunLight.shadow.camera;
    shadowCam.left = -half;
    shadowCam.right = half;
    shadowCam.top = half;
    shadowCam.bottom = -half;
    shadowCam.near = 15;
    shadowCam.far = 260;
    shadowCam.updateProjectionMatrix();

    const desiredMapSize = frustumWidth < 70 ? 4096 : 2048;
    if (this.sunLight.shadow.mapSize.width !== desiredMapSize) {
      this.sunLight.shadow.mapSize.set(desiredMapSize, desiredMapSize);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
      this.sunLight.shadow.needsUpdate = true;
    }
  }

  public focusOnCube(cubeId: number): void {
    const cube = this.latestState?.cubes[cubeId];
    if (!cube) return;
    this.followAgentId = null;
    const pos = cellToWorldCenter(cube.row, cube.col);
    this.desiredTarget.set(
      THREE.MathUtils.clamp(pos.x, -PAN_LIMIT, PAN_LIMIT),
      0,
      THREE.MathUtils.clamp(pos.z, -PAN_LIMIT, PAN_LIMIT)
    );
  }

  public highlightProvinceCenter(cubeId: number): void {
    this.focusOnCube(cubeId);
    const cube = this.latestState?.cubes[cubeId];
    if (!cube) return;
    this.provinceHighlightCubeId = cubeId;
    this.provinceHighlightTimer = 3.0;
    const pos = cellToWorldCenter(cube.row, cube.col);
    const offset = getCenterFlagWorldOffset(cube);
    const groundY = getTerrainHeightAt(
      pos.x + offset.dx,
      pos.z + offset.dz,
      this.seaCoords
    );
    this.provinceHighlightRingMesh.position.set(
      pos.x + offset.dx,
      groundY + 0.2,
      pos.z + offset.dz
    );
    this.provinceHighlightRingMesh.visible = true;
  }

  public getCitizenInfo(agentId: number): CitizenInfo | null {
    return this.peopleAgents.getAgentInfo(agentId);
  }

  public zoomBy(factor: number): void {
    this.desiredFrustumHeight = THREE.MathUtils.clamp(
      this.desiredFrustumHeight * factor,
      MIN_FRUSTUM_HEIGHT,
      MAX_FRUSTUM_HEIGHT
    );
  }

  public syncState(payload: WorldSyncPayload): void {
    this.latestState = payload;

    const seaCells: Cube[] = [];
    const ownedCells: Cube[] = [];
    const villageIds: number[] = [];
    const seaSet = new Set<string>();
    const ownedSet = new Set<string>();

    for (const c of payload.cubes) {
      if (c.isVillage) {
        villageIds.push(c.id);
      }
      if (c.owner === 'player') {
        ownedCells.push(c);
        ownedSet.add(`${c.row},${c.col}`);
        if (c.themeId === 'sea') {
          seaCells.push(c);
          seaSet.add(`${c.row},${c.col}`);
        }
      }
    }

    const seaSignature = seaCells.map((c) => c.id).join(',');
    const ownedSignature = ownedCells.map((c) => c.id).join(',');
    const villageSignature = villageIds.join(',');
    const seaChanged = seaSignature !== this.lastSeaSignature;
    const ownedChanged = ownedSignature !== this.lastOwnedSignature;
    const villageChanged = villageSignature !== this.lastVillageSignature;

    if (seaChanged || ownedChanged) {
      this.seaCoords = seaCells.map((c) => cellToWorldCenter(c.row, c.col));
      const ownedCoords = ownedCells.map((c) => cellToWorldCenter(c.row, c.col));

      this.rebuildTerrainVerticesAndColors(this.seaCoords, ownedCoords);
      this.wilderness.sync(payload.cubes, this.seaCoords);

      if (seaChanged) {
        this.rebuildMergedSeas(seaSet);
        this.lastSeaSignature = seaSignature;
      }
      if (ownedChanged || seaChanged) {
        this.rebuildOwnedBoundaryRibbon(ownedSet);
        this.lastOwnedSignature = ownedSignature;
      }
    }

    // Element 3.2 & 6.2: Rebuild purchasable markers & refit sun shadow camera on owned territory change
    if (ownedChanged || villageChanged) {
      this.rebuildPurchasableMarkers(payload.cubes);
      this.lastVillageSignature = villageSignature;
    }
    if (ownedChanged) {
      this.refitSunShadowCamera(payload.cubes);
    }

    // Element 5.2: Golden pennant over built private businesses
    const privateSigParts: string[] = [];
    for (const c of payload.cubes) {
      if (
        c.owner === 'player' &&
        typeof c.privateOwnerId === 'number' &&
        c.themeId !== null
      ) {
        privateSigParts.push(`${c.id}:${c.privateOwnerId}:${c.themeId}`);
      }
    }
    const privateSignature = privateSigParts.join(',');
    if (privateSignature !== this.lastPrivateSignature || seaChanged) {
      this.rebuildPrivatePennants(payload.cubes);
      this.lastPrivateSignature = privateSignature;
    }

    const bankSigParts: string[] = [];
    for (const c of payload.cubes) {
      if (c.owner === 'bank') {
        bankSigParts.push(`${c.id}`);
      }
    }
    const bankSignature = bankSigParts.join(',');
    if (bankSignature !== this.lastBankSignature || seaChanged) {
      this.rebuildBankPennants(payload.cubes);
      this.lastBankSignature = bankSignature;
    }

    this.syncBuildings(payload);
    this.syncProvinceVisuals(payload);
    this.syncArrivalCampVisuals(payload);
    this.peopleAgents.sync(
      payload.cubes,
      payload.population,
      payload.satisfaction,
      payload.staffedSlots,
      this.seaCoords,
      payload.camp,
      payload.citizens
    );
    this.peopleAgents.setSelectedAgent(payload.selectedCitizenId);
    this.followAgentId = payload.followCitizenId;

    this.updateSelectionRing();
    this.updateHoverDecal();
  }

  private syncArrivalCampVisuals(payload: WorldSyncPayload): void {
    const camp = payload.camp;
    const active =
      camp != null &&
      camp.cubeId !== null &&
      camp.residentIds.length > 0 &&
      payload.cubes[camp.cubeId]?.owner === 'player';
    const sig = active
      ? `${camp!.cubeId}:${Math.min(3, Math.max(2, Math.ceil(camp!.residentIds.length / 2)))}`
      : 'empty';

    if (sig === this.lastCampSignature) return;
    this.lastCampSignature = sig;

    while (this.campGroup.children.length > 0) {
      const ch = this.campGroup.children[0];
      this.campGroup.remove(ch);
      this.disposeObjectTree(ch);
    }
    this.campFlameMesh = null;
    this.campGlowLight = null;

    if (!active || !camp || camp.cubeId === null) return;
    const cube = payload.cubes[camp.cubeId];
    if (!cube) return;

    const center = cellToWorldCenter(cube.row, cube.col);
    const groundY = getTerrainHeightAt(center.x, center.z, this.seaCoords);

    const campRoot = new THREE.Group();
    campRoot.position.set(center.x, groundY, center.z);

    // 2 to 3 composite procedural desert canvas tents around the central firepit
    const tentCount = camp.residentIds.length >= 4 ? 3 : 2;
    const tentSpecs = [
      { x: -2.1, z: -1.6, rotY: 0.45, color: 0xe6d3ad, stripe: 0x9e4b35 },
      { x: 2.15, z: -1.35, rotY: -0.55, color: 0xdcc396, stripe: 0x14524a },
      { x: 0.15, z: -2.65, rotY: 0.05, color: 0xebd9b7, stripe: 0xc9962e },
    ];

    for (let i = 0; i < tentCount; i++) {
      const spec = tentSpecs[i];
      const tent = new THREE.Group();
      tent.position.set(spec.x, 0, spec.z);
      tent.rotation.y = spec.rotY;

      // Woven rug base
      const rugGeo = new THREE.BoxGeometry(2.1, 0.06, 1.85);
      const rugMat = new THREE.MeshStandardMaterial({
        color: spec.stripe,
        roughness: 0.92,
      });
      const rug = new THREE.Mesh(rugGeo, rugMat);
      rug.position.y = 0.03;
      rug.receiveShadow = true;
      tent.add(rug);

      // Pitched 3-sided prism canvas roof (CylinderGeometry with 3 radial segments)
      const roofGeo = new THREE.CylinderGeometry(0.05, 1.35, 1.55, 4);
      roofGeo.rotateY(Math.PI * 0.25);
      const roofMat = new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: 0.88,
      });
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.y = 0.78;
      roof.scale.set(1.05, 1, 1.25);
      roof.castShadow = true;
      roof.receiveShadow = true;
      tent.add(roof);

      // Decorative stripe band near ridge
      const bandGeo = new THREE.CylinderGeometry(0.42, 0.62, 0.24, 4);
      bandGeo.rotateY(Math.PI * 0.25);
      const bandMat = new THREE.MeshStandardMaterial({
        color: spec.stripe,
        roughness: 0.85,
      });
      const band = new THREE.Mesh(bandGeo, bandMat);
      band.position.y = 1.12;
      band.scale.set(1.06, 1, 1.26);
      tent.add(band);

      // Wooden ridge post
      const poleGeo = new THREE.CylinderGeometry(0.04, 0.05, 1.72, 6);
      const poleMat = new THREE.MeshStandardMaterial({
        color: 0x6b4726,
        roughness: 0.84,
      });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 0.86;
      tent.add(pole);

      campRoot.add(tent);
    }

    // Stone-ringed campfire at (0, 0, 1.1)
    const fireGroup = new THREE.Group();
    fireGroup.position.set(0, 0, 1.15);

    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x8b7e6d,
      roughness: 0.92,
    });
    for (let s = 0; s < 8; s++) {
      const ang = (s / 8) * Math.PI * 2;
      const stoneGeo = new THREE.DodecahedronGeometry(0.16, 0);
      const stone = new THREE.Mesh(stoneGeo, stoneMat);
      stone.position.set(Math.cos(ang) * 0.52, 0.1, Math.sin(ang) * 0.52);
      stone.castShadow = true;
      fireGroup.add(stone);
    }

    // Crossed logs
    const logGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.78, 6);
    logGeo.rotateZ(Math.PI / 2);
    const logMat = new THREE.MeshStandardMaterial({
      color: 0x4f321b,
      roughness: 0.95,
    });
    const log1 = new THREE.Mesh(logGeo, logMat);
    log1.position.y = 0.09;
    log1.rotation.y = 0.5;
    fireGroup.add(log1);
    const log2 = new THREE.Mesh(logGeo, logMat);
    log2.position.y = 0.12;
    log2.rotation.y = -0.65;
    fireGroup.add(log2);

    // Warm glowing flame cone
    const flameGeo = new THREE.ConeGeometry(0.24, 0.72, 6);
    const flameMat = new THREE.MeshStandardMaterial({
      color: 0xffa630,
      emissive: 0xff6a14,
      emissiveIntensity: 1.5,
      roughness: 0.4,
    });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.y = 0.42;
    fireGroup.add(flame);
    this.campFlameMesh = flame;

    if (!this.isSoftwareGl) {
      const glow = new THREE.PointLight(0xff9b3d, 2.2, 10, 1.8);
      glow.position.set(0, 1.1, 0);
      fireGroup.add(glow);
      this.campGlowLight = glow;
    }

    campRoot.add(fireGroup);
    this.campGroup.add(campRoot);
  }

  private disposeObjectTree(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    });
  }

  private spawnVillageJoinGoldBurst(x: number, y: number, z: number): void {
    // Element 2.2: Capped single celebration burst at joined village center (never per-cube)
    const count = 14;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.14;
      const speed = 1.6 + (i % 4) * 0.65;
      const mat = new THREE.SpriteMaterial({
        map: this.dustTexture,
        color: i % 2 === 0 ? 0xf6cf65 : 0xffebb0,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(x, y + 0.6, z);
      const baseScale = 1.15 + (i % 3) * 0.35;
      sprite.scale.set(baseScale, baseScale, 1);
      sprite.renderOrder = 18;
      this.fxGroup.add(sprite);

      this.dustParticles.push({
        sprite,
        vx: Math.cos(angle) * speed,
        vy: 2.3 + (i % 3) * 0.55,
        vz: Math.sin(angle) * speed,
        age: 0,
        life: 2.0,
        baseScale,
      });
    }
  }

  private buildDirtRoadMesh(
    road: ProvinceRoadSpec
  ): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; totalIndices: number } | null {
    if (road.waypoints.length < 2) return null;

    const pts3D = road.waypoints.map((pt) => {
      const y = getTerrainHeightAt(pt.x, pt.z, this.seaCoords) + 0.085;
      return new THREE.Vector3(pt.x, y, pt.z);
    });

    // Subdivide gently along segments for terrain conformance while staying strictly inside walkable cells
    const sampled: THREE.Vector3[] = [];
    for (let i = 0; i < pts3D.length - 1; i++) {
      const a = pts3D[i];
      const b = pts3D[i + 1];
      const segSteps = 4;
      for (let s = 0; s < segSteps; s++) {
        const t = s / segSteps;
        const x = THREE.MathUtils.lerp(a.x, b.x, t);
        const z = THREE.MathUtils.lerp(a.z, b.z, t);
        const y = getTerrainHeightAt(x, z, this.seaCoords) + 0.085;
        sampled.push(new THREE.Vector3(x, y, z));
      }
    }
    sampled.push(pts3D[pts3D.length - 1]);

    if (sampled.length < 2) return null;

    const halfWidth = 0.68;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < sampled.length; i++) {
      const p = sampled[i];
      const prev = sampled[Math.max(0, i - 1)];
      const next = sampled[Math.min(sampled.length - 1, i + 1)];
      const dirX = next.x - prev.x;
      const dirZ = next.z - prev.z;
      const len = Math.hypot(dirX, dirZ) || 1;
      const perpX = -dirZ / len;
      const perpZ = dirX / len;

      const lx = p.x + perpX * halfWidth;
      const lz = p.z + perpZ * halfWidth;
      const ly = getTerrainHeightAt(lx, lz, this.seaCoords) + 0.085;

      const rx = p.x - perpX * halfWidth;
      const rz = p.z - perpZ * halfWidth;
      const ry = getTerrainHeightAt(rx, rz, this.seaCoords) + 0.085;

      positions.push(lx, ly, lz, rx, ry, rz);
      normals.push(0, 1, 0, 0, 1, 0);
      const v = i / (sampled.length - 1);
      uvs.push(0, v, 1, v);

      if (i < sampled.length - 1) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    const mat = new THREE.MeshStandardMaterial({
      color: 0xc29e68,
      roughness: 0.96,
      metalness: 0.0,
      transparent: true,
      opacity: 0.88,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = 3;
    return { mesh, mat, totalIndices: indices.length };
  }

  private createProvinceFlagpoleMesh(
    colorHex: string,
    isPalace: boolean
  ): {
    root: THREE.Group;
    pennantMesh: THREE.Mesh;
    pennantMat: THREE.MeshStandardMaterial;
  } {
    const root = new THREE.Group();

    // Stone plinth base
    const baseGeo = new THREE.CylinderGeometry(0.32, 0.44, 0.34, 8);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0xd9c7a3,
      roughness: 0.88,
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = 0.17;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    root.add(baseMesh);

    // Tall turned wooden mast
    const poleHeight = isPalace ? 6.2 : 5.4;
    const poleGeo = new THREE.CylinderGeometry(0.065, 0.095, poleHeight, 8);
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x6b4726,
      roughness: 0.78,
    });
    const poleMesh = new THREE.Mesh(poleGeo, poleMat);
    poleMesh.position.y = 0.34 + poleHeight / 2;
    poleMesh.castShadow = true;
    root.add(poleMesh);

    // Golden finial sphere
    const finialGeo = new THREE.SphereGeometry(0.16, 10, 8);
    const finialMat = new THREE.MeshStandardMaterial({
      color: 0xe6b84b,
      roughness: 0.32,
      metalness: 0.55,
    });
    const finialMesh = new THREE.Mesh(finialGeo, finialMat);
    finialMesh.position.y = 0.34 + poleHeight + 0.12;
    root.add(finialMesh);

    // Swallowtail cloth pennant in province color
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.45);
    shape.lineTo(1.75, 0.22);
    shape.lineTo(1.38, 0);
    shape.lineTo(1.75, -0.22);
    shape.lineTo(0, -0.45);
    shape.closePath();

    const pennantGeo = new THREE.ShapeGeometry(shape, 4);
    const pennantMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex),
      roughness: 0.65,
      metalness: 0.05,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    });
    const pennantMesh = new THREE.Mesh(pennantGeo, pennantMat);
    pennantMesh.position.set(0.06, 0.34 + poleHeight - 0.52, 0);
    pennantMesh.castShadow = true;
    root.add(pennantMesh);

    return { root, pennantMesh, pennantMat };
  }

  private syncProvinceVisuals(payload: WorldSyncPayload): void {
    const provinces = payload.provinces ?? [];
    const currentOwnedIds = new Set<number>();
    for (let i = 0; i < payload.cubes.length; i++) {
      if (payload.cubes[i].owner === 'player') {
        currentOwnedIds.add(payload.cubes[i].id);
      }
    }

    // Detect newly joined cubes vs defected cubes
    const newlyJoinedCubes = new Set<number>();
    let joinTriggered = false;
    if (
      this.initialSyncDone &&
      typeof payload.lastJoinedVillageSeq === 'number' &&
      payload.lastJoinedVillageSeq > this.lastJoinedSeqSeen
    ) {
      this.lastJoinedSeqSeen = payload.lastJoinedVillageSeq;
      joinTriggered = true;
      for (const id of currentOwnedIds) {
        if (!this.prevOwnedCubeIds.has(id)) {
          newlyJoinedCubes.add(id);
        }
      }
      if (typeof payload.lastJoinedVillageCubeId === 'number') {
        newlyJoinedCubes.add(payload.lastJoinedVillageCubeId);
        const vCube = payload.cubes[payload.lastJoinedVillageCubeId];
        if (vCube) {
          const vp = cellToWorldCenter(vCube.row, vCube.col);
          const vy = getTerrainHeightAt(vp.x, vp.z, this.seaCoords);
          this.spawnVillageJoinGoldBurst(vp.x, vy, vp.z);
        }
      }
    } else if (!this.initialSyncDone && typeof payload.lastJoinedVillageSeq === 'number') {
      this.lastJoinedSeqSeen = payload.lastJoinedVillageSeq;
    }

    let defectionTriggered = false;
    if (
      this.initialSyncDone &&
      typeof payload.lastDefectedSeq === 'number' &&
      payload.lastDefectedSeq > this.lastDefectedSeqSeen
    ) {
      this.lastDefectedSeqSeen = payload.lastDefectedSeq;
      defectionTriggered = true;
    } else if (!this.initialSyncDone && typeof payload.lastDefectedSeq === 'number') {
      this.lastDefectedSeqSeen = payload.lastDefectedSeq;
    }

    this.prevOwnedCubeIds = currentOwnedIds;

    // Build deterministic signatures for dressing & roads
    const dressingPlan = computeProvinceDressingPlan(payload.cubes, provinces);
    const provSig =
      provinces
        .map((p) => `${p.id}:${p.centerCubeId}:${p.color}:${p.cubeIds.length}:${p.houseCount}`)
        .join('|') +
      `#hb:${dressingPlan.houseBanners.map((b) => `${b.cubeId}:${b.slot}:${b.color}`).join(',')}`;

    if (provSig !== this.lastProvinceSignature || joinTriggered || defectionTriggered) {
      // Queue removed center flags for 2s lower+fade on dissolve/defection
      const nextCenterIds = new Set(
        dressingPlan.centerFlags.map((f) => f.centerCubeId)
      );
      if (this.initialSyncDone) {
        for (let i = 0; i < this.provinceFlags.length; i++) {
          const prevFlag = this.provinceFlags[i];
          if (!nextCenterIds.has(prevFlag.cubeId)) {
            this.provinceDressGroup.remove(prevFlag.root);
            const mats: THREE.Material[] = [];
            prevFlag.root.traverse((ch) => {
              if ((ch as THREE.Mesh).isMesh) {
                const m = (ch as THREE.Mesh).material as THREE.Material;
                m.transparent = true;
                mats.push(m);
              }
            });
            this.fadingFxGroup.add(prevFlag.root);
            this.fadingObjects.push({
              root: prevFlag.root,
              materials: mats,
              age: 0,
              duration: 2.0,
              lowerY: true,
              startY: prevFlag.root.position.y,
            });
          }
        }
      }

      // Clear active dressing group (surviving/previous items rebuilt cleanly from provinces)
      while (this.provinceDressGroup.children.length > 0) {
        const ch = this.provinceDressGroup.children[0];
        this.provinceDressGroup.remove(ch);
        this.disposeObjectTree(ch);
      }
      this.provinceFlags = [];
      this.houseBanners = [];

      const neutralStartColor = new THREE.Color('#D7C9AA');

      // Build center flagpoles
      for (let i = 0; i < dressingPlan.centerFlags.length; i++) {
        const spec = dressingPlan.centerFlags[i];
        const cube = payload.cubes[spec.centerCubeId];
        if (!cube) continue;
        const center = cellToWorldCenter(cube.row, cube.col);
        const off = getCenterFlagWorldOffset(cube);
        const wx = center.x + off.dx;
        const wz = center.z + off.dz;
        const groundY = getTerrainHeightAt(wx, wz, this.seaCoords);

        const animateColor = joinTriggered && newlyJoinedCubes.has(cube.id);
        const { root, pennantMesh, pennantMat } = this.createProvinceFlagpoleMesh(
          animateColor ? '#D7C9AA' : spec.color,
          spec.isPalace
        );
        root.position.set(wx, groundY, wz);
        this.provinceDressGroup.add(root);

        this.provinceFlags.push({
          root,
          pennantMesh,
          pennantMat,
          targetColor: new THREE.Color(spec.color),
          startColor: animateColor ? neutralStartColor.clone() : null,
          colorLerpAge: animateColor ? 0 : 2.0,
          baseY: groundY,
          phase: cube.id * 0.7,
          cubeId: cube.id,
          provinceId: spec.provinceId,
        });
      }

      // Build small cloth banners on king-owned houses matching province color
      for (let i = 0; i < dressingPlan.houseBanners.length; i++) {
        const spec = dressingPlan.houseBanners[i];
        const pos = cellSlotToWorld(spec.row, spec.col, 'half', spec.slot);
        const groundY = getTerrainHeightAt(pos.x, pos.z, this.seaCoords);
        const animateColor = joinTriggered && newlyJoinedCubes.has(spec.cubeId);

        const bannerGeo = new THREE.PlaneGeometry(0.42, 0.88);
        const bannerMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(animateColor ? '#D7C9AA' : spec.color),
          roughness: 0.72,
          side: THREE.DoubleSide,
        });
        const bannerMesh = new THREE.Mesh(bannerGeo, bannerMat);
        bannerMesh.position.set(pos.x + 1.18, groundY + 2.15, pos.z + 1.15);
        bannerMesh.rotation.y = Math.PI * 0.25;
        this.provinceDressGroup.add(bannerMesh);

        this.houseBanners.push({
          mesh: bannerMesh,
          mat: bannerMat,
          targetColor: new THREE.Color(spec.color),
          startColor: animateColor ? neutralStartColor.clone() : null,
          colorLerpAge: animateColor ? 0 : 2.0,
          phase: spec.cubeId * 1.1 + spec.slot * 1.7,
          cubeId: spec.cubeId,
        });
      }

      this.lastProvinceSignature = provSig;
    }

    // Recompute dirt roads from palace to non-palace province centers via Prompt 1 street A*
    const roadSig =
      provinces.map((p) => `${p.id}:${p.centerCubeId}`).join('|') +
      `#own:${this.lastOwnedSignature}#sea:${this.lastSeaSignature}#bld:${payload.cubes
        .map((c) => (c.owner === 'player' ? `${c.id}:${c.themeId ?? ''}` : ''))
        .filter(Boolean)
        .join(',')}`;

    if (roadSig !== this.lastRoadSignature) {
      const roadSpecs = computeProvinceRoads(
        payload.cubes,
        provinces,
        this.seaCoords
      );
      const nextRoadIds = new Set(roadSpecs.map((r) => r.provinceId));

      // Fade out removed/dissolved province roads over 2.0s
      for (const [provId, active] of this.activeProvinceRoads.entries()) {
        if (!nextRoadIds.has(provId)) {
          this.provinceRoadsGroup.remove(active.mesh);
          if (this.initialSyncDone) {
            this.fadingFxGroup.add(active.mesh);
            this.fadingObjects.push({
              root: active.mesh,
              materials: [active.mat],
              age: 0,
              duration: 2.0,
              lowerY: false,
              startY: active.mesh.position.y,
            });
          } else {
            active.mesh.geometry.dispose();
            active.mat.dispose();
          }
          this.activeProvinceRoads.delete(provId);
        }
      }

      // Add or update active roads
      for (let i = 0; i < roadSpecs.length; i++) {
        const spec = roadSpecs[i];
        const prev = this.activeProvinceRoads.get(spec.provinceId);
        const built = this.buildDirtRoadMesh(spec);
        if (!built) continue;

        const isBrandNew = !prev && this.initialSyncDone;
        if (prev) {
          this.provinceRoadsGroup.remove(prev.mesh);
          prev.mesh.geometry.dispose();
          prev.mat.dispose();
        }

        if (isBrandNew) {
          built.mesh.geometry.setDrawRange(0, 0);
        }
        this.provinceRoadsGroup.add(built.mesh);
        this.activeProvinceRoads.set(spec.provinceId, {
          provinceId: spec.provinceId,
          mesh: built.mesh,
          mat: built.mat,
          totalIndices: built.totalIndices,
          drawAge: isBrandNew ? 0 : 2.0,
          drawDuration: 2.0,
        });
      }

      this.lastRoadSignature = roadSig;
    }
  }

  private getOrCreatePriceTagTexture(price: number): THREE.CanvasTexture {
    const cached = this.priceTagCache.get(price);
    if (cached) return cached;
    const created = createPriceTagTexture(price, true);
    this.priceTagCache.set(price, created);
    return created;
  }

  private rebuildPurchasableMarkers(cubes: Cube[]): void {
    while (this.purchasableGroup.children.length > 0) {
      const child = this.purchasableGroup.children[0];
      this.purchasableGroup.remove(child);
      if ((child as THREE.Sprite).isSprite) {
        (child as THREE.Sprite).material.dispose();
      }
    }
    this.purchasableSprites = [];

    for (let i = 0; i < cubes.length; i++) {
      const cube = cubes[i];
      if (!isPurchasableNeutralCube(cubes, cube)) continue;

      const pos = cellToWorldCenter(cube.row, cube.col);
      const groundY = getTerrainHeightAt(pos.x, pos.z, this.seaCoords);

      // Soft golden shimmer plane (reuses feathered footprint decal — no square border)
      const shimmer = new THREE.Mesh(
        this.purchasableShimmerGeo,
        this.purchasableShimmerMat
      );
      shimmer.position.set(pos.x, groundY + 0.12, pos.z);
      shimmer.renderOrder = 4;
      shimmer.userData.cubeId = cube.id;
      this.purchasableGroup.add(shimmer);

      // Cached floating price-tag sprite facing camera automatically
      const price = getCubePurchasePrice(cubes, cube);
      const tagTex = this.getOrCreatePriceTagTexture(price);
      const spriteMat = new THREE.SpriteMaterial({
        map: tagTex,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      const baseY = groundY + 2.65;
      sprite.position.set(pos.x, baseY, pos.z);
      sprite.scale.set(4.6, 1.92, 1);
      sprite.renderOrder = 20;
      sprite.userData.cubeId = cube.id;
      this.purchasableGroup.add(sprite);

      this.purchasableSprites.push({
        sprite,
        baseY,
        phase: cube.id * 0.75,
      });
    }
  }

  private rebuildPrivatePennants(cubes: Cube[]): void {
    while (this.privatePennantGroup.children.length > 0) {
      const child = this.privatePennantGroup.children[0];
      this.privatePennantGroup.remove(child);
      if ((child as THREE.Sprite).isSprite) {
        (child as THREE.Sprite).material.dispose();
      }
    }
    this.privatePennants = [];

    for (let i = 0; i < cubes.length; i++) {
      const cube = cubes[i];
      if (
        cube.owner !== 'player' ||
        typeof cube.privateOwnerId !== 'number' ||
        !cube.themeId
      ) {
        continue;
      }
      const def = THEMES[cube.themeId];
      const pos = cellSlotToWorld(cube.row, cube.col, def.footprint, 0);
      const groundY = getTerrainHeightAt(pos.x, pos.z, this.seaCoords);
      const spriteMat = new THREE.SpriteMaterial({
        map: this.privatePennantTexture,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      const baseY = groundY + (cube.themeId === 'hotel' ? 9.6 : 6.4);
      sprite.position.set(pos.x, baseY, pos.z);
      sprite.scale.set(2.1, 2.1, 1);
      sprite.renderOrder = 21;
      sprite.userData.cubeId = cube.id;
      this.privatePennantGroup.add(sprite);

      this.privatePennants.push({
        sprite,
        baseY,
        phase: cube.id * 0.9,
      });
    }
  }

  private rebuildBankPennants(cubes: Cube[]): void {
    while (this.bankPennantGroup.children.length > 0) {
      const child = this.bankPennantGroup.children[0];
      this.bankPennantGroup.remove(child);
      if ((child as THREE.Sprite).isSprite) {
        (child as THREE.Sprite).material.dispose();
      }
    }
    this.bankPennants = [];

    for (let i = 0; i < cubes.length; i++) {
      const cube = cubes[i];
      if (cube.owner !== 'bank') continue;
      const pos = cellSlotToWorld(cube.row, cube.col, 'full', 0);
      const groundY = getTerrainHeightAt(pos.x, pos.z, this.seaCoords);
      const spriteMat = new THREE.SpriteMaterial({
        map: this.bankPennantTexture,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      const baseY = groundY + 4.8;
      sprite.position.set(pos.x, baseY, pos.z);
      sprite.scale.set(2.1, 2.1, 1);
      sprite.renderOrder = 21;
      sprite.userData.cubeId = cube.id;
      this.bankPennantGroup.add(sprite);

      this.bankPennants.push({
        sprite,
        baseY,
        phase: cube.id * 0.9,
      });
    }
  }

  private rebuildTerrainVerticesAndColors(
    seaCoords: Array<{ x: number; z: number }>,
    ownedCoords: Array<{ x: number; z: number }>
  ): void {
    const pos = this.terrainGeometry.attributes.position as THREE.BufferAttribute;
    const col = this.terrainGeometry.attributes.color as THREE.BufferAttribute;

    // Warm owned sand vs slightly cooler/darker wilderness sand vs sandy-teal lake bed
    const ownedTint = new THREE.Color(0xfff4d6);
    const neutralTint = new THREE.Color(0xd1c2a3);
    const outerTint = new THREE.Color(0xb8a684);
    const seaBedTint = new THREE.Color(0x6d9993);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = getTerrainHeightAt(x, z, seaCoords);
      pos.setY(i, y);

      const ownedBlend = getOwnedBlendAt(x, z, ownedCoords);
      const dist = Math.max(Math.abs(x), Math.abs(z));
      const outerFactor = THREE.MathUtils.smoothstep(dist, 55, 130);

      // Start from neutral tint, darken slightly into distant wilderness, brighten softly inside owned land
      c.copy(neutralTint).lerp(outerTint, outerFactor * 0.85);
      c.lerp(ownedTint, ownedBlend * 0.92);

      // Blend wet sandy-teal seabed inside carved sea depressions
      if (y < WATER_SURFACE_Y + 0.15) {
        const wetT = THREE.MathUtils.clamp(
          (WATER_SURFACE_Y + 0.15 - y) / 1.35,
          0,
          1
        );
        c.lerp(seaBedTint, wetT * 0.85);
      }

      col.setXYZ(i, c.r, c.g, c.b);
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.terrainGeometry.computeVertexNormals();
  }

  private rebuildOwnedBoundaryRibbon(ownedSet: Set<string>): void {
    while (this.boundaryGroup.children.length > 0) {
      const child = this.boundaryGroup.children[0] as THREE.Mesh;
      this.boundaryGroup.remove(child);
      child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }

    const loops = extractUnionLoops(ownedSet);
    for (const loop of loops) {
      const points = sampleRoundedLoopPoints3D(loop, this.seaCoords, 0.24, 2.7);
      if (points.length < 3) continue;

      const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.25);
      const tubularSegments = Math.max(64, points.length * 2);

      // Crisp golden raised perimeter tube
      const coreGeo = new THREE.TubeGeometry(curve, tubularSegments, 0.2, 8, true);
      const coreMat = new THREE.MeshStandardMaterial({
        color: 0xf2c95e,
        emissive: 0xc9962e,
        emissiveIntensity: 0.55,
        roughness: 0.35,
        metalness: 0.35,
      });
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      this.boundaryGroup.add(coreMesh);

      // Soft outer golden halo ribbon hugging the ground
      const glowGeo = new THREE.TubeGeometry(curve, tubularSegments, 0.52, 8, true);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xe6b84b,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      });
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      this.boundaryGroup.add(glowMesh);
    }
  }

  private rebuildMergedSeas(seaSet: Set<string>): void {
    // Clear existing merged lake meshes
    while (this.waterGroup.children.length > 0) {
      const child = this.waterGroup.children[0];
      this.waterGroup.remove(child);
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).geometry.dispose();
      } else if ((child as THREE.Sprite).isSprite) {
        (child as THREE.Sprite).material.dispose();
      }
    }
    this.seaSparkles = [];

    if (seaSet.size === 0) return;

    const loops = extractUnionLoops(seaSet);

    const signedAreaXZ = (pts: Array<{ x: number; z: number }>) => {
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        area += a.x * b.z - b.x * a.z;
      }
      return area * 0.5;
    };

    const pointInLoopXZ = (
      px: number,
      pz: number,
      poly: Array<{ x: number; z: number }>
    ) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x;
        const zi = poly[i].z;
        const xj = poly[j].x;
        const zj = poly[j].z;
        const intersect =
          zi > pz !== zj > pz &&
          px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-9) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    // In clockwise XZ winding, positive signed area = outer boundary, negative = inner island hole
    const outerLoops = loops.filter((l) => signedAreaXZ(l) > 0);
    const holeLoops = loops.filter((l) => signedAreaXZ(l) <= 0);

    for (const outer of outerLoops) {
      const waterLoop = offsetPolygonLoop(outer, 0.55);
      const waterShape = buildRoundedLoopShape(waterLoop, 3.6);

      const foamLoop = offsetPolygonLoop(outer, 1.15);
      const foamShape = buildRoundedLoopShape(foamLoop, 4.1);

      for (const hole of holeLoops) {
        if (hole.length > 0 && pointInLoopXZ(hole[0].x, hole[0].z, outer)) {
          const waterHole = offsetPolygonLoop(hole, 0.55);
          waterShape.holes.push(buildRoundedLoopShape(waterHole, 2.8));

          const foamHole = offsetPolygonLoop(hole, 1.15);
          foamShape.holes.push(buildRoundedLoopShape(foamHole, 3.2));
        }
      }

      const waterGeo = new THREE.ShapeGeometry(waterShape, 18);
      waterGeo.rotateX(-Math.PI / 2);

      const waterMesh = new THREE.Mesh(waterGeo, this.waterMaterial);
      waterMesh.position.y = WATER_SURFACE_Y;
      waterMesh.receiveShadow = true;
      waterMesh.renderOrder = 3;
      this.waterGroup.add(waterMesh);

      const foamGeo = new THREE.ShapeGeometry(foamShape, 18);
      foamGeo.rotateX(-Math.PI / 2);

      const foamMesh = new THREE.Mesh(foamGeo, this.foamMaterial);
      foamMesh.position.y = WATER_SURFACE_Y - 0.04;
      foamMesh.renderOrder = 2;
      this.waterGroup.add(foamMesh);
    }

    // Subtle rising shimmer sparkles over sea cells (diegetic sea activity)
    for (let i = 0; i < this.seaCoords.length; i++) {
      const sc = this.seaCoords[i];
      for (let s = 0; s < 2; s++) {
        const mat = new THREE.SpriteMaterial({
          map: this.dustTexture,
          color: 0xe6fbff,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(1.0, 1.0, 1);
        this.waterGroup.add(sprite);
        this.seaSparkles.push({
          sprite,
          baseX: sc.x + (s === 0 ? -1.8 : 1.9),
          baseZ: sc.z + (s === 0 ? 1.5 : -1.7),
          phase: i * 1.7 + s * 3.14,
          speed: 0.75 + s * 0.25,
        });
      }
    }
  }

  private syncBuildings(payload: WorldSyncPayload): void {
    const activeKeys = new Set<string>();

    for (const cube of payload.cubes) {
      if (cube.owner !== 'player') continue;

      const entries: Array<{
        slot: SlotIndex;
        themeId: ThemeId | null;
        progress: number;
      }> = [
        { slot: 0, themeId: cube.themeId, progress: cube.progress },
        { slot: 1, themeId: cube.secondThemeId, progress: cube.secondProgress },
      ];

      for (const entry of entries) {
        if (!entry.themeId || entry.themeId === 'sea') continue;
        const key = `${cube.id}:${entry.slot}:${entry.themeId}`;
        activeKeys.add(key);

        let handle = this.buildingsMap.get(key);
        const def = THEMES[entry.themeId];
        const pos = cellSlotToWorld(cube.row, cube.col, def.footprint, entry.slot);
        const groundY = getTerrainHeightAt(pos.x, pos.z, this.seaCoords);

        if (!handle) {
          const animateRise = this.initialSyncDone;
          handle = createBuildingVisual(
            this.buildingLib,
            key,
            cube.id,
            entry.slot,
            entry.themeId,
            animateRise
          );
          handle.root.position.set(pos.x, groundY, pos.z);
          if (animateRise) {
            handle.bodyGroup.scale.set(1, 0.01, 1);
            this.spawnDustPuff(pos.x, groundY + 0.3, pos.z, def.footprint === 'full' ? 1.35 : 0.9);
          }
          this.buildingsGroup.add(handle.root);
          this.buildingsMap.set(key, handle);
        } else {
          handle.root.position.set(pos.x, groundY, pos.z);
        }

        // Diegetic cycle progress updates
        const ratio =
          def.cycleSeconds && def.cycleSeconds > 0
            ? entry.progress / def.cycleSeconds
            : 0;
        if (entry.themeId === 'farm' || entry.themeId === 'wheat_farm') {
          updateFarmCropGrowth(handle, ratio);
        } else if (handle.progressArcMesh) {
          updateProgressRing(handle, ratio);
        }

        // Unstaffed visual treatment
        const isStaffed = payload.staffedSlots.has(
          makeSlotKey(cube.id, entry.slot)
        );
        const unstaffed = def.workers > 0 && !isStaffed;
        applyUnstaffedVisual(handle, this.buildingLib, unstaffed);
      }
    }

    // Remove demolished buildings
    for (const [key, handle] of this.buildingsMap.entries()) {
      if (!activeKeys.has(key)) {
        this.buildingsGroup.remove(handle.root);
        disposeBuildingVisual(handle, this.buildingLib);
        this.buildingsMap.delete(key);
      }
    }
  }

  private spawnDustPuff(x: number, y: number, z: number, scaleMult: number): void {
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
      const speed = (1.6 + Math.random() * 1.4) * scaleMult;
      const mat = new THREE.SpriteMaterial({
        map: this.dustTexture,
        color: 0xf4dfaf,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(x, y, z);
      const baseScale = (1.4 + Math.random() * 1.0) * scaleMult;
      sprite.scale.set(baseScale, baseScale, 1);
      sprite.renderOrder = 15;
      this.fxGroup.add(sprite);

      this.dustParticles.push({
        sprite,
        vx: Math.cos(angle) * speed,
        vy: 1.4 + Math.random() * 1.2,
        vz: Math.sin(angle) * speed,
        age: 0,
        life: 0.48 + Math.random() * 0.22,
        baseScale,
      });
    }
  }

  private updateSelectionRing(): void {
    const state = this.latestState;
    if (!state || state.selectedCubeId === null) {
      this.selectionRingMesh.visible = false;
      return;
    }

    const cube = state.cubes[state.selectedCubeId];
    if (!cube) {
      this.selectionRingMesh.visible = false;
      return;
    }

    const pos = cellToWorldCenter(cube.row, cube.col);
    const groundY = Math.max(
      WATER_SURFACE_Y + 0.08,
      getTerrainHeightAt(pos.x, pos.z, this.seaCoords) + 0.14
    );
    this.selectionRingMesh.position.set(pos.x, groundY, pos.z);
    this.selectionRingMesh.visible = true;
  }

  private updateHoverDecal(): void {
    const state = this.latestState;
    if (!state || this.hoveredCubeId === null) {
      this.hoverDecalMesh.visible = false;
      return;
    }

    const cube = state.cubes[this.hoveredCubeId];
    if (!cube) {
      this.hoverDecalMesh.visible = false;
      return;
    }

    if (state.activeBuildTheme) {
      const check = canPlaceThemeOnCube(cube, state.activeBuildTheme, state.level);
      const def = THEMES[state.activeBuildTheme];
      const targetSlot: SlotIndex = check.targetSlot ?? 0;
      const pos =
        def.footprint === 'half' && check.valid
          ? cellSlotToWorld(cube.row, cube.col, 'half', targetSlot)
          : cellToWorldCenter(cube.row, cube.col);

      const scale = def.footprint === 'half' && check.valid ? 0.56 : 0.96;
      const groundY = Math.max(
        WATER_SURFACE_Y + 0.06,
        getTerrainHeightAt(pos.x, pos.z, this.seaCoords) + 0.16
      );
      this.hoverDecalMesh.position.set(pos.x, groundY, pos.z);
      this.hoverDecalMesh.scale.setScalar(scale);
      this.hoverDecalMat.color.setHex(check.valid ? 0xfff0b8 : 0xe05848);
      this.hoverDecalMesh.visible = true;
      return;
    }

    // Subtle organic highlight when hovering a purchasable adjacent neutral land spot
    if (isPurchasableNeutralCube(state.cubes, cube)) {
      const pos = cellToWorldCenter(cube.row, cube.col);
      const groundY = getTerrainHeightAt(pos.x, pos.z, this.seaCoords) + 0.16;
      this.hoverDecalMesh.position.set(pos.x, groundY, pos.z);
      this.hoverDecalMesh.scale.setScalar(0.88);
      this.hoverDecalMat.color.setHex(0xf2cb68);
      this.hoverDecalMesh.visible = true;
      return;
    }

    this.hoverDecalMesh.visible = false;
  }

  private updateSize(): void {
    const rect = this.container.getBoundingClientRect();
    this.viewportWidth = Math.max(1, Math.floor(rect.width));
    this.viewportHeight = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(this.viewportWidth, this.viewportHeight, false);
    this.updateCameraProjection();
  }

  private updateCameraProjection(): void {
    const aspect = this.viewportWidth / this.viewportHeight;
    const halfH = this.currentFrustumHeight / 2;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  private updateCameraTransform(): void {
    this.camera.position
      .copy(this.currentTarget)
      .addScaledVector(CAM_DIR, CAM_DISTANCE);
    this.camera.lookAt(this.currentTarget);
  }

  private setRayFromClient(clientX: number, clientY: number): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    return true;
  }

  private raycastCitizenAtClient(clientX: number, clientY: number): number | null {
    if (!this.setRayFromClient(clientX, clientY)) return null;
    const hits = this.raycaster.intersectObjects(
      this.peopleAgents.group.children,
      true
    );
    for (let i = 0; i < hits.length; i++) {
      let obj: THREE.Object3D | null = hits[i].object;
      let agentId: number | null = null;
      let hidden = false;
      while (obj) {
        if (!obj.visible) {
          hidden = true;
          break;
        }
        if (agentId === null && typeof obj.userData.agentId === 'number') {
          agentId = obj.userData.agentId;
        }
        obj = obj.parent;
      }
      if (!hidden && agentId !== null) {
        return agentId;
      }
    }
    return null;
  }

  private raycastPurchasableTagAtClient(
    clientX: number,
    clientY: number
  ): number | null {
    if (this.purchasableSprites.length === 0) return null;
    if (!this.setRayFromClient(clientX, clientY)) return null;
    const sprites = this.purchasableSprites.map((item) => item.sprite);
    const hits = this.raycaster.intersectObjects(sprites, false);
    if (hits.length > 0 && typeof hits[0].object.userData.cubeId === 'number') {
      return hits[0].object.userData.cubeId;
    }
    return null;
  }

  private raycastCellAtClient(clientX: number, clientY: number): number | null {
    if (!this.setRayFromClient(clientX, clientY)) return null;
    const hit = this.raycaster.ray.intersectPlane(
      this.groundPlane,
      this.scratchHit
    );
    if (!hit) return null;
    const cell = worldToCell(hit.x, hit.z);
    return cell ? cell.id : null;
  }

  private panByScreenDelta(dxPx: number, dyPx: number): void {
    if (this.viewportHeight <= 0) return;
    const worldUnitsPerPx = this.currentFrustumHeight / this.viewportHeight;
    // Compensate vertical screen drag for isometric 32 deg pitch
    const pitchScale = 1 / Math.sin(ISO_ELEVATION);

    this.desiredTarget.addScaledVector(CAM_RIGHT, -dxPx * worldUnitsPerPx);
    this.desiredTarget.addScaledVector(
      CAM_FORWARD,
      dyPx * worldUnitsPerPx * pitchScale
    );
    this.desiredTarget.x = THREE.MathUtils.clamp(
      this.desiredTarget.x,
      -PAN_LIMIT,
      PAN_LIMIT
    );
    this.desiredTarget.z = THREE.MathUtils.clamp(
      this.desiredTarget.z,
      -PAN_LIMIT,
      PAN_LIMIT
    );
  }

  private handlePointerDown = (e: PointerEvent) => {
    const canvas = this.renderer.domElement;
    canvas.setPointerCapture(e.pointerId);
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.activePointers.size === 2) {
      const pts = Array.from(this.activePointers.values());
      this.pinchStartDist = Math.hypot(
        pts[0].x - pts[1].x,
        pts[0].y - pts[1].y
      );
      this.pinchStartFrustum = this.desiredFrustumHeight;
      this.isDragging = false;
      this.dragMoved = true;
      return;
    }

    this.isDragging = true;
    this.dragMoved = false;
    this.dragButton = e.button;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Two-finger pinch zoom
    if (this.activePointers.size === 2) {
      const pts = Array.from(this.activePointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.pinchStartDist > 10 && dist > 10) {
        const ratio = this.pinchStartDist / dist;
        this.desiredFrustumHeight = THREE.MathUtils.clamp(
          this.pinchStartFrustum * ratio,
          MIN_FRUSTUM_HEIGHT,
          MAX_FRUSTUM_HEIGHT
        );
      }
      return;
    }

    if (this.isDragging) {
      const totalDist = Math.hypot(
        e.clientX - this.dragStartX,
        e.clientY - this.dragStartY
      );
      const allowLeftPan =
        this.dragButton === 2 ||
        this.dragButton === 1 ||
        !this.latestState?.activeBuildTheme;

      if (totalDist > 6 && allowLeftPan) {
        this.dragMoved = true;
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.panByScreenDelta(dx, dy);
      }
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    }

    // Throttled hover raycast (max 25Hz)
    const now = performance.now();
    if (now - this.lastHoverRaycastTime >= 40) {
      this.lastHoverRaycastTime = now;
      const cellId = this.raycastCellAtClient(e.clientX, e.clientY);
      if (cellId !== this.hoveredCubeId) {
        this.hoveredCubeId = cellId;
        this.updateHoverDecal();
      }
    }
  };

  private handlePointerUp = (e: PointerEvent) => {
    const canvas = this.renderer.domElement;
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    this.activePointers.delete(e.pointerId);

    const wasClick = this.isDragging && !this.dragMoved && this.dragButton === 0;
    this.isDragging = false;

    if (wasClick) {
      // If not placing a building, test citizens first, then floating price tags, then ground cells
      if (!this.latestState?.activeBuildTheme && this.onCitizenClick) {
        const agentId = this.raycastCitizenAtClient(e.clientX, e.clientY);
        if (agentId !== null) {
          this.onCitizenClick(agentId);
          return;
        }
      }

      const tagCubeId = this.raycastPurchasableTagAtClient(e.clientX, e.clientY);
      if (tagCubeId !== null) {
        this.onCubeClick(tagCubeId);
        return;
      }

      const cellId = this.raycastCellAtClient(e.clientX, e.clientY);
      if (cellId !== null) {
        this.onCubeClick(cellId);
      }
    }
  };

  private handlePointerLeave = () => {
    this.hoveredCubeId = null;
    this.hoverDecalMesh.visible = false;
  };

  private handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.91;
    this.zoomBy(zoomFactor);
  };

  private handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (
      [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
      ].includes(e.code)
    ) {
      this.pressedKeys.add(e.code);
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.pressedKeys.delete(e.code);
  };

  private handleWindowBlur = () => {
    this.pressedKeys.clear();
    this.isDragging = false;
    this.activePointers.clear();
  };

  private handleContextLost = (e: Event) => {
    e.preventDefault();
  };

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerUp);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.handleContextMenu);
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
  }

  private unbindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    canvas.removeEventListener('pointercancel', this.handlePointerUp);
    canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    canvas.removeEventListener('wheel', this.handleWheel);
    canvas.removeEventListener('contextmenu', this.handleContextMenu);
    canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
  }

  private stepSimulation(dt: number): void {
    this.elapsedTime += dt;

    // Element 2.1: Update living people agents on delta time
    this.peopleAgents.update(dt);

    // Element 2.3: Smooth camera follow target for followed citizen
    if (this.followAgentId !== null) {
      if (
        this.peopleAgents.getAgentPosition(
          this.followAgentId,
          this.scratchFollowPos
        )
      ) {
        this.desiredTarget.set(
          THREE.MathUtils.clamp(this.scratchFollowPos.x, -PAN_LIMIT, PAN_LIMIT),
          0,
          THREE.MathUtils.clamp(this.scratchFollowPos.z, -PAN_LIMIT, PAN_LIMIT)
        );
      } else {
        this.followAgentId = null;
      }
    }

    // Keyboard WASD / Arrow camera pan
    if (this.pressedKeys.size > 0) {
      const panSpeed = this.currentFrustumHeight * 0.72 * dt;
      if (this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp')) {
        this.desiredTarget.addScaledVector(CAM_FORWARD, panSpeed);
      }
      if (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown')) {
        this.desiredTarget.addScaledVector(CAM_FORWARD, -panSpeed);
      }
      if (this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight')) {
        this.desiredTarget.addScaledVector(CAM_RIGHT, panSpeed);
      }
      if (this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft')) {
        this.desiredTarget.addScaledVector(CAM_RIGHT, -panSpeed);
      }
      this.desiredTarget.x = THREE.MathUtils.clamp(
        this.desiredTarget.x,
        -PAN_LIMIT,
        PAN_LIMIT
      );
      this.desiredTarget.z = THREE.MathUtils.clamp(
        this.desiredTarget.z,
        -PAN_LIMIT,
        PAN_LIMIT
      );
    }

    // Exponential damping for silky pan & zoom
    const dampLambda = this.isSoftwareGl ? 24 : 11;
    this.currentTarget.x = THREE.MathUtils.damp(
      this.currentTarget.x,
      this.desiredTarget.x,
      dampLambda,
      dt
    );
    this.currentTarget.z = THREE.MathUtils.damp(
      this.currentTarget.z,
      this.desiredTarget.z,
      dampLambda,
      dt
    );

    const prevFrustum = this.currentFrustumHeight;
    this.currentFrustumHeight = THREE.MathUtils.damp(
      this.currentFrustumHeight,
      this.desiredFrustumHeight,
      dampLambda,
      dt
    );
    if (Math.abs(this.currentFrustumHeight - prevFrustum) > 0.001) {
      this.updateCameraProjection();
    }
    this.updateCameraTransform();

    // Water shimmer texture scroll + soft foam pulse
    this.waterTexture.offset.x = (this.elapsedTime * 0.018) % 1;
    this.waterTexture.offset.y = (this.elapsedTime * 0.012) % 1;
    this.foamMaterial.opacity = 0.22 + Math.sin(this.elapsedTime * 1.9) * 0.06;

    // Subtle rising sparkles over sea bodies
    for (let i = 0; i < this.seaSparkles.length; i++) {
      const sp = this.seaSparkles[i];
      const cycle = ((this.elapsedTime * sp.speed + sp.phase) % 2.4) / 2.4;
      sp.sprite.position.set(
        sp.baseX + Math.sin(this.elapsedTime + sp.phase) * 0.45,
        WATER_SURFACE_Y + 0.15 + cycle * 1.65,
        sp.baseZ + Math.cos(this.elapsedTime + sp.phase) * 0.45
      );
      const alpha = Math.sin(cycle * Math.PI) * 0.65;
      sp.sprite.material.opacity = alpha;
      const sc = 0.55 + Math.sin(cycle * Math.PI) * 0.6;
      sp.sprite.scale.set(sc, sc, 1);
    }

    // Building animations: rise bounce (350ms), unstaffed badge bob, wandering pasture livestock
    for (const handle of this.buildingsMap.values()) {
      if (handle.riseAge < 1) {
        handle.riseAge = Math.min(1, handle.riseAge + dt / 0.35);
        const t = handle.riseAge;
        // Smooth ease-out-back overshoot bounce
        const c1 = 1.55;
        const c3 = c1 + 1;
        const sy =
          t >= 1
            ? 1
            : 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        handle.bodyGroup.scale.set(1, Math.max(0.01, sy), 1);
      }

      if (handle.unstaffedSprite) {
        handle.unstaffedSprite.position.y =
          4.9 + Math.sin(this.elapsedTime * 3.4 + handle.cubeId) * 0.35;
      }

      if (handle.animals.length > 0) {
        for (let i = 0; i < handle.animals.length; i++) {
          const a = handle.animals[i];
          if (a.pauseTimer > 0) {
            a.pauseTimer -= dt;
            continue;
          }
          const dx = a.targetX - a.x;
          const dz = a.targetZ - a.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.25) {
            a.pauseTimer = 1.2 + Math.random() * 2.4;
            a.targetX = (Math.random() - 0.5) * 5.2;
            a.targetZ = (Math.random() - 0.5) * 5.2;
          } else {
            const step = Math.min(dist, a.speed * dt);
            a.x += (dx / dist) * step;
            a.z += (dz / dist) * step;
            a.mesh.position.set(a.x, 0.28 + Math.abs(Math.sin(this.elapsedTime * 6 + i)) * 0.06, a.z);
            a.mesh.rotation.y = Math.atan2(-dz, dx);
          }
        }
      }
    }

    // Dust puff particles
    for (let i = this.dustParticles.length - 1; i >= 0; i--) {
      const p = this.dustParticles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.fxGroup.remove(p.sprite);
        p.sprite.material.dispose();
        this.dustParticles.splice(i, 1);
        continue;
      }
      const progress = p.age / p.life;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt * (1 - progress * 0.5);
      p.sprite.position.z += p.vz * dt;
      const sc = p.baseScale * (1 + progress * 0.9);
      p.sprite.scale.set(sc, sc, 1);
      p.sprite.material.opacity = (1 - progress) * 0.72;
    }

    // Element 3.1: Gentle shimmer pulse + subtle float on purchasable land markers
    if (this.purchasableSprites.length > 0) {
      this.purchasableShimmerMat.opacity =
        0.22 + Math.sin(this.elapsedTime * 2.4) * 0.08;
      for (let i = 0; i < this.purchasableSprites.length; i++) {
        const item = this.purchasableSprites[i];
        item.sprite.position.y =
          item.baseY + Math.sin(this.elapsedTime * 2.1 + item.phase) * 0.16;
      }
    }

    // Element 5.2: Subtle breeze flutter on built private-business golden pennants
    if (this.privatePennants.length > 0) {
      for (let i = 0; i < this.privatePennants.length; i++) {
        const item = this.privatePennants[i];
        item.sprite.position.y =
          item.baseY + Math.sin(this.elapsedTime * 2.6 + item.phase) * 0.12;
      }
    }

    // Prompt 5 B4: Subtle breeze flutter on bank silver pennants
    if (this.bankPennants.length > 0) {
      for (let i = 0; i < this.bankPennants.length; i++) {
        const item = this.bankPennants[i];
        item.sprite.position.y =
          item.baseY + Math.sin(this.elapsedTime * 2.6 + item.phase) * 0.12;
      }
    }

    // Prompt 7 Element 2: Province center flagpole breeze wave & 2s join color transition
    for (let i = 0; i < this.provinceFlags.length; i++) {
      const f = this.provinceFlags[i];
      f.pennantMesh.rotation.y = Math.sin(this.elapsedTime * 2.8 + f.phase) * 0.22;
      if (f.startColor && f.colorLerpAge < 2.0) {
        f.colorLerpAge = Math.min(2.0, f.colorLerpAge + dt);
        const t = f.colorLerpAge / 2.0;
        f.pennantMat.color.copy(f.startColor).lerp(f.targetColor, t);
      }
    }

    // Prompt 7 Element 2: House banner gentle sway & 2s join color transition
    for (let i = 0; i < this.houseBanners.length; i++) {
      const b = this.houseBanners[i];
      b.mesh.rotation.z = Math.sin(this.elapsedTime * 2.2 + b.phase) * 0.08;
      if (b.startColor && b.colorLerpAge < 2.0) {
        b.colorLerpAge = Math.min(2.0, b.colorLerpAge + dt);
        const t = b.colorLerpAge / 2.0;
        b.mat.color.copy(b.startColor).lerp(b.targetColor, t);
      }
    }

    // Prompt 7 Element 2: Newly formed province roads draw smoothly from palace to center over 2.0s
    for (const road of this.activeProvinceRoads.values()) {
      if (road.drawAge < road.drawDuration) {
        road.drawAge = Math.min(road.drawDuration, road.drawAge + dt);
        const t = road.drawAge / road.drawDuration;
        const count = Math.floor((road.totalIndices / 6) * t) * 6;
        road.mesh.geometry.setDrawRange(0, Math.min(road.totalIndices, count));
      }
    }

    // Prompt 7 Element 2: Dissolved/defected roads & lowered flags fade out over 2.0s
    for (let i = this.fadingObjects.length - 1; i >= 0; i--) {
      const item = this.fadingObjects[i];
      item.age += dt;
      if (item.age >= item.duration) {
        this.fadingFxGroup.remove(item.root);
        this.disposeObjectTree(item.root);
        this.fadingObjects.splice(i, 1);
        continue;
      }
      const alpha = Math.max(0, 1 - item.age / item.duration);
      for (let m = 0; m < item.materials.length; m++) {
        item.materials[m].opacity = alpha * 0.88;
      }
      if (item.lowerY) {
        item.root.position.y = item.startY - (item.age / item.duration) * 1.6;
      }
    }

    // Prompt 7 Element 4: 3s province center highlight pulse
    if (this.provinceHighlightTimer > 0) {
      this.provinceHighlightTimer = Math.max(0, this.provinceHighlightTimer - dt);
      const pulse = 1 + Math.sin(this.elapsedTime * 5.2) * 0.14;
      this.provinceHighlightRingMesh.scale.set(pulse, 1, pulse);
      this.provinceHighlightRingMat.opacity =
        Math.min(1, this.provinceHighlightTimer / 0.6) * 0.9;
      if (this.provinceHighlightTimer <= 0) {
        this.provinceHighlightRingMesh.visible = false;
        this.provinceHighlightCubeId = null;
      }
    }

    // Prompt 7 Element 3: Subtle campfire flicker at Arrival Camp
    if (this.campFlameMesh) {
      const flick = 0.88 + Math.sin(this.elapsedTime * 11.5) * 0.14 + Math.cos(this.elapsedTime * 17.3) * 0.08;
      this.campFlameMesh.scale.set(0.92 + (flick - 0.88) * 0.5, flick, 0.92 + (flick - 0.88) * 0.5);
      if (this.campGlowLight) {
        this.campGlowLight.intensity = 1.9 + flick * 0.55;
      }
    }

    // Gentle pulse on organic hover decal and selection ground ring
    if (this.hoverDecalMesh.visible) {
      this.hoverDecalMat.opacity = 0.28 + Math.sin(this.elapsedTime * 4.2) * 0.08;
    }
    if (this.selectionRingMesh.visible) {
      const pulse = 1 + Math.sin(this.elapsedTime * 3.2) * 0.035;
      this.selectionRingMesh.scale.set(pulse, 1, pulse);
    }
  }

  private afterSoftwareDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (gl && typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 90);
    }
  }

  private tick = () => {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    this.stepSimulation(dt);
    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterSoftwareDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private startLoop(): void {
    this.lastFrameTime = performance.now();
    this.tick();
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    this.unbindEvents();

    for (const handle of this.buildingsMap.values()) {
      disposeBuildingVisual(handle, this.buildingLib);
    }
    this.buildingsMap.clear();
    this.buildingLib.dispose();
    this.wilderness.dispose();
    this.peopleAgents.dispose();

    for (const item of this.purchasableSprites) {
      item.sprite.material.dispose();
    }
    this.purchasableSprites = [];
    for (const item of this.privatePennants) {
      item.sprite.material.dispose();
    }
    this.privatePennants = [];
    for (const item of this.bankPennants) {
      item.sprite.material.dispose();
    }
    this.bankPennants = [];
    this.priceTagCache.forEach((tex) => tex.dispose());
    this.priceTagCache.clear();
    this.purchasableShimmerGeo.dispose();
    this.purchasableShimmerMat.dispose();

    for (const p of this.dustParticles) {
      p.sprite.material.dispose();
    }
    this.dustParticles.length = 0;

    for (const sp of this.seaSparkles) {
      sp.sprite.material.dispose();
    }
    this.seaSparkles = [];

    this.terrainGeometry.dispose();
    this.terrainMaterial.dispose();
    this.waterMaterial.dispose();
    this.foamMaterial.dispose();
    this.hoverDecalMesh.geometry.dispose();
    this.hoverDecalMat.dispose();
    this.selectionRingMesh.geometry.dispose();
    this.selectionRingMat.dispose();
    this.provinceHighlightRingMesh.geometry.dispose();
    this.provinceHighlightRingMat.dispose();

    while (this.provinceDressGroup.children.length > 0) {
      const ch = this.provinceDressGroup.children[0];
      this.provinceDressGroup.remove(ch);
      this.disposeObjectTree(ch);
    }
    while (this.provinceRoadsGroup.children.length > 0) {
      const ch = this.provinceRoadsGroup.children[0];
      this.provinceRoadsGroup.remove(ch);
      this.disposeObjectTree(ch);
    }
    while (this.fadingFxGroup.children.length > 0) {
      const ch = this.fadingFxGroup.children[0];
      this.fadingFxGroup.remove(ch);
      this.disposeObjectTree(ch);
    }
    while (this.campGroup.children.length > 0) {
      const ch = this.campGroup.children[0];
      this.campGroup.remove(ch);
      this.disposeObjectTree(ch);
    }
    this.provinceFlags = [];
    this.houseBanners = [];
    this.activeProvinceRoads.clear();
    this.fadingObjects = [];

    this.sandTexture.dispose();
    this.sandBumpTexture.dispose();
    this.waterTexture.dispose();
    this.skyTexture.dispose();
    this.awningTexture.dispose();
    this.dustTexture.dispose();
    this.unstaffedTexture.dispose();
    this.footprintTexture.dispose();
    this.blobShadowTexture.dispose();
    this.privatePennantTexture.dispose();
    this.bankPennantTexture.dispose();
    this.envTexture.dispose();

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
