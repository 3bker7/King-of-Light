import { GRID_SIZE } from './constants';
import { computeStaffing, findPalaceCube, makeSlotKey } from './production';
import type {
  Citizen,
  Cube,
  GameState,
  Province,
  ProvinceEvent,
  ProvinceEventKind,
} from './types';

// Element 1.1: Frozen province constants & tables
export const PROVINCE_MIN_LAND_CUBES = 10;
export const PROVINCE_MIN_CHEBYSHEV_DIST = 4;
export const MAX_PROVINCES = 6; // palace + 5
export const MAX_PROVINCE_EVENTS = 20;

export const PALACE_PROVINCE_NAME = 'ولاية القصر';

export const PROVINCE_NAME_TABLE: readonly string[] = [
  'النخيل',
  'الزيتون',
  'القمح',
  'الواحة',
  'المرجان',
];

// Fixed table of 6 province colors: deep teal (fixed for palace), ochre, olive, sand-rose, slate blue, terracotta
export const PROVINCE_COLORS: readonly string[] = [
  '#14524A', // deep teal — King's Palace color (fixed, never changes)
  '#C9962E', // ochre
  '#6B7D3B', // olive
  '#C27C72', // sand-rose
  '#4A6B8A', // slate blue
  '#B85D3B', // terracotta
];

export const KING_PALACE_COLOR = PROVINCE_COLORS[0];

const CARDINAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export interface ComputeProvincesInput {
  cubes: Cube[];
  citizens: Citizen[];
  population: number;
}

export function isSeaCube(cube: Cube): boolean {
  return cube.themeId === 'sea' || cube.secondThemeId === 'sea';
}

export function chebyshevDistance(
  a: Pick<Cube, 'row' | 'col'>,
  b: Pick<Cube, 'row' | 'col'>
): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

export function formatProvinceTitle(nameAr: string): string {
  return nameAr.startsWith('ولاية ') ? nameAr : `ولاية ${nameAr}`;
}

function findFourConnectedComponents(landCubes: Cube[]): Cube[][] {
  if (landCubes.length === 0) return [];
  const byCoord = new Map<number, Cube>();
  for (let i = 0; i < landCubes.length; i++) {
    const c = landCubes[i];
    byCoord.set(c.row * GRID_SIZE + c.col, c);
  }

  const visited = new Set<number>();
  const components: Cube[][] = [];
  const sorted = [...landCubes].sort((a, b) => a.id - b.id);

  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    const startKey = start.row * GRID_SIZE + start.col;
    if (visited.has(startKey)) continue;

    const comp: Cube[] = [];
    const queue: Cube[] = [start];
    visited.add(startKey);
    let head = 0;

    while (head < queue.length) {
      const cur = queue[head++];
      comp.push(cur);
      for (let d = 0; d < CARDINAL_DIRS.length; d++) {
        const nr = cur.row + CARDINAL_DIRS[d][0];
        const nc = cur.col + CARDINAL_DIRS[d][1];
        if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;
        const nKey = nr * GRID_SIZE + nc;
        if (visited.has(nKey)) continue;
        const neighbor = byCoord.get(nKey);
        if (!neighbor) continue;
        visited.add(nKey);
        queue.push(neighbor);
      }
    }

    components.push(comp);
  }

  return components;
}

function pickCentroidLandCube(region: Cube[], existingCenters?: Cube[]): Cube {
  let sumRow = 0;
  let sumCol = 0;
  for (let i = 0; i < region.length; i++) {
    sumRow += region[i].row;
    sumCol += region[i].col;
  }
  const avgRow = sumRow / region.length;
  const avgCol = sumCol / region.length;

  // Prefer a joined village cube inside the region (at Chebyshev dist >= 4 from existing centers) if present
  const villageCandidates = region.filter(
    (c) =>
      c.villageName !== null &&
      (!existingCenters ||
        minChebyshevToCenters(c, existingCenters) >= PROVINCE_MIN_CHEBYSHEV_DIST)
  );
  const pool = villageCandidates.length > 0 ? villageCandidates : region;

  let best = pool[0];
  let bestDistSq = Infinity;
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i];
    const dr = c.row - avgRow;
    const dc = c.col - avgCol;
    const distSq = dr * dr + dc * dc;
    if (
      distSq < bestDistSq - 1e-9 ||
      (Math.abs(distSq - bestDistSq) <= 1e-9 && c.id < best.id)
    ) {
      bestDistSq = distSq;
      best = c;
    }
  }
  return best;
}

