import { GRID_SIZE, THEMES } from '../game/constants';
import type { Cube, ThemeId } from '../game/types';
import {
  type AnchorPoint,
  isPointInsideAnyBuildingFootprint,
  isPointOverWater,
  WALKABLE_FIELD_THEMES,
} from './anchors';
import { cellToWorldCenter, worldToCell } from './worldMath';

export interface GridCoord {
  row: number;
  col: number;
}

export interface StreetGrid {
  /** blocked[row * GRID_SIZE + col] === true means transit through this cell is forbidden */
  blocked: Uint8Array;
  cubes: Cube[];
  seaCoords: AnchorPoint[];
}

export interface StreetPathResult {
  reachable: boolean;
  /** Ordered world-space waypoints along free cell centers ending at the anchor (or nearest free cell if unreachable) */
  waypoints: AnchorPoint[];
  /** Intermediate free grid cells visited by the A* path */
  cellPath: GridCoord[];
}

const CARDINAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Element 2.1: A cell is BLOCKED for transit if:
 * - it is not owned by the player,
 * - it is a sea cell (water is never walkable),
 * - it holds a full-footprint building EXCEPT walkable fields (farm, wheat_farm, orchard, pasture, forest).
 * Half-footprint cells remain walkable along their orthogonal center street lanes.
 */
export function isCellBlockedForTransit(cube: Cube | undefined): boolean {
  if (!cube || cube.owner !== 'player') return true;
  if (cube.themeId === 'sea' || cube.secondThemeId === 'sea') return true;
  if (cube.themeId !== null) {
    const def = THEMES[cube.themeId];
    if (def.footprint === 'full' && !WALKABLE_FIELD_THEMES.has(cube.themeId)) {
      return true;
    }
  }
  return false;
}

export function buildStreetGrid(
  cubes: Cube[],
  seaCoords: AnchorPoint[]
): StreetGrid {
  const blocked = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (let i = 0; i < cubes.length; i++) {
    const c = cubes[i];
    if (isCellBlockedForTransit(c)) {
      blocked[c.row * GRID_SIZE + c.col] = 1;
    }
  }
  return { blocked, cubes, seaCoords };
}

export function isCellWalkable(
  grid: StreetGrid,
  row: number,
  col: number
): boolean {
  if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) return false;
  return grid.blocked[row * GRID_SIZE + col] === 0;
}

/**
 * Finds the best walkable cell for a world point (if the point sits on the doorstep margin
 * of a blocked full-building cell, picks the adjacent walkable cell on that side).
 */
export function findWalkableCellForPoint(
  grid: StreetGrid,
  x: number,
  z: number,
  preferredOffset?: { dRow: number; dCol: number }
): GridCoord | null {
  const cell = worldToCell(x, z);
  if (cell && isCellWalkable(grid, cell.row, cell.col)) {
    return { row: cell.row, col: cell.col };
  }

  if (cell && preferredOffset) {
    const pr = cell.row + preferredOffset.dRow;
    const pc = cell.col + preferredOffset.dCol;
    if (isCellWalkable(grid, pr, pc)) {
      return { row: pr, col: pc };
    }
  }

  // Try orthogonal neighbors of the containing cell first (nearest to point)
  if (cell) {
    let bestNeighbor: GridCoord | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < CARDINAL_DIRS.length; i++) {
      const nr = cell.row + CARDINAL_DIRS[i][0];
      const nc = cell.col + CARDINAL_DIRS[i][1];
      if (!isCellWalkable(grid, nr, nc)) continue;
      const center = cellToWorldCenter(nr, nc);
      const d = Math.hypot(center.x - x, center.z - z);
      if (d < bestDist) {
        bestDist = d;
        bestNeighbor = { row: nr, col: nc };
      }
    }
    if (bestNeighbor) return bestNeighbor;
  }

  return null;
}

/**
 * Checks whether a straight line segment (ax, az) -> (bx, bz) stays clear of:
 * - all sea cells / water planes,
 * - all blocked full-building cells (except an optional doorstep cell margin outside its footprint),
 * - all building footprint rectangles (except allowed field interiors).
 */
