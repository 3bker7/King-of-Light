import * as THREE from 'three';
import type { Cube } from '../game/types';
import { isPointInsideAnyBuildingFootprint } from './anchors';
import { cellToWorldCenter, getTerrainHeightAt } from './worldMath';

export const MAX_STREET_LAMP_POINT_LIGHTS = 8;

export interface StreetLampSpec {
  cubeId: number;
  row: number;
  col: number;
  x: number;
  z: number;
}

const CORNER_OFFSETS: ReadonlyArray<{ dx: number; dz: number }> = [
  { dx: 4.35, dz: 4.35 },
  { dx: -4.35, dz: 4.35 },
  { dx: 4.35, dz: -4.35 },
  { dx: -4.35, dz: -4.35 },
];

/**
 * Element 3 — Pure street-lamp placement rule:
 * - Sort owned LAND cubes (owner === 'player', !isRocky, themeId !== 'sea') by id ascending.
 * - Target count = floor(ownedLand.length / 4), anchoring on every 4th index (3, 7, 11, ...).
 *   On the fresh 3x3 kingdom (9 owned land cubes), this yields exactly 2 lamps.
 * - If the 4th cube is themed, select the next free unthemed land cube in id order (wrapping if needed).
 * - If all owned land cubes are themed, fall back to an unused owned land cube's outer street-corner
 *   anchor (always outside building footprints, never on sea or rocky cubes).
 */
export function computeStreetLampPlacements(
  cubes: readonly Cube[]
): StreetLampSpec[] {
  const ownedLand = cubes
    .filter((c) => c.owner === 'player' && !c.isRocky && c.themeId !== 'sea')
    .sort((a, b) => a.id - b.id);

  const targetCount = Math.floor(ownedLand.length / 4);
  if (targetCount <= 0) return [];

  const isFreeLand = (c: Cube): boolean =>
    c.themeId === null && c.secondThemeId === null;

  const usedIds = new Set<number>();
  const placements: StreetLampSpec[] = [];

  for (let k = 0; k < targetCount; k++) {
    const baseIdx = k * 4 + 3;
    let chosen: Cube | null = null;

    const primary = ownedLand[baseIdx];
    if (primary && isFreeLand(primary) && !usedIds.has(primary.id)) {
      chosen = primary;
    } else {
      // Scan forward from baseIdx + 1, then wrap 0 .. baseIdx - 1 for the next free land cube in id order
      for (let step = 1; step < ownedLand.length; step++) {
        const cand = ownedLand[(baseIdx + step) % ownedLand.length];
        if (isFreeLand(cand) && !usedIds.has(cand.id)) {
          chosen = cand;
          break;
        }
      }
      // Fallback if every owned land cube has a building: place at outer street corner of unused land cube
      if (!chosen) {
        if (primary && !usedIds.has(primary.id)) {
          chosen = primary;
        } else {
          for (let i = 0; i < ownedLand.length; i++) {
            if (!usedIds.has(ownedLand[i].id)) {
              chosen = ownedLand[i];
              break;
            }
          }
        }
      }
    }

    if (!chosen) continue;
    usedIds.add(chosen.id);

    const center = cellToWorldCenter(chosen.row, chosen.col);
    let bestX = center.x + CORNER_OFFSETS[0].dx;
    let bestZ = center.z + CORNER_OFFSETS[0].dz;

    // Pick a street-corner offset guaranteed outside any building footprint
    const mutableCubes = cubes as Cube[];
    for (let cIdx = 0; cIdx < CORNER_OFFSETS.length; cIdx++) {
      const off = CORNER_OFFSETS[(chosen.id + cIdx) % CORNER_OFFSETS.length];
      const tx = center.x + off.dx;
      const tz = center.z + off.dz;
      if (!isPointInsideAnyBuildingFootprint(tx, tz, mutableCubes, 0.25)) {
        bestX = tx;
        bestZ = tz;
        break;
      }
    }

    placements.push({
      cubeId: chosen.id,
      row: chosen.row,
      col: chosen.col,
      x: bestX,
      z: bestZ,
    });
  }

  return placements;
}

/**
 * Pure selector returning indices of up to `maxLights` (hard-capped at 8) lamps nearest the focus point.
 */
