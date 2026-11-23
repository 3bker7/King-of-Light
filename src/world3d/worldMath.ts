import * as THREE from 'three';
import { GRID_SIZE } from '../game/constants';
import type { Cube, SlotIndex } from '../game/types';

export const CELL_SIZE = 10;
export const PLAYABLE_SIZE = GRID_SIZE * CELL_SIZE; // 120 units
export const PLAYABLE_HALF = PLAYABLE_SIZE / 2; // 60 units
export const TERRAIN_SIZE = 340; // Extended wilderness fading into fog
export const TERRAIN_SEGMENTS = 144;
export const WATER_SURFACE_Y = -0.32;
export const SEA_DEPTH = -2.25;

// Deterministic hash for seeded desert noise and wilderness props
export function hash2D(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smoothNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash2D(ix, iz);
  const b = hash2D(ix + 1, iz);
  const c = hash2D(ix, iz + 1);
  const d = hash2D(ix + 1, iz + 1);

  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbmNoise(x: number, z: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < 3; i++) {
    value += amplitude * (smoothNoise(x * frequency, z * frequency) * 2 - 1);
    frequency *= 2.05;
    amplitude *= 0.48;
  }
  return value;
}

export function cellToWorldCenter(row: number, col: number): { x: number; z: number } {
  return {
    x: (col - GRID_SIZE / 2 + 0.5) * CELL_SIZE,
    z: (row - GRID_SIZE / 2 + 0.5) * CELL_SIZE,
  };
}

// Offset half-footprint slots perpendicular to the 45-degree isometric camera view
// so two half-size buildings stand clearly side-by-side without overlapping.
export function cellSlotToWorld(
  row: number,
  col: number,
  footprint: 'full' | 'half',
  slot: SlotIndex
): { x: number; z: number } {
  const center = cellToWorldCenter(row, col);
  if (footprint === 'full') return center;
  const offset = 1.9;
  if (slot === 0) {
    return { x: center.x - offset, z: center.z + offset };
  }
  return { x: center.x + offset, z: center.z - offset };
}

export function worldToCell(
  x: number,
  z: number
): { row: number; col: number; id: number } | null {
  if (
    x < -PLAYABLE_HALF ||
    x >= PLAYABLE_HALF ||
    z < -PLAYABLE_HALF ||
    z >= PLAYABLE_HALF
  ) {
    return null;
  }
  const col = Math.floor((x + PLAYABLE_HALF) / CELL_SIZE);
  const row = Math.floor((z + PLAYABLE_HALF) / CELL_SIZE);
  if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) {
    return null;
  }
  return { row, col, id: row * GRID_SIZE + col };
}

// Continuous smooth desert elevation: nearly flat inside buildable land,
// gently undulating dunes toward and beyond island borders.
export function getBaseDesertHeight(x: number, z: number): number {
  const maxAxis = Math.max(Math.abs(x), Math.abs(z));
  const edgeFactor = THREE.MathUtils.smoothstep(maxAxis, 46, 125);
  const gentleCenter = fbmNoise(x * 0.025, z * 0.025) * 0.22;
  const outerDunes =
    (fbmNoise(x * 0.018 + 7.3, z * 0.018 - 4.1) * 0.5 + 0.5) * 8.5 * edgeFactor +
    Math.sin(x * 0.045 + z * 0.03) * 1.4 * edgeFactor;
  return gentleCenter + outerDunes;
}

// Smoothly depresses terrain inside sea cells with sloped natural shorelines.
export function getSeaDepressionAt(
  x: number,
  z: number,
  seaCoords: Array<{ x: number; z: number }>
): number {
  if (seaCoords.length === 0) return 0;

  let minBoxDist = Infinity;
  const half = CELL_SIZE * 0.5;
  for (let i = 0; i < seaCoords.length; i++) {
    const sc = seaCoords[i];
    const dx = Math.max(Math.abs(x - sc.x) - half, 0);
    const dz = Math.max(Math.abs(z - sc.z) - half, 0);
    // Negative distance inside cell box for deeper center
    if (dx === 0 && dz === 0) {
      const innerEdge = Math.min(half - Math.abs(x - sc.x), half - Math.abs(z - sc.z));
      const d = -innerEdge;
      if (d < minBoxDist) minBoxDist = d;
    } else {
      const d = Math.hypot(dx, dz);
      if (d < minBoxDist) minBoxDist = d;
    }
  }

  // Smooth bank slope from +2.6 units outside sea cells down to -1.8 units inside
  if (minBoxDist > 2.8) return 0;
  const t = 1 - THREE.MathUtils.smoothstep(minBoxDist, -2.0, 2.8);
  return SEA_DEPTH * t;
}

export function getTerrainHeightAt(
  x: number,
  z: number,
  seaCoords: Array<{ x: number; z: number }>
): number {
  return getBaseDesertHeight(x, z) + getSeaDepressionAt(x, z, seaCoords);
}

