import { GRID_SIZE, THEMES } from './constants';
import { getHousingQueue } from './housingOffice';
import { findPalaceCube } from './production';
import { isSeaCube } from './provinces';
import type { ArrivalCamp, Citizen, Cube, SlotIndex } from './types';
import { type AnchorPoint, getBuildingAnchors } from '../world3d/anchors';
import {
  buildStreetGrid,
  computeStreetPath,
  type StreetPathResult,
} from '../world3d/streetPathing';
import { cellToWorldCenter } from '../world3d/worldMath';

export const CAMP_CAPACITY = 6;
export const CAMP_CITIZEN_CARD_TEXT_AR = 'في مخيم الوصول ينتظر سكناً';

export function borderDistance(cube: Pick<Cube, 'row' | 'col'>): number {
  return Math.min(
    cube.row,
    cube.col,
    GRID_SIZE - 1 - cube.row,
    GRID_SIZE - 1 - cube.col
  );
}

/**
 * Element 3.1 & H3: A valid Arrival Camp cube is a free, unbuilt, king-owned LAND cube
 * (not sea, not palace, not rocky, not private, not mortgaged collateral).
 */
export function isValidCampCube(
  cube: Cube | undefined,
  palaceCubeId: number | null
): boolean {
  if (!cube) return false;
  if (cube.owner !== 'player') return false;
  if (isSeaCube(cube)) return false;
  if (cube.themeId !== null || cube.secondThemeId !== null) return false;
  if (cube.privateOwnerId != null) return false;
  if (cube.collateralLoanId != null) return false;
  if (cube.isRocky) return false;
  if (palaceCubeId !== null && cube.id === palaceCubeId) return false;
  return true;
}

/**
 * Element 3.1: Pick the camp cube — free, unbuilt, king-owned land cube closest to the map border
 * (ties -> lowest cube id). Keeps currentCampCubeId while valid and residents exist;
 * frees automatically when camp empties or if cube is built on / sold / lost.
 * Returns null if no free land cube exists.
 */
export function pickCampCubeId(
  cubes: Cube[],
  currentCampCubeId: number | null,
  hasResidents: boolean
): number | null {
  if (!hasResidents) return null;

  const palace = findPalaceCube(cubes);
  const palaceCubeId = palace ? palace.id : null;

  if (
    currentCampCubeId !== null &&
    isValidCampCube(cubes[currentCampCubeId], palaceCubeId)
  ) {
    return currentCampCubeId;
  }

  let best: Cube | null = null;
  let bestBorder = Infinity;

  for (let i = 0; i < cubes.length; i++) {
    const c = cubes[i];
    if (!isValidCampCube(c, palaceCubeId)) continue;
    const bd = borderDistance(c);
    if (bd < bestBorder || (bd === bestBorder && (!best || c.id < best.id))) {
      bestBorder = bd;
      best = c;
    }
  }

  return best ? best.id : null;
}

/**
 * Element 3.1 & H3: Returns the ordered list of unhoused citizen applicant IDs directly from
 * Prompt 3's frozen housing queue (`getHousingQueue`), never modifying queue priority.
 */
export function getUnhousedQueueApplicantIds(
  citizens: Citizen[],
  totalMonths: number
): number[] {
  const byId = new Map<number, Citizen>();
  for (let i = 0; i < citizens.length; i++) {
    byId.set(citizens[i].id, citizens[i]);
  }
  const queue = getHousingQueue(citizens, totalMonths);
  const unhousedIds: number[] = [];
  for (let i = 0; i < queue.length; i++) {
    const applicant = byId.get(queue[i].applicantId);
    if (applicant && applicant.homeCubeId === null) {
      unhousedIds.push(applicant.id);
    }
  }
  return unhousedIds;
}

export interface SyncArrivalCampResult {
  camp: ArrivalCamp;
  pendingArrivals: number;
  citizens: Citizen[];
}

