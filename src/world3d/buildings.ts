import * as THREE from 'three';
import { THEMES } from '../game/constants';
import type { ThemeId } from '../game/types';
import {
  createBlobShadowTexture,
  createMarbleTexture,
  createPackedEarthTexture,
  createPlasterTexture,
  createStoneBlocksTexture,
  createTerracottaRoofTexture,
  createThatchTexture,
  createWoodPlanksTexture,
} from './textures';
import { hash2D } from './worldMath';
export {
  type AnchorPoint,
  type AnchorWorldContext,
  type BuildingAnchors,
  type FootprintRect,
  getBuildingAnchors,
} from './anchors';

export interface BuildingTexturesBundle {
  plaster: THREE.CanvasTexture;
  wood: THREE.CanvasTexture;
  stone: THREE.CanvasTexture;
  terracotta: THREE.CanvasTexture;
  thatch: THREE.CanvasTexture;
  marble: THREE.CanvasTexture;
  packedEarth: THREE.CanvasTexture;
  blobShadow: THREE.CanvasTexture;
  awning: THREE.CanvasTexture;
  unstaffed: THREE.CanvasTexture;
}

export interface BuildingLibrary {
  materials: {
    plaster: THREE.MeshStandardMaterial;
    terracotta: THREE.MeshStandardMaterial;
    stone: THREE.MeshStandardMaterial;
    marble: THREE.MeshStandardMaterial;
    thatch: THREE.MeshStandardMaterial;
    wood: THREE.MeshStandardMaterial;
    darkWood: THREE.MeshStandardMaterial;
    soil: THREE.MeshStandardMaterial;
    forestSoil: THREE.MeshStandardMaterial;
    pastureGrass: THREE.MeshStandardMaterial;
    foliageMain: THREE.MeshStandardMaterial;
    foliageDark: THREE.MeshStandardMaterial;
    cropGreen: THREE.MeshStandardMaterial;
    cropWheat: THREE.MeshStandardMaterial;
    fruitAccent: THREE.MeshStandardMaterial;
    awning: THREE.MeshStandardMaterial;
    wellWater: THREE.MeshStandardMaterial;
    sheepWhite: THREE.MeshStandardMaterial;
    cowBrown: THREE.MeshStandardMaterial;
    goldAccent: THREE.MeshStandardMaterial;
    bannerTeal: THREE.MeshStandardMaterial;
    bannerCrimson: THREE.MeshStandardMaterial;
    ironOre: THREE.MeshStandardMaterial;
    copperOre: THREE.MeshStandardMaterial;
    gemCrystal: THREE.MeshStandardMaterial;
    oilDark: THREE.MeshStandardMaterial;
    clinicEmerald: THREE.MeshStandardMaterial;
    warmWindow: THREE.MeshStandardMaterial;
    packedEarth: THREE.MeshBasicMaterial;
    blobShadow: THREE.MeshBasicMaterial;
    goldRing: THREE.MeshBasicMaterial;
    ringTrack: THREE.MeshBasicMaterial;
  };
  geometries: {
    cropStalk: THREE.ConeGeometry;
    roundedFullPlot: THREE.ExtrudeGeometry;
    roundedPasturePlot: THREE.ExtrudeGeometry;
    foundationFull: THREE.PlaneGeometry;
    foundationHalf: THREE.PlaneGeometry;
    shadowFull: THREE.PlaneGeometry;
    shadowHalf: THREE.PlaneGeometry;
    barrel: THREE.CylinderGeometry;
    crate: THREE.BoxGeometry;
    sack: THREE.SphereGeometry;
  };
  unstaffedTexture: THREE.CanvasTexture;
  dispose: () => void;
}

export interface PastureAnimal {
  mesh: THREE.Group;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  speed: number;
  pauseTimer: number;
}

export interface BuildingVisualHandle {
  key: string;
  cubeId: number;
  slot: 0 | 1;
  themeId: ThemeId;
  root: THREE.Group;
  bodyGroup: THREE.Group;
  riseAge: number;
  isUnstaffedVisual: boolean;
  unstaffedSprite: THREE.Sprite | null;
  progressArcMesh: THREE.Mesh | null;
  progressTrackMesh: THREE.Mesh | null;
  lastProgressBucket: number;
  farmCropsMesh: THREE.InstancedMesh | null;
  farmCropOffsets: Array<{ x: number; z: number; rot: number; baseScale: number }>;
  animals: PastureAnimal[];
  clonedMaterials: THREE.Material[];
}

function createRoundedRectShape(width: number, depth: number, radius: number): THREE.Shape {
  const w = width / 2;
  const d = depth / 2;
  const r = Math.min(radius, w * 0.45, d * 0.45);
  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -d);
  shape.lineTo(w - r, -d);
  shape.quadraticCurveTo(w, -d, w, -d + r);
  shape.lineTo(w, d - r);
  shape.quadraticCurveTo(w, d, w - r, d);
  shape.lineTo(-w + r, d);
  shape.quadraticCurveTo(-w, d, -w, d - r);
  shape.lineTo(-w, -d + r);
  shape.quadraticCurveTo(-w, -d, -w + r, -d);
  shape.closePath();
  return shape;
}

