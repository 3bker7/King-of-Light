import {
  CUBE_DISTANCE_PRICE_STEP,
  CUBE_PRICE_ROUND_STEP,
  CUBE_PURCHASE_BASE_COST,
  GRAND_MARKET_AURA_RANGE,
  GRAND_MARKET_SHOP_BONUS,
  GRID_SIZE,
  SEA_ADJACENCY_BONUS_MAX,
  SEA_ADJACENCY_BONUS_STEP,
  SHOP_FOOD_PRIORITY,
  STARTING_PALACE_COL,
  STARTING_PALACE_ROW,
  THEMES,
  WAREHOUSE_AURA_RANGE,
  WAREHOUSE_GOLD_BONUS,
  WORKER_PRIORITY_ORDER,
} from './constants';
import { getTotalFood } from './people';
import type {
  Citizen,
  Cube,
  ShortageReason,
  SlotIndex,
  StaffingStatus,
  ThemeId,
  TradedResourceKey,
  Warehouse,
} from './types';

export function makeSlotKey(cubeId: number, slot: SlotIndex): string {
  return `${cubeId}:${slot}`;
}

export function getOrthogonalNeighbors(
  cubes: Cube[],
  row: number,
  col: number
): Cube[] {
  const result: Cube[] = [];
  const deltas = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (const [dr, dc] of deltas) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
      const neighbor = cubes[nr * GRID_SIZE + nc];
      if (neighbor) result.push(neighbor);
    }
  }

  return result;
}

export function isAdjacentToOwned(cubes: Cube[], cube: Cube): boolean {
  return getOrthogonalNeighbors(cubes, cube.row, cube.col).some(
    (neighbor) => neighbor.owner === 'player'
  );
}

// Neutral cells orthogonally adjacent to owned land (independent villages join free by loyalty, not bought)
export function isPurchasableNeutralCube(cubes: Cube[], cube: Cube): boolean {
  if (cube.owner !== 'player' && !cube.isVillage) {
    return isAdjacentToOwned(cubes, cube);
  }
  return false;
}

export function findPalaceCube(cubes: Cube[]): Cube | null {
  const palace = cubes.find((c) => c.owner === 'player' && c.themeId === 'palace');
  if (palace) return palace;
  return cubes[STARTING_PALACE_ROW * GRID_SIZE + STARTING_PALACE_COL] ?? null;
}

export function getManhattanDistanceToPalace(cubes: Cube[], cube: Cube): number {
  const palace = findPalaceCube(cubes);
  if (!palace) return 1;
  return Math.abs(cube.row - palace.row) + Math.abs(cube.col - palace.col);
}

// WP3 exact distance pricing formula:
// 30 * (1 + 0.15 * manhattanDistance(cell, palaceCell)), rounded to nearest 5.
export function getCubePurchasePrice(cubes: Cube[], cube: Cube): number {
  const dist = getManhattanDistanceToPalace(cubes, cube);
  const raw = CUBE_PURCHASE_BASE_COST * (1 + CUBE_DISTANCE_PRICE_STEP * dist);
  return Math.round(raw / CUBE_PRICE_ROUND_STEP) * CUBE_PRICE_ROUND_STEP;
}

export function countAdjacentSeas(cubes: Cube[], cube: Cube): number {
  return getOrthogonalNeighbors(cubes, cube.row, cube.col).filter(
    (neighbor) => neighbor.owner === 'player' && neighbor.themeId === 'sea'
  ).length;
}

export function getSeaFishOutput(cubes: Cube[], cube: Cube): {
  amount: number;
  bonusPercent: number;
  adjacentSeas: number;
} {
  const adjacentSeas = countAdjacentSeas(cubes, cube);
  const bonusRatio = Math.min(
    SEA_ADJACENCY_BONUS_MAX,
    adjacentSeas * SEA_ADJACENCY_BONUS_STEP
  );
  const baseOutput = THEMES.sea.outputAmount ?? 2;
  return {
    amount: Math.floor(baseOutput * (1 + bonusRatio)),
    bonusPercent: Math.round(bonusRatio * 100),
    adjacentSeas,
  };
}

