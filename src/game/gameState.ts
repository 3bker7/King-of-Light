import {
  createEmptyTradeVolumes,
  createInitialPrices,
  createInitialWarehouse,
  CUBE_PURCHASE_COST,
  GRID_SIZE,
  LEVEL_1_FOOD_TARGET,
  LEVEL_1_SATISFACTION_TARGET,
  LEVEL_2_CUBES_TARGET,
  LEVEL_2_GOLD_TARGET,
  LEVEL_2_POPULATION_TARGET,
  OBJECTIVE_REWARDS,
  START_OWNED_MIN_COL,
  START_OWNED_MIN_ROW,
  STARTING_DAY,
  STARTING_GOLD,
  STARTING_HOUSES_COL,
  STARTING_HOUSES_ROW,
  STARTING_POPULATION,
  STARTING_REPUTATION,
  THEMES,
  TICKS_PER_DAY,
} from './constants';
import { executeTrade, rolloverBoursePrices } from './economy';
import {
  computeNeedsAndSatisfaction,
  getTotalFood,
  processDayRolloverPeople,
} from './people';
import {
  advanceProductionTick,
  canPlaceThemeOnCube,
  isPurchasableNeutralCube,
} from './production';
import { clearSavedGame } from './save';
import { STRINGS } from './strings';
import type {
  AudioCue,
  Cube,
  GameState,
  ObjectiveState,
  PersistedSaveData,
  SlotIndex,
  ThemeId,
  ToastItem,
  ToastTone,
  TradedResourceKey,
} from './types';

let toastCounter = 1;
let audioCounter = 1;

function createToast(message: string, tone: ToastTone): ToastItem {
  toastCounter += 1;
  return { id: `toast-${toastCounter}`, message, tone };
}

function appendToasts(existing: ToastItem[], additions: ToastItem[]): ToastItem[] {
  if (additions.length === 0) return existing;
  return [...existing, ...additions].slice(-4);
}

function createInitialObjectives(): ObjectiveState[] {
  return [
    {
      id: 'build_sea',
      level: 1,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.build_sea,
    },
    {
      id: 'build_farm',
      level: 1,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.build_farm,
    },
    {
      id: 'hold_30_food',
      level: 1,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.hold_30_food,
    },
    {
      id: 'reach_60_satisfaction',
      level: 1,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.reach_60_satisfaction,
    },
    {
      id: 'reach_25_pop',
      level: 2,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.reach_25_pop,
    },
    {
      id: 'own_15_cubes',
      level: 2,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.own_15_cubes,
    },
    {
      id: 'hold_200_gold',
      level: 2,
      completed: false,
      rewardGold: OBJECTIVE_REWARDS.hold_200_gold,
    },
  ];
}

export function createInitialCubes(now: number): Cube[] {
  const cubes: Cube[] = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const id = row * GRID_SIZE + col;
      const isOwned =
        row >= START_OWNED_MIN_ROW && col >= START_OWNED_MIN_COL;
      const isStartingHousesCube =
        row === STARTING_HOUSES_ROW && col === STARTING_HOUSES_COL;

      cubes.push({
        id,
        row,
        col,
        owner: isOwned ? 'player' : 'neutral',
        themeId: isStartingHousesCube ? 'house' : null,
        secondThemeId: isStartingHousesCube ? 'house' : null,
        builtAt: isStartingHousesCube ? now : null,
        secondBuiltAt: isStartingHousesCube ? now : null,
        progress: 0,
        secondProgress: 0,
        shortage: null,
        secondShortage: null,
      });
    }
  }
  return cubes;
}

export function createFreshGameState(now = Date.now()): GameState {
  const cubes = createInitialCubes(now);
  const warehouse = createInitialWarehouse();
  const prices = createInitialPrices();
  const evalNeeds = computeNeedsAndSatisfaction(
    cubes,
    warehouse,
    STARTING_POPULATION,
    false
  );

  return {
    cubes,
    warehouse,
    gold: STARTING_GOLD,
    population: STARTING_POPULATION,
    satisfaction: evalNeeds.satisfaction,
    reputation: STARTING_REPUTATION,
    hungerFlag: false,
    needs: evalNeeds.needs,
    day: STARTING_DAY,
    tickInDay: 0,
    prices,
    previousPrices: { ...prices },
    dailyBought: createEmptyTradeVolumes(),
    dailySold: createEmptyTradeVolumes(),
    tickerMessage: STRINGS.bourse.defaultTicker,
    level: 1,
    objectives: createInitialObjectives(),
    level2ModalOpen: false,
    level2CompletedModalOpen: false,
    level2CompletedShown: false,
    muted: false,
    lastSavedAt: now,
    toasts: [],
    pendingAudioCue: null,
  };
}

