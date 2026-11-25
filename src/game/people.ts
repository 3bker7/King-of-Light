import {
  ENTERTAINMENT_CAFE_BONUS,
  ENTERTAINMENT_MOSQUE_BONUS,
  ENTERTAINMENT_RESTAURANT_BONUS,
  ENTERTAINMENT_SEA_BONUS,
  ENTERTAINMENT_SHOP_OR_MARKET_BONUS,
  ENTERTAINMENT_THEATER_BONUS,
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
  SCHOOL_REPUTATION_MULTIPLIER,
  SHRINK_SATISFACTION_BELOW,
  WEIGHT_ENTERTAINMENT,
  WEIGHT_FOOD,
  WEIGHT_HOUSING,
  WEIGHT_WATER,
} from './constants';
import type { Cube, FoodResourceKey, NeedsBreakdown, ThemeId, Warehouse } from './types';

// Strictly counts Fish + Crops + Wheat + Fruit + Meat + Bread. Water NEVER counts as food.
export function getTotalFood(warehouse: Warehouse): number {
  return FOOD_RESOURCES.reduce((sum, key) => sum + Math.max(0, warehouse[key] ?? 0), 0);
}

// Bread counts double toward food variety.
export function getFoodVarietyCount(warehouse: Warehouse): number {
  let variety = 0;
  for (const key of FOOD_RESOURCES) {
    if ((warehouse[key] ?? 0) > 0) {
      variety += key === 'bread' ? 2 : 1;
    }
  }
  return variety;
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

export function hasThemeBuilt(cubes: Cube[], themeId: ThemeId): boolean {
  return cubes.some(
    (cube) =>
      cube.owner === 'player' &&
      (cube.themeId === themeId || cube.secondThemeId === themeId)
  );
}

export function hasAnyShopOrMarket(cubes: Cube[]): boolean {
  return hasThemeBuilt(cubes, 'shop') || hasThemeBuilt(cubes, 'grand_market');
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
  const shopOrMarket = hasAnyShopOrMarket(cubes);
  const theater = hasThemeBuilt(cubes, 'theater');
  const mosque = hasThemeBuilt(cubes, 'mosque');
  const foodVariety = getFoodVarietyCount(warehouse) >= ENTERTAINMENT_VARIETY_MIN_TYPES;
  const cafe = hasThemeBuilt(cubes, 'cafe');
  const restaurant = hasThemeBuilt(cubes, 'restaurant');

  // Exact WP4 formula, capped at 100
  const score = Math.min(
    100,
    (seaAdjacent ? ENTERTAINMENT_SEA_BONUS : 0) +
      (shopOrMarket ? ENTERTAINMENT_SHOP_OR_MARKET_BONUS : 0) +
      (theater ? ENTERTAINMENT_THEATER_BONUS : 0) +
      (mosque ? ENTERTAINMENT_MOSQUE_BONUS : 0) +
      (foodVariety ? ENTERTAINMENT_VARIETY_BONUS : 0) +
      (cafe ? ENTERTAINMENT_CAFE_BONUS : 0) +
      (restaurant ? ENTERTAINMENT_RESTAURANT_BONUS : 0)
  );

  return {
    seaAdjacent,
    shopOrMarket,
    theater,
    mosque,
    foodVariety,
    cafe,
    restaurant,
    score,
  };
}

export function computeNeedsAndSatisfaction(
  cubes: Cube[],
  warehouse: Warehouse,
  population: number,
  hungerFlag: boolean,
  taxMoodDelta = 0
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

  const baseFormula = Math.round(Math.max(0, Math.min(100, weighted)));
  const withMood = Math.max(0, Math.min(100, baseFormula + taxMoodDelta));
  // Active hunger cap: on a hunger-flag day, Satisfaction is strictly capped at 30.
  const capped = hungerFlag ? Math.min(HUNGER_SATISFACTION_CAP, withMood) : withMood;

  return {
    needs: {
      food: Math.round(foodScore),
      water: Math.round(waterScore),
      housing: Math.round(housingScore),
      entertainment: Math.round(entertainmentScore),
    },
    satisfaction: capped,
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
  level: 1 | 2,
  taxMoodDelta = 0
): DayRolloverPeopleResult {
  const nextWarehouse: Warehouse = { ...warehouse };
  const foodAvailableBefore = getTotalFood(nextWarehouse);

  const hungerFlag = population > 0 && foodAvailableBefore === 0;

  // Consume 1 food unit per person evenly from available food types.
  let remainingFoodToEat = Math.max(0, population * FOOD_PER_PERSON_PER_DAY);
  while (remainingFoodToEat > 0) {
    const availableKeys: FoodResourceKey[] = FOOD_RESOURCES.filter(
      (k) => (nextWarehouse[k] ?? 0) > 0
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

  const preGrowthEval = computeNeedsAndSatisfaction(
    cubes,
    nextWarehouse,
    population,
    hungerFlag,
    taxMoodDelta
  );

  const capacity = getHouseCapacity(cubes);
  const clinicExists = hasThemeBuilt(cubes, 'clinic');
  const schoolExists = hasThemeBuilt(cubes, 'school');

  let nextPopulation = population;
  let popEvent: 'grow' | 'shrink' | 'none' = 'none';

  if (
    preGrowthEval.satisfaction >= GROWTH_SATISFACTION_MIN &&
    capacity > population
  ) {
    nextPopulation = population + POPULATION_CHANGE_STEP;
    popEvent = 'grow';
  } else if (preGrowthEval.satisfaction < SHRINK_SATISFACTION_BELOW) {
    const popFloor = level === 1 ? LEVEL_1_POPULATION_FLOOR : 0;
    // Clinic halves population decline (rounded down)
    const loss = clinicExists
      ? Math.floor(POPULATION_CHANGE_STEP / 2)
      : POPULATION_CHANGE_STEP;
    const candidate = Math.max(popFloor, population - loss);
    if (candidate < population) {
      nextPopulation = candidate;
      popEvent = 'shrink';
    }
  }

  const popDelta = nextPopulation - population;

  // Reputation moves 10% toward Satisfaction; School speeds up positive Reputation gain x1.5
  const repDelta = preGrowthEval.satisfaction - reputation;
  const repFactor =
    repDelta > 0 && schoolExists
      ? REPUTATION_DRIFT_FACTOR * SCHOOL_REPUTATION_MULTIPLIER
      : REPUTATION_DRIFT_FACTOR;

  const nextReputation = Math.max(
    0,
    Math.min(100, reputation + repDelta * repFactor)
  );

  const finalEval = computeNeedsAndSatisfaction(
    cubes,
    nextWarehouse,
    nextPopulation,
    hungerFlag,
    taxMoodDelta
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