function createPrismRoofGeometry(width: number, height: number, depth: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

export function createBuildingLibrary(
  awningTexture: THREE.CanvasTexture,
  unstaffedTexture: THREE.CanvasTexture
): BuildingLibrary {
  const ownedTextures = {
    plaster: createPlasterTexture(4),
    wood: createWoodPlanksTexture(4),
    stone: createStoneBlocksTexture(4),
    terracotta: createTerracottaRoofTexture(4),
    thatch: createThatchTexture(4),
    marble: createMarbleTexture(4),
    packedEarth: createPackedEarthTexture(4),
    blobShadow: createBlobShadowTexture(),
  };
  const tex: BuildingTexturesBundle = {
    ...ownedTextures,
    awning: awningTexture,
    unstaffed: unstaffedTexture,
  };

  // All building materials use procedural 512px canvas maps + roughness maps (zero flat colors)
  const materials = {
    plaster: new THREE.MeshStandardMaterial({
      map: tex.plaster,
      roughnessMap: tex.plaster,
      roughness: 0.9,
      metalness: 0.02,
    }),
    terracotta: new THREE.MeshStandardMaterial({
      map: tex.terracotta,
      roughnessMap: tex.terracotta,
      roughness: 0.72,
      metalness: 0.03,
    }),
    stone: new THREE.MeshStandardMaterial({
      map: tex.stone,
      roughnessMap: tex.stone,
      roughness: 0.92,
      metalness: 0.04,
    }),
    marble: new THREE.MeshStandardMaterial({
      map: tex.marble,
      roughnessMap: tex.marble,
      roughness: 0.56,
      metalness: 0.06,
    }),
    thatch: new THREE.MeshStandardMaterial({
      map: tex.thatch,
      roughnessMap: tex.thatch,
      roughness: 0.95,
      metalness: 0.0,
    }),
    wood: new THREE.MeshStandardMaterial({
      map: tex.wood,
      roughnessMap: tex.wood,
      roughness: 0.86,
      metalness: 0.02,
    }),
    darkWood: new THREE.MeshStandardMaterial({
      map: tex.wood,
      color: 0x705640,
      roughness: 0.88,
      metalness: 0.02,
    }),
    soil: new THREE.MeshStandardMaterial({
      map: tex.plaster,
      color: 0x7c5332,
      roughness: 0.96,
      metalness: 0.0,
    }),
    forestSoil: new THREE.MeshStandardMaterial({
      map: tex.plaster,
      color: 0x5c442b,
      roughness: 0.96,
      metalness: 0.0,
    }),
    pastureGrass: new THREE.MeshStandardMaterial({
      map: tex.thatch,
      color: 0x7aa348,
      roughness: 0.92,
      metalness: 0.0,
    }),
    foliageMain: new THREE.MeshStandardMaterial({
      map: tex.thatch,
      color: 0x3b6e44,
      roughness: 0.86,
      metalness: 0.0,
    }),
    foliageDark: new THREE.MeshStandardMaterial({
      map: tex.thatch,
      color: 0x2c5635,
      roughness: 0.88,
      metalness: 0.0,
    }),
    cropGreen: new THREE.MeshStandardMaterial({
      map: tex.thatch,
      color: 0x5a9649,
      roughness: 0.82,
      metalness: 0.0,
    }),
    cropWheat: new THREE.MeshStandardMaterial({
      map: tex.thatch,
      color: 0xd4ad52,
      roughness: 0.82,
      metalness: 0.0,
    }),
    fruitAccent: new THREE.MeshStandardMaterial({
      map: tex.plaster,
      color: 0xc9623b,
      roughness: 0.65,
      metalness: 0.02,
    }),
    awning: new THREE.MeshStandardMaterial({
      map: tex.awning,
      roughness: 0.78,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
    wellWater: new THREE.MeshStandardMaterial({
      color: 0x2b7a9b,
      roughness: 0.16,
      metalness: 0.08,
    }),
    sheepWhite: new THREE.MeshStandardMaterial({
      map: tex.plaster,
      color: 0xeee5d5,
      roughness: 0.94,
      metalness: 0.0,
    }),
    cowBrown: new THREE.MeshStandardMaterial({
      map: tex.wood,
      color: 0x875c3e,
      roughness: 0.9,
      metalness: 0.0,
    }),
    goldAccent: new THREE.MeshStandardMaterial({
      map: tex.marble,
      color: 0xdcb043,
      roughness: 0.28,
      metalness: 0.72,
    }),
    bannerTeal: new THREE.MeshStandardMaterial({
      map: tex.plaster,
      color: 0x1a6157,
      roughness: 0.8,
      side: THREE.DoubleSide,
    }),
    bannerCrimson: new THREE.MeshStandardMaterial({
      map: tex.plaster,
      color: 0xa44736,
      roughness: 0.8,
      side: THREE.DoubleSide,
    }),
    ironOre: new THREE.MeshStandardMaterial({
      map: tex.stone,
      color: 0x626b73,
      roughness: 0.55,
      metalness: 0.48,
    }),
    copperOre: new THREE.MeshStandardMaterial({
      map: tex.stone,
      color: 0xb56d44,
      roughness: 0.45,
      metalness: 0.52,
    }),
    gemCrystal: new THREE.MeshStandardMaterial({
      map: tex.marble,
      color: 0x2c9c7d,
      roughness: 0.22,
      metalness: 0.25,
    }),
    oilDark: new THREE.MeshStandardMaterial({
      map: tex.stone,
      color: 0x2c2a28,
      roughness: 0.35,
      metalness: 0.2,
    }),
    clinicEmerald: new THREE.MeshStandardMaterial({
      map: tex.marble,
      color: 0x2f8752,
      roughness: 0.5,
      metalness: 0.05,
    }),
    warmWindow: new THREE.MeshStandardMaterial({
      color: 0xffe4a0,
      emissive: 0xe8a430,
      emissiveIntensity: 0.72,
      roughness: 0.24,
      metalness: 0.12,
    }),
    packedEarth: new THREE.MeshBasicMaterial({
      map: tex.packedEarth,
      color: new THREE.Color(0.92, 0.92, 0.92),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    blobShadow: new THREE.MeshBasicMaterial({
      map: tex.blobShadow,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    goldRing: new THREE.MeshBasicMaterial({
      color: 0xe6b84b,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
    ringTrack: new THREE.MeshBasicMaterial({
      color: 0x2b2118,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  };

  const roundedFullShape = createRoundedRectShape(8.2, 8.2, 1.5);
  const roundedFullPlot = new THREE.ExtrudeGeometry(roundedFullShape, {
    depth: 0.26,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.12,
    bevelSegments: 2,
  });
  roundedFullPlot.rotateX(-Math.PI / 2);

  const roundedPastureShape = createRoundedRectShape(8.4, 8.4, 1.7);
  const roundedPasturePlot = new THREE.ExtrudeGeometry(roundedPastureShape, {
    depth: 0.2,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.12,
    bevelSegments: 2,
  });
  roundedPasturePlot.rotateX(-Math.PI / 2);

  const cropStalk = new THREE.ConeGeometry(0.32, 1.18, 5);
  cropStalk.translate(0, 0.59, 0);

  const foundationFull = new THREE.PlaneGeometry(10.6, 10.6);
  foundationFull.rotateX(-Math.PI / 2);

  const foundationHalf = new THREE.PlaneGeometry(5.6, 5.6);
  foundationHalf.rotateX(-Math.PI / 2);

  const shadowFull = new THREE.PlaneGeometry(9.2, 9.2);
  shadowFull.rotateX(-Math.PI / 2);

  const shadowHalf = new THREE.PlaneGeometry(4.8, 4.8);
  shadowHalf.rotateX(-Math.PI / 2);

  const barrel = new THREE.CylinderGeometry(0.24, 0.22, 0.52, 8);
  barrel.translate(0, 0.26, 0);

  const crate = new THREE.BoxGeometry(0.48, 0.45, 0.48);
  crate.translate(0, 0.225, 0);

  const sack = new THREE.SphereGeometry(0.26, 7, 6);
  sack.scale(1.1, 0.78, 0.9);
  sack.translate(0, 0.2, 0);

  return {
    materials,
    geometries: {
      cropStalk,
      roundedFullPlot,
      roundedPasturePlot,
      foundationFull,
      foundationHalf,
      shadowFull,
      shadowHalf,
      barrel,
      crate,
      sack,
    },
    unstaffedTexture: tex.unstaffed,
    dispose: () => {
      Object.values(materials).forEach((m) => m.dispose());
      Object.values(ownedTextures).forEach((t) => t.dispose());
      cropStalk.dispose();
      roundedFullPlot.dispose();
      roundedPasturePlot.dispose();
      foundationFull.dispose();
      foundationHalf.dispose();
      shadowFull.dispose();
      shadowHalf.dispose();
      barrel.dispose();
      crate.dispose();
      sack.dispose();
    },
  };
}

function enableShadows(obj: THREE.Object3D, cast = true, receive = true) {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
}

function addSmallProps(
  g: THREE.Group,
  lib: BuildingLibrary,
  kind: 'crates' | 'sacks' | 'cart' | 'laundry'
) {
  if (kind === 'crates') {
    const c1 = new THREE.Mesh(lib.geometries.crate, lib.materials.wood);
    c1.position.set(1.85, 0.02, 1.35);
    c1.rotation.y = 0.25;
    g.add(c1);

    const b1 = new THREE.Mesh(lib.geometries.barrel, lib.materials.darkWood);
    b1.position.set(2.15, 0.02, 0.8);
    g.add(b1);
  } else if (kind === 'sacks') {
    const s1 = new THREE.Mesh(lib.geometries.sack, lib.materials.thatch);
    s1.position.set(-1.75, 0.02, 1.45);
    g.add(s1);
    const s2 = new THREE.Mesh(lib.geometries.sack, lib.materials.thatch);
    s2.position.set(-1.35, 0.02, 1.65);
    g.add(s2);
  } else if (kind === 'cart') {
    const cartBed = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.28, 0.72),
      lib.materials.wood
    );
    cartBed.position.set(-2.05, 0.42, 1.3);
    cartBed.rotation.y = 0.35;
    g.add(cartBed);

    const wheelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.1, 8);
    wheelGeo.rotateX(Math.PI / 2);
    const w1 = new THREE.Mesh(wheelGeo, lib.materials.darkWood);
    w1.position.set(-2.05, 0.24, 1.65);
    g.add(w1);
    const w2 = new THREE.Mesh(wheelGeo, lib.materials.darkWood);
    w2.position.set(-2.05, 0.24, 0.95);
    g.add(w2);
  } else if (kind === 'laundry') {
    const p1 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.25, 5),
      lib.materials.wood
    );
    p1.position.set(-1.85, 0.62, 0.95);
    g.add(p1);
    const p2 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.25, 5),
      lib.materials.wood
    );
    p2.position.set(-1.85, 0.62, -0.75);
    g.add(p2);
    const cloth = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.42, 1.15),
      lib.materials.plaster
    );
    cloth.position.set(-1.85, 0.95, 0.1);
    g.add(cloth);
  }
}

// WP3: Grand Ruler's Palace (~1.6x house scale, marble + gold dome + banners + courtyard)
function buildPalace(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  // Raised stone courtyard terrace
  const terrace = new THREE.Mesh(
    new THREE.BoxGeometry(8.2, 0.48, 8.2),
    lib.materials.stone
  );
  terrace.position.y = 0.24;
  g.add(terrace);

  // Main marble palace hall
  const hall = new THREE.Mesh(
    new THREE.BoxGeometry(5.6, 3.6, 5.2),
    lib.materials.marble
  );
  hall.position.set(0, 2.25, -0.5);
  g.add(hall);

  // Twin side wings
  const wingGeo = new THREE.BoxGeometry(1.7, 2.6, 4.4);
  const leftWing = new THREE.Mesh(wingGeo, lib.materials.plaster);
  leftWing.position.set(-3.3, 1.75, -0.2);
  g.add(leftWing);
  const rightWing = new THREE.Mesh(wingGeo, lib.materials.plaster);
  rightWing.position.set(3.3, 1.75, -0.2);
  g.add(rightWing);

  // Terracotta parapet trim
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(6.0, 0.32, 5.6),
    lib.materials.terracotta
  );
  trim.position.set(0, 4.18, -0.5);
  g.add(trim);

  // Golden main dome + finial spire
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 2.05, 0.9, 14),
    lib.materials.marble
  );
  drum.position.set(0, 4.7, -0.5);
  g.add(drum);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.88, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
    lib.materials.goldAccent
  );
  dome.position.set(0, 5.05, -0.5);
  g.add(dome);

  const finial = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 1.1, 6),
    lib.materials.goldAccent
  );
  finial.position.set(0, 7.3, -0.5);
  g.add(finial);

  // Grand arched portal
  const portal = new THREE.Mesh(
    new THREE.BoxGeometry(1.65, 2.2, 0.35),
    lib.materials.darkWood
  );
  portal.position.set(0, 1.55, 2.1);
  g.add(portal);

  // Courtyard water fountain disc
  const fountainBase = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.2, 0.35, 12),
    lib.materials.marble
  );
  fountainBase.position.set(0, 0.65, 3.05);
  g.add(fountainBase);

  const fountainWater = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.85, 0.08, 12),
    lib.materials.wellWater
  );
  fountainWater.position.set(0, 0.84, 3.05);
  g.add(fountainWater);

  // Royal banners on poles
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 4.6, 6);
  const bannerGeo = new THREE.PlaneGeometry(0.75, 1.6);
  for (const bx of [-3.4, 3.4]) {
    const pole = new THREE.Mesh(poleGeo, lib.materials.goldAccent);
    pole.position.set(bx, 2.75, 2.7);
    g.add(pole);
    const banner = new THREE.Mesh(bannerGeo, lib.materials.bannerTeal);
    banner.position.set(bx, 4.15, 2.95);
    g.add(banner);
  }

  enableShadows(g);
  return g;
}