export function hydrateGameState(saved: PersistedSaveData): GameState {
  const evalNeeds = computeNeedsAndSatisfaction(
    saved.cubes,
    saved.warehouse,
    saved.population,
    saved.hungerFlag
  );

  const defaultObjectives = createInitialObjectives();
  const mergedObjectives = defaultObjectives.map((def) => {
    const found = saved.objectives?.find((o) => o.id === def.id);
    return found ? { ...def, completed: Boolean(found.completed) } : def;
  });

  return {
    cubes: saved.cubes,
    warehouse: saved.warehouse,
    gold: Math.max(0, saved.gold),
    population: Math.max(0, saved.population),
    satisfaction: evalNeeds.satisfaction,
    reputation: Math.max(0, Math.min(100, saved.reputation)),
    hungerFlag: Boolean(saved.hungerFlag),
    needs: evalNeeds.needs,
    day: Math.max(1, saved.day),
    tickInDay: Math.max(0, saved.tickInDay % TICKS_PER_DAY),
    prices: saved.prices,
    previousPrices: saved.previousPrices,
    dailyBought: saved.dailyBought,
    dailySold: saved.dailySold,
    tickerMessage: saved.tickerMessage || STRINGS.bourse.defaultTicker,
    level: saved.level === 2 ? 2 : 1,
    objectives: mergedObjectives,
    level2ModalOpen: false,
    level2CompletedModalOpen: false,
    level2CompletedShown: Boolean(saved.level2CompletedShown),
    muted: Boolean(saved.muted),
    lastSavedAt: saved.lastSavedAt,
    toasts: [],
    pendingAudioCue: null,
  };
}

function isObjectiveSatisfied(state: GameState, objectiveId: string): boolean {
  switch (objectiveId) {
    case 'build_sea':
      return state.cubes.some(
        (c) => c.owner === 'player' && c.themeId === 'sea'
      );
    case 'build_farm':
      return state.cubes.some(
        (c) => c.owner === 'player' && c.themeId === 'farm'
      );
    case 'hold_30_food':
      // Strictly counts Fish + Crops + Meat + Bread (Water never counts as food)
      return getTotalFood(state.warehouse) >= LEVEL_1_FOOD_TARGET;
    case 'reach_60_satisfaction':
      return state.satisfaction >= LEVEL_1_SATISFACTION_TARGET;
    case 'reach_25_pop':
      return state.population >= LEVEL_2_POPULATION_TARGET;
    case 'own_15_cubes':
      return (
        state.cubes.filter((c) => c.owner === 'player').length >=
        LEVEL_2_CUBES_TARGET
      );
    case 'hold_200_gold':
      return state.gold >= LEVEL_2_GOLD_TARGET;
    default:
      return false;
  }
}

function evaluateObjectivesAndProgression(state: GameState): GameState {
  let gold = state.gold;
  let level = state.level;
  let level2ModalOpen = state.level2ModalOpen;
  let level2CompletedModalOpen = state.level2CompletedModalOpen;
  let level2CompletedShown = state.level2CompletedShown;
  let pendingAudioCue = state.pendingAudioCue;
  const newToasts: ToastItem[] = [];

  let prevLevel1Completed = true;
  const nextObjectives = state.objectives.map((obj) => {
    if (obj.completed) {
      return obj;
    }
    if (obj.level > level) return obj;
    if (obj.level === 1 && !prevLevel1Completed) {
      return obj;
    }
    if (!isObjectiveSatisfied(state, obj.id)) {
      if (obj.level === 1) prevLevel1Completed = false;
      return obj;
    }

    gold += obj.rewardGold;
    const label = STRINGS.objectives.items[obj.id] ?? obj.id;
    newToasts.push(
      createToast(STRINGS.toasts.objectiveCompleted(label, obj.rewardGold), 'success')
    );
    audioCounter += 1;
    pendingAudioCue = { id: audioCounter, cue: 'reward' };
    return { ...obj, completed: true };
  });

  // Check Level 1 completion -> unlock Level 2
  if (level === 1) {
    const level1AllDone = nextObjectives
      .filter((o) => o.level === 1)
      .every((o) => o.completed);
    if (level1AllDone) {
      level = 2;
      level2ModalOpen = true;
      audioCounter += 1;
      pendingAudioCue = { id: audioCounter, cue: 'levelUp' };
    }
  }

  // Check Level 2 completion -> Level 3 coming soon modal
  if (level === 2 && !level2CompletedShown) {
    const level2AllDone = nextObjectives
      .filter((o) => o.level === 2)
      .every((o) => o.completed);
    if (level2AllDone) {
      level2CompletedModalOpen = true;
      level2CompletedShown = true;
      audioCounter += 1;
      pendingAudioCue = { id: audioCounter, cue: 'levelUp' };
    }
  }

  return {
    ...state,
    gold,
    level,
    objectives: nextObjectives,
    level2ModalOpen,
    level2CompletedModalOpen,
    level2CompletedShown,
    toasts: appendToasts(state.toasts, newToasts),
    pendingAudioCue,
  };
}