function minChebyshevToCenters(cube: Cube, centers: Cube[]): number {
  let best = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const d = chebyshevDistance(cube, centers[i]);
    if (d < best) best = d;
  }
  return best;
}

function assignCubesToCenters(
  ownedCubes: Cube[],
  centers: Cube[]
): Map<number, Cube[]> {
  const buckets = new Map<number, Cube[]>();
  for (let i = 0; i < centers.length; i++) {
    buckets.set(centers[i].id, []);
  }

  for (let i = 0; i < ownedCubes.length; i++) {
    const cube = ownedCubes[i];
    let nearest = centers[0];
    let bestDist = chebyshevDistance(cube, nearest);
    for (let j = 1; j < centers.length; j++) {
      const cand = centers[j];
      const d = chebyshevDistance(cube, cand);
      if (d < bestDist || (d === bestDist && cand.id < nearest.id)) {
        bestDist = d;
        nearest = cand;
      }
    }
    buckets.get(nearest.id)!.push(cube);
  }

  return buckets;
}

/**
 * Element 1.1 & 1.2: Pure, deterministic province derivation from king-owned cubes,
 * palace cube, citizen registry, and staffing. Never mutates inputs; zero randomness; zero Date.now().
 * Total function over all king-owned ('player') cubes — bank and neutral cubes are excluded.
 */
