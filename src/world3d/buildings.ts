import * as THREE from 'three';
import type { ThemeId } from '../game/types';
import { hash2D } from './worldMath';

export interface BuildingLibrary {
  materials: {
    plaster: THREE.MeshStandardMaterial;
    terracotta: THREE.MeshStandardMaterial;
    stone: THREE.MeshStandardMaterial;
    wood: THREE.MeshStandardMaterial;
    darkWood: THREE.MeshStandardMaterial;
    soil: THREE.MeshStandardMaterial;
    forestSoil: THREE.MeshStandardMaterial;
    pastureGrass: THREE.MeshStandardMaterial;
    foliageMain: THREE.MeshStandardMaterial;
    foliageDark: THREE.MeshStandardMaterial;
    cropLight: THREE.MeshStandardMaterial;
    cropDark: THREE.MeshStandardMaterial;
    awning: THREE.MeshStandardMaterial;
    wellWater: THREE.MeshStandardMaterial;
    sheepWhite: THREE.MeshStandardMaterial;
    cowBrown: THREE.MeshStandardMaterial;
    rope: THREE.MeshStandardMaterial;
    goldRing: THREE.MeshBasicMaterial;
    ringTrack: THREE.MeshBasicMaterial;
  };
  geometries: {
    cropStalk: THREE.ConeGeometry;
    roundedFullPlot: THREE.ExtrudeGeometry;
    roundedPasturePlot: THREE.ExtrudeGeometry;
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
    bevelThickness: 0.06,
    bevelSize: 0.05,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

export function createBuildingLibrary(
  awningTexture: THREE.CanvasTexture,
  unstaffedTexture: THREE.CanvasTexture
): BuildingLibrary {
  const materials = {
    plaster: new THREE.MeshStandardMaterial({
      color: 0xf3e2c7,
      roughness: 0.88,
      metalness: 0.02,
    }),
    terracotta: new THREE.MeshStandardMaterial({
      color: 0xc96f4a,
      roughness: 0.62,
      metalness: 0.04,
    }),
    stone: new THREE.MeshStandardMaterial({
      color: 0x9aa3a7,
      roughness: 0.92,
      metalness: 0.04,
    }),
    wood: new THREE.MeshStandardMaterial({
      color: 0x7a5434,
      roughness: 0.84,
      metalness: 0.02,
    }),
    darkWood: new THREE.MeshStandardMaterial({
      color: 0x4f3520,
      roughness: 0.86,
      metalness: 0.02,
    }),
    soil: new THREE.MeshStandardMaterial({
      color: 0x8a5a33,
      roughness: 0.96,
      metalness: 0.0,
    }),
    forestSoil: new THREE.MeshStandardMaterial({
      color: 0x674b2e,
      roughness: 0.96,
      metalness: 0.0,
    }),
    pastureGrass: new THREE.MeshStandardMaterial({
      color: 0x8bc34a,
      roughness: 0.9,
      metalness: 0.0,
    }),
    foliageMain: new THREE.MeshStandardMaterial({
      color: 0x3e7c4f,
      roughness: 0.82,
      metalness: 0.0,
    }),
    foliageDark: new THREE.MeshStandardMaterial({
      color: 0x2f643e,
      roughness: 0.85,
      metalness: 0.0,
    }),
    cropLight: new THREE.MeshStandardMaterial({
      color: 0x6fb457,
      roughness: 0.76,
      metalness: 0.0,
    }),
    cropDark: new THREE.MeshStandardMaterial({
      color: 0x4e944f,
      roughness: 0.8,
      metalness: 0.0,
    }),
    awning: new THREE.MeshStandardMaterial({
      map: awningTexture,
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
    wellWater: new THREE.MeshStandardMaterial({
      color: 0x2e86ab,
      roughness: 0.15,
      metalness: 0.08,
    }),
    sheepWhite: new THREE.MeshStandardMaterial({
      color: 0xf7f1e3,
      roughness: 0.92,
      metalness: 0.0,
    }),
    cowBrown: new THREE.MeshStandardMaterial({
      color: 0x8c5a38,
      roughness: 0.88,
      metalness: 0.0,
    }),
    rope: new THREE.MeshStandardMaterial({
      color: 0xc2a16b,
      roughness: 0.95,
      metalness: 0.0,
    }),
    goldRing: new THREE.MeshBasicMaterial({
      color: 0xe6b84b,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    ringTrack: new THREE.MeshBasicMaterial({
      color: 0x2b2118,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  };

  const roundedFullShape = createRoundedRectShape(8.4, 8.4, 1.5);
  const roundedFullPlot = new THREE.ExtrudeGeometry(roundedFullShape, {
    depth: 0.28,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.14,
    bevelSegments: 2,
  });
  roundedFullPlot.rotateX(-Math.PI / 2);

  const roundedPastureShape = createRoundedRectShape(8.6, 8.6, 1.7);
  const roundedPasturePlot = new THREE.ExtrudeGeometry(roundedPastureShape, {
    depth: 0.22,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.14,
    bevelSegments: 2,
  });
  roundedPasturePlot.rotateX(-Math.PI / 2);

  const cropStalk = new THREE.ConeGeometry(0.32, 1.15, 5);
  cropStalk.translate(0, 0.575, 0);

  return {
    materials,
    geometries: {
      cropStalk,
      roundedFullPlot,
      roundedPasturePlot,
    },
    unstaffedTexture,
    dispose: () => {
      Object.values(materials).forEach((m) => m.dispose());
      cropStalk.dispose();
      roundedFullPlot.dispose();
      roundedPasturePlot.dispose();
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

function buildHouse(lib: BuildingLibrary, seed: number): THREE.Group {
  const g = new THREE.Group();
  const rotY = ((Math.floor(seed * 4) % 4) * Math.PI) / 2;

  // Stone foundation plinth
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(3.45, 0.3, 3.15),
    lib.materials.stone
  );
  plinth.position.y = 0.15;
  g.add(plinth);

  // Warm cream stucco walls
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(3.15, 2.25, 2.85),
    lib.materials.plaster
  );
  walls.position.y = 1.4;
  g.add(walls);

  // Terracotta prism roof
  const roofGeo = createPrismRoofGeometry(3.55, 1.5, 3.2);
  const roof = new THREE.Mesh(roofGeo, lib.materials.terracotta);
  roof.position.y = 2.48;
  g.add(roof);

  // Mini chimney
  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.9, 0.45),
    lib.materials.plaster
  );
  chimney.position.set(0.85, 3.35, -0.55);
  g.add(chimney);

  // Door
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.68, 1.15, 0.12),
    lib.materials.darkWood
  );
  door.position.set(0, 0.85, 1.44);
  g.add(door);

  // Tiny side window
  const win = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.52, 0.58),
    lib.materials.wood
  );
  win.position.set(1.58, 1.55, 0.2);
  g.add(win);

  g.rotation.y = rotY;
  enableShadows(g);
  return g;
}

function buildWell(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  // Stone base pad
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(1.75, 1.9, 0.2, 12),
    lib.materials.stone
  );
  pad.position.y = 0.1;
  g.add(pad);

  // Stone well cylinder
  const wellBody = new THREE.Mesh(
    new THREE.CylinderGeometry(1.18, 1.28, 1.15, 12),
    lib.materials.stone
  );
  wellBody.position.y = 0.72;
  g.add(wellBody);

  // Water surface inside well
  const waterDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 0.95, 0.1, 12),
    lib.materials.wellWater
  );
  waterDisc.position.y = 1.27;
  g.add(waterDisc);