// WP3: Independent Neutral Village (2-3 tiny weathered grey-brown houses, no color banner)
export function createVillageVisual(lib: BuildingLibrary, seed: number): THREE.Group {
  const g = new THREE.Group();

  const earth = new THREE.Mesh(lib.geometries.foundationFull, lib.materials.packedEarth);
  earth.position.y = 0.03;
  g.add(earth);

  const huts: Array<[number, number, number]> = [
    [-2.0, -1.3, 0.88],
    [1.8, -0.7, 0.78],
    [-0.3, 2.0, 0.82],
  ];

  huts.forEach(([hx, hz, sc], idx) => {
    const hut = new THREE.Group();
    hut.position.set(hx, 0, hz);
    hut.rotation.y = hash2D(seed + idx, 7.1) * Math.PI * 2;
    hut.scale.setScalar(sc);

    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 1.7, 2.2),
      lib.materials.stone
    );
    walls.position.y = 0.85;
    hut.add(walls);

    const roof = new THREE.Mesh(
      createPrismRoofGeometry(2.8, 1.05, 2.5),
      lib.materials.thatch
    );
    roof.position.y = 1.68;
    hut.add(roof);

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.85, 0.1),
      lib.materials.darkWood
    );
    door.position.set(0, 0.45, 1.12);
    hut.add(door);

    g.add(hut);
  });

  enableShadows(g);
  return g;
}

function buildHouse(lib: BuildingLibrary, seed: number): THREE.Group {
  const g = new THREE.Group();
  const rotY = ((Math.floor(seed * 4) % 4) * Math.PI) / 2;

  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(3.45, 0.28, 3.15),
    lib.materials.stone
  );
  plinth.position.y = 0.14;
  g.add(plinth);

  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(3.12, 2.2, 2.82),
    lib.materials.plaster
  );
  walls.position.y = 1.38;
  g.add(walls);

  const roof = new THREE.Mesh(
    createPrismRoofGeometry(3.52, 1.48, 3.18),
    lib.materials.terracotta
  );
  roof.position.y = 2.46;
  g.add(roof);

  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.9, 0.45),
    lib.materials.plaster
  );
  chimney.position.set(0.85, 3.3, -0.52);
  g.add(chimney);

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.66, 1.12, 0.12),
    lib.materials.darkWood
  );
  door.position.set(0, 0.84, 1.42);
  g.add(door);

  const win = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.5, 0.55),
    lib.materials.wood
  );
  win.position.set(1.56, 1.52, 0.2);
  g.add(win);

  addSmallProps(g, lib, 'laundry');
  g.rotation.y = rotY;
  enableShadows(g);
  return g;
}

function buildWell(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(1.72, 1.88, 0.22, 12),
    lib.materials.stone
  );
  pad.position.y = 0.11;
  g.add(pad);

  const wellBody = new THREE.Mesh(
    new THREE.CylinderGeometry(1.18, 1.28, 1.12, 12),
    lib.materials.stone
  );
  wellBody.position.y = 0.72;
  g.add(wellBody);

  const waterDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.94, 0.94, 0.08, 12),
    lib.materials.wellWater
  );
  waterDisc.position.y = 1.26;
  g.add(waterDisc);

  const postGeo = new THREE.BoxGeometry(0.22, 1.92, 0.22);
  const lp = new THREE.Mesh(postGeo, lib.materials.wood);
  lp.position.set(-1.0, 1.92, 0);
  g.add(lp);
  const rp = new THREE.Mesh(postGeo, lib.materials.wood);
  rp.position.set(1.0, 1.92, 0);
  g.add(rp);

  const axle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8),
    lib.materials.darkWood
  );
  axle.rotation.z = Math.PI / 2;
  axle.position.y = 2.32;
  g.add(axle);

  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.92, 6),
    lib.materials.thatch
  );
  rope.position.y = 1.84;
  g.add(rope);

  const bucket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.17, 0.34, 8),
    lib.materials.wood
  );
  bucket.position.y = 1.44;
  g.add(bucket);

  const roof = new THREE.Mesh(
    createPrismRoofGeometry(2.52, 0.94, 2.08),
    lib.materials.terracotta
  );
  roof.position.y = 2.78;
  g.add(roof);

  enableShadows(g);
  return g;
}

function buildShop(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(3.55, 0.24, 3.25),
    lib.materials.stone
  );
  base.position.y = 0.12;
  g.add(base);

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(3.15, 2.1, 2.3),
    lib.materials.plaster
  );
  box.position.set(0, 1.28, -0.25);
  g.add(box);

  const roofTrim = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 0.34, 2.55),
    lib.materials.terracotta
  );
  roofTrim.position.set(0, 2.46, -0.25);
  g.add(roofTrim);

  const awning = new THREE.Mesh(
    new THREE.PlaneGeometry(3.3, 1.62),
    lib.materials.awning
  );
  awning.position.set(0, 2.05, 1.42);
  awning.rotation.x = -Math.PI / 2 + 0.36;
  g.add(awning);

  const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.72, 6);
  const lp = new THREE.Mesh(poleGeo, lib.materials.wood);
  lp.position.set(-1.42, 0.98, 2.02);
  g.add(lp);
  const rp = new THREE.Mesh(poleGeo, lib.materials.wood);
  rp.position.set(1.42, 0.98, 2.02);
  g.add(rp);

  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(2.55, 0.7, 0.7),
    lib.materials.wood
  );
  counter.position.set(0, 0.58, 1.3);
  g.add(counter);

  addSmallProps(g, lib, 'cart');
  addSmallProps(g, lib, 'crates');
  enableShadows(g);
  return g;
}

function buildBakery(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.1, 2.1, 2.9),
    lib.materials.plaster
  );
  body.position.y = 1.05;
  g.add(body);

  const roof = new THREE.Mesh(
    createPrismRoofGeometry(3.4, 1.2, 3.2),
    lib.materials.terracotta
  );
  roof.position.y = 2.1;
  g.add(roof);

  // Brick dome baking oven & chimney on the side
  const oven = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
    lib.materials.stone
  );
  oven.position.set(1.55, 0.1, 0.35);
  g.add(oven);

  const chimney = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.32, 2.8, 8),
    lib.materials.stone
  );
  chimney.position.set(1.55, 1.65, 0.35);
  g.add(chimney);

  addSmallProps(g, lib, 'sacks');
  enableShadows(g);
  return g;
}

function buildRestaurantOrCafe(lib: BuildingLibrary, isRestaurant: boolean): THREE.Group {
  const g = new THREE.Group();

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(3.75, 0.22, 3.55),
    lib.materials.stone
  );
  deck.position.y = 0.11;
  g.add(deck);

  const hall = new THREE.Mesh(
    new THREE.BoxGeometry(3.1, isRestaurant ? 2.35 : 1.95, 2.0),
    lib.materials.plaster
  );
  hall.position.set(0, (isRestaurant ? 2.35 : 1.95) / 2 + 0.22, -0.6);
  g.add(hall);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 0.36, 2.35),
    isRestaurant ? lib.materials.terracotta : lib.materials.thatch
  );
  roof.position.set(0, isRestaurant ? 2.65 : 2.25, -0.6);
  g.add(roof);

  const awning = new THREE.Mesh(
    new THREE.PlaneGeometry(3.35, 1.75),
    lib.materials.awning
  );
  awning.position.set(0, 1.95, 1.1);
  awning.rotation.x = -Math.PI / 2 + 0.3;
  g.add(awning);

  // Outdoor dining table
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 0.1, 8),
    lib.materials.wood
  );
  table.position.set(-0.7, 0.72, 1.25);
  g.add(table);

  const tableLeg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 0.5, 6),
    lib.materials.darkWood
  );
  tableLeg.position.set(-0.7, 0.45, 1.25);
  g.add(tableLeg);

  enableShadows(g);
  return g;
}