// Logistics & Grand Market auras for Shops and Restaurants
export function getGoldServiceAuraBonus(
  cubes: Cube[],
  cube: Cube,
  themeId: ThemeId
): number {
  let bonus = 0;
  if (themeId === 'shop' || themeId === 'restaurant') {
    const hasNearbyWarehouse = cubes.some(
      (other) =>
        other.owner === 'player' &&
        other.themeId === 'warehouse_bldg' &&
        Math.max(Math.abs(other.row - cube.row), Math.abs(other.col - cube.col)) <=
          WAREHOUSE_AURA_RANGE
    );
    if (hasNearbyWarehouse) bonus += WAREHOUSE_GOLD_BONUS;
  }

  if (themeId === 'shop') {
    const hasNearbyGrandMarket = cubes.some(
      (other) =>
        other.owner === 'player' &&
        other.themeId === 'grand_market' &&
        Math.max(Math.abs(other.row - cube.row), Math.abs(other.col - cube.col)) <=
          GRAND_MARKET_AURA_RANGE
    );
    if (hasNearbyGrandMarket) bonus += GRAND_MARKET_SHOP_BONUS;
  }

  return bonus;
}

export function checkMaterialCosts(
  warehouse: Warehouse,
  themeId: ThemeId,
  level: 1 | 2 = 2
): { ok: boolean; missing: Array<{ resource: TradedResourceKey; needed: number; have: number }> } {
  if (level < 2) {
    return { ok: true, missing: [] };
  }
  const costs = THEMES[themeId].materialCosts;
  if (!costs) return { ok: true, missing: [] };

  const missing: Array<{ resource: TradedResourceKey; needed: number; have: number }> = [];
  for (const [res, amt] of Object.entries(costs) as Array<[TradedResourceKey, number]>) {
    if (amt <= 0) continue;
    const have = warehouse[res] ?? 0;
    if (have < amt) {
      missing.push({ resource: res, needed: amt, have });
    }
  }
  return { ok: missing.length === 0, missing };
}

export function canPlaceThemeOnCube(
  cube: Cube,
  themeId: ThemeId,
  level: 1 | 2
): { valid: boolean; targetSlot: SlotIndex | null; reason?: 'rocky_required' | 'invalid' } {
  if (cube.owner !== 'player' || cube.privateOwnerId != null) {
    return { valid: false, targetSlot: null, reason: 'invalid' };
  }
  const theme = THEMES[themeId];
  if (theme.unlockLevel > level || themeId === 'palace') {
    return { valid: false, targetSlot: null, reason: 'invalid' };
  }
  if (theme.rockyOnly && !cube.isRocky) {
    return { valid: false, targetSlot: null, reason: 'rocky_required' };
  }

  if (theme.footprint === 'full') {
    if (cube.themeId === null && cube.secondThemeId === null) {
      return { valid: true, targetSlot: 0 };
    }
    return { valid: false, targetSlot: null, reason: 'invalid' };
  }

  // Half-size theme
  if (cube.themeId === null) {
    return { valid: true, targetSlot: 0 };
  }
  if (THEMES[cube.themeId].footprint === 'half' && cube.secondThemeId === null) {
    return { valid: true, targetSlot: 1 };
  }
  return { valid: false, targetSlot: null, reason: 'invalid' };
}

interface WorkerCandidate {
  cubeId: number;
  slot: SlotIndex;
  themeId: ThemeId;
  workersNeeded: number;
  builtAt: number;
  priorityIndex: number;
}