  // Two timber posts
  const postGeo = new THREE.BoxGeometry(0.22, 1.95, 0.22);
  const leftPost = new THREE.Mesh(postGeo, lib.materials.wood);
  leftPost.position.set(-1.02, 1.95, 0);
  g.add(leftPost);

  const rightPost = new THREE.Mesh(postGeo, lib.materials.wood);
  rightPost.position.set(1.02, 1.95, 0);
  g.add(rightPost);

  // Crossbeam axle
  const axle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8),
    lib.materials.darkWood
  );
  axle.rotation.z = Math.PI / 2;
  axle.position.y = 2.35;
  g.add(axle);

  // Hanging rope & tiny bucket
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.95, 6),
    lib.materials.rope
  );
  rope.position.y = 1.85;
  g.add(rope);

  const bucket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.17, 0.34, 8),
    lib.materials.wood
  );
  bucket.position.y = 1.45;
  g.add(bucket);

  // Mini terracotta prism roof
  const roofGeo = createPrismRoofGeometry(2.55, 0.95, 2.1);
  const roof = new THREE.Mesh(roofGeo, lib.materials.terracotta);
  roof.position.y = 2.82;
  g.add(roof);

  enableShadows(g);
  return g;
}

function buildShop(lib: BuildingLibrary): THREE.Group {
  const g = new THREE.Group();

  // Base step
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.24, 3.3),
    lib.materials.stone
  );
  base.position.y = 0.12;
  g.add(base);

  // Main stall building
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 2.15, 2.35),
    lib.materials.plaster
  );
  box.position.set(0, 1.3, -0.25);
  g.add(box);

  // Flat terracotta roof trim
  const roofTrim = new THREE.Mesh(
    new THREE.BoxGeometry(3.45, 0.35, 2.6),
    lib.materials.terracotta
  );
  roofTrim.position.set(0, 2.5, -0.25);
  g.add(roofTrim);

  // Slanted striped awning
  const awning = new THREE.Mesh(
    new THREE.PlaneGeometry(3.35, 1.65),
    lib.materials.awning
  );
  awning.position.set(0, 2.08, 1.45);
  awning.rotation.x = -Math.PI / 2 + 0.36;
  g.add(awning);

  // Front awning support poles
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.75, 6);
  const leftPole = new THREE.Mesh(poleGeo, lib.materials.wood);
  leftPole.position.set(-1.45, 1.0, 2.05);
  g.add(leftPole);

  const rightPole = new THREE.Mesh(poleGeo, lib.materials.wood);
  rightPole.position.set(1.45, 1.0, 2.05);
  g.add(rightPole);

  // Display counter & crate
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.72, 0.72),
    lib.materials.wood
  );
  counter.position.set(0, 0.58, 1.32);
  g.add(counter);

  // Hanging sign post
  const signPost = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 1.8, 0.14),
    lib.materials.darkWood
  );
  signPost.position.set(1.82, 1.0, 1.25);
  g.add(signPost);

  const signBoard = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 0.48, 0.1),
    lib.materials.terracotta
  );
  signBoard.position.set(1.82, 1.72, 1.25);
  g.add(signBoard);

  enableShadows(g);
  return g;
}

