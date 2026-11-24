import { GRID_SIZE, THEMES } from '../game/constants';
import type { Cube, SlotIndex, ThemeFootprint, ThemeId } from '../game/types';
import {
  CELL_SIZE,
  cellToWorldCenter,
  getTerrainHeightAt,
  PLAYABLE_HALF,
  WATER_SURFACE_Y,
} from './worldMath';

export interface AnchorPoint {
  x: number;
  z: number;
}

export interface FootprintRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface BuildingAnchors {
  doorstep: AnchorPoint;
  workSpots: AnchorPoint[];
  faceTarget: AnchorPoint;
  footprintRect: FootprintRect;
  /** Outward cardinal direction from the building's cell toward its doorstep approach side */
  approachOffset: { dRow: number; dCol: number };
}

export interface AnchorWorldContext {
  cubes?: Cube[];
  seaCoords?: AnchorPoint[];
  row?: number;
  col?: number;
}

// Field/open-plot full themes where workers legitimately stand inside the plot
export const WALKABLE_FIELD_THEMES = new Set<ThemeId>([
  'farm',
  'wheat_farm',
  'orchard',
  'pasture',
  'forest',
]);

// Fixed deterministic lateral jitter per slot (no runtime randomness)
const SLOT_LATERAL_JITTER: Record<SlotIndex, number> = {
  0: -0.25,
  1: 0.25,
};

const FULL_LATERAL_JITTER_BY_THEME: Partial<Record<ThemeId, number>> = {
  palace: 0,
  farm: -0.3,
  wheat_farm: 0.3,
  orchard: -0.2,
  pasture: 0.25,
  forest: -0.35,
  quarry: 0.2,
  iron_mine: -0.2,
  copper_mine: 0.2,
  gold_mine: -0.25,
  gem_mine: 0.25,
  oil_well: 0.15,
  warehouse_bldg: -0.2,
  workshop: 0.25,
  grand_market: 0,
  hotel: 0,
  mosque: 0,
  theater: 0,
  school: -0.15,
};

const HALF_SLOT_OFFSET = 1.9;
const DOORSTEP_CLEARANCE = 0.9;
const WATER_SAFE_MARGIN = 1.9; // Strictly beyond water mesh (+0.55), foam (+1.15), and wet depression

export function getSlotWorldCenterFromCell(
  cellWorldPos: AnchorPoint,
  footprint: ThemeFootprint,
  slot: SlotIndex
): AnchorPoint {
  if (footprint === 'full') {
    return { x: cellWorldPos.x, z: cellWorldPos.z };
  }
  if (slot === 0) {
    return {
      x: cellWorldPos.x - HALF_SLOT_OFFSET,
      z: cellWorldPos.z + HALF_SLOT_OFFSET,
    };
  }
  return {
    x: cellWorldPos.x + HALF_SLOT_OFFSET,
    z: cellWorldPos.z - HALF_SLOT_OFFSET,
  };
}

export function getBuildingFootprintHalfExtents(
  themeId: ThemeId,
  footprint: ThemeFootprint
): { halfW: number; halfD: number } {
  if (footprint === 'half') {
    if (themeId === 'well') {
      return { halfW: 1.72, halfD: 1.72 };
    }
    return { halfW: 1.75, halfD: 1.65 };
  }

  switch (themeId) {
    case 'palace':
      // Main hall + wings + front courtyard fountain end before z=+3.6
      return { halfW: 3.7, halfD: 3.6 };
    case 'sea':
      return { halfW: CELL_SIZE * 0.5, halfD: CELL_SIZE * 0.5 };
    case 'farm':
    case 'wheat_farm':
    case 'orchard':
    case 'pasture':
    case 'forest':
      return { halfW: 3.6, halfD: 3.6 };
    case 'hotel':
      return { halfW: 3.5, halfD: 3.4 };
    default:
      // Solid full structures: mines, quarry, oil_well, warehouse, workshop, grand_market, mosque, theater, school
      return { halfW: 3.5, halfD: 3.5 };
  }
}