function buildCropFarm(
  lib: BuildingLibrary,
  isWheat: boolean
): {
  group: THREE.Group;
  cropsMesh: THREE.InstancedMesh;
  offsets: Array<{ x: number; z: number; rot: number; baseScale: number }>;
} {
  const g = new THREE.Group();

  const soilMesh = new THREE.Mesh(lib.geometries.roundedFullPlot, lib.materials.soil);
  soilMesh.receiveShadow = true;
  soilMesh.castShadow = true;
  g.add(soilMesh);

  // Small thatch storage shed in back corner
  const shedWalls = new THREE.Mesh(
    new THREE.BoxGeometry(1.75, 1.2, 1.55),
    lib.materials.wood
  );
  shedWalls.position.set(-2.65, 0.82, -2.65);
  g.add(shedWalls);

  const shedRoof = new THREE.Mesh(
    createPrismRoofGeometry(2.05, 0.85, 1.85),
    lib.materials.thatch
  );
  shedRoof.position.set(-2.65, 1.4, -2.65);
  g.add(shedRoof);

  // Plowed rows
  const ridgeGeo = new THREE.BoxGeometry(6.6, 0.14, 0.52);
  for (let row = 0; row < 4; row++) {
    const z = -2.4 + row * 1.65;
    const ridge = new THREE.Mesh(ridgeGeo, lib.materials.forestSoil);
    ridge.position.set(0.35, 0.32, z);
    ridge.receiveShadow = true;
    g.add(ridge);
  }

  // Instanced growing crops
  const offsets: Array<{ x: number; z: number; rot: number; baseScale: number }> = [];
  const count = 24;
  const cropsMesh = new THREE.InstancedMesh(
    lib.geometries.cropStalk,
    isWheat ? lib.materials.cropWheat : lib.materials.cropGreen,
    count
  );
  cropsMesh.castShadow = true;
  cropsMesh.receiveShadow = true;

  const c1 = new THREE.Color(isWheat ? 0xe0ba5c : 0x67a352);
  const c2 = new THREE.Color(isWheat ? 0xc49a42 : 0x4b8244);

  let idx = 0;
  for (let row = 0; row < 4; row++) {
    const z = -2.4 + row * 1.65;
    for (let col = 0; col < 6; col++) {
      const x = -2.4 + col * 1.12;
      // Leave small clearance for the corner shed
      const adjustedX = row === 0 && col < 2 ? x + 2.6 : x;
      const adjustedZ = row === 0 && col < 2 ? z + 0.5 : z;
      const rot = hash2D(col * 3, row * 9) * Math.PI * 2;
      const baseScale = 0.86 + hash2D(row + 19, col + 29) * 0.28;
      offsets.push({ x: adjustedX, z: adjustedZ, rot, baseScale });
      cropsMesh.setColorAt(idx, row % 2 === 0 ? c1 : c2);
      idx += 1;
    }
  }
  if (cropsMesh.instanceColor) cropsMesh.instanceColor.needsUpdate = true;
  cropsMesh.frustumCulled = false;
  g.add(cropsMesh);

  addSmallProps(g, lib, 'sacks');
  enableShadows(g);
  return { group: g, cropsMesh, offsets };
}

function buildOrchard(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const meadow = new THREE.Mesh(
    lib.geometries.roundedPasturePlot,
    lib.materials.pastureGrass
  );
  g.add(meadow);

  const coords: Array<[number, number]> = [
    [-2.1, -2.0],
    [1.9, -2.0],
    [-2.0, 1.9],
    [2.0, 1.9],
    [0, 0],
  ];

  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.5, 7);
  const crownGeo = new THREE.DodecahedronGeometry(1.35, 1);
  const fruitGeo = new THREE.SphereGeometry(0.18, 6, 5);

  coords.forEach(([tx, tz]) => {
    const tree = new THREE.Group();
    tree.position.set(tx, 0.22, tz);

    const trunk = new THREE.Mesh(trunkGeo, lib.materials.wood);
    trunk.position.y = 0.75;
    tree.add(trunk);

    const crown = new THREE.Mesh(crownGeo, lib.materials.foliageMain);
    crown.position.y = 2.25;
    tree.add(crown);

    for (let f = 0; f < 3; f++) {
      const ang = (f / 3) * Math.PI * 2;
      const fruit = new THREE.Mesh(fruitGeo, lib.materials.fruitAccent);
      fruit.position.set(Math.cos(ang) * 0.95, 2.15 + (f % 2) * 0.35, Math.sin(ang) * 0.95);
      tree.add(fruit);
    }

    g.add(tree);
  });

  addSmallProps(g, lib, 'crates');
  enableShadows(g);
  return g;
}

function buildForest(lib: BuildingLibrary, seed: number): THREE.Group {
  const g = new THREE.Group();

  const soilMesh = new THREE.Mesh(
    lib.geometries.roundedFullPlot,
    lib.materials.forestSoil
  );
  g.add(soilMesh);

  const treeCoords = [
    [-2.4, -2.1],
    [0.2, -2.4],
    [2.5, -1.6],
    [-1.8, 0.4],
    [1.0, 0.2],
    [-2.2, 2.3],
    [1.9, 2.2],
  ];

  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 1.35, 7);
  const coneBottomGeo = new THREE.ConeGeometry(1.22, 2.15, 7);
  const coneTopGeo = new THREE.ConeGeometry(0.92, 1.75, 7);

  treeCoords.forEach(([bx, bz], i) => {
    const jx = (hash2D(seed * 17 + i, 3.1) - 0.5) * 0.6;
    const jz = (hash2D(seed * 23 + i, 9.7) - 0.5) * 0.6;
    const sc = 0.8 + hash2D(seed * 31 + i, 5.5) * 0.4;

    const tree = new THREE.Group();
    tree.position.set(bx + jx, 0.28, bz + jz);
    tree.scale.setScalar(sc);

    const trunk = new THREE.Mesh(trunkGeo, lib.materials.wood);
    trunk.position.y = 0.65;
    tree.add(trunk);

    const lower = new THREE.Mesh(
      coneBottomGeo,
      i % 2 === 0 ? lib.materials.foliageMain : lib.materials.foliageDark
    );
    lower.position.y = 2.0;
    tree.add(lower);

    const upper = new THREE.Mesh(
      coneTopGeo,
      i % 2 === 0 ? lib.materials.foliageDark : lib.materials.foliageMain
    );
    upper.position.y = 3.15;
    tree.add(upper);

    g.add(tree);
  });

  // Stacked timber logs
  const logGeo = new THREE.CylinderGeometry(0.18, 0.18, 1.6, 7);
  logGeo.rotateZ(Math.PI / 2);
  for (let l = 0; l < 3; l++) {
    const log = new THREE.Mesh(logGeo, lib.materials.wood);
    log.position.set(0, 0.44 + (l === 2 ? 0.28 : 0), 3.15 + (l % 2) * 0.34);
    g.add(log);
  }

  enableShadows(g);
  return g;
}

function buildQuarry(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const base = new THREE.Mesh(lib.geometries.roundedFullPlot, lib.materials.stone);
  g.add(base);

  // Stepped carved quarry blocks
  const step1 = new THREE.Mesh(
    new THREE.BoxGeometry(5.8, 1.1, 2.6),
    lib.materials.stone
  );
  step1.position.set(0, 0.78, -2.0);
  g.add(step1);

  const step2 = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 1.9, 1.8),
    lib.materials.stone
  );
  step2.position.set(-1.1, 1.2, -2.4);
  g.add(step2);

  // Cut stone cubes ready for hauling
  for (let i = 0; i < 3; i++) {
    const blk = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.85, 1.05),
      lib.materials.marble
    );
    blk.position.set(-2.0 + i * 1.45, 0.65, 2.1);
    blk.rotation.y = i * 0.2;
    g.add(blk);
  }

  // Timber crane arm
  const mast = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 3.6, 0.28),
    lib.materials.wood
  );
  mast.position.set(2.2, 2.0, 0.5);
  g.add(mast);

  const boom = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 0.22, 0.22),
    lib.materials.wood
  );
  boom.position.set(1.1, 3.5, 0.5);
  boom.rotation.z = 0.24;
  g.add(boom);

  enableShadows(g);
  return g;
}