export function computeStaffing(
  cubes: Cube[],
  population: number,
  citizens?: Citizen[]
): StaffingStatus {
  const candidates: WorkerCandidate[] = [];
  const staffedSlots = new Set<string>();
  let totalWorkersNeeded = 0;
  let totalWorkersEmployed = 0;

  // Element 4.4: Pre-count living private workers per cube+owner for O(N) lookup
  const privateWorkersByCube = new Map<string, number>();
  if (citizens && citizens.length > 0) {
    for (const c of citizens) {
      if (c.jobCubeId !== null && typeof c.employerId === 'number') {
        const key = `${c.jobCubeId}:${c.employerId}`;
        privateWorkersByCube.set(key, (privateWorkersByCube.get(key) ?? 0) + 1);
      }
    }
  }

  for (const cube of cubes) {
    if (cube.owner !== 'player') continue;
    const isPrivate = typeof cube.privateOwnerId === 'number';

    const slots: Array<{ slot: SlotIndex; themeId: ThemeId | null; builtAt: number | null }> = [
      { slot: 0, themeId: cube.themeId, builtAt: cube.builtAt },
      { slot: 1, themeId: cube.secondThemeId, builtAt: cube.secondBuiltAt },
    ];

    for (const entry of slots) {
      if (!entry.themeId) continue;
      const def = THEMES[entry.themeId];
      if (def.workers === 0) {
        staffedSlots.add(makeSlotKey(cube.id, entry.slot));
        continue;
      }

      totalWorkersNeeded += def.workers;

      if (isPrivate) {
        // Permitted amendment (Element 4.4): private buildings are staffed ONLY by living ad-filled holders
        const filled =
          privateWorkersByCube.get(`${cube.id}:${cube.privateOwnerId}`) ?? 0;
        totalWorkersEmployed += Math.min(def.workers, filled);
        if (filled >= def.workers) {
          staffedSlots.add(makeSlotKey(cube.id, entry.slot));
        }
      } else {
        // Frozen crown priority staffing
        const idx = WORKER_PRIORITY_ORDER.indexOf(entry.themeId);
        candidates.push({
          cubeId: cube.id,
          slot: entry.slot,
          themeId: entry.themeId,
          workersNeeded: def.workers,
          builtAt: entry.builtAt ?? 0,
          priorityIndex: idx === -1 ? 999 : idx,
        });
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.priorityIndex !== b.priorityIndex) return a.priorityIndex - b.priorityIndex;
    if (a.builtAt !== b.builtAt) return a.builtAt - b.builtAt;
    if (a.cubeId !== b.cubeId) return a.cubeId - b.cubeId;
    return a.slot - b.slot;
  });

  let remainingWorkers = Math.max(0, population);

  for (const c of candidates) {
    if (remainingWorkers >= c.workersNeeded) {
      remainingWorkers -= c.workersNeeded;
      totalWorkersEmployed += c.workersNeeded;
      staffedSlots.add(makeSlotKey(c.cubeId, c.slot));
    }
  }

  return {
    totalWorkersNeeded,
    totalWorkersEmployed,
    staffedSlots,
  };
}

function getShortageForTheme(themeId: ThemeId): ShortageReason {
  switch (themeId) {
    case 'farm':
    case 'wheat_farm':
    case 'cafe':
      return 'no_water';
    case 'pasture':
      return 'no_crops';
    case 'bakery':
      return 'no_wheat';
    case 'restaurant':
      return 'no_bread_meat';
    case 'workshop':
      return 'no_iron_wood';
    case 'jeweler':
      return 'no_gold_gem';
    case 'shop':
      return 'no_surplus_food';
    default:
      return null;
  }
}

function hasInputsForTheme(
  themeId: ThemeId,
  warehouse: Warehouse,
  population: number
): boolean {
  if (themeId === 'shop') {
    return (
      getTotalFood(warehouse) > population &&
      SHOP_FOOD_PRIORITY.some((k) => (warehouse[k] ?? 0) >= 1)
    );
  }
  const inputs = THEMES[themeId].inputs;
  if (!inputs || inputs.length === 0) return true;
  return inputs.every((inp) => (warehouse[inp.resource] ?? 0) >= inp.amount);
}

export function resolveCycleOutput(
  themeId: ThemeId,
  cube: Cube,
  allCubes: Cube[],
  warehouse: Warehouse,
  gold: number,
  population: number
): { gold: number; shortage: ShortageReason } {
  const def = THEMES[themeId];
  let nextGold = gold;

  if (themeId === 'sea') {
    const seaOut = getSeaFishOutput(allCubes, cube);
    warehouse.fish += seaOut.amount;
    return { gold: nextGold, shortage: null };
  }

  if (themeId === 'shop') {
    const totalFood = getTotalFood(warehouse);
    if (totalFood > population) {
      const targetFood = SHOP_FOOD_PRIORITY.find((key) => (warehouse[key] ?? 0) >= 1);
      if (targetFood) {
        warehouse[targetFood] = Math.max(0, warehouse[targetFood] - 1);
        const auraBonus = getGoldServiceAuraBonus(allCubes, cube, 'shop');
        const gain = Math.round((def.goldPerCycle ?? 4) * (1 + auraBonus));
        nextGold += gain;
        return { gold: nextGold, shortage: null };
      }
    }
    return { gold: nextGold, shortage: 'no_surplus_food' };
  }

  // Check required inputs
  if (def.inputs && def.inputs.length > 0) {
    const canPay = def.inputs.every((inp) => (warehouse[inp.resource] ?? 0) >= inp.amount);
    if (!canPay) {
      return { gold: nextGold, shortage: getShortageForTheme(themeId) };
    }
    for (const inp of def.inputs) {
      warehouse[inp.resource] = Math.max(0, (warehouse[inp.resource] ?? 0) - inp.amount);
    }
  }

  if (def.outputResource && def.outputAmount) {
    warehouse[def.outputResource] = (warehouse[def.outputResource] ?? 0) + def.outputAmount;
  }

  if (def.goldPerCycle) {
    const auraBonus = getGoldServiceAuraBonus(allCubes, cube, themeId);
    const gain = Math.round(def.goldPerCycle * (1 + auraBonus));
    nextGold += gain;
  }

  return { gold: nextGold, shortage: null };
}