export function getBuildingFootprintRect(
  themeId: ThemeId,
  footprint: ThemeFootprint,
  slot: SlotIndex,
  cellWorldPos: AnchorPoint
): FootprintRect {
  const center = getSlotWorldCenterFromCell(cellWorldPos, footprint, slot);
  const { halfW, halfD } = getBuildingFootprintHalfExtents(themeId, footprint);
  return {
    minX: center.x - halfW,
    maxX: center.x + halfW,
    minZ: center.z - halfD,
    maxZ: center.z + halfD,
  };
}

export function isPointInRect(
  x: number,
  z: number,
  rect: FootprintRect,
  pad = 0
): boolean {
  return (
    x >= rect.minX - pad &&
    x <= rect.maxX + pad &&
    z >= rect.minZ - pad &&
    z <= rect.maxZ + pad
  );
}

/**
 * Returns true if (x, z) lies over a sea cell, its water/foam plane, or wet seabed below WATER_SURFACE_Y.
 */
export function isPointOverWater(
  x: number,
  z: number,
  seaCoords: AnchorPoint[]
): boolean {
  if (seaCoords.length === 0) return false;
  const half = CELL_SIZE * 0.5;
  for (let i = 0; i < seaCoords.length; i++) {
    const sc = seaCoords[i];
    const dx = Math.max(Math.abs(x - sc.x) - half, 0);
    const dz = Math.max(Math.abs(z - sc.z) - half, 0);
    if (dx === 0 && dz === 0) return true;
    if (Math.hypot(dx, dz) < WATER_SAFE_MARGIN) return true;
  }
  return getTerrainHeightAt(x, z, seaCoords) <= WATER_SURFACE_Y + 0.04;
}

/**
 * Checks whether (x, z) falls inside any solid building footprint on the map.
 * Field/pasture/forest interiors can be excluded for workers of those plots.
 */
export function isPointInsideAnyBuildingFootprint(
  x: number,
  z: number,
  cubes: Cube[],
  allowedFieldCubeId?: number,
  ignoreAllWalkableFields = false
): boolean {
  for (let i = 0; i < cubes.length; i++) {
    const cube = cubes[i];
    if (cube.owner !== 'player') continue;
    const cellCenter = cellToWorldCenter(cube.row, cube.col);

    const slots: Array<{ slot: SlotIndex; themeId: ThemeId | null }> = [
      { slot: 0, themeId: cube.themeId },
      { slot: 1, themeId: cube.secondThemeId },
    ];

    for (let s = 0; s < slots.length; s++) {
      const themeId = slots[s].themeId;
      if (!themeId || themeId === 'sea') continue;
      if (
        WALKABLE_FIELD_THEMES.has(themeId) &&
        (ignoreAllWalkableFields || allowedFieldCubeId === cube.id)
      ) {
        continue;
      }
      const def = THEMES[themeId];
      const rect = getBuildingFootprintRect(
        themeId,
        def.footprint,
        slots[s].slot,
        cellCenter
      );
      if (isPointInRect(x, z, rect, -0.02)) {
        return true;
      }
    }
  }
  return false;
}

function isWithinPlayableLand(x: number, z: number): boolean {
  return (
    x >= -PLAYABLE_HALF + 0.5 &&
    x <= PLAYABLE_HALF - 0.5 &&
    z >= -PLAYABLE_HALF + 0.5 &&
    z <= PLAYABLE_HALF - 0.5
  );
}

/**
 * Picks a dry, landward shoreline anchor strictly ON SAND outside the sea cell's water plane
 * and outside every building footprint.
 */