function buildMine(
  lib: BuildingLibrary,
  oreKind: 'iron' | 'copper' | 'gold' | 'gem'
): THREE.Group {
  const g = new THREE.Group();

  // Rocky mound
  const mound = new THREE.Mesh(
    new THREE.DodecahedronGeometry(3.3, 1),
    lib.materials.stone
  );
  mound.scale.set(1.2, 0.72, 1.05);
  mound.position.set(0, 1.45, -1.1);
  g.add(mound);

  // Dark tunnel entrance framed with timber beams
  const tunnel = new THREE.Mesh(
    new THREE.BoxGeometry(1.85, 1.95, 1.1),
    lib.materials.oilDark
  );
  tunnel.position.set(0, 1.0, 1.15);
  g.add(tunnel);

  const beamV = new THREE.BoxGeometry(0.26, 2.25, 0.28);
  const bl = new THREE.Mesh(beamV, lib.materials.wood);
  bl.position.set(-1.05, 1.12, 1.65);
  g.add(bl);
  const br = new THREE.Mesh(beamV, lib.materials.wood);
  br.position.set(1.05, 1.12, 1.65);
  g.add(br);
  const bt = new THREE.Mesh(
    new THREE.BoxGeometry(2.55, 0.28, 0.34),
    lib.materials.wood
  );
  bt.position.set(0, 2.22, 1.65);
  g.add(bt);

  // Ore vein / crystal clusters indicating mine type
  const oreMat =
    oreKind === 'iron'
      ? lib.materials.ironOre
      : oreKind === 'copper'
        ? lib.materials.copperOre
        : oreKind === 'gold'
          ? lib.materials.goldAccent
          : lib.materials.gemCrystal;

  const oreGeo = new THREE.OctahedronGeometry(0.55, 0);
  const oreSpots: Array<[number, number, number]> = [
    [-2.2, 0.65, 1.7],
    [2.1, 0.7, 1.4],
    [-1.5, 2.2, -0.4],
    [1.6, 1.9, -0.6],
  ];
  oreSpots.forEach(([ox, oy, oz], i) => {
    const chunk = new THREE.Mesh(oreGeo, oreMat);
    chunk.position.set(ox, oy, oz);
    chunk.rotation.set(i * 0.5, i * 0.9, 0);
    g.add(chunk);
  });

  // Mine cart
  const cart = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.7, 1.3),
    lib.materials.darkWood
  );
  cart.position.set(0, 0.52, 2.85);
  g.add(cart);

  const cartOre = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), oreMat);
  cartOre.position.set(0, 0.96, 2.85);
  g.add(cartOre);

  enableShadows(g);
  return g;
}

function buildOilWell(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const pad = new THREE.Mesh(lib.geometries.roundedFullPlot, lib.materials.stone);
  g.add(pad);

  // Wooden derrick legs (4 angled beams)
  const legGeo = new THREE.BoxGeometry(0.24, 5.2, 0.24);
  const corners: Array<[number, number, number, number]> = [
    [-1.1, -1.1, 0.16, -0.16],
    [1.1, -1.1, -0.16, -0.16],
    [-1.1, 1.1, 0.16, 0.16],
    [1.1, 1.1, -0.16, 0.16],
  ];
  for (const [lx, lz, rz, rx] of corners) {
    const leg = new THREE.Mesh(legGeo, lib.materials.darkWood);
    leg.position.set(lx, 2.65, lz);
    leg.rotation.set(rx, 0, rz);
    g.add(leg);
  }

  const topCap = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.35, 1.1),
    lib.materials.ironOre
  );
  topCap.position.y = 5.1;
  g.add(topCap);

  // Oil storage barrels
  for (let i = 0; i < 3; i++) {
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 1.15, 10),
      lib.materials.oilDark
    );
    tank.position.set(-2.4 + i * 1.2, 0.85, 2.55);
    g.add(tank);
  }

  enableShadows(g);
  return g;
}

function buildWarehouseBldg(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.35, 6.2),
    lib.materials.stone
  );
  base.position.y = 0.18;
  g.add(base);

  const hall = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 2.8, 5.2),
    lib.materials.wood
  );
  hall.position.y = 1.75;
  g.add(hall);

  const roof = new THREE.Mesh(
    createPrismRoofGeometry(7.0, 1.85, 5.8),
    lib.materials.terracotta
  );
  roof.position.y = 3.12;
  g.add(roof);

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 2.0, 0.2),
    lib.materials.darkWood
  );
  door.position.set(0, 1.35, 2.62);
  g.add(door);

  addSmallProps(g, lib, 'crates');
  addSmallProps(g, lib, 'sacks');
  enableShadows(g);
  return g;
}

function buildWorkshop(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(7.0, 0.32, 6.4),
    lib.materials.stone
  );
  base.position.y = 0.16;
  g.add(base);

  const hall = new THREE.Mesh(
    new THREE.BoxGeometry(5.4, 2.7, 4.4),
    lib.materials.plaster
  );
  hall.position.set(-0.6, 1.65, -0.5);
  g.add(hall);

  const roof = new THREE.Mesh(
    createPrismRoofGeometry(5.9, 1.6, 4.9),
    lib.materials.terracotta
  );
  roof.position.set(-0.6, 3.0, -0.5);
  g.add(roof);

  // Tall stone forge chimney
  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 4.6, 1.1),
    lib.materials.stone
  );
  chimney.position.set(2.4, 2.5, -1.5);
  g.add(chimney);

  // Work yard anvil/bench
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.85, 1.0),
    lib.materials.wood
  );
  bench.position.set(1.6, 0.72, 1.7);
  g.add(bench);

  addSmallProps(g, lib, 'crates');
  enableShadows(g);
  return g;
}

function buildJeweler(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 2.35, 2.8),
    lib.materials.marble
  );
  body.position.y = 1.18;
  g.add(body);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    lib.materials.goldAccent
  );
  dome.position.y = 2.35;
  g.add(dome);

  const gemDisplay = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.42, 0),
    lib.materials.gemCrystal
  );
  gemDisplay.position.set(0, 1.25, 1.55);
  g.add(gemDisplay);

  enableShadows(g);
  return g;
}

function buildGrandMarket(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const plaza = new THREE.Mesh(
    new THREE.BoxGeometry(8.2, 0.28, 8.2),
    lib.materials.stone
  );
  plaza.position.y = 0.14;
  g.add(plaza);

  // Central stone archway pavilion
  const arch = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 2.8, 3.4),
    lib.materials.marble
  );
  arch.position.y = 1.65;
  g.add(arch);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    lib.materials.terracotta
  );
  dome.position.y = 3.05;
  g.add(dome);

  // 4 surrounding merchant stalls with striped awnings
  const corners: Array<[number, number]> = [
    [-2.5, -2.5],
    [2.5, -2.5],
    [-2.5, 2.5],
    [2.5, 2.5],
  ];
  for (const [cx, cz] of corners) {
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.22, 2.2),
      lib.materials.awning
    );
    canopy.position.set(cx, 1.85, cz);
    g.add(canopy);

    const stall = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.85, 1.8),
      lib.materials.wood
    );
    stall.position.set(cx, 0.68, cz);
    g.add(stall);
  }

  addSmallProps(g, lib, 'cart');
  enableShadows(g);
  return g;
}

function buildTradeOffice(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.3, 3.1, 3.0),
    lib.materials.plaster
  );
  body.position.y = 1.55;
  g.add(body);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(3.55, 0.32, 3.25),
    lib.materials.stone
  );
  trim.position.y = 3.15;
  g.add(trim);

  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85, 1.4),
    lib.materials.bannerTeal
  );
  banner.position.set(0, 2.1, 1.54);
  g.add(banner);

  enableShadows(g);
  return g;
}

// WP4: Mosque (white marble stone + grand dome + minaret + gold crescent finial)
function buildMosque(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(8.0, 0.42, 8.0),
    lib.materials.stone
  );
  plinth.position.y = 0.21;
  g.add(plinth);

  const hall = new THREE.Mesh(
    new THREE.BoxGeometry(5.6, 3.1, 5.4),
    lib.materials.marble
  );
  hall.position.set(-0.4, 1.95, 0.2);
  g.add(hall);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2.15, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
    lib.materials.marble
  );
  dome.position.set(-0.4, 3.45, 0.2);
  g.add(dome);

  // Gold crescent finial atop main dome
  const spire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 0.9, 6),
    lib.materials.goldAccent
  );
  spire.position.set(-0.4, 5.95, 0.2);
  g.add(spire);

  const crescent = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.07, 6, 14, Math.PI * 1.45),
    lib.materials.goldAccent
  );
  crescent.position.set(-0.4, 6.55, 0.2);
  crescent.rotation.z = 0.55;
  g.add(crescent);

  // Tall slender minaret tower
  const minaret = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.72, 6.2, 10),
    lib.materials.marble
  );
  minaret.position.set(2.9, 3.4, -2.5);
  g.add(minaret);

  const balcony = new THREE.Mesh(
    new THREE.CylinderGeometry(0.88, 0.75, 0.35, 10),
    lib.materials.stone
  );
  balcony.position.set(2.9, 5.2, -2.5);
  g.add(balcony);

  const minaretCap = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 1.45, 10),
    lib.materials.goldAccent
  );
  minaretCap.position.set(2.9, 7.1, -2.5);
  g.add(minaretCap);

  enableShadows(g);
  return g;
}