export function computeProvinces(
  state: Pick<GameState, 'cubes' | 'citizens' | 'population'>
): Province[] {
  const ownedCubes: Cube[] = [];
  const ownedLandCubes: Cube[] = [];

  for (let i = 0; i < state.cubes.length; i++) {
    const c = state.cubes[i];
    if (c.owner !== 'player') continue;
    ownedCubes.push(c);
    if (!isSeaCube(c)) {
      ownedLandCubes.push(c);
    }
  }

  if (ownedCubes.length === 0) return [];

  // Center 0: palace cube (fallback: lowest-id owned land cube, or lowest-id owned cube)
  const palace = findPalaceCube(state.cubes);
  let palaceCenter: Cube | null =
    palace && palace.owner === 'player' ? palace : null;
  if (!palaceCenter) {
    const pool = ownedLandCubes.length > 0 ? ownedLandCubes : ownedCubes;
    palaceCenter = [...pool].sort((a, b) => a.id - b.id)[0] ?? null;
  }
  if (!palaceCenter) return [];

  const centers: Cube[] = [palaceCenter];
  const fullLandComponents = findFourConnectedComponents(ownedLandCubes);

  // Iteratively seed additional centers up to MAX_PROVINCES (palace + 5)
  while (centers.length < MAX_PROVINCES) {
    const centerIds = new Set(centers.map((c) => c.id));
    const candidates: Array<{ region: Cube[]; centroid: Cube }> = [];

    for (let ci = 0; ci < fullLandComponents.length; ci++) {
      const comp = fullLandComponents[ci];
      const containsExistingCenter = comp.some((c) => centerIds.has(c.id));

      if (!containsExistingCenter) {
        if (comp.length < PROVINCE_MIN_LAND_CUBES) continue;
        let farthest = 0;
        for (let k = 0; k < comp.length; k++) {
          const d = minChebyshevToCenters(comp[k], centers);
          if (d > farthest) farthest = d;
        }
        if (farthest >= PROVINCE_MIN_CHEBYSHEV_DIST) {
          const centroid = pickCentroidLandCube(comp, centers);
          if (!centerIds.has(centroid.id)) {
            candidates.push({ region: comp, centroid });
          }
        }
      } else {
        // Connected mainland expansion: 4-connected sub-regions of land cubes at Chebyshev distance >= 4 from all centers
        const farLand = comp.filter(
          (c) => minChebyshevToCenters(c, centers) >= PROVINCE_MIN_CHEBYSHEV_DIST
        );
        if (farLand.length < PROVINCE_MIN_LAND_CUBES) continue;
        const subRegions = findFourConnectedComponents(farLand);
        for (let si = 0; si < subRegions.length; si++) {
          const sub = subRegions[si];
          if (sub.length < PROVINCE_MIN_LAND_CUBES) continue;
          const centroid = pickCentroidLandCube(sub, centers);
          if (!centerIds.has(centroid.id)) {
            candidates.push({ region: sub, centroid });
          }
        }
      }
    }

    if (candidates.length === 0) break;

    // Largest region by land-cube count first; ties -> lowest centroid cube id
    candidates.sort((a, b) => {
      if (b.region.length !== a.region.length) {
        return b.region.length - a.region.length;
      }
      return a.centroid.id - b.centroid.id;
    });

    centers.push(candidates[0].centroid);
  }

  // Assign every owned cube (land + sea) and dissolve any non-palace province with < 10 land cubes
  let survivingCenters = [...centers];
  let buckets = assignCubesToCenters(ownedCubes, survivingCenters);

  while (survivingCenters.length > 1) {
    let dropIndex = -1;
    let dropLandCount = Infinity;
    for (let i = 1; i < survivingCenters.length; i++) {
      const ctr = survivingCenters[i];
      const assigned = buckets.get(ctr.id) ?? [];
      let landCount = 0;
      for (let k = 0; k < assigned.length; k++) {
        if (!isSeaCube(assigned[k])) landCount += 1;
      }
      if (landCount < PROVINCE_MIN_LAND_CUBES) {
        if (
          landCount < dropLandCount ||
          (landCount === dropLandCount &&
            dropIndex !== -1 &&
            ctr.id > survivingCenters[dropIndex].id)
        ) {
          dropLandCount = landCount;
          dropIndex = i;
        }
      }
    }
    if (dropIndex === -1) break;
    survivingCenters.splice(dropIndex, 1);
    buckets = assignCubesToCenters(ownedCubes, survivingCenters);
  }

  // Sort non-palace centers ascending by cube id for deterministic naming & color assignment
  const palaceId = survivingCenters[0].id;
  const nonPalaceCenters = survivingCenters
    .slice(1)
    .sort((a, b) => a.id - b.id);
  const orderedCenters = [survivingCenters[0], ...nonPalaceCenters];

  // Shared staffing computation (Prompt 2 computeStaffing)
  const staffing = computeStaffing(
    state.cubes,
    state.population,
    state.citizens
  );

  // Map homeCubeId -> citizen count in a single O(citizens) pass
  const popByCube = new Map<number, number>();
  for (let i = 0; i < state.citizens.length; i++) {
    const homeId = state.citizens[i].homeCubeId;
    if (homeId !== null) {
      popByCube.set(homeId, (popByCube.get(homeId) ?? 0) + 1);
    }
  }

  const usedNames = new Set<string>();
  const provinces: Province[] = [];

  for (let i = 0; i < orderedCenters.length; i++) {
    const ctr = orderedCenters[i];
    const isPalaceProv = ctr.id === palaceId;
    const assigned = [...(buckets.get(ctr.id) ?? [])].sort((a, b) => a.id - b.id);

    const cubeIds: number[] = [];
    const landCubeIds: number[] = [];
    const seaCubeIds: number[] = [];
    let houseCount = 0;
    let population = 0;
    let staffedWorkplaces = 0;
    let privatePlots = 0;

    for (let k = 0; k < assigned.length; k++) {
      const cube = assigned[k];
      cubeIds.push(cube.id);
      if (isSeaCube(cube)) {
        seaCubeIds.push(cube.id);
      } else {
        landCubeIds.push(cube.id);
      }
      if (cube.themeId === 'house') houseCount += 1;
      if (cube.secondThemeId === 'house') houseCount += 1;
      population += popByCube.get(cube.id) ?? 0;

      if (
        cube.themeId &&
        staffing.staffedSlots.has(makeSlotKey(cube.id, 0))
      ) {
        staffedWorkplaces += 1;
      }
      if (
        cube.secondThemeId &&
        staffing.staffedSlots.has(makeSlotKey(cube.id, 1))
      ) {
        staffedWorkplaces += 1;
      }
      if (typeof cube.privateOwnerId === 'number') {
        privatePlots += 1;
      }
    }

    let nameAr: string;
    let color: string;
    if (isPalaceProv) {
      nameAr = PALACE_PROVINCE_NAME;
      color = PROVINCE_COLORS[0];
    } else {
      const idx = i - 1;
      const baseName = PROVINCE_NAME_TABLE[idx % PROVINCE_NAME_TABLE.length];
      nameAr = usedNames.has(baseName) ? `${baseName} الثانية` : baseName;
      color = PROVINCE_COLORS[1 + (idx % (PROVINCE_COLORS.length - 1))];
    }
    usedNames.add(nameAr);

    provinces.push({
      id: `prov-${ctr.id}`,
      centerCubeId: ctr.id,
      nameAr,
      cubeIds,
      landCubeIds,
      seaCubeIds,
      houseCount,
      population,
      staffedWorkplaces,
      privatePlots,
      color,
    });
  }

  return provinces;
}