function resolveSeaShorelineAnchors(
  cellWorldPos: AnchorPoint,
  context?: AnchorWorldContext
): {
  doorstep: AnchorPoint;
  workSpots: AnchorPoint[];
  approachOffset: { dRow: number; dCol: number };
} {
  const cubes = context?.cubes;
  const seaCoords = context?.seaCoords ?? [cellWorldPos];
  const row = context?.row;
  const col = context?.col;

  // Candidate shoreline offsets around the sea cell (7.1 units = 2.1 units outside the sea box -> dry sand)
  // Ordered South, East, West, North, then corners
  const cardinalCandidates: Array<{
    dRow: number;
    dCol: number;
    pts: AnchorPoint[];
  }> = [
    {
      dRow: 1,
      dCol: 0,
      pts: [
        { x: cellWorldPos.x, z: cellWorldPos.z + 7.1 },
        { x: cellWorldPos.x - 1.4, z: cellWorldPos.z + 7.1 },
        { x: cellWorldPos.x + 1.4, z: cellWorldPos.z + 7.1 },
      ],
    },
    {
      dRow: 0,
      dCol: 1,
      pts: [
        { x: cellWorldPos.x + 7.1, z: cellWorldPos.z },
        { x: cellWorldPos.x + 7.1, z: cellWorldPos.z + 1.4 },
        { x: cellWorldPos.x + 7.1, z: cellWorldPos.z - 1.4 },
      ],
    },
    {
      dRow: 0,
      dCol: -1,
      pts: [
        { x: cellWorldPos.x - 7.1, z: cellWorldPos.z },
        { x: cellWorldPos.x - 7.1, z: cellWorldPos.z + 1.4 },
        { x: cellWorldPos.x - 7.1, z: cellWorldPos.z - 1.4 },
      ],
    },
    {
      dRow: -1,
      dCol: 0,
      pts: [
        { x: cellWorldPos.x, z: cellWorldPos.z - 7.1 },
        { x: cellWorldPos.x - 1.4, z: cellWorldPos.z - 7.1 },
        { x: cellWorldPos.x + 1.4, z: cellWorldPos.z - 7.1 },
      ],
    },
    // Diagonal dry corners (distance outside box = hypot(1.5, 1.5) = 2.12 > WATER_SAFE_MARGIN)
    {
      dRow: 1,
      dCol: 1,
      pts: [{ x: cellWorldPos.x + 6.55, z: cellWorldPos.z + 6.55 }],
    },
    {
      dRow: 1,
      dCol: -1,
      pts: [{ x: cellWorldPos.x - 6.55, z: cellWorldPos.z + 6.55 }],
    },
    {
      dRow: -1,
      dCol: 1,
      pts: [{ x: cellWorldPos.x + 6.55, z: cellWorldPos.z - 6.55 }],
    },
    {
      dRow: -1,
      dCol: -1,
      pts: [{ x: cellWorldPos.x - 6.55, z: cellWorldPos.z - 6.55 }],
    },
  ];

  // Pass 1: prefer owned non-sea neighbor cell; Pass 2: any playable dry land
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < cardinalCandidates.length; i++) {
      const cand = cardinalCandidates[i];
      if (pass === 0 && cubes && row !== undefined && col !== undefined) {
        const nr = row + cand.dRow;
        const nc = col + cand.dCol;
        if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;
        const neighbor = cubes[nr * GRID_SIZE + nc];
        if (!neighbor || neighbor.owner !== 'player' || neighbor.themeId === 'sea') {
          continue;
        }
      }

      const validPts: AnchorPoint[] = [];
      for (let p = 0; p < cand.pts.length; p++) {
        const pt = cand.pts[p];
        if (!isWithinPlayableLand(pt.x, pt.z)) continue;
        if (isPointOverWater(pt.x, pt.z, seaCoords)) continue;
        if (cubes && isPointInsideAnyBuildingFootprint(pt.x, pt.z, cubes)) {
          continue;
        }
        validPts.push(pt);
      }

      if (validPts.length > 0) {
        return {
          doorstep: validPts[0],
          workSpots: validPts.slice(0, 2),
          approachOffset: { dRow: cand.dRow, dCol: cand.dCol },
        };
      }
    }
  }

  // Fallback landward corner strictly outside the sea box
  const fallback: AnchorPoint = {
    x: Math.max(-PLAYABLE_HALF + 1, Math.min(PLAYABLE_HALF - 1, cellWorldPos.x - 6.55)),
    z: Math.max(-PLAYABLE_HALF + 1, Math.min(PLAYABLE_HALF - 1, cellWorldPos.z - 6.55)),
  };
  return {
    doorstep: fallback,
    workSpots: [fallback],
    approachOffset: { dRow: -1, dCol: -1 },
  };
}

