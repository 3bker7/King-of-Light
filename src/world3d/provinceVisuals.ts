import { GRID_SIZE, THEMES } from '../game/constants';
import {
  isSeaCube,
  KING_PALACE_COLOR,
  PALACE_PROVINCE_NAME,
} from '../game/provinces';
import { findPalaceCube } from '../game/production';
import type { Cube, Province, SlotIndex } from '../game/types';
import { type AnchorPoint } from './anchors';
import {
  buildStreetGrid,
  computeStreetPath,
  type GridCoord,
  isCellBlockedForTransit,
} from './streetPathing';
import { cellToWorldCenter } from './worldMath';

export interface ProvinceCenterFlagSpec {
  provinceId: string;
  centerCubeId: number;
  row: number;
  col: number;
  color: string;
  isPalace: boolean;
}

export interface HouseBannerSpec {
  cubeId: number;
  slot: SlotIndex;
  row: number;
  col: number;
  color: string;
  provinceId: string;
}

export interface ProvinceDressingPlan {
  /** Maps every dressed king-owned land cubeId -> province hex color. Neutral & bank cubes are absent. */
  cubePennantColors: Map<number, string>;
  centerFlags: ProvinceCenterFlagSpec[];
  houseBanners: HouseBannerSpec[];
}

export interface ProvinceRoadSpec {
  provinceId: string;
  centerCubeId: number;
  color: string;
  cellPath: GridCoord[];
  waypoints: AnchorPoint[];
  reachable: boolean;
}

/**
 * Element 2.1: Pure, deterministic visual dressing plan derived directly from (cubes, provinces).
 * Never stores its own province assignment map; always mirrors provinces 1:1.
 * - Every king-owned land cube gets its assigned province color (palace province always KING_PALACE_COLOR).
 * - Unowned ('neutral') and bank ('bank') cubes are never dressed.
 * - Every province center gets a tall flagpole; every king-owned house slot gets a matching cloth banner.
 */
export function computeProvinceDressingPlan(
  cubes: Cube[],
  provinces: Province[]
): ProvinceDressingPlan {
  const cubeById = new Map<number, Cube>();
  for (let i = 0; i < cubes.length; i++) {
    cubeById.set(cubes[i].id, cubes[i]);
  }

  const cubePennantColors = new Map<number, string>();
  const centerFlags: ProvinceCenterFlagSpec[] = [];
  const houseBanners: HouseBannerSpec[] = [];

  for (let i = 0; i < provinces.length; i++) {
    const prov = provinces[i];
    const isPalace = prov.nameAr === PALACE_PROVINCE_NAME;
    const color = isPalace ? KING_PALACE_COLOR : prov.color;

    const centerCube = cubeById.get(prov.centerCubeId);
    if (centerCube && centerCube.owner === 'player' && !isSeaCube(centerCube)) {
      centerFlags.push({
        provinceId: prov.id,
        centerCubeId: centerCube.id,
        row: centerCube.row,
        col: centerCube.col,
        color,
        isPalace,
      });
    }

    for (let k = 0; k < prov.cubeIds.length; k++) {
      const cube = cubeById.get(prov.cubeIds[k]);
      if (!cube || cube.owner !== 'player' || isSeaCube(cube)) continue;

      cubePennantColors.set(cube.id, color);

      if (cube.themeId === 'house') {
        houseBanners.push({
          cubeId: cube.id,
          slot: 0,
          row: cube.row,
          col: cube.col,
          color,
          provinceId: prov.id,
        });
      }
      if (cube.secondThemeId === 'house') {
        houseBanners.push({
          cubeId: cube.id,
          slot: 1,
          row: cube.row,
          col: cube.col,
          color,
          provinceId: prov.id,
        });
      }
    }
  }

  return { cubePennantColors, centerFlags, houseBanners };
}

/**
 * Shared read-only helper for H2 & rendering: returns the province pennant color for a cube,
 * or null if neutral, bank-owned, or sea.
 */