export type GameAction =
  | { type: 'TICK' }
  | { type: 'PLACE_THEME'; cubeId: number; themeId: ThemeId }
  | { type: 'DEMOLISH_THEME'; cubeId: number; slot: SlotIndex }
  | { type: 'BUY_CUBE'; cubeId: number }
  | {
      type: 'TRADE_RESOURCE';
      resource: TradedResourceKey;
      side: 'buy' | 'sell';
      quantity: number | 'max';
    }
  | { type: 'DISMISS_TOAST'; id: string }
  | { type: 'CLOSE_LEVEL2_MODAL' }
  | { type: 'CLOSE_LEVEL2_COMPLETED_MODAL' }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'NEW_GAME' };

function makeCue(cue: AudioCue) {
  audioCounter += 1;
  return { id: audioCounter, cue };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'TICK': {
      const prod = advanceProductionTick(
        state.cubes,
        state.warehouse,
        state.gold,
        state.population
      );

      let nextCubes = prod.cubes;
      let nextWarehouse = prod.warehouse;
      let nextGold = prod.gold;
      let nextPopulation = state.population;
      let nextReputation = state.reputation;
      let nextHungerFlag = state.hungerFlag;
      let nextDay = state.day;
      let nextTickInDay = state.tickInDay + 1;
      let nextPrices = state.prices;
      let nextPreviousPrices = state.previousPrices;
      let nextDailyBought = state.dailyBought;
      let nextDailySold = state.dailySold;
      let nextTicker = state.tickerMessage;
      const newToasts: ToastItem[] = [];
      let pendingAudioCue = state.pendingAudioCue;

      if (nextTickInDay >= TICKS_PER_DAY) {
        nextTickInDay = 0;
        nextDay += 1;

        const peopleRes = processDayRolloverPeople(
          nextCubes,
          nextWarehouse,
          nextPopulation,
          nextReputation,
          state.level
        );
        nextWarehouse = peopleRes.warehouse;
        nextPopulation = peopleRes.population;
        nextReputation = peopleRes.reputation;
        nextHungerFlag = peopleRes.hungerFlag;

        if (peopleRes.hungerFlag) {
          newToasts.push(createToast(STRINGS.toasts.hungerOccurred, 'warning'));
        }
        if (peopleRes.popEvent === 'grow') {
          newToasts.push(createToast(STRINGS.toasts.newFamilies, 'success'));
        } else if (peopleRes.popEvent === 'shrink') {
          newToasts.push(createToast(STRINGS.toasts.familiesLeft, 'warning'));
        }

        const bourseRes = rolloverBoursePrices(
          nextPrices,
          nextDailyBought,
          nextDailySold,
          state.level
        );
        nextPrices = bourseRes.prices;
        nextPreviousPrices = bourseRes.previousPrices;
        nextTicker = bourseRes.tickerMessage;
        nextDailyBought = createEmptyTradeVolumes();
        nextDailySold = createEmptyTradeVolumes();

        pendingAudioCue = makeCue('day');
      }

      const evalNeeds = computeNeedsAndSatisfaction(
        nextCubes,
        nextWarehouse,
        nextPopulation,
        nextHungerFlag
      );

      const updated: GameState = {
        ...state,
        cubes: nextCubes,
        warehouse: nextWarehouse,
        gold: Math.max(0, nextGold),
        population: Math.max(0, nextPopulation),
        satisfaction: evalNeeds.satisfaction,
        reputation: nextReputation,
        hungerFlag: nextHungerFlag,
        needs: evalNeeds.needs,
        day: nextDay,
        tickInDay: nextTickInDay,
        prices: nextPrices,
        previousPrices: nextPreviousPrices,
        dailyBought: nextDailyBought,
        dailySold: nextDailySold,
        tickerMessage: nextTicker,
        toasts: appendToasts(state.toasts, newToasts),
        pendingAudioCue,
      };

      return evaluateObjectivesAndProgression(updated);
    }

    case 'PLACE_THEME': {
      const cube = state.cubes[action.cubeId];
      if (!cube) return state;

      const theme = THEMES[action.themeId];
      if (state.gold < theme.cost) {
        return {
          ...state,
          toasts: appendToasts(state.toasts, [
            createToast(STRINGS.toasts.notEnoughGold, 'warning'),
          ]),
          pendingAudioCue: makeCue('error'),
        };
      }

      const check = canPlaceThemeOnCube(cube, action.themeId, state.level);
      if (!check.valid || check.targetSlot === null) {
        return {
          ...state,
          toasts: appendToasts(state.toasts, [
            createToast(STRINGS.toasts.invalidPlacement, 'warning'),
          ]),
          pendingAudioCue: makeCue('error'),
        };
      }

      const now = Date.now();
      const nextCubes = state.cubes.map((c) => {
        if (c.id !== action.cubeId) return c;
        if (check.targetSlot === 0) {
          return {
            ...c,
            themeId: action.themeId,
            builtAt: now,
            progress: 0,
            shortage: null,
          };
        }
        return {
          ...c,
          secondThemeId: action.themeId,
          secondBuiltAt: now,
          secondProgress: 0,
          secondShortage: null,
        };
      });

      const evalNeeds = computeNeedsAndSatisfaction(
        nextCubes,
        state.warehouse,
        state.population,
        state.hungerFlag
      );

      const updated: GameState = {
        ...state,
        cubes: nextCubes,
        gold: Math.max(0, state.gold - theme.cost),
        satisfaction: evalNeeds.satisfaction,
        needs: evalNeeds.needs,
        pendingAudioCue: makeCue('build'),
      };

      return evaluateObjectivesAndProgression(updated);
    }

    case 'DEMOLISH_THEME': {
      const cube = state.cubes[action.cubeId];
      if (!cube || cube.owner !== 'player') return state;

      const nextCubes = state.cubes.map((c) => {
        if (c.id !== action.cubeId) return c;
        if (action.slot === 0) {
          // If a second half theme exists, promote it cleanly into slot 0
          if (c.secondThemeId) {
            return {
              ...c,
              themeId: c.secondThemeId,
              builtAt: c.secondBuiltAt,
              progress: c.secondProgress,
              shortage: c.secondShortage,
              secondThemeId: null,
              secondBuiltAt: null,
              secondProgress: 0,
              secondShortage: null,
            };
          }
          return {
            ...c,
            themeId: null,
            builtAt: null,
            progress: 0,
            shortage: null,
          };
        }
        return {
          ...c,
          secondThemeId: null,
          secondBuiltAt: null,
          secondProgress: 0,
          secondShortage: null,
        };
      });

      const evalNeeds = computeNeedsAndSatisfaction(
        nextCubes,
        state.warehouse,
        state.population,
        state.hungerFlag
      );

      return {
        ...state,
        cubes: nextCubes,
        satisfaction: evalNeeds.satisfaction,
        needs: evalNeeds.needs,
      };
    }

    case 'BUY_CUBE': {
      const cube = state.cubes[action.cubeId];
      if (!cube || !isPurchasableNeutralCube(state.cubes, cube)) return state;
      if (state.gold < CUBE_PURCHASE_COST) {
        return {
          ...state,
          toasts: appendToasts(state.toasts, [
            createToast(STRINGS.toasts.notEnoughGold, 'warning'),
          ]),
          pendingAudioCue: makeCue('error'),
        };
      }

      const nextCubes = state.cubes.map((c) =>
        c.id === action.cubeId ? { ...c, owner: 'player' as const } : c
      );

      const updated: GameState = {
        ...state,
        cubes: nextCubes,
        gold: Math.max(0, state.gold - CUBE_PURCHASE_COST),
        toasts: appendToasts(state.toasts, [
          createToast(STRINGS.toasts.cubePurchased, 'success'),
        ]),
        pendingAudioCue: makeCue('build'),
      };

      return evaluateObjectivesAndProgression(updated);
    }

    case 'TRADE_RESOURCE': {
      if (state.level < 2) return state;
      const result = executeTrade(
        state.gold,
        state.warehouse,
        state.prices,
        state.dailyBought,
        state.dailySold,
        action.resource,
        action.side,
        action.quantity
      );
      if (result.tradedQty <= 0) {
        return {
          ...state,
          pendingAudioCue: makeCue('error'),
        };
      }

      const evalNeeds = computeNeedsAndSatisfaction(
        state.cubes,
        result.warehouse,
        state.population,
        state.hungerFlag
      );

      const updated: GameState = {
        ...state,
        gold: result.gold,
        warehouse: result.warehouse,
        dailyBought: result.dailyBought,
        dailySold: result.dailySold,
        satisfaction: evalNeeds.satisfaction,
        needs: evalNeeds.needs,
        pendingAudioCue: makeCue('trade'),
      };

      return evaluateObjectivesAndProgression(updated);
    }

    case 'DISMISS_TOAST': {
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.id),
      };
    }

    case 'CLOSE_LEVEL2_MODAL': {
      return { ...state, level2ModalOpen: false };
    }

    case 'CLOSE_LEVEL2_COMPLETED_MODAL': {
      return { ...state, level2CompletedModalOpen: false };
    }

    case 'TOGGLE_MUTE': {
      return { ...state, muted: !state.muted };
    }

    case 'NEW_GAME': {
      clearSavedGame();
      return createFreshGameState(Date.now());
    }

    default:
      return state;
  }
}