// Smooth ownership blend factor (0 = neutral wilderness, 1 = owned territory)
export function getOwnedBlendAt(
  x: number,
  z: number,
  ownedCoords: Array<{ x: number; z: number }>
): number {
  if (ownedCoords.length === 0) return 0;
  const half = CELL_SIZE * 0.5;
  let minDist = Infinity;

  for (let i = 0; i < ownedCoords.length; i++) {
    const oc = ownedCoords[i];
    const dx = Math.max(Math.abs(x - oc.x) - half, 0);
    const dz = Math.max(Math.abs(z - oc.z) - half, 0);
    if (dx === 0 && dz === 0) {
      return 1;
    }
    const d = Math.hypot(dx, dz);
    if (d < minDist) minDist = d;
  }

  if (minDist > 3.2) return 0;
  return 1 - THREE.MathUtils.smoothstep(minDist, 0, 3.2);
}

// Traces exact outer perimeter loops of an arbitrary set of grid cells.
// Interior shared edges cancel automatically; produces smooth organic rounded polygons.
export function extractUnionLoops(cellSet: Set<string>): Array<Array<{ x: number; z: number }>> {
  if (cellSet.size === 0) return [];

  // Directed boundary edges in integer grid corner coordinates (0..GRID_SIZE)
  // Using clockwise winding around each cell in (col=X, row=Z):
  // Top (north):    (c, r) -> (c+1, r)
  // Right (east):   (c+1, r) -> (c+1, r+1)
  // Bottom (south): (c+1, r+1) -> (c, r+1)
  // Left (west):    (c, r+1) -> (c, r)
  type DirEdge = { x1: number; z1: number; x2: number; z2: number; used: boolean };
  const edges: DirEdge[] = [];
  const byStart = new Map<string, DirEdge[]>();

  const addEdge = (x1: number, z1: number, x2: number, z2: number) => {
    const edge: DirEdge = { x1, z1, x2, z2, used: false };
    edges.push(edge);
    const k = `${x1},${z1}`;
    const list = byStart.get(k);
    if (list) list.push(edge);
    else byStart.set(k, [edge]);
  };

  for (const key of cellSet) {
    const [rStr, cStr] = key.split(',');
    const r = Number(rStr);
    const c = Number(cStr);

    if (!cellSet.has(`${r - 1},${c}`)) addEdge(c, r, c + 1, r);
    if (!cellSet.has(`${r},${c + 1}`)) addEdge(c + 1, r, c + 1, r + 1);
    if (!cellSet.has(`${r + 1},${c}`)) addEdge(c + 1, r + 1, c, r + 1);
    if (!cellSet.has(`${r},${c - 1}`)) addEdge(c, r + 1, c, r);
  }

  const loops: Array<Array<{ x: number; z: number }>> = [];

  for (const startEdge of edges) {
    if (startEdge.used) continue;

    const rawPts: Array<{ gx: number; gz: number }> = [];
    let current: DirEdge | undefined = startEdge;
    let safety = 0;

    while (current && !current.used && safety < 2000) {
      safety += 1;
      current.used = true;
      rawPts.push({ gx: current.x1, gz: current.z1 });

      const nextKey: string = `${current.x2},${current.z2}`;
      const candidates: DirEdge[] = (byStart.get(nextKey) ?? []).filter((e) => !e.used);
      if (candidates.length === 0) break;

      if (candidates.length === 1) {
        current = candidates[0];
      } else {
        // Resolve diagonal pinch by choosing the sharpest right turn
        const inDx = current.x2 - current.x1;
        const inDz = current.z2 - current.z1;
        let best = candidates[0];
        let bestScore = -Infinity;
        for (const cand of candidates) {
          const outDx = cand.x2 - cand.x1;
          const outDz = cand.z2 - cand.z1;
          // Cross product in XZ (positive = right turn in clockwise winding)
          const cross = inDx * outDz - inDz * outDx;
          const dot = inDx * outDx + inDz * outDz;
          const score = cross * 2 - dot;
          if (score > bestScore) {
            bestScore = score;
            best = cand;
          }
        }
        current = best;
      }
    }

    if (rawPts.length < 3) continue;

    // Remove collinear mid-points so corners round cleanly
    const simplified: Array<{ x: number; z: number }> = [];
    const n = rawPts.length;
    for (let i = 0; i < n; i++) {
      const prev = rawPts[(i - 1 + n) % n];
      const curr = rawPts[i];
      const next = rawPts[(i + 1) % n];
      const dx1 = curr.gx - prev.gx;
      const dz1 = curr.gz - prev.gz;
      const dx2 = next.gx - curr.gx;
      const dz2 = next.gz - curr.gz;
      if (dx1 * dz2 - dz1 * dx2 !== 0) {
        simplified.push({
          x: (curr.gx - GRID_SIZE / 2) * CELL_SIZE,
          z: (curr.gz - GRID_SIZE / 2) * CELL_SIZE,
        });
      }
    }

    if (simplified.length >= 3) {
      loops.push(simplified);
    }
  }

  return loops;
}

