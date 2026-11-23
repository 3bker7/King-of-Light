import {
  ENTERTAINMENT_SEA_BONUS,
  ENTERTAINMENT_SHOP_BONUS,
  ENTERTAINMENT_VARIETY_BONUS,
  ENTERTAINMENT_VARIETY_MIN_TYPES,
  FOOD_PER_PERSON_PER_DAY,
  FOOD_RESOURCES,
  GRID_SIZE,
  GROWTH_SATISFACTION_MIN,
  HOUSE_CAPACITY,
  HUNGER_SATISFACTION_CAP,
  LEVEL_1_POPULATION_FLOOR,
  PEOPLE_PER_WATER_PER_DAY,
  POPULATION_CHANGE_STEP,
  REPUTATION_DRIFT_FACTOR,
  SHRINK_SATISFACTION_BELOW,
  WEIGHT_ENTERTAINMENT,
  WEIGHT_FOOD,
  WEIGHT_HOUSING,
  WEIGHT_WATER,
} from './constants';
import type { Cube, FoodResourceKey, NeedsBreakdown, Warehouse } from './types';

// Strictly counts Fish + Crops + Meat + Bread. Water NEVER counts as food.
export function getTotalFood(warehouse: Warehouse): number {
  return FOOD_RESOURCES.reduce((sum, key) => sum + Math.max(0, warehouse[key]), 0);
}

export function getFoodVarietyCount(warehouse: Warehouse): number {
  return FOOD_RESOURCES.filter((key) => warehouse[key] > 0).length;
}

export function getHouseCapacity(cubes: Cube[]): number {
  let houses = 0;
  for (const cube of cubes) {
    if (cube.owner !== 'player') continue;
    if (cube.themeId === 'house') houses += 1;
    if (cube.secondThemeId === 'house') houses += 1;
  }
  return houses * HOUSE_CAPACITY;
}

export function hasAnyShop(cubes: Cube[]): boolean {
  return cubes.some(
    (cube) =>
      cube.owner === 'player' &&
      (cube.themeId === 'shop' || cube.secondThemeId === 'shop')
  );
}

export function hasSeaAdjacentToHouse(cubes: Cube[]): boolean {
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (const cube of cubes) {
    if (cube.owner !== 'player') continue;
    const hasHouse = cube.themeId === 'house' || cube.secondThemeId === 'house';
    if (!hasHouse) continue;

    for (const [dr, dc] of dirs) {
      const nr = cube.row + dr;
      const nc = cube.col + dc;
      if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;
      const neighbor = cubes[nr * GRID_SIZE + nc];
      if (neighbor && neighbor.owner === 'player' && neighbor.themeId === 'sea') {
        return true;
      }
    }
  }
  return false;
}

export function getEntertainmentBreakdown(cubes: Cube[], warehouse: Warehouse) {
  const seaAdjacent = hasSeaAdjacentToHouse(cubes);
  const shopExists = hasAnyShop(cubes);
  const foodVariety = getFoodVarietyCount(warehouse) >= ENTERTAINMENT_VARIETY_MIN_TYPES;

  const score =
    (seaAdjacent ? ENTERTAINMENT_SEA_BONUS : 0) +
    (shopExists ? ENTERTAINMENT_SHOP_BONUS : 0) +
    (foodVariety ? ENTERTAINMENT_VARIETY_BONUS : 0);

  return {
    seaAdjacent,
    shopExists,
    foodVariety,
    score: Math.min(100, score),
  };
}

export function computeNeedsAndSatisfaction(
  cubes: Cube[],
  warehouse: Warehouse,
  population: number,
  hungerFlag: boolean
): { needs: NeedsBreakdown; satisfaction: number } {
  const denom = Math.max(1, population);
  const totalFood = getTotalFood(warehouse);
  const houseCapacity = getHouseCapacity(cubes);

  const foodScore = Math.min(100, (totalFood / denom) * 100);
  const waterScore = Math.min(100, (Math.max(0, warehouse.water) / denom) * 100);
  const housingScore = Math.min(100, (houseCapacity / denom) * 100);
  const entertainmentScore = getEntertainmentBreakdown(cubes, warehouse).score;

  const weighted =
    WEIGHT_FOOD * foodScore +
    WEIGHT_WATER * waterScore +
    WEIGHT_HOUSING * housingScore +
    WEIGHT_ENTERTAINMENT * entertainmentScore;

  const clamped = Math.max(0, Math.min(100, weighted));
  // Active hunger cap: on a hunger-flag day, Satisfaction is strictly capped at 30.
  const capped = hungerFlag ? Math.min(HUNGER_SATISFACTION_CAP, clamped) : clamped;

  return {
    needs: {
      food: Math.round(foodScore),
      water: Math.round(waterScore),
      housing: Math.round(housingScore),
      entertainment: Math.round(entertainmentScore),
    },
    satisfaction: Math.round(capped),
  };
}