function buildFarm(
  lib: BuildingLibrary
): {
  group: THREE.Group;
  cropsMesh: THREE.InstancedMesh;
  offsets: Array<{ x: number; z: number; rot: number; baseScale: number }>;
} {
  const g = new THREE.Group();

  // Rich rounded brown soil plot
  const soilMesh = new THREE.Mesh(lib.geometries.roundedFullPlot, lib.materials.soil);
  soilMesh.receiveShadow = true;
  soilMesh.castShadow = true;
  g.add(soilMesh);

  // Plowed furrow soil ridges
  const ridgeGeo = new THREE.BoxGeometry(7.0, 0.16, 0.55);
  for (let row = 0; row < 4; row++) {
    const z = -2.55 + row * 1.7;
    const ridge = new THREE.Mesh(ridgeGeo, lib.materials.forestSoil);
    ridge.position.set(0, 0.34, z);
    ridge.receiveShadow = true;
    g.add(ridge);
  }

  // Instanced crop rows (4 rows x 6 stalks = 24 stalks)
  const offsets: Array<{ x: number; z: number; rot: number; baseScale: number }> = [];
  const count = 24;
  const cropsMesh = new THREE.InstancedMesh(
    lib.geometries.cropStalk,
    lib.materials.cropLight,
    count
  );
  cropsMesh.castShadow = true;
  cropsMesh.receiveShadow = true;

  const colorLight = new THREE.Color(0x6fb457);
  const colorDark = new THREE.Color(0x4e944f);

  let idx = 0;
  for (let row = 0; row < 4; row++) {
    const z = -2.55 + row * 1.7;
    for (let col = 0; col < 6; col++) {
      const x = -2.9 + col * 1.16;
      const jitterX = (hash2D(row * 7 + col, 13) - 0.5) * 0.22;
      const jitterZ = (hash2D(row * 11, col * 5 + 3) - 0.5) * 0.18;
      const rot = hash2D(col * 3, row * 9) * Math.PI * 2;
      const baseScale = 0.88 + hash2D(row + 19, col + 29) * 0.28;
      offsets.push({ x: x + jitterX, z: z + jitterZ, rot, baseScale });
      cropsMesh.setColorAt(idx, row % 2 === 0 ? colorLight : colorDark);
      idx += 1;
    }
  }
  if (cropsMesh.instanceColor) cropsMesh.instanceColor.needsUpdate = true;
  cropsMesh.frustumCulled = false;
  g.add(cropsMesh);

  return { group: g, cropsMesh, offsets };
}