/**
 * Shared read-only helper: look up which province owns a given cube id (from recomputed provinces).
 */
export function findProvinceForCube(
  provinces: Province[],
  cubeId: number
): Province | null {
  for (let i = 0; i < provinces.length; i++) {
    if (provinces[i].cubeIds.includes(cubeId)) {
      return provinces[i];
    }
  }
  return null;
}

/**
 * Shared read-only selector for Element 4.1: housed share (population with a real house / population).
 */
export function getProvinceHousedShare(
  province: Province,
  cubes: Cube[],
  citizens: Citizen[]
): { housed: number; total: number; ratio: number } {
  const cubeSet = new Set(province.cubeIds);
  let total = 0;
  let housed = 0;
  for (let i = 0; i < citizens.length; i++) {
    const c = citizens[i];
    if (c.homeCubeId === null || !cubeSet.has(c.homeCubeId)) continue;
    total += 1;
    const cube = cubes[c.homeCubeId];
    if (
      cube &&
      cube.owner === 'player' &&
      (cube.themeId === 'house' || cube.secondThemeId === 'house')
    ) {
      housed += 1;
    }
  }
  return {
    housed,
    total,
    ratio: total > 0 ? housed / total : 0,
  };
}

/**
 * Element 5.1 & H5: Idempotent event recording keyed by (kind, month, centerCubeId).
 * Caps at MAX_PROVINCE_EVENTS (20), dropping oldest first.
 */
export function makeProvinceEventId(
  kind: ProvinceEventKind,
  month: number,
  centerCubeId: number
): string {
  return `${kind}-${Math.max(0, Math.trunc(month))}-${centerCubeId}`;
}

export function createProvinceEvent(
  kind: ProvinceEventKind,
  month: number,
  centerCubeId: number,
  labelAr: string
): ProvinceEvent {
  const safeMonth = Math.max(0, Math.trunc(month));
  return {
    id: makeProvinceEventId(kind, safeMonth, centerCubeId),
    month: safeMonth,
    kind,
    centerCubeId,
    labelAr,
  };
}

export function recordProvinceEvents(
  existing: ProvinceEvent[],
  additions: ProvinceEvent[]
): { events: ProvinceEvent[]; added: ProvinceEvent[] } {
  if (additions.length === 0) {
    return { events: existing, added: [] };
  }
  const seen = new Set(existing.map((e) => e.id));
  const next = [...existing];
  const added: ProvinceEvent[] = [];

  for (let i = 0; i < additions.length; i++) {
    const ev = additions[i];
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    next.push(ev);
    added.push(ev);
  }

  if (added.length === 0) {
    return { events: existing, added: [] };
  }

  const trimmed =
    next.length > MAX_PROVINCE_EVENTS
      ? next.slice(next.length - MAX_PROVINCE_EVENTS)
      : next;

  return { events: trimmed, added };
}

/**
 * Element 5.1: Compare previous in-memory province list against newly recomputed list
 * to emit province_formed and province_dissolved events deterministically.
 */
