import {
  GRID_SIZE,
  SEA_ADJACENCY_BONUS_MAX,
  SEA_ADJACENCY_BONUS_STEP,
  SHOP_FOOD_PRIORITY,
  THEMES,
  WORKER_PRIORITY_ORDER,
} from './constants';
import { getTotalFood } from './people';
import type {
  Cube,
  ShortageReason,
  SlotIndex,
  StaffingStatus,
  ThemeId,
  Warehouse,
} from './types';

export function makeSlotKey(cubeId: number, slot: SlotIndex): string {
  return `${cubeId}:${slot}`;
}

// Strict orthogonal neighbors (up/down/left/right, no diagonals).
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

// Unified orthogonal adjacency expansion rule (Level 1 and Level 2).
export function isPurchasableNeutralCube(cubes: Cube[], cube: Cube): boolean {
  if (cube.owner !== 'neutral') return false;
  return getOrthogonalNeighbors(cubes, cube.row, cube.col).some(
    (neighbor) => neighbor.owner === 'player'
  );
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

export function canPlaceThemeOnCube(
  cube: Cube,
  themeId: ThemeId,
  level: 1 | 2
): { valid: boolean; targetSlot: SlotIndex | null } {
  if (cube.owner !== 'player') {
    return { valid: false, targetSlot: null };
  }
  const theme = THEMES[themeId];
  if (theme.unlockLevel > level) {
    return { valid: false, targetSlot: null };
  }

  if (theme.footprint === 'full') {
    if (cube.themeId === null && cube.secondThemeId === null) {
      return { valid: true, targetSlot: 0 };
    }
    return { valid: false, targetSlot: null };
  }

  // Half-size theme
  if (cube.themeId === null) {
    return { valid: true, targetSlot: 0 };
  }
  if (THEMES[cube.themeId].footprint === 'half' && cube.secondThemeId === null) {
    return { valid: true, targetSlot: 1 };
  }
  return { valid: false, targetSlot: null };
}

interface WorkerCandidate {
  cubeId: number;
  slot: SlotIndex;
  themeId: ThemeId;
  workersNeeded: number;
  builtAt: number;
  priorityIndex: number;
}

export function computeStaffing(cubes: Cube[], population: number): StaffingStatus {
  const candidates: WorkerCandidate[] = [];
  const staffedSlots = new Set<string>();
  let totalWorkersNeeded = 0;

  for (const cube of cubes) {
    if (cube.owner !== 'player') continue;

    const slots: Array<{ slot: SlotIndex; themeId: ThemeId | null; builtAt: number | null }> = [
      { slot: 0, themeId: cube.themeId, builtAt: cube.builtAt },
      { slot: 1, themeId: cube.secondThemeId, builtAt: cube.secondBuiltAt },
    ];

    for (const entry of slots) {
      if (!entry.themeId) continue;
      const def = THEMES[entry.themeId];
      if (def.workers === 0) {
        staffedSlots.add(makeSlotKey(cube.id, entry.slot));
      } else {
        totalWorkersNeeded += def.workers;
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

  // Strict staffing priority order: Well, Farm, Sea, Pasture, Forest, Shop
  candidates.sort((a, b) => {
    if (a.priorityIndex !== b.priorityIndex) return a.priorityIndex - b.priorityIndex;
    if (a.builtAt !== b.builtAt) return a.builtAt - b.builtAt;
    if (a.cubeId !== b.cubeId) return a.cubeId - b.cubeId;
    return a.slot - b.slot;
  });

  let remainingWorkers = Math.max(0, population);
  let totalWorkersEmployed = 0;

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
  let shortage: ShortageReason = null;

  if (themeId === 'sea') {
    const seaOut = getSeaFishOutput(allCubes, cube);
    warehouse.fish += seaOut.amount;
  } else if (themeId === 'well') {
    warehouse.water += def.outputAmount ?? 3;
  } else if (themeId === 'forest') {
    warehouse.wood += def.outputAmount ?? 2;
  } else if (themeId === 'farm') {
    const waterCost = def.inputAmount ?? 1;
    if (warehouse.water >= waterCost) {
      warehouse.water = Math.max(0, warehouse.water - waterCost);
      warehouse.crops += def.outputAmount ?? 3;
    } else {
      shortage = 'no_water';
    }
  } else if (themeId === 'pasture') {
    const cropsCost = def.inputAmount ?? 1;
    if (warehouse.crops >= cropsCost) {
      warehouse.crops = Math.max(0, warehouse.crops - cropsCost);
      warehouse.meat += def.outputAmount ?? 2;
    } else {
      shortage = 'no_crops';
    }
  } else if (themeId === 'shop') {
    // Converts 1 unit of surplus food (above daily population need) in Fish -> Crops -> Meat order.
    const totalFood = getTotalFood(warehouse);
    if (totalFood > population) {
      const targetFood = SHOP_FOOD_PRIORITY.find((key) => warehouse[key] >= 1);
      if (targetFood) {
        warehouse[targetFood] = Math.max(0, warehouse[targetFood] - 1);
        nextGold += def.shopGoldPerCycle ?? 4;
      } else {
        shortage = 'no_surplus_food';
      }
    } else {
      shortage = 'no_surplus_food';
    }
  }

  return { gold: nextGold, shortage };
}

export interface ProductionTickResult {
  cubes: Cube[];
  warehouse: Warehouse;
  gold: number;
}

export function advanceProductionTick(
  cubes: Cube[],
  warehouse: Warehouse,
  gold: number,
  population: number
): ProductionTickResult {
  const staffing = computeStaffing(cubes, population);
  const nextWarehouse: Warehouse = { ...warehouse };
  let nextGold = gold;

  const nextCubes = cubes.map((cube) => {
    if (cube.owner !== 'player') return cube;
    if (!cube.themeId && !cube.secondThemeId) return cube;

    let progress = cube.progress;
    let secondProgress = cube.secondProgress;
    let shortage = cube.shortage;
    let secondShortage = cube.secondShortage;
    let mutated = false;

    // Slot 0
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
              nextGold,
              population
            );
            nextGold = res.gold;
            shortage = res.shortage;
          } else {
            // Clear stale shortage badge immediately if resources have become available
            if (shortage === 'no_water' && nextWarehouse.water >= 1) shortage = null;
            if (shortage === 'no_crops' && nextWarehouse.crops >= 1) shortage = null;
            if (shortage === 'no_surplus_food' && getTotalFood(nextWarehouse) > population) {
              shortage = null;
            }
          }
        }
      }
    }

    // Slot 1 (second half-size theme)
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
              nextGold,
              population
            );
            nextGold = res.gold;
            secondShortage = res.shortage;
          } else {
            if (secondShortage === 'no_water' && nextWarehouse.water >= 1) {
              secondShortage = null;
            }
            if (secondShortage === 'no_crops' && nextWarehouse.crops >= 1) {
              secondShortage = null;
            }
            if (
              secondShortage === 'no_surplus_food' &&
              getTotalFood(nextWarehouse) > population
            ) {
              secondShortage = null;
            }
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
  };
}