function buildForest(lib: BuildingLibrary, seed: number): THREE.Group {
  const g = new THREE.Group();

  // Darker rounded woodland earth patch
  const soilMesh = new THREE.Mesh(
    lib.geometries.roundedFullPlot,
    lib.materials.forestSoil
  );
  soilMesh.receiveShadow = true;
  soilMesh.castShadow = true;
  g.add(soilMesh);

  // 7 composite pine trees (trunk cylinder + 2 stacked foliage cones)
  const treeCoords = [
    [-2.4, -2.1],
    [0.2, -2.5],
    [2.5, -1.6],
    [-1.8, 0.4],
    [1.0, 0.2],
    [-2.2, 2.4],
    [1.9, 2.3],
  ];

  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.35, 7);
  const coneBottomGeo = new THREE.ConeGeometry(1.22, 2.15, 7);
  const coneTopGeo = new THREE.ConeGeometry(0.92, 1.75, 7);

  treeCoords.forEach(([bx, bz], i) => {
    const jitterX = (hash2D(seed * 17 + i, 3.1) - 0.5) * 0.65;
    const jitterZ = (hash2D(seed * 23 + i, 9.7) - 0.5) * 0.65;
    const sc = 0.8 + hash2D(seed * 31 + i, 5.5) * 0.42;

    const tree = new THREE.Group();
    tree.position.set(bx + jitterX, 0.3, bz + jitterZ);
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

  enableShadows(g);
  return g;
}

function createAnimalMesh(lib: BuildingLibrary, isCow: boolean): THREE.Group {
  const animal = new THREE.Group();
  const coatMat = isCow ? lib.materials.cowBrown : lib.materials.sheepWhite;

  // Body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(isCow ? 1.15 : 0.88, isCow ? 0.68 : 0.55, isCow ? 0.62 : 0.52),
    coatMat
  );
  body.position.y = isCow ? 0.62 : 0.48;
  animal.add(body);

  // Head
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.38, 0.38),
    isCow ? lib.materials.darkWood : lib.materials.stone
  );
  head.position.set(isCow ? 0.68 : 0.52, isCow ? 0.78 : 0.62, 0);
  animal.add(head);

  // 4 stubby legs
  const legGeo = new THREE.BoxGeometry(0.14, 0.34, 0.14);
  const legOffsets = [
    [-0.3, -0.18],
    [0.3, -0.18],
    [-0.3, 0.18],
    [0.3, 0.18],
  ];
  for (const [lx, lz] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, lib.materials.darkWood);
    leg.position.set(lx, 0.17, lz);
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

  // Sunlit green rounded pasture meadow
  const meadow = new THREE.Mesh(
    lib.geometries.roundedPasturePlot,
    lib.materials.pastureGrass
  );
  meadow.receiveShadow = true;
  meadow.castShadow = true;
  g.add(meadow);

  // Perimeter wooden fence posts & rails
  const postGeo = new THREE.BoxGeometry(0.22, 0.92, 0.22);
  const span = 3.75;
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
    post.position.set(px, 0.68, pz);
    g.add(post);
  }

  // Horizontal fence rails (leaving a tiny entry gap on front side)
  const railH = new THREE.BoxGeometry(span * 2, 0.12, 0.12);
  const railV = new THREE.BoxGeometry(0.12, 0.12, span * 2);

  for (const ry of [0.58, 0.92]) {
    const north = new THREE.Mesh(railH, lib.materials.wood);
    north.position.set(0, ry, -span);
    g.add(north);

    const east = new THREE.Mesh(railV, lib.materials.wood);
    east.position.set(span, ry, 0);
    g.add(east);

    const west = new THREE.Mesh(railV, lib.materials.wood);
    west.position.set(-span, ry, 0);
    g.add(west);

    // Split south rail for gate
    const southL = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.12, 0.12),
      lib.materials.wood
    );
    southL.position.set(-2.45, ry, span);
    g.add(southL);

    const southR = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.12, 0.12),
      lib.materials.wood
    );
    southR.position.set(2.45, ry, span);
    g.add(southR);
  }

  // 3 wandering low-poly sheep / cattle
  const animals: PastureAnimal[] = [];
  for (let i = 0; i < 3; i++) {
    const isCow = i === 0;
    const mesh = createAnimalMesh(lib, isCow);
    const startX = (hash2D(seed * 13 + i, 4.2) - 0.5) * 4.4;
    const startZ = (hash2D(seed * 29 + i, 8.7) - 0.5) * 4.4;
    mesh.position.set(startX, 0.28, startZ);
    g.add(mesh);

    animals.push({
      mesh,
      x: startX,
      z: startZ,
      targetX: (hash2D(seed * 41 + i, 2.1) - 0.5) * 4.6,
      targetZ: (hash2D(seed * 53 + i, 6.4) - 0.5) * 4.6,
      speed: 0.55 + hash2D(seed + i, 11.3) * 0.35,
      pauseTimer: hash2D(seed + i, 19.1) * 2.5,
    });
  }

  enableShadows(g);
  return { group: g, animals };
}