/**
 * Element 3.1, 3.3 & H3:
 * Synchronizes ArrivalCamp and citizen.inCamp strictly from the live Prompt 3 housing queue.
 * - Hard-caps residentIds at CAMP_CAPACITY (6).
 * - If no free land cube exists (cubeId === null), residentIds is [] and all unhoused applicants
 *   wait in pendingArrivals.
 * - Never changes homeCubeId or queue priority; only updates the permitted `inCamp` marker.
 */
export function syncArrivalCamp(
  citizens: Citizen[],
  cubes: Cube[],
  totalMonths: number,
  currentCampCubeId: number | null
): SyncArrivalCampResult {
  const unhousedIds = getUnhousedQueueApplicantIds(citizens, totalMonths);
  const hasUnhoused = unhousedIds.length > 0;
  const cubeId = pickCampCubeId(cubes, currentCampCubeId, hasUnhoused);

  const residentIds =
    cubeId !== null ? unhousedIds.slice(0, CAMP_CAPACITY) : [];
  const pendingArrivals = Math.max(0, unhousedIds.length - residentIds.length);
  const residentSet = new Set<number>(residentIds);

  let changed = false;
  for (let i = 0; i < citizens.length; i++) {
    const shouldBeInCamp = residentSet.has(citizens[i].id);
    if (Boolean(citizens[i].inCamp) !== shouldBeInCamp) {
      changed = true;
      break;
    }
  }

  const nextCitizens = changed
    ? citizens.map((c) => {
        const shouldBeInCamp = residentSet.has(c.id);
        if (Boolean(c.inCamp) === shouldBeInCamp) return c;
        return { ...c, inCamp: shouldBeInCamp };
      })
    : citizens;

  return {
    camp: { cubeId, residentIds },
    pendingArrivals,
    citizens: nextCitizens,
  };
}

/**
 * H3: On load/hydrate, ignore any tampered residentIds > 6 or invalid cubeId and recompute
 * strictly from live housing queue & live cubes.
 */
export function sanitizeArrivalCampOnHydrate(
  citizens: Citizen[],
  cubes: Cube[],
  totalMonths: number,
  rawCamp: ArrivalCamp | undefined
): SyncArrivalCampResult {
  const candidateCubeId =
    rawCamp &&
    typeof rawCamp.cubeId === 'number' &&
    Number.isInteger(rawCamp.cubeId) &&
    rawCamp.cubeId >= 0 &&
    rawCamp.cubeId < cubes.length
      ? rawCamp.cubeId
      : null;

  return syncArrivalCamp(citizens, cubes, totalMonths, candidateCubeId);
}

/**
 * Element 3.2 & 7.2f: Pure street A* walk from the arrival camp cube to a granted house's doorstep.
 * Uses Prompt 1's `buildStreetGrid` + `computeStreetPath` + `getBuildingAnchors` so the walk
 * never enters water or blocked full buildings.
 */
export function computeCampToHouseWalk(
  cubes: Cube[],
  seaCoords: AnchorPoint[],
  campCubeId: number,
  houseCubeId: number
): StreetPathResult {
  const campCube = cubes[campCubeId];
  const houseCube = cubes[houseCubeId];
  if (!campCube || !houseCube) {
    return { reachable: false, waypoints: [], cellPath: [] };
  }

  const slot: SlotIndex =
    houseCube.themeId === 'house'
      ? 0
      : houseCube.secondThemeId === 'house'
        ? 1
        : 0;
  const themeId =
    slot === 0
      ? houseCube.themeId ?? 'house'
      : houseCube.secondThemeId ?? 'house';

  const campCenter = cellToWorldCenter(campCube.row, campCube.col);
  const houseCellPos = cellToWorldCenter(houseCube.row, houseCube.col);
  const footprint = THEMES[themeId].footprint;
  const anchors = getBuildingAnchors(themeId, footprint, slot, houseCellPos, {
    cubes,
    seaCoords,
    row: houseCube.row,
    col: houseCube.col,
  });
  const grid = buildStreetGrid(cubes, seaCoords);

  return computeStreetPath(grid, campCenter.x, campCenter.z, anchors.doorstep, {
    destCubeId: houseCube.id,
    destThemeId: themeId,
    destApproachOffset: anchors.approachOffset,
  });
}