export function isSegmentClear(
  grid: StreetGrid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  allowedDoorstepCubeId?: number,
  allowedFieldCubeId?: number
): boolean {
  const dist = Math.hypot(bx - ax, bz - az);
  if (dist < 0.05) return true;
  const steps = Math.max(4, Math.ceil(dist / 0.85));

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = ax + (bx - ax) * t;
    const pz = az + (bz - az) * t;

    if (isPointOverWater(px, pz, grid.seaCoords)) {
      return false;
    }

    const cell = worldToCell(px, pz);
    if (!cell) return false;
    const cube = grid.cubes[cell.id];
    if (!cube || cube.owner !== 'player') return false;
    if (cube.themeId === 'sea' || cube.secondThemeId === 'sea') return false;

    if (grid.blocked[cell.id] === 1 && cell.id !== allowedDoorstepCubeId) {
      return false;
    }

    if (
      isPointInsideAnyBuildingFootprint(
        px,
        pz,
        grid.cubes,
        allowedFieldCubeId,
        true
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Element 2.2 & 2.5: 4-connected A* over the 12x12 grid.
 * Never enters a sea cell or a blocked full-building cell.
 * Returns free cell-center waypoints followed by the final approach to destAnchor,
 * or routes to the nearest reachable free cell if isolated (reachable = false).
 */
export function computeStreetPath(
  grid: StreetGrid,
  fromX: number,
  fromZ: number,
  destAnchor: AnchorPoint,
  options?: {
    destCubeId?: number;
    destThemeId?: ThemeId | null;
    destApproachOffset?: { dRow: number; dCol: number };
    originApproachOffset?: { dRow: number; dCol: number };
  }
): StreetPathResult {
  const startCell = findWalkableCellForPoint(
    grid,
    fromX,
    fromZ,
    options?.originApproachOffset
  );

  // If the agent somehow started on an isolated blocked cell with no walkable neighbor, stay put & wait
  if (!startCell) {
    return { reachable: false, waypoints: [], cellPath: [] };
  }

  const destCell = findWalkableCellForPoint(
    grid,
    destAnchor.x,
    destAnchor.z,
    options?.destApproachOffset
  );

  const destCubeId = options?.destCubeId;
  const isFieldDest =
    options?.destThemeId != null && WALKABLE_FIELD_THEMES.has(options.destThemeId);
  const allowedFieldCubeId = isFieldDest ? destCubeId : undefined;
  const allowedDoorstepCubeId =
    options?.destThemeId && options.destThemeId !== 'sea' ? destCubeId : undefined;

  // Run 4-connected A* from startCell to destCell (or full flood if destCell is null)
  const total = GRID_SIZE * GRID_SIZE;
  const startIdx = startCell.row * GRID_SIZE + startCell.col;
  const goalIdx = destCell ? destCell.row * GRID_SIZE + destCell.col : -1;

  const gScore = new Float32Array(total);
  const fScore = new Float32Array(total);
  const cameFrom = new Int16Array(total);
  const closed = new Uint8Array(total);
  const inOpen = new Uint8Array(total);

  gScore.fill(Infinity);
  fScore.fill(Infinity);
  cameFrom.fill(-1);

  const heuristic = (r: number, c: number) =>
    destCell ? Math.abs(r - destCell.row) + Math.abs(c - destCell.col) : 0;

  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(startCell.row, startCell.col);
  const openList: number[] = [startIdx];
  inOpen[startIdx] = 1;

  let reachedGoal = false;
  let bestFallbackIdx = startIdx;
  let bestFallbackDist = Infinity;

  while (openList.length > 0) {
    // Find lowest fScore in openList (12x12 -> max 144 nodes, linear scan is < 1 microsecond)
    let bestPos = 0;
    let bestF = fScore[openList[0]];
    for (let i = 1; i < openList.length; i++) {
      const f = fScore[openList[i]];
      if (f < bestF) {
        bestF = f;
        bestPos = i;
      }
    }

    const current = openList[bestPos];
    openList[bestPos] = openList[openList.length - 1];
    openList.pop();
    inOpen[current] = 0;
    closed[current] = 1;

    const cr = Math.floor(current / GRID_SIZE);
    const cc = current % GRID_SIZE;
    const cWorld = cellToWorldCenter(cr, cc);
    const dToDest = Math.hypot(cWorld.x - destAnchor.x, cWorld.z - destAnchor.z);
    if (dToDest < bestFallbackDist) {
      bestFallbackDist = dToDest;
      bestFallbackIdx = current;
    }

    if (current === goalIdx) {
      reachedGoal = true;
      break;
    }

    for (let d = 0; d < CARDINAL_DIRS.length; d++) {
      const nr = cr + CARDINAL_DIRS[d][0];
      const nc = cc + CARDINAL_DIRS[d][1];
      if (!isCellWalkable(grid, nr, nc)) continue;
      const nIdx = nr * GRID_SIZE + nc;
      if (closed[nIdx]) continue;

      const tentativeG = gScore[current] + 1;
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentativeG;
        fScore[nIdx] = tentativeG + heuristic(nr, nc);
        if (!inOpen[nIdx]) {
          openList.push(nIdx);
          inOpen[nIdx] = 1;
        }
      }
    }
  }

  const reconstructCells = (endIdx: number): GridCoord[] => {
    const cells: GridCoord[] = [];
    let cur = endIdx;
    let safety = 0;
    while (cur !== -1 && safety < 200) {
      safety += 1;
      cells.push({ row: Math.floor(cur / GRID_SIZE), col: cur % GRID_SIZE });
      cur = cameFrom[cur];
    }
    cells.reverse();
    return cells;
  };

  // Helper: connect (ax, az) -> (bx, bz) safely without clipping building corners (uses L-shaped sidewalk corner if diagonal clips)
  const appendSafeTransition = (
    out: AnchorPoint[],
    ax: number,
    az: number,
    bx: number,
    bz: number,
    allowDoorCubeId?: number,
    allowFieldCubeId?: number
  ) => {
    if (Math.hypot(bx - ax, bz - az) < 0.25) return;
    if (isSegmentClear(grid, ax, az, bx, bz, allowDoorCubeId, allowFieldCubeId)) {
      out.push({ x: bx, z: bz });
      return;
    }
    // Try both axis-aligned L-corners (x-first vs z-first) along the cell street lanes
    const corner1: AnchorPoint = { x: bx, z: az };
    if (
      isSegmentClear(grid, ax, az, corner1.x, corner1.z, allowDoorCubeId, allowFieldCubeId) &&
      isSegmentClear(grid, corner1.x, corner1.z, bx, bz, allowDoorCubeId, allowFieldCubeId)
    ) {
      out.push(corner1, { x: bx, z: bz });
      return;
    }
    const corner2: AnchorPoint = { x: ax, z: bz };
    if (
      isSegmentClear(grid, ax, az, corner2.x, corner2.z, allowDoorCubeId, allowFieldCubeId) &&
      isSegmentClear(grid, corner2.x, corner2.z, bx, bz, allowDoorCubeId, allowFieldCubeId)
    ) {
      out.push(corner2, { x: bx, z: bz });
      return;
    }
    // Fallback via start cell's orthogonal center lane if available
    out.push({ x: bx, z: bz });
  };

  // Element 2.5: Unreachable destination -> walk to nearest reachable free cell center, then wait
  if (!reachedGoal || !destCell) {
    const fallbackCells = reconstructCells(bestFallbackIdx);
    const waypoints: AnchorPoint[] = [];
    let curX = fromX;
    let curZ = fromZ;
    for (let i = 0; i < fallbackCells.length; i++) {
      const c = fallbackCells[i];
      const center = cellToWorldCenter(c.row, c.col);
      if (i === 0 && Math.hypot(center.x - curX, center.z - curZ) < 0.7) {
        continue;
      }
      if (i === 0) {
        appendSafeTransition(waypoints, curX, curZ, center.x, center.z);
      } else {
        waypoints.push(center);
      }
      curX = center.x;
      curZ = center.z;
    }
    return {
      reachable: false,
      waypoints,
      cellPath: fallbackCells,
    };
  }

  const cellPath = reconstructCells(goalIdx);

  // Element 2.2: If origin and destination are in the same or adjacent cells AND the direct segment
  // is strictly clear of water and building footprints, go straight to the anchor.
  if (cellPath.length <= 2) {
    const startCellNow = worldToCell(fromX, fromZ);
    const sameOrAdj =
      startCellNow !== null &&
      Math.abs(startCellNow.row - destCell.row) +
        Math.abs(startCellNow.col - destCell.col) <=
        1;
    if (
      sameOrAdj &&
      isSegmentClear(
        grid,
        fromX,
        fromZ,
        destAnchor.x,
        destAnchor.z,
        allowedDoorstepCubeId,
        allowedFieldCubeId
      )
    ) {
      return {
        reachable: true,
        waypoints: [{ x: destAnchor.x, z: destAnchor.z }],
        cellPath,
      };
    }
  }

  // Convert free A* cell path into cell-center waypoints (with L-corner sidewalk transitions at both ends)
  const waypoints: AnchorPoint[] = [];
  let curX = fromX;
  let curZ = fromZ;

  // Determine if origin is standing at a full-building doorstep margin so its exit step is allowed
  const originCellNow = worldToCell(fromX, fromZ);
  const originCubeId = originCellNow ? originCellNow.id : undefined;

  for (let i = 0; i < cellPath.length; i++) {
    const c = cellPath[i];
    const center = cellToWorldCenter(c.row, c.col);
    if (i === 0 && Math.hypot(center.x - curX, center.z - curZ) < 0.35) {
      continue;
    }
    if (i === 0) {
      appendSafeTransition(waypoints, curX, curZ, center.x, center.z, originCubeId, originCubeId);
    } else {
      waypoints.push(center);
    }
    curX = center.x;
    curZ = center.z;
  }

  // Final approach segment from last free cell center to the destination anchor
  if (Math.hypot(destAnchor.x - curX, destAnchor.z - curZ) > 0.25) {
    appendSafeTransition(
      waypoints,
      curX,
      curZ,
      destAnchor.x,
      destAnchor.z,
      allowedDoorstepCubeId,
      allowedFieldCubeId
    );
  }

  return {
    reachable: true,
    waypoints,
    cellPath,
  };
}