function buildTheater(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const stage = new THREE.Mesh(
    new THREE.BoxGeometry(6.8, 0.55, 2.2),
    lib.materials.wood
  );
  stage.position.set(0, 0.28, -2.5);
  g.add(stage);

  // Stage backdrop colonnade
  const backdrop = new THREE.Mesh(
    new THREE.BoxGeometry(6.6, 2.8, 0.65),
    lib.materials.marble
  );
  backdrop.position.set(0, 1.85, -3.35);
  g.add(backdrop);

  const cornice = new THREE.Mesh(
    new THREE.BoxGeometry(7.0, 0.45, 1.0),
    lib.materials.terracotta
  );
  cornice.position.set(0, 3.35, -3.35);
  g.add(cornice);

  // Semi-circular stone amphitheater tiers
  for (let tier = 0; tier < 3; tier++) {
    const r = 2.0 + tier * 1.1;
    const arc = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r + 0.3, 0.55 + tier * 0.48, 16, 1, false, 0, Math.PI),
      lib.materials.stone
    );
    arc.position.set(0, (0.55 + tier * 0.48) / 2, -0.5);
    g.add(arc);
  }

  enableShadows(g);
  return g;
}

function buildGarden(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const lawn = new THREE.Mesh(
    new THREE.CylinderGeometry(2.1, 2.2, 0.18, 14),
    lib.materials.pastureGrass
  );
  lawn.position.y = 0.09;
  g.add(lawn);

  // Central marble fountain disc
  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.85, 0.35, 12),
    lib.materials.marble
  );
  basin.position.y = 0.32;
  g.add(basin);

  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.62, 0.06, 12),
    lib.materials.wellWater
  );
  water.position.y = 0.5;
  g.add(water);

  // 2 miniature palms + wooden benches
  for (const [px, pz] of [[-1.3, -1.0], [1.3, -0.9]]) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.18, 2.2, 6),
      lib.materials.wood
    );
    trunk.position.set(px, 1.2, pz);
    g.add(trunk);

    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(1.1, 0.7, 6),
      lib.materials.foliageMain
    );
    crown.position.set(px, 2.45, pz);
    g.add(crown);
  }

  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.32, 0.38),
    lib.materials.wood
  );
  bench.position.set(0, 0.34, 1.45);
  g.add(bench);

  enableShadows(g);
  return g;
}

function buildClinic(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 2.35, 2.9),
    lib.materials.marble
  );
  body.position.y = 1.18;
  g.add(body);

  const roof = new THREE.Mesh(
    createPrismRoofGeometry(3.5, 1.2, 3.2),
    lib.materials.terracotta
  );
  roof.position.y = 2.35;
  g.add(roof);

  // Emerald health emblem plaque
  const hBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 0.22, 0.14),
    lib.materials.clinicEmerald
  );
  hBar.position.set(0, 1.6, 1.48);
  g.add(hBar);
  const vBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.75, 0.14),
    lib.materials.clinicEmerald
  );
  vBar.position.set(0, 1.6, 1.48);
  g.add(vBar);

  enableShadows(g);
  return g;
}

function buildSchool(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(7.6, 0.34, 7.2),
    lib.materials.stone
  );
  base.position.y = 0.17;
  g.add(base);

  const mainHall = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 2.6, 3.2),
    lib.materials.plaster
  );
  mainHall.position.set(0, 1.62, -1.6);
  g.add(mainHall);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.3, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    lib.materials.terracotta
  );
  dome.position.set(0, 2.92, -1.6);
  g.add(dome);

  // Side study wings around open courtyard
  const wingGeo = new THREE.BoxGeometry(1.6, 1.9, 3.4);
  const wl = new THREE.Mesh(wingGeo, lib.materials.marble);
  wl.position.set(-2.5, 1.25, 1.4);
  g.add(wl);
  const wr = new THREE.Mesh(wingGeo, lib.materials.marble);
  wr.position.set(2.5, 1.25, 1.4);
  g.add(wr);

  enableShadows(g);
  return g;
}

function createAnimalMesh(lib: BuildingLibrary, isCow: boolean): THREE.Group {
  const animal = new THREE.Group();
  const coatMat = isCow ? lib.materials.cowBrown : lib.materials.sheepWhite;

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.1),
    lib.materials.blobShadow
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  animal.add(shadow);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(isCow ? 1.1 : 0.86, isCow ? 0.65 : 0.52, isCow ? 0.6 : 0.5),
    coatMat
  );
  body.position.y = isCow ? 0.6 : 0.46;
  animal.add(body);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.36, 0.36),
    isCow ? lib.materials.darkWood : lib.materials.stone
  );
  head.position.set(isCow ? 0.65 : 0.5, isCow ? 0.76 : 0.6, 0);
  animal.add(head);

  const legGeo = new THREE.BoxGeometry(0.14, 0.32, 0.14);
  for (const [lx, lz] of [[-0.28, -0.17], [0.28, -0.17], [-0.28, 0.17], [0.28, 0.17]]) {
    const leg = new THREE.Mesh(legGeo, lib.materials.darkWood);
    leg.position.set(lx, 0.16, lz);
    animal.add(leg);
  }

  enableShadows(animal);
  return animal;
}

function buildPasture(
  lib: BuildingLibrary,
  seed: number
): { group: THREE.Group; animals: PastureAnimal[] } {
  const g = new THREE.Group();

  const meadow = new THREE.Mesh(
    lib.geometries.roundedPasturePlot,
    lib.materials.pastureGrass
  );
  meadow.receiveShadow = true;
  meadow.castShadow = true;
  g.add(meadow);

  const postGeo = new THREE.BoxGeometry(0.22, 0.9, 0.22);
  const span = 3.7;
  const postCoords: Array<[number, number]> = [
    [-span, -span],
    [0, -span],
    [span, -span],
    [span, 0],
    [span, span],
    [0, span],
    [-span, span],
    [-span, 0],
  ];
  for (const [px, pz] of postCoords) {
    const post = new THREE.Mesh(postGeo, lib.materials.wood);
    post.position.set(px, 0.65, pz);
    g.add(post);
  }

  const railH = new THREE.BoxGeometry(span * 2, 0.12, 0.12);
  const railV = new THREE.BoxGeometry(0.12, 0.12, span * 2);
  for (const ry of [0.56, 0.88]) {
    const n = new THREE.Mesh(railH, lib.materials.wood);
    n.position.set(0, ry, -span);
    g.add(n);
    const e = new THREE.Mesh(railV, lib.materials.wood);
    e.position.set(span, ry, 0);
    g.add(e);
    const w = new THREE.Mesh(railV, lib.materials.wood);
    w.position.set(-span, ry, 0);
    g.add(w);
  }

  const animals: PastureAnimal[] = [];
  for (let i = 0; i < 3; i++) {
    const mesh = createAnimalMesh(lib, i === 0);
    const startX = (hash2D(seed * 13 + i, 4.2) - 0.5) * 4.2;
    const startZ = (hash2D(seed * 29 + i, 8.7) - 0.5) * 4.2;
    mesh.position.set(startX, 0.24, startZ);
    g.add(mesh);

    animals.push({
      mesh,
      x: startX,
      z: startZ,
      targetX: (hash2D(seed * 41 + i, 2.1) - 0.5) * 4.4,
      targetZ: (hash2D(seed * 53 + i, 6.4) - 0.5) * 4.4,
      speed: 0.55 + hash2D(seed + i, 11.3) * 0.35,
      pauseTimer: hash2D(seed + i, 19.1) * 2.5,
    });
  }

  enableShadows(g);
  return { group: g, animals };
}