export interface ProductionTickResult {
  cubes: Cube[];
  warehouse: Warehouse;
  gold: number;
  royalShopGoldDelta: number;
  businessTaxDelta: number;
  privateOwnerCredits: Record<number, number>;
}

export function advanceProductionTick(
  cubes: Cube[],
  warehouse: Warehouse,
  gold: number,
  population: number,
  citizens?: Citizen[]
): ProductionTickResult {
  const staffing = computeStaffing(cubes, population, citizens);
  const nextWarehouse: Warehouse = { ...warehouse };
  let nextGold = gold;
  let royalShopGoldDelta = 0;
  let businessTaxDelta = 0;
  const privateOwnerCredits: Record<number, number> = {};

  const applyCycleGold = (cube: Cube, gain: number) => {
    if (gain <= 0) return;
    if (typeof cube.privateOwnerId === 'number') {
      // Element 4.6: Private business revenue splits 90% owner (floor) / 10% treasury tax
      const ownerShare = Math.floor(gain * 0.9);
      const tax = gain - ownerShare;
      nextGold += tax;
      businessTaxDelta += tax;
      if (ownerShare > 0) {
        privateOwnerCredits[cube.privateOwnerId] =
          (privateOwnerCredits[cube.privateOwnerId] ?? 0) + ownerShare;
      }
    } else {
      nextGold += gain;
      royalShopGoldDelta += gain;
    }
  };

  const nextCubes = cubes.map((cube) => {
    if (cube.owner !== 'player') return cube;
    if (!cube.themeId && !cube.secondThemeId) return cube;

    let progress = cube.progress;
    let secondProgress = cube.secondProgress;
    let shortage = cube.shortage;
    let secondShortage = cube.secondShortage;
    let mutated = false;

    if (cube.themeId) {
      const def = THEMES[cube.themeId];
      if (def.cycleSeconds !== null) {
        const isStaffed = staffing.staffedSlots.has(makeSlotKey(cube.id, 0));
        if (isStaffed) {
          mutated = true;
          progress += 1;
          if (progress >= def.cycleSeconds) {
            progress = 0;
            const res = resolveCycleOutput(
              cube.themeId,
              cube,
              cubes,
              nextWarehouse,
              0,
              population
            );
            applyCycleGold(cube, res.gold);
            shortage = res.shortage;
          } else if (shortage && hasInputsForTheme(cube.themeId, nextWarehouse, population)) {
            shortage = null;
          }
        }
      }
    }

    if (cube.secondThemeId) {
      const def = THEMES[cube.secondThemeId];
      if (def.cycleSeconds !== null) {
        const isStaffed = staffing.staffedSlots.has(makeSlotKey(cube.id, 1));
        if (isStaffed) {
          mutated = true;
          secondProgress += 1;
          if (secondProgress >= def.cycleSeconds) {
            secondProgress = 0;
            const res = resolveCycleOutput(
              cube.secondThemeId,
              cube,
              cubes,
              nextWarehouse,
              0,
              population
            );
            applyCycleGold(cube, res.gold);
            secondShortage = res.shortage;
          } else if (
            secondShortage &&
            hasInputsForTheme(cube.secondThemeId, nextWarehouse, population)
          ) {
            secondShortage = null;
          }
        }
      }
    }

    if (!mutated) return cube;
    return {
      ...cube,
      progress,
      secondProgress,
      shortage,
      secondShortage,
    };
  });

  return {
    cubes: nextCubes,
    warehouse: nextWarehouse,
    gold: nextGold,
    royalShopGoldDelta,
    businessTaxDelta,
    privateOwnerCredits,
  };
}