/**
 * Element 1.1: Returns deterministic building anchors (doorstep + workSpots + faceTarget).
 * Every anchor lies outside building footprint rectangles (except explicitly allowed field/pasture/forest
 * workSpots) and never over water.
 */
export function getBuildingAnchors(
  themeId: ThemeId,
  footprint: ThemeFootprint,
  slot: SlotIndex,
  cellWorldPos: AnchorPoint,
  context?: AnchorWorldContext
): BuildingAnchors {
  const slotCenter = getSlotWorldCenterFromCell(cellWorldPos, footprint, slot);
  const { halfW, halfD } = getBuildingFootprintHalfExtents(themeId, footprint);
  const footprintRect: FootprintRect = {
    minX: slotCenter.x - halfW,
    maxX: slotCenter.x + halfW,
    minZ: slotCenter.z - halfD,
    maxZ: slotCenter.z + halfD,
  };

  // Special case: Sea shoreline anchor strictly on land at the beach edge
  if (themeId === 'sea') {
    const sea = resolveSeaShorelineAnchors(cellWorldPos, context);
    return {
      doorstep: sea.doorstep,
      workSpots: sea.workSpots,
      faceTarget: { x: cellWorldPos.x, z: cellWorldPos.z },
      footprintRect,
      approachOffset: sea.approachOffset,
    };
  }

  const jitter =
    footprint === 'half'
      ? SLOT_LATERAL_JITTER[slot]
      : (FULL_LATERAL_JITTER_BY_THEME[themeId] ?? 0);

  // Default doorstep: south edge at (footprintHalfDepth + 0.9) + deterministic lateral jitter
  const doorCandidates: Array<{
    pt: AnchorPoint;
    offset: { dRow: number; dCol: number };
  }> = [
    {
      pt: { x: slotCenter.x + jitter, z: slotCenter.z + halfD + DOORSTEP_CLEARANCE },
      offset: { dRow: 1, dCol: 0 },
    },
    {
      pt: { x: slotCenter.x + halfW + DOORSTEP_CLEARANCE, z: slotCenter.z + jitter },
      offset: { dRow: 0, dCol: 1 },
    },
    {
      pt: { x: slotCenter.x - halfW - DOORSTEP_CLEARANCE, z: slotCenter.z + jitter },
      offset: { dRow: 0, dCol: -1 },
    },
    {
      pt: { x: slotCenter.x + jitter, z: slotCenter.z - halfD - DOORSTEP_CLEARANCE },
      offset: { dRow: -1, dCol: 0 },
    },
  ];

  const seaCoords = context?.seaCoords ?? [];
  const cubes = context?.cubes;
  const row = context?.row;
  const col = context?.col;

  const isValidDoorCandidate = (
    cand: { pt: AnchorPoint; offset: { dRow: number; dCol: number } },
    requireWalkableNeighbor: boolean
  ): boolean => {
    if (!isWithinPlayableLand(cand.pt.x, cand.pt.z)) return false;
    if (seaCoords.length > 0 && isPointOverWater(cand.pt.x, cand.pt.z, seaCoords)) {
      return false;
    }
    if (cubes && isPointInsideAnyBuildingFootprint(cand.pt.x, cand.pt.z, cubes)) {
      return false;
    }
    if (
      requireWalkableNeighbor &&
      footprint === 'full' &&
      !WALKABLE_FIELD_THEMES.has(themeId) &&
      cubes &&
      row !== undefined &&
      col !== undefined
    ) {
      const nr = row + cand.offset.dRow;
      const nc = col + cand.offset.dCol;
      if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) return false;
      const neighbor = cubes[nr * GRID_SIZE + nc];
      if (!neighbor || neighbor.owner !== 'player') return false;
      if (neighbor.themeId === 'sea' || neighbor.secondThemeId === 'sea') return false;
      if (
        neighbor.themeId &&
        THEMES[neighbor.themeId].footprint === 'full' &&
        !WALKABLE_FIELD_THEMES.has(neighbor.themeId)
      ) {
        return false;
      }
    }
    return true;
  };

  let chosenDoor = doorCandidates[0];
  let foundPreferred = false;
  // Pass 1: South-first among sides opening onto an owned walkable street cell
  for (let i = 0; i < doorCandidates.length; i++) {
    if (isValidDoorCandidate(doorCandidates[i], true)) {
      chosenDoor = doorCandidates[i];
      foundPreferred = true;
      break;
    }
  }
  // Pass 2: Any dry land doorstep outside footprints if completely surrounded
  if (!foundPreferred) {
    for (let i = 0; i < doorCandidates.length; i++) {
      if (isValidDoorCandidate(doorCandidates[i], false)) {
        chosenDoor = doorCandidates[i];
        break;
      }
    }
  }

  const doorstep = chosenDoor.pt;
  const approachOffset = chosenDoor.offset;
  let workSpots: AnchorPoint[] = [doorstep];

  switch (themeId) {
    case 'farm':
    case 'wheat_farm':
    case 'orchard':
      // Explicitly allowed inside the field plot: field rows offset (±1.8, ±1.2) from center
      workSpots = [
        { x: slotCenter.x - 1.8, z: slotCenter.z - 1.2 },
        { x: slotCenter.x + 1.8, z: slotCenter.z + 1.2 },
      ];
      break;

    case 'pasture':
      // Explicitly allowed inside the fence near the animals
      workSpots = [
        { x: slotCenter.x - 1.7, z: slotCenter.z + 1.0 },
        { x: slotCenter.x + 1.6, z: slotCenter.z - 1.1 },
      ];
      break;

    case 'forest':
      // Tree line edge (inside the forest plot's southern clearing edge)
      workSpots = [
        { x: slotCenter.x - 2.2, z: slotCenter.z + 3.1 },
        { x: slotCenter.x + 2.2, z: slotCenter.z + 3.0 },
      ];
      break;

    case 'quarry':
    case 'iron_mine':
    case 'copper_mine':
    case 'gold_mine':
    case 'gem_mine':
    case 'oil_well': {
      // Plot front edge beside the structure, strictly OUTSIDE the shaft footprint
      const frontCandidates: AnchorPoint[] =
        approachOffset.dRow !== 0
          ? [
              { x: slotCenter.x - 1.6, z: doorstep.z },
              { x: slotCenter.x + 1.6, z: doorstep.z },
            ]
          : [
              { x: doorstep.x, z: slotCenter.z - 1.6 },
              { x: doorstep.x, z: slotCenter.z + 1.6 },
            ];
      const safeFront = frontCandidates.filter(
        (pt) =>
          isWithinPlayableLand(pt.x, pt.z) &&
          !isPointOverWater(pt.x, pt.z, seaCoords) &&
          !(cubes && isPointInsideAnyBuildingFootprint(pt.x, pt.z, cubes))
      );
      workSpots = safeFront.length > 0 ? safeFront : [doorstep];
      break;
    }

    case 'palace': {
      // Open-air courtyard points right in front of the palace steps, outside the hall & fountain
      const courtyardCandidates: AnchorPoint[] = [
        { x: doorstep.x, z: doorstep.z },
        { x: slotCenter.x - 1.8, z: doorstep.z },
        { x: slotCenter.x + 1.8, z: doorstep.z },
      ].filter(
        (pt) =>
          isWithinPlayableLand(pt.x, pt.z) &&
          !isPointOverWater(pt.x, pt.z, seaCoords) &&
          !(cubes && isPointInsideAnyBuildingFootprint(pt.x, pt.z, cubes))
      );
      workSpots = courtyardCandidates.length > 0 ? courtyardCandidates : [doorstep];
      break;
    }

    case 'house':
    case 'well':
    case 'shop':
    case 'grand_market':
    case 'bakery':
    case 'restaurant':
    case 'cafe':
    case 'jeweler':
    case 'workshop':
    case 'trade_office':
    case 'hotel':
    case 'warehouse_bldg':
    case 'clinic':
    case 'school':
    case 'theater':
    case 'mosque':
    case 'garden':
    default:
      // Staff stand at the doorstep / entrance / counter front
      workSpots = [doorstep];
      break;
  }

  return {
    doorstep,
    workSpots,
    faceTarget: slotCenter,
    footprintRect,
    approachOffset,
  };
}