function buildHotel(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  // Elevated stone plinth + grand south entrance steps
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(6.8, 0.36, 5.6),
    lib.materials.stone
  );
  plinth.position.set(0, 0.18, -0.1);
  g.add(plinth);

  const steps = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.22, 0.9),
    lib.materials.marble
  );
  steps.position.set(0, 0.11, 2.95);
  g.add(steps);

  // Two-storey main hotel block (warm limestone/marble facade)
  const mainBlock = new THREE.Mesh(
    new THREE.BoxGeometry(5.8, 4.1, 4.4),
    lib.materials.marble
  );
  mainBlock.position.set(0, 2.41, -0.1);
  g.add(mainBlock);

  // Mid-storey cornice belt + roof cornice trim
  const beltGeo = new THREE.BoxGeometry(6.08, 0.22, 4.68);
  const midBelt = new THREE.Mesh(beltGeo, lib.materials.stone);
  midBelt.position.set(0, 2.38, -0.1);
  g.add(midBelt);

  const topBelt = new THREE.Mesh(beltGeo, lib.materials.stone);
  topBelt.position.set(0, 4.42, -0.1);
  g.add(topBelt);

  // Flat roof terrace with perimeter parapet rails + terrace shade canopy
  const terraceFloor = new THREE.Mesh(
    new THREE.BoxGeometry(5.5, 0.12, 4.1),
    lib.materials.terracotta
  );
  terraceFloor.position.set(0, 4.54, -0.1);
  g.add(terraceFloor);

  const paraH = new THREE.BoxGeometry(5.88, 0.42, 0.22);
  const paraV = new THREE.BoxGeometry(0.22, 0.42, 4.48);
  const paraN = new THREE.Mesh(paraH, lib.materials.plaster);
  paraN.position.set(0, 4.72, -2.2);
  g.add(paraN);
  const paraS = new THREE.Mesh(paraH, lib.materials.plaster);
  paraS.position.set(0, 4.72, 2.0);
  g.add(paraS);
  const paraW = new THREE.Mesh(paraV, lib.materials.plaster);
  paraW.position.set(-2.83, 4.72, -0.1);
  g.add(paraW);
  const paraE = new THREE.Mesh(paraV, lib.materials.plaster);
  paraE.position.set(2.83, 4.72, -0.1);
  g.add(paraE);

  // Rooftop lounge pergola (adds unmistakable hotel terrace silhouette)
  const pergolaPostGeo = new THREE.BoxGeometry(0.14, 1.0, 0.14);
  for (const [px, pz] of [
    [-1.4, -1.3],
    [1.4, -1.3],
    [-1.4, 0.5],
    [1.4, 0.5],
  ]) {
    const p = new THREE.Mesh(pergolaPostGeo, lib.materials.darkWood);
    p.position.set(px, 5.05, pz);
    g.add(p);
  }
  const pergolaRoof = new THREE.Mesh(
    new THREE.BoxGeometry(3.15, 0.1, 2.05),
    lib.materials.wood
  );
  pergolaRoof.position.set(0, 5.56, -0.4);
  g.add(pergolaRoof);

  // Double entrance doorway on south facade
  const doorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.75, 1.85, 0.22),
    lib.materials.darkWood
  );
  doorFrame.position.set(0, 1.28, 2.12);
  g.add(doorFrame);

  const doorGlass = new THREE.Mesh(
    new THREE.BoxGeometry(1.25, 1.45, 0.26),
    lib.materials.warmWindow
  );
  doorGlass.position.set(0, 1.26, 2.13);
  g.add(doorGlass);

  // Striped entrance awning + 2 supporting columns
  const awningMesh = new THREE.Mesh(
    new THREE.BoxGeometry(2.65, 0.12, 1.45),
    lib.materials.awning
  );
  awningMesh.position.set(0, 2.26, 2.74);
  awningMesh.rotation.x = 0.22;
  g.add(awningMesh);

  const awningPostGeo = new THREE.CylinderGeometry(0.07, 0.08, 1.98, 8);
  for (const ax of [-1.12, 1.12]) {
    const post = new THREE.Mesh(awningPostGeo, lib.materials.goldAccent);
    post.position.set(ax, 1.25, 3.22);
    g.add(post);
  }

  // Rooftop front hotel sign board (dark wood board + gold frame & crest bar)
  const signPostGeo = new THREE.BoxGeometry(0.14, 0.55, 0.14);
  for (const sx of [-1.0, 1.0]) {
    const sp = new THREE.Mesh(signPostGeo, lib.materials.darkWood);
    sp.position.set(sx, 5.08, 1.98);
    g.add(sp);
  }
  const signBoard = new THREE.Mesh(
    new THREE.BoxGeometry(2.7, 0.72, 0.16),
    lib.materials.bannerTeal
  );
  signBoard.position.set(0, 5.5, 1.98);
  g.add(signBoard);

  const signGoldFrame = new THREE.Mesh(
    new THREE.BoxGeometry(2.82, 0.12, 0.2),
    lib.materials.goldAccent
  );
  signGoldFrame.position.set(0, 5.86, 1.98);
  g.add(signGoldFrame);

  const signPlaque = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.26, 0.2),
    lib.materials.goldAccent
  );
  signPlaque.position.set(0, 5.5, 1.99);
  g.add(signPlaque);

  // Warm glowing guestroom windows (4 upper south, 2 lower lobby south, 2+2 side windows)
  const winFrameGeo = new THREE.BoxGeometry(0.84, 0.96, 0.14);
  const winPaneGeo = new THREE.BoxGeometry(0.66, 0.76, 0.18);

  const addFrontWindow = (wx: number, wy: number) => {
    const f = new THREE.Mesh(winFrameGeo, lib.materials.darkWood);
    f.position.set(wx, wy, 2.11);
    g.add(f);
    const p = new THREE.Mesh(winPaneGeo, lib.materials.warmWindow);
    p.position.set(wx, wy, 2.12);
    g.add(p);
  };
  // Upper floor (4 lit windows)
  for (const wx of [-2.05, -0.7, 0.7, 2.05]) {
    addFrontWindow(wx, 3.42);
  }
  // Ground lobby flanking entrance (2 lit windows)
  for (const wx of [-1.95, 1.95]) {
    addFrontWindow(wx, 1.4);
  }

  // East & West side lit windows
  const sideFrameGeo = new THREE.BoxGeometry(0.14, 0.9, 0.8);
  const sidePaneGeo = new THREE.BoxGeometry(0.18, 0.72, 0.62);
  for (const side of [-1, 1]) {
    for (const wz of [-1.1, 0.9]) {
      for (const wy of [1.4, 3.42]) {
        const f = new THREE.Mesh(sideFrameGeo, lib.materials.darkWood);
        f.position.set(side * 2.91, wy, wz);
        g.add(f);
        const p = new THREE.Mesh(sidePaneGeo, lib.materials.warmWindow);
        p.position.set(side * 2.92, wy, wz);
        g.add(p);
      }
    }
  }

  // Potted entrance planters flanking steps
  const potGeo = new THREE.CylinderGeometry(0.28, 0.2, 0.42, 8);
  const bushGeo = new THREE.DodecahedronGeometry(0.36, 0);
  for (const ux of [-1.7, 1.7]) {
    const pot = new THREE.Mesh(potGeo, lib.materials.terracotta);
    pot.position.set(ux, 0.42, 2.95);
    g.add(pot);
    const bush = new THREE.Mesh(bushGeo, lib.materials.foliageMain);
    bush.position.set(ux, 0.82, 2.95);
    g.add(bush);
  }

  enableShadows(g);
  return g;
}

export const BUILDING_MODEL_THEMES: ReadonlySet<ThemeId> = new Set<ThemeId>([
  'palace',
  'house',
  'well',
  'shop',
  'bakery',
  'restaurant',
  'cafe',
  'wheat_farm',
  'farm',
  'orchard',
  'forest',
  'quarry',
  'iron_mine',
  'copper_mine',
  'gold_mine',
  'gem_mine',
  'oil_well',
  'warehouse_bldg',
  'workshop',
  'jeweler',
  'grand_market',
  'trade_office',
  'hotel',
  'mosque',
  'theater',
  'garden',
  'clinic',
  'school',
  'pasture',
  'sea', // Rendered by terrain water mesh in WorldEngine
]);