export function selectNearestLampIndices(
  lamps: readonly StreetLampSpec[],
  focusX: number,
  focusZ: number,
  maxLights = MAX_STREET_LAMP_POINT_LIGHTS
): number[] {
  const cap = Math.max(0, Math.min(MAX_STREET_LAMP_POINT_LIGHTS, Math.floor(maxLights)));
  if (cap === 0 || lamps.length === 0) return [];

  const ranked = lamps.map((l, idx) => {
    const dx = l.x - focusX;
    const dz = l.z - focusZ;
    return { idx, distSq: dx * dx + dz * dz, cubeId: l.cubeId };
  });
  ranked.sort((a, b) =>
    a.distSq !== b.distSq ? a.distSq - b.distSq : a.cubeId - b.cubeId
  );

  return ranked.slice(0, cap).map((r) => r.idx);
}

interface PlacedLampVisual {
  spec: StreetLampSpec;
  y: number;
  group: THREE.Group;
}

const UNLIT_GLASS_COLOR = new THREE.Color(0xd8d2c5);
const LIT_GLASS_COLOR = new THREE.Color(0xffe4a8);

export class StreetLampsManager {
  public readonly group = new THREE.Group();

  private readonly plinthGeo: THREE.CylinderGeometry;
  private readonly poleGeo: THREE.CylinderGeometry;
  private readonly collarGeo: THREE.CylinderGeometry;
  private readonly bracketGeo: THREE.BoxGeometry;
  private readonly glassGeo: THREE.CylinderGeometry;
  private readonly capGeo: THREE.ConeGeometry;

  private readonly plinthMat: THREE.MeshStandardMaterial;
  private readonly poleMat: THREE.MeshStandardMaterial;
  private readonly glassMat: THREE.MeshStandardMaterial;

  private readonly pointLightPool: THREE.PointLight[] = [];
  private activeLightCount = 0;

  private lamps: PlacedLampVisual[] = [];
  private lastSignature = '';
  private lastFocusCellKey = '';
  private lastGlow = -1;

  constructor() {
    // 5-part composite lantern post (~2.65 units tall, bottom-center pivot at y = 0)
    this.plinthGeo = new THREE.CylinderGeometry(0.18, 0.24, 0.28, 6);
    this.poleGeo = new THREE.CylinderGeometry(0.055, 0.085, 2.25, 8);
    this.collarGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.08, 8);
    this.bracketGeo = new THREE.BoxGeometry(0.32, 0.05, 0.05);
    this.glassGeo = new THREE.CylinderGeometry(0.13, 0.10, 0.30, 6);
    this.capGeo = new THREE.ConeGeometry(0.18, 0.14, 6);

    this.plinthMat = new THREE.MeshStandardMaterial({
      color: 0x8f7e63,
      roughness: 0.88,
      metalness: 0.05,
    });
    this.poleMat = new THREE.MeshStandardMaterial({
      color: 0x2c2621,
      roughness: 0.52,
      metalness: 0.72,
    });
    this.glassMat = new THREE.MeshStandardMaterial({
      color: UNLIT_GLASS_COLOR.clone(),
      emissive: new THREE.Color(0xffb45e),
      emissiveIntensity: 0,
      roughness: 0.22,
      metalness: 0.08,
    });