export function createBuildingVisual(
  lib: BuildingLibrary,
  key: string,
  cubeId: number,
  slot: 0 | 1,
  themeId: ThemeId,
  animateRise: boolean
): BuildingVisualHandle {
  const root = new THREE.Group();
  let bodyGroup = new THREE.Group();
  let farmCropsMesh: THREE.InstancedMesh | null = null;
  let farmCropOffsets: Array<{ x: number; z: number; rot: number; baseScale: number }> = [];
  let animals: PastureAnimal[] = [];

  const seed = cubeId * 13 + slot * 7 + 1;

  if (themeId === 'house') {
    bodyGroup = buildHouse(lib, seed);
  } else if (themeId === 'well') {
    bodyGroup = buildWell(lib);
  } else if (themeId === 'shop') {
    bodyGroup = buildShop(lib);
  } else if (themeId === 'farm') {
    const built = buildFarm(lib);
    bodyGroup = built.group;
    farmCropsMesh = built.cropsMesh;
    farmCropOffsets = built.offsets;
  } else if (themeId === 'forest') {
    bodyGroup = buildForest(lib, seed);
  } else if (themeId === 'pasture') {
    const built = buildPasture(lib, seed);
    bodyGroup = built.group;
    animals = built.animals;
  }

  root.add(bodyGroup);

  // Diegetic slim gold ground progress ring for non-farm, non-sea producers (Well, Forest, Pasture, Shop)
  let progressTrackMesh: THREE.Mesh | null = null;
  let progressArcMesh: THREE.Mesh | null = null;
  const usesGroundRing =
    themeId === 'well' ||
    themeId === 'forest' ||
    themeId === 'pasture' ||
    themeId === 'shop';

  if (usesGroundRing) {
    const isHalf = themeId === 'well' || themeId === 'shop';
    const innerR = isHalf ? 2.15 : 4.55;
    const outerR = isHalf ? 2.4 : 4.82;

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
    _dummy.position.set(o.x, 0.32, o.z);
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

export function updateProgressRing(handle: BuildingVisualHandle, progressRatio: number): void {
  if (!handle.progressArcMesh) return;
  const clamped = Math.max(0, Math.min(1, progressRatio));
  const bucket = Math.round(clamped * 36);
  if (bucket === handle.lastProgressBucket) return;
  handle.lastProgressBucket = bucket;

  const isHalf = handle.themeId === 'well' || handle.themeId === 'shop';
  const innerR = isHalf ? 2.15 : 4.55;
  const outerR = isHalf ? 2.4 : 4.82;
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
    // Desaturate by cloning & lerping building materials toward warm grey
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

    // Attach floating amber "!" badge sprite
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
    // Restore shared original materials
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
  const sharedGeos = new Set<THREE.BufferGeometry>([
    lib.geometries.cropStalk,
    lib.geometries.roundedFullPlot,
    lib.geometries.roundedPasturePlot,
  ]);
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