// Inflates/deflates a clockwise XZ polygon outward by `offset` units along corner bisectors
export function offsetPolygonLoop(
  loop: Array<{ x: number; z: number }>,
  offset: number
): Array<{ x: number; z: number }> {
  if (Math.abs(offset) < 0.001) return loop;
  const n = loop.length;
  const out: Array<{ x: number; z: number }> = [];

  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const curr = loop[i];
    const next = loop[(i + 1) % n];

    const e1x = curr.x - prev.x;
    const e1z = curr.z - prev.z;
    const l1 = Math.hypot(e1x, e1z) || 1;
    // Outward normal for clockwise loop in XZ: (dz, -dx)
    const n1x = e1z / l1;
    const n1z = -e1x / l1;

    const e2x = next.x - curr.x;
    const e2z = next.z - curr.z;
    const l2 = Math.hypot(e2x, e2z) || 1;
    const n2x = e2z / l2;
    const n2z = -e2x / l2;

    let bx = n1x + n2x;
    let bz = n1z + n2z;
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl;
    bz /= bl;

    const dot = Math.max(0.45, bx * n1x + bz * n1z);
    const miter = Math.min(2.0, 1 / dot) * offset;

    out.push({
      x: curr.x + bx * miter,
      z: curr.z + bz * miter,
    });
  }

  return out;
}

// Creates a smooth rounded THREE.Shape (in XY where Shape.y = -World.z for rotateX(-PI/2))
export function buildRoundedLoopShape(
  loop: Array<{ x: number; z: number }>,
  cornerRadius = 3.2
): THREE.Shape {
  const shape = new THREE.Shape();
  const n = loop.length;

  const getCornerTrim = (i: number) => {
    const prev = loop[(i - 1 + n) % n];
    const curr = loop[i];
    const next = loop[(i + 1) % n];

    const v1x = prev.x - curr.x;
    const v1z = prev.z - curr.z;
    const len1 = Math.hypot(v1x, v1z) || 1;
    const v2x = next.x - curr.x;
    const v2z = next.z - curr.z;
    const len2 = Math.hypot(v2x, v2z) || 1;

    const r = Math.min(cornerRadius, len1 * 0.45, len2 * 0.45);
    return {
      before: { x: curr.x + (v1x / len1) * r, z: curr.z + (v1z / len1) * r },
      corner: curr,
      after: { x: curr.x + (v2x / len2) * r, z: curr.z + (v2z / len2) * r },
    };
  };

  const first = getCornerTrim(0);
  shape.moveTo(first.before.x, -first.before.z);
  shape.quadraticCurveTo(
    first.corner.x,
    -first.corner.z,
    first.after.x,
    -first.after.z
  );

  for (let i = 1; i < n; i++) {
    const t = getCornerTrim(i);
    shape.lineTo(t.before.x, -t.before.z);
    shape.quadraticCurveTo(t.corner.x, -t.corner.z, t.after.x, -t.after.z);
  }

  shape.closePath();
  return shape;
}

// Samples points along a rounded perimeter loop in 3D world space for smooth ground ribbons
export function sampleRoundedLoopPoints3D(
  loop: Array<{ x: number; z: number }>,
  seaCoords: Array<{ x: number; z: number }>,
  yOffset = 0.22,
  cornerRadius = 2.8
): THREE.Vector3[] {
  const shape = buildRoundedLoopShape(loop, cornerRadius);
  const pts2d = shape.getSpacedPoints(Math.max(48, loop.length * 14));
  // Drop duplicate last point because CatmullRomCurve3 is closed
  if (pts2d.length > 2) pts2d.pop();

  return pts2d.map((p) => {
    const wx = p.x;
    const wz = -p.y;
    const wy = getTerrainHeightAt(wx, wz, seaCoords) + yOffset;
    return new THREE.Vector3(wx, wy, wz);
  });
}

export function getOwnedTerritoryBounds(cubes: Cube[]): {
  centerX: number;
  centerZ: number;
  span: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const c of cubes) {
    if (c.owner !== 'player') continue;
    const pos = cellToWorldCenter(c.row, c.col);
    if (pos.x < minX) minX = pos.x;
    if (pos.x > maxX) maxX = pos.x;
    if (pos.z < minZ) minZ = pos.z;
    if (pos.z > maxZ) maxZ = pos.z;
  }

  if (!Number.isFinite(minX)) {
    return { centerX: 45, centerZ: 45, span: 45 };
  }

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    span: Math.max(maxX - minX + CELL_SIZE, maxZ - minZ + CELL_SIZE),
  };
}