    // Hard-budgeted pool of 8 PointLights (warm 0xffb45e, modest radius, zero shadow cost)
    for (let i = 0; i < MAX_STREET_LAMP_POINT_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffb45e, 0, 14, 1.8);
      light.castShadow = false;
      light.visible = false;
      this.pointLightPool.push(light);
      this.group.add(light);
    }
  }

  public getLampCount(): number {
    return this.lamps.length;
  }

  public getPointLightBudget(): number {
    return this.pointLightPool.length;
  }

  public sync(
    cubes: readonly Cube[],
    seaCoords: ReadonlyArray<{ x: number; z: number }>,
    focusX: number,
    focusZ: number
  ): void {
    const specs = computeStreetLampPlacements(cubes);
    const sig = specs
      .map((s) => `${s.cubeId}:${s.x.toFixed(1)},${s.z.toFixed(1)}`)
      .join('|');
    if (sig === this.lastSignature) return;
    this.lastSignature = sig;

    // Remove old lamp meshes (keep pooled PointLights attached)
    for (let i = 0; i < this.lamps.length; i++) {
      this.group.remove(this.lamps[i].group);
    }
    this.lamps = [];

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const y = getTerrainHeightAt(spec.x, spec.z, seaCoords as Array<{ x: number; z: number }>);
      const post = this.createLampPostMesh();
      post.position.set(spec.x, y, spec.z);
      // Slight deterministic yaw so lantern bracket angles naturally toward the street
      post.rotation.y = ((spec.cubeId % 4) * Math.PI) / 2 + Math.PI / 4;
      this.group.add(post);
      this.lamps.push({ spec, y, group: post });
    }

    this.lastFocusCellKey = '';
    this.refreshNearestLights(focusX, focusZ, true);
    if (this.lastGlow >= 0) {
      this.applyLightIntensities(this.lastGlow);
    }
  }

  private createLampPostMesh(): THREE.Group {
    const root = new THREE.Group();

    const plinth = new THREE.Mesh(this.plinthGeo, this.plinthMat);
    plinth.position.y = 0.14;
    plinth.castShadow = true;
    plinth.receiveShadow = true;

    const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
    pole.position.y = 0.28 + 2.25 / 2;
    pole.castShadow = true;

    const collar = new THREE.Mesh(this.collarGeo, this.poleMat);
    collar.position.y = 2.48;

    const bracket = new THREE.Mesh(this.bracketGeo, this.poleMat);
    bracket.position.set(0.14, 2.52, 0);

    const glass = new THREE.Mesh(this.glassGeo, this.glassMat);
    glass.position.set(0.24, 2.38, 0);

    const cap = new THREE.Mesh(this.capGeo, this.poleMat);
    cap.position.set(0.24, 2.60, 0);

    root.add(plinth, pole, collar, bracket, glass, cap);
    return root;
  }

  /**
   * Recomputes the nearest-8 PointLights ONLY when the camera focus cell changes (or placements changed).
   */
  public refreshNearestLights(
    focusX: number,
    focusZ: number,
    force = false
  ): void {
    const cellX = Math.floor(focusX / 10);
    const cellZ = Math.floor(focusZ / 10);
    const key = `${cellX},${cellZ}`;
    if (!force && key === this.lastFocusCellKey) return;
    this.lastFocusCellKey = key;

    const specs = this.lamps.map((l) => l.spec);
    const nearest = selectNearestLampIndices(
      specs,
      focusX,
      focusZ,
      MAX_STREET_LAMP_POINT_LIGHTS
    );
    this.activeLightCount = nearest.length;

    for (let i = 0; i < this.pointLightPool.length; i++) {
      const light = this.pointLightPool[i];
      if (i < nearest.length) {
        const lamp = this.lamps[nearest[i]];
        light.position.set(lamp.spec.x, lamp.y + 2.42, lamp.spec.z);
      } else {
        light.visible = false;
        light.intensity = 0;
      }
    }

    if (this.lastGlow >= 0) {
      this.applyLightIntensities(this.lastGlow);
    }
  }

  public updateGlow(lampGlow: number): void {
    const clamped = Number.isFinite(lampGlow)
      ? Math.max(0, Math.min(1, lampGlow))
      : 0;
    if (Math.abs(clamped - this.lastGlow) < 0.002) return;
    this.lastGlow = clamped;

    this.glassMat.color
      .copy(UNLIT_GLASS_COLOR)
      .lerp(LIT_GLASS_COLOR, clamped);
    this.glassMat.emissiveIntensity = clamped * 2.65;

    this.applyLightIntensities(clamped);
  }

  private applyLightIntensities(glow: number): void {
    const lit = glow > 0.01;
    const intensity = lit ? glow * 2.8 : 0;
    for (let i = 0; i < this.pointLightPool.length; i++) {
      const light = this.pointLightPool[i];
      if (i < this.activeLightCount && lit) {
        light.visible = true;
        light.intensity = intensity;
      } else {
        light.visible = false;
        light.intensity = 0;
      }
    }
  }

  public dispose(): void {
    this.plinthGeo.dispose();
    this.poleGeo.dispose();
    this.collarGeo.dispose();
    this.bracketGeo.dispose();
    this.glassGeo.dispose();
    this.capGeo.dispose();
    this.plinthMat.dispose();
    this.poleMat.dispose();
    this.glassMat.dispose();
    this.lamps = [];
    this.group.clear();
  }
}