export interface DayRolloverPeopleResult {
  warehouse: Warehouse;
  population: number;
  popDelta: number;
  popEvent: 'grow' | 'shrink' | 'none';
  hungerFlag: boolean;
  satisfaction: number;
  needs: NeedsBreakdown;
  reputation: number;
}

export function processDayRolloverPeople(
  cubes: Cube[],
  warehouse: Warehouse,
  population: number,
  reputation: number,
  level: 1 | 2
): DayRolloverPeopleResult {
  const nextWarehouse: Warehouse = { ...warehouse };
  const foodAvailableBefore = getTotalFood(nextWarehouse);

  // If warehouse food is 0 at day rollover, hunger flag is set for the day.
  const hungerFlag = population > 0 && foodAvailableBefore === 0;

  // Consume 1 food unit per person evenly from available food types.
  let remainingFoodToEat = Math.max(0, population * FOOD_PER_PERSON_PER_DAY);
  while (remainingFoodToEat > 0) {
    const availableKeys: FoodResourceKey[] = FOOD_RESOURCES.filter(
      (k) => nextWarehouse[k] > 0
    );
    if (availableKeys.length === 0) break;

    const perTypeShare = Math.max(
      1,
      Math.floor(remainingFoodToEat / availableKeys.length)
    );
    for (const key of availableKeys) {
      if (remainingFoodToEat <= 0) break;
      const take = Math.min(nextWarehouse[key], perTypeShare, remainingFoodToEat);
      nextWarehouse[key] = Math.max(0, nextWarehouse[key] - take);
      remainingFoodToEat -= take;
    }
  }

  // Consume 1 Water per 2 people at day rollover.
  const waterNeeded = Math.floor(population / PEOPLE_PER_WATER_PER_DAY);
  nextWarehouse.water = Math.max(0, nextWarehouse.water - waterNeeded);

  // Evaluate satisfaction with active hunger cap before growth/departure check.
  const preGrowthEval = computeNeedsAndSatisfaction(
    cubes,
    nextWarehouse,
    population,
    hungerFlag
  );

  const capacity = getHouseCapacity(cubes);
  let nextPopulation = population;
  let popEvent: 'grow' | 'shrink' | 'none' = 'none';

  if (
    preGrowthEval.satisfaction >= GROWTH_SATISFACTION_MIN &&
    capacity > population
  ) {
    nextPopulation = population + POPULATION_CHANGE_STEP;
    popEvent = 'grow';
  } else if (preGrowthEval.satisfaction < SHRINK_SATISFACTION_BELOW) {
    // Level 1 safety rule: population never drops below 5 in Level 1.
    const popFloor = level === 1 ? LEVEL_1_POPULATION_FLOOR : 0;
    const candidate = Math.max(popFloor, population - POPULATION_CHANGE_STEP);
    if (candidate < population) {
      nextPopulation = candidate;
      popEvent = 'shrink';
    }
  }

  const popDelta = nextPopulation - population;

  // Reputation moves 10% of the distance toward current Satisfaction.
  const nextReputation = Math.max(
    0,
    Math.min(
      100,
      reputation + (preGrowthEval.satisfaction - reputation) * REPUTATION_DRIFT_FACTOR
    )
  );

  // Recompute final needs/satisfaction for updated population while preserving hungerFlag cap.
  const finalEval = computeNeedsAndSatisfaction(
    cubes,
    nextWarehouse,
    nextPopulation,
    hungerFlag
  );

  return {
    warehouse: nextWarehouse,
    population: nextPopulation,
    popDelta,
    popEvent,
    hungerFlag,
    satisfaction: finalEval.satisfaction,
    needs: finalEval.needs,
    reputation: nextReputation,
  };
}