export function createBuildingVisual(
  lib: BuildingLibrary,
  key: string,
  cubeId: number,
  slot: 0 | 1,
  themeId: ThemeId,
  animateRise: boolean
): BuildingVisualHandle {
  const footprint = THEMES[themeId].footprint;
  const root = new THREE.Group();

  // WP1 Grounding: packed-earth foundation patch + fake AO blob shadow disc under every building
  const foundation = new THREE.Mesh(
    footprint === 'full' ? lib.geometries.foundationFull : lib.geometries.foundationHalf,
    lib.materials.packedEarth
  );
  foundation.position.y = 0.03;
  root.add(foundation);

  const blobShadow = new THREE.Mesh(
    footprint === 'full' ? lib.geometries.shadowFull : lib.geometries.shadowHalf,
    lib.materials.blobShadow
  );
  blobShadow.position.y = 0.05;
  root.add(blobShadow);

  let bodyGroup = new THREE.Group();
  let farmCropsMesh: THREE.InstancedMesh | null = null;
  let farmCropOffsets: Array<{ x: number; z: number; rot: number; baseScale: number }> = [];
  let animals: PastureAnimal[] = [];

  const seed = cubeId * 13 + slot * 7 + 1;

  switch (themeId) {
    case 'palace':
      bodyGroup = buildPalace(lib);
      break;
    case 'house':
      bodyGroup = buildHouse(lib, seed);
      break;
    case 'well':
      bodyGroup = buildWell(lib);
      break;
    case 'shop':
      bodyGroup = buildShop(lib);
      break;
    case 'bakery':
      bodyGroup = buildBakery(lib);
      break;
    case 'restaurant':
      bodyGroup = buildRestaurantOrCafe(lib, true);
      break;
    case 'cafe':
      bodyGroup = buildRestaurantOrCafe(lib, false);
      break;
    case 'wheat_farm': {
      const built = buildCropFarm(lib, true);
      bodyGroup = built.group;
      farmCropsMesh = built.cropsMesh;
      farmCropOffsets = built.offsets;
      break;
    }
    case 'farm': {
      const built = buildCropFarm(lib, false);
      bodyGroup = built.group;
      farmCropsMesh = built.cropsMesh;
      farmCropOffsets = built.offsets;
      break;
    }
    case 'orchard':
      bodyGroup = buildOrchard(lib);
      break;
    case 'forest':
      bodyGroup = buildForest(lib, seed);
      break;
    case 'quarry':
      bodyGroup = buildQuarry(lib);
      break;
    case 'iron_mine':
      bodyGroup = buildMine(lib, 'iron');
      break;
    case 'copper_mine':
      bodyGroup = buildMine(lib, 'copper');
      break;
    case 'gold_mine':
      bodyGroup = buildMine(lib, 'gold');
      break;
    case 'gem_mine':
      bodyGroup = buildMine(lib, 'gem');
      break;
    case 'oil_well':
      bodyGroup = buildOilWell(lib);
      break;
    case 'warehouse_bldg':
      bodyGroup = buildWarehouseBldg(lib);
      break;
    case 'workshop':
      bodyGroup = buildWorkshop(lib);
      break;
    case 'jeweler':
      bodyGroup = buildJeweler(lib);
      break;
    case 'grand_market':
      bodyGroup = buildGrandMarket(lib);
      break;
    case 'trade_office':
      bodyGroup = buildTradeOffice(lib);
      break;
    case 'hotel':
      bodyGroup = buildHotel(lib);
      break;
    case 'mosque':
      bodyGroup = buildMosque(lib);
      break;
    case 'theater':
      bodyGroup = buildTheater(lib);
      break;
    case 'garden':
      bodyGroup = buildGarden(lib);
      break;
    case 'clinic':
      bodyGroup = buildClinic(lib);
      break;
    case 'school':
      bodyGroup = buildSchool(lib);
      break;
    case 'pasture': {
      const built = buildPasture(lib, seed);
      bodyGroup = built.group;
      animals = built.animals;
      break;
    }
    default:
      bodyGroup = buildHouse(lib, seed);
      break;
  }

  root.add(bodyGroup);

  // Diegetic ground progress ring for non-farm, non-sea cycle producers
  let progressTrackMesh: THREE.Mesh | null = null;
  let progressArcMesh: THREE.Mesh | null = null;
  const usesGroundRing =
    themeId === 'well' ||
    themeId === 'orchard' ||
    themeId === 'pasture' ||
    themeId === 'bakery' ||
    themeId === 'restaurant' ||
    themeId === 'cafe' ||
    themeId === 'forest' ||
    themeId === 'quarry' ||
    themeId === 'iron_mine' ||
    themeId === 'copper_mine' ||
    themeId === 'gold_mine' ||
    themeId === 'gem_mine' ||
    themeId === 'oil_well' ||
    themeId === 'workshop' ||
    themeId === 'jeweler' ||
    themeId === 'shop' ||
    themeId === 'hotel';

  if (usesGroundRing) {
    const innerR = footprint === 'half' ? 2.15 : 4.55;
    const outerR = footprint === 'half' ? 2.4 : 4.82;

    const trackGeo = new THREE.RingGeometry(innerR, outerR, 36);
    trackGeo.rotateX(-Math.PI / 2);
    progressTrackMesh = new THREE.Mesh(trackGeo, lib.materials.ringTrack);
    progressTrackMesh.position.y = 0.08;
    root.add(progressTrackMesh);

    const arcGeo = new THREE.RingGeometry(innerR, outerR, 36, 1, 0, 0.01);
    arcGeo.rotateX(-Math.PI / 2);
    progressArcMesh = new THREE.Mesh(arcGeo, lib.materials.goldRing);
    progressArcMesh.position.y = 0.1;
    root.add(progressArcMesh);
  }

  return {
    key,
    cubeId,
    slot,
    themeId,
    root,
    bodyGroup,
    riseAge: animateRise ? 0 : 1,
    isUnstaffedVisual: false,
    unstaffedSprite: null,
    progressArcMesh,
    progressTrackMesh,
    lastProgressBucket: -1,
    farmCropsMesh,
    farmCropOffsets,
    animals,
    clonedMaterials: [],
  };
}

const _dummy = new THREE.Object3D();

export function updateFarmCropGrowth(handle: BuildingVisualHandle, progressRatio: number): void {
  if (!handle.farmCropsMesh) return;
  const growth = 0.18 + Math.max(0, Math.min(1, progressRatio)) * 0.92;
  const offsets = handle.farmCropOffsets;
  for (let i = 0; i < offsets.length; i++) {
    const o = offsets[i];
    _dummy.position.set(o.x, 0.3, o.z);
    _dummy.rotation.set(0, o.rot, 0);
    _dummy.scale.set(
      o.baseScale * (0.55 + 0.45 * growth),
      o.baseScale * growth,
      o.baseScale * (0.55 + 0.45 * growth)
    );
    _dummy.updateMatrix();
    handle.farmCropsMesh.setMatrixAt(i, _dummy.matrix);
  }
  handle.farmCropsMesh.instanceMatrix.needsUpdate = true;
}

export function updateProgressRing(
  handle: BuildingVisualHandle,
  progressRatio: number
): void {
  if (!handle.progressArcMesh) return;
  const footprint = THEMES[handle.themeId].footprint;
  const clamped = Math.max(0, Math.min(1, progressRatio));
  const bucket = Math.round(clamped * 36);
  if (bucket === handle.lastProgressBucket) return;
  handle.lastProgressBucket = bucket;

  const innerR = footprint === 'half' ? 2.15 : 4.55;
  const outerR = footprint === 'half' ? 2.4 : 4.82;
  const thetaLength = Math.max(0.02, (bucket / 36) * Math.PI * 2);

  handle.progressArcMesh.geometry.dispose();
  const nextGeo = new THREE.RingGeometry(
    innerR,
    outerR,
    Math.max(4, bucket + 2),
    1,
    Math.PI / 2,
    thetaLength
  );
  nextGeo.rotateX(-Math.PI / 2);
  handle.progressArcMesh.geometry = nextGeo;
}

const _greyTarget = new THREE.Color(0x88847c);

export function applyUnstaffedVisual(
  handle: BuildingVisualHandle,
  lib: BuildingLibrary,
  unstaffed: boolean
): void {
  if (handle.isUnstaffedVisual === unstaffed) return;
  handle.isUnstaffedVisual = unstaffed;

  if (unstaffed) {
    handle.bodyGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (!mesh.userData.originalMaterial) {
          mesh.userData.originalMaterial = mesh.material;
        }
        const orig = mesh.userData.originalMaterial as THREE.Material;
        if (orig instanceof THREE.MeshStandardMaterial) {
          const clone = orig.clone();
          clone.color.lerp(_greyTarget, 0.65);
          clone.roughness = Math.min(1, clone.roughness + 0.12);
          mesh.material = clone;
          handle.clonedMaterials.push(clone);
        }
      }
    });

    if (!handle.unstaffedSprite) {
      const mat = new THREE.SpriteMaterial({
        map: lib.unstaffedTexture,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(2.1, 2.1, 1);
      sprite.position.set(0, 5.1, 0);
      sprite.renderOrder = 25;
      handle.root.add(sprite);
      handle.unstaffedSprite = sprite;
    }
  } else {
    handle.bodyGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.userData.originalMaterial) {
          mesh.material = mesh.userData.originalMaterial;
        }
      }
    });
    handle.clonedMaterials.forEach((m) => m.dispose());
    handle.clonedMaterials = [];

    if (handle.unstaffedSprite) {
      handle.root.remove(handle.unstaffedSprite);
      handle.unstaffedSprite.material.dispose();
      handle.unstaffedSprite = null;
    }
  }
}

export function disposeBuildingVisual(handle: BuildingVisualHandle, lib: BuildingLibrary): void {
  const sharedGeos = new Set<THREE.BufferGeometry>(Object.values(lib.geometries));
  const sharedMats = new Set<THREE.Material>(Object.values(lib.materials));

  handle.clonedMaterials.forEach((m) => m.dispose());
  handle.clonedMaterials = [];

  if (handle.unstaffedSprite) {
    handle.unstaffedSprite.material.dispose();
    handle.unstaffedSprite = null;
  }

  handle.root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry && !sharedGeos.has(mesh.geometry)) {
        mesh.geometry.dispose();
      }
      if (
        mesh.material &&
        !Array.isArray(mesh.material) &&
        !sharedMats.has(mesh.material)
      ) {
        mesh.material.dispose();
      }
    }
  });
}