export function getCubePennantColor(
  plan: ProvinceDressingPlan,
  cubeId: number
): string | null {
  return plan.cubePennantColors.get(cubeId) ?? null;
}

/**
 * Element 2.1: Compute walkable dirt road ribbons from the King's Palace to each non-palace
 * province center using Prompt 1's 4-connected street A* (`buildStreetGrid` + `computeStreetPath`).
 * Roads strictly traverse walkable player-owned cells: never sea, never neutral/bank, never blocked full buildings.
 */
export function computeProvinceRoads(
  cubes: Cube[],
  provinces: Province[],
  seaCoords?: AnchorPoint[]
): ProvinceRoadSpec[] {
  const palace = findPalaceCube(cubes);
  if (!palace || palace.owner !== 'player') return [];

  const resolvedSeaCoords: AnchorPoint[] =
    seaCoords ??
    cubes
      .filter((c) => c.owner === 'player' && isSeaCube(c))
      .map((c) => cellToWorldCenter(c.row, c.col));

  const grid = buildStreetGrid(cubes, resolvedSeaCoords);
  const palacePos = cellToWorldCenter(palace.row, palace.col);
  const cubeById = new Map<number, Cube>();
  for (let i = 0; i < cubes.length; i++) {
    cubeById.set(cubes[i].id, cubes[i]);
  }

  const roads: ProvinceRoadSpec[] = [];

  for (let i = 0; i < provinces.length; i++) {
    const prov = provinces[i];
    if (prov.nameAr === PALACE_PROVINCE_NAME || prov.centerCubeId === palace.id) {
      continue;
    }
    const centerCube = cubeById.get(prov.centerCubeId);
    if (!centerCube || centerCube.owner !== 'player' || isSeaCube(centerCube)) {
      continue;
    }

    const centerPos = cellToWorldCenter(centerCube.row, centerCube.col);
    const path = computeStreetPath(grid, palacePos.x, palacePos.z, centerPos, {
      destCubeId: centerCube.id,
      destThemeId: centerCube.themeId,
    });

    if (!path.reachable || path.cellPath.length < 2) {
      continue;
    }

    // Strict H2 guarantee: every cell along the road is walkable (owned, non-sea, non-blocked full building)
    const safeCells: GridCoord[] = [];
    let valid = true;
    for (let k = 0; k < path.cellPath.length; k++) {
      const cell = path.cellPath[k];
      if (
        cell.row < 0 ||
        cell.row >= GRID_SIZE ||
        cell.col < 0 ||
        cell.col >= GRID_SIZE
      ) {
        valid = false;
        break;
      }
      const c = cubes[cell.row * GRID_SIZE + cell.col];
      if (isCellBlockedForTransit(c)) {
        valid = false;
        break;
      }
      safeCells.push(cell);
    }

    if (!valid || safeCells.length < 2) continue;

    // Build cell-center waypoints strictly from verified walkable cells (no diagonal cutting through buildings)
    const waypoints: AnchorPoint[] = safeCells.map((cell) =>
      cellToWorldCenter(cell.row, cell.col)
    );

    roads.push({
      provinceId: prov.id,
      centerCubeId: prov.centerCubeId,
      color: prov.color,
      cellPath: safeCells,
      waypoints,
      reachable: true,
    });
  }

  return roads;
}

/**
 * Helper to determine safe side offset for a center flagpole so it doesn't collide with full buildings.
 */
export function getCenterFlagWorldOffset(cube: Cube): { dx: number; dz: number } {
  if (!cube.themeId) {
    return { dx: 0, dz: 0 };
  }
  const def = THEMES[cube.themeId];
  if (cube.themeId === 'palace') {
    return { dx: -3.2, dz: 3.1 };
  }
  if (def.footprint === 'full') {
    return { dx: -3.6, dz: 3.6 };
  }
  return { dx: 0, dz: 0 };
}