export function diffProvincesForEvents(
  prevProvinces: Province[],
  nextProvinces: Province[],
  month: number
): ProvinceEvent[] {
  const events: ProvinceEvent[] = [];
  const prevNonPalace = prevProvinces.filter(
    (p) => p.nameAr !== PALACE_PROVINCE_NAME
  );
  const nextNonPalace = nextProvinces.filter(
    (p) => p.nameAr !== PALACE_PROVINCE_NAME
  );

  const matchedPrev = new Set<string>();
  const matchedNext = new Set<string>();

  // 1. Exact id match
  const nextById = new Map<string, Province>();
  for (const p of nextNonPalace) nextById.set(p.id, p);
  for (const p of prevNonPalace) {
    if (nextById.has(p.id)) {
      matchedPrev.add(p.id);
      matchedNext.add(p.id);
    }
  }

  // 2. Overlap match for remaining non-palace provinces (prevents spurious dissolve+form when centroid shifts by 1 cell on growth)
  const unmatchedPrev = prevNonPalace.filter((p) => !matchedPrev.has(p.id));
  const unmatchedNext = nextNonPalace.filter((p) => !matchedNext.has(p.id));
  if (unmatchedPrev.length > 0 && unmatchedNext.length > 0) {
    const pairs: Array<{ prevId: string; nextId: string; overlapRatio: number }> = [];
    for (const prev of unmatchedPrev) {
      const prevSet = new Set(prev.cubeIds);
      for (const next of unmatchedNext) {
        let overlap = 0;
        for (let i = 0; i < next.cubeIds.length; i++) {
          if (prevSet.has(next.cubeIds[i])) overlap += 1;
        }
        const denom = Math.max(1, Math.min(prev.cubeIds.length, next.cubeIds.length));
        const ratio = overlap / denom;
        if (ratio >= 0.5) {
          pairs.push({ prevId: prev.id, nextId: next.id, overlapRatio: ratio });
        }
      }
    }
    pairs.sort((a, b) => b.overlapRatio - a.overlapRatio);
    for (const pair of pairs) {
      if (matchedPrev.has(pair.prevId) || matchedNext.has(pair.nextId)) continue;
      matchedPrev.add(pair.prevId);
      matchedNext.add(pair.nextId);
    }
  }

  // Formed provinces
  for (const p of nextNonPalace) {
    if (!matchedNext.has(p.id)) {
      events.push(
        createProvinceEvent(
          'province_formed',
          month,
          p.centerCubeId,
          `تشكلت ولاية جديدة: ${formatProvinceTitle(p.nameAr)}`
        )
      );
    }
  }

  // Dissolved provinces
  for (const p of prevNonPalace) {
    if (!matchedPrev.has(p.id)) {
      events.push(
        createProvinceEvent(
          'province_dissolved',
          month,
          p.centerCubeId,
          `انحلّت ${formatProvinceTitle(p.nameAr)} وعادت أراضيها للولايات المجاورة`
        )
      );
    }
  }

  return events;
}

const VALID_PROVINCE_EVENT_KINDS: ReadonlySet<ProvinceEventKind> = new Set([
  'village_joined',
  'village_defected',
  'province_formed',
  'province_dissolved',
  'camp_full',
]);

export function sanitizeProvinceEventsOnHydrate(
  raw: ProvinceEvent[] | undefined,
  totalCubes: number
): ProvinceEvent[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const clean: ProvinceEvent[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ev = raw[i];
    if (!ev || typeof ev !== 'object') continue;
    if (!VALID_PROVINCE_EVENT_KINDS.has(ev.kind)) continue;
    const month =
      typeof ev.month === 'number' && Number.isFinite(ev.month)
        ? Math.max(0, Math.trunc(ev.month))
        : 0;
    const centerCubeId =
      typeof ev.centerCubeId === 'number' &&
      Number.isInteger(ev.centerCubeId) &&
      ev.centerCubeId >= 0 &&
      ev.centerCubeId < totalCubes
        ? ev.centerCubeId
        : -1;
    if (centerCubeId < 0) continue;
    const labelAr =
      typeof ev.labelAr === 'string' && ev.labelAr.length > 0
        ? ev.labelAr
        : ev.kind;
    const id =
      typeof ev.id === 'string' && ev.id.length > 0
        ? ev.id
        : makeProvinceEventId(ev.kind, month, centerCubeId);
    if (seen.has(id)) continue;
    seen.add(id);
    clean.push({
      id,
      month,
      kind: ev.kind,
      centerCubeId,
      labelAr,
    });
  }
  return clean.length > MAX_PROVINCE_EVENTS
    ? clean.slice(clean.length - MAX_PROVINCE_EVENTS)
    : clean;
}
