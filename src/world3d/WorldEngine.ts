import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { THEMES } from '../game/constants';
import {
  canPlaceThemeOnCube,
  isPurchasableNeutralCube,
  makeSlotKey,
} from '../game/production';
import type { Cube, SlotIndex, ThemeId } from '../game/types';
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
import {
  createAwningTexture,
  createFootprintDecalTexture,
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
  selectedCubeId: number | null;
  activeBuildTheme: ThemeId | null;
  staffedSlots: Set<string>;
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

const HORIZON_COLOR = 0xe6d1a5;

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

export class WorldEngine {
  private readonly container: HTMLElement;
  private readonly onCubeClick: (cubeId: number) => void;
  private readonly isSoftwareGl: boolean;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly envTexture: THREE.Texture;

  private readonly sandTexture: THREE.CanvasTexture;
  private readonly sandBumpTexture: THREE.CanvasTexture;
  private readonly waterTexture: THREE.CanvasTexture;
  private readonly skyTexture: THREE.CanvasTexture;
  private readonly awningTexture: THREE.CanvasTexture;
  private readonly dustTexture: THREE.CanvasTexture;
  private readonly unstaffedTexture: THREE.CanvasTexture;
  private readonly footprintTexture: THREE.CanvasTexture;

  private readonly buildingLib: BuildingLibrary;
  private readonly wilderness: WildernessProps;

  private readonly terrainGeometry: THREE.PlaneGeometry;
  private readonly terrainMaterial: THREE.MeshStandardMaterial;
  private readonly terrainMesh: THREE.Mesh;

  private readonly boundaryGroup = new THREE.Group();
  private readonly waterGroup = new THREE.Group();
  private readonly buildingsGroup = new THREE.Group();
  private readonly fxGroup = new THREE.Group();

  private readonly waterMaterial: THREE.MeshStandardMaterial;
  private readonly foamMaterial: THREE.MeshBasicMaterial;

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
  private initialSyncDone = false;

  // Camera pan/zoom state (damped)
  private currentTarget = new THREE.Vector3(45, 0, 45);
  private desiredTarget = new THREE.Vector3(45, 0, 45);
  private currentFrustumHeight = 64;
  private desiredFrustumHeight = 64;
  private viewportWidth = 1;
  private viewportHeight = 1;

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
    onCubeClick: (cubeId: number) => void
  ) {
    this.container = container;
    this.onCubeClick = onCubeClick;
    this.isSoftwareGl = detectSoftwareWebGL();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
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

    // Warm desert sun directional light + sky/ground hemisphere fill
    const hemiLight = new THREE.HemisphereLight(0xbfe3ea, 0xd9b264, 0.95);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffe3b3, 2.15);
    sunLight.position.set(85, 115, 55);
    sunLight.castShadow = !this.isSoftwareGl;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 25;
    sunLight.shadow.camera.far = 290;
    sunLight.shadow.camera.left = -95;
    sunLight.shadow.camera.right = 95;
    sunLight.shadow.camera.top = 95;
    sunLight.shadow.camera.bottom = -95;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.03;
    this.scene.add(sunLight);

    // Procedural Canvas Textures
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.sandTexture = createSandTexture(maxAniso);
    this.sandBumpTexture = createSandBumpTexture(maxAniso);
    this.waterTexture = createWaterWaveTexture(maxAniso);
    this.awningTexture = createAwningTexture(maxAniso);
    this.dustTexture = createSoftCircleTexture();
    this.unstaffedTexture = createUnstaffedBadgeTexture();
    this.footprintTexture = createFootprintDecalTexture();

    this.buildingLib = createBuildingLibrary(
      this.awningTexture,
      this.unstaffedTexture
    );

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

    this.wilderness = new WildernessProps();
    this.scene.add(
      this.wilderness.group,
      this.waterGroup,
      this.boundaryGroup,
      this.buildingsGroup,
      this.fxGroup,
      this.hoverDecalMesh,
      this.selectionRingMesh
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
    const seaSet = new Set<string>();
    const ownedSet = new Set<string>();

    for (const c of payload.cubes) {
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
    const seaChanged = seaSignature !== this.lastSeaSignature;
    const ownedChanged = ownedSignature !== this.lastOwnedSignature;

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

    this.syncBuildings(payload);
    this.updateSelectionRing();
    this.updateHoverDecal();
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

  private raycastCellAtClient(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
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

    this.sandTexture.dispose();
    this.sandBumpTexture.dispose();
    this.waterTexture.dispose();
    this.skyTexture.dispose();
    this.awningTexture.dispose();
    this.dustTexture.dispose();
    this.unstaffedTexture.dispose();
    this.footprintTexture.dispose();
    this.envTexture.dispose();

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
