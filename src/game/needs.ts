import { ageYears } from './citizens';
import { FOOD_RESOURCES } from './constants';
import { getTotalFood } from './people';
import { STRINGS } from './strings';
import type { Citizen, Cube, GameState, ThemeId, Warehouse } from './types';

/**
 * Heavy-labor workplace themes that increase a citizen's daily caloric need by ×1.3.
 * Verified verbatim against ThemeId in src/game/types.ts.
 */
export const HEAVY_JOB_THEMES: ReadonlySet<ThemeId> = new Set<ThemeId>([
  'quarry',
  'iron_mine',
  'copper_mine',
  'gold_mine',
  'gem_mine',
  'oil_well',
  'forest',
]);

/**
 * Anchor-audited base-curve ceiling at coverage >= 1.2.
 * Old fresh-state food component was 100 (producing total satisfaction 85 with water=100, housing=100, ent=0).
 * Setting FOOD_BASE_CURVE_MAX = 110 guarantees avgScore = 100 and fresh satisfaction = 85 even when
 * starting citizens randomly roll bell-curve health < 30 (-10 healthDrag), while preserving full
 * monotonicity, variety impact (+5/+10/+15), and health drag (-10) at normal non-surplus coverage.
 */
export const FOOD_BASE_CURVE_MAX = 110;
export const FOOD_COVERAGE_CAP = 1.2;
export const HUNGER_AVG_SCORE_THRESHOLD = 25;
export const NEED_HISTORY_CAP = 7;

export interface FoodAccess {
  foodPerCapita: number;
  varietyCount: number;
}

export interface DailyFoodAggregate {
  avgScore: number;
  scores: Map<number, number>;
  access: FoodAccess;
}

/**
 * Deterministic daily food need (units/day) for a single citizen:
 * - Age < 14: 0.6
 * - Age 14–59: 1.0
 * - Age 60+: 0.8
 * - Heavy-job multiplier ×1.3 when current jobThemeId is in HEAVY_JOB_THEMES.
 */
export function citizenDailyFoodNeed(
  citizen: Pick<Citizen, 'birthMonth' | 'jobThemeId'>,
  totalMonths: number
): number {
  const age = ageYears(citizen, totalMonths);
  const base = age < 14 ? 0.6 : age >= 60 ? 0.8 : 1.0;
  const isHeavy =
    citizen.jobThemeId !== null && HEAVY_JOB_THEMES.has(citizen.jobThemeId);
  return isHeavy ? Number((base * 1.3).toFixed(4)) : base;
}

/**
 * Derives kingdom-wide FoodAccess strictly from real warehouse food stocks and population.
 * Uses existing getTotalFood (water never counts as food) and counts distinct non-zero food types (capped 0..4).
 */
export function computeFoodAccess(
  warehouse: Warehouse,
  population: number
): FoodAccess {
  const totalFood = getTotalFood(warehouse);
  const denom = Math.max(1, Number.isFinite(population) ? population : 0);
  const foodPerCapita = Math.max(0, totalFood / denom);

  let nonZeroTypes = 0;
  for (let i = 0; i < FOOD_RESOURCES.length; i++) {
    const key = FOOD_RESOURCES[i];
    if ((warehouse[key] ?? 0) > 0) {
      nonZeroTypes += 1;
    }
  }
  const varietyCount = Math.min(4, nonZeroTypes);

  return { foodPerCapita, varietyCount };
}

/**
 * Pure per-citizen daily food satisfaction score (0..100 integer):
 * - coverage = access.foodPerCapita / citizenDailyFoodNeed(citizen, totalMonths)
 * - base = (clamp(coverage, 0, 1.2) / 1.2) * FOOD_BASE_CURVE_MAX
 * - varietyBonus = (clamp(varietyCount, 1..4) - 1) * 5  (0 when varietyCount <= 1, +15 at 4 types)
 * - healthDrag = citizen.attrs.health < 30 ? -10 : 0
 * - score = clamp(round(base + varietyBonus + healthDrag), 0, 100)
 */
export function citizenFoodScore(
  citizen: Pick<Citizen, 'birthMonth' | 'jobThemeId' | 'attrs'>,
  access: FoodAccess,
  totalMonths: number
): number {
  const need = citizenDailyFoodNeed(citizen, totalMonths);
  const safePerCapita =
    Number.isFinite(access.foodPerCapita) && access.foodPerCapita > 0
      ? access.foodPerCapita
      : 0;
  const coverage = need > 0 ? safePerCapita / need : 0;
  const clampedCoverage = Math.max(0, Math.min(FOOD_COVERAGE_CAP, coverage));
  const base = (clampedCoverage / FOOD_COVERAGE_CAP) * FOOD_BASE_CURVE_MAX;

  const safeVariety = Number.isFinite(access.varietyCount)
    ? Math.max(0, Math.min(4, Math.floor(access.varietyCount)))
    : 0;
  const varietyBonus = safeVariety > 1 ? (safeVariety - 1) * 5 : 0;

  const health =
    typeof citizen.attrs?.health === 'number' && Number.isFinite(citizen.attrs.health)
      ? citizen.attrs.health
      : 50;
  const healthDrag = health < 30 ? -10 : 0;

  const raw = Math.round(base + varietyBonus + healthDrag);
  return Math.max(0, Math.min(100, raw));
}

export interface DailyFoodAggregateInput {
  warehouse: Warehouse;
  population: number;
  citizens?: readonly Citizen[];
  totalMonths?: number;
}

/**
 * Pure, deterministic kingdom food aggregation across all living citizens.
 * - 0 living citizens (or population <= 0 when citizens omitted): avgScore = 100.
 * - When citizens array is omitted (legacy callers without citizen registry) and population > 0:
 *   evaluates the exact same citizenFoodScore curve for a representative adult (need 1.0, health 50).
 */
export function aggregateDailyFood(
  state: DailyFoodAggregateInput
): DailyFoodAggregate {
  const totalMonths =
    typeof state.totalMonths === 'number' && Number.isFinite(state.totalMonths)
      ? Math.trunc(state.totalMonths)
      : 0;
  const access = computeFoodAccess(state.warehouse, state.population);
  const scores = new Map<number, number>();

  if (state.citizens !== undefined) {
    if (state.citizens.length === 0) {
      return { avgScore: 100, scores, access };
    }
    let sum = 0;
    for (let i = 0; i < state.citizens.length; i++) {
      const c = state.citizens[i];
      const s = citizenFoodScore(c, access, totalMonths);
      scores.set(c.id, s);
      sum += s;
    }
    return {
      avgScore: sum / state.citizens.length,
      scores,
      access,
    };
  }

  // Fallback for legacy callers that pass population without citizens[]
  if (!Number.isFinite(state.population) || state.population <= 0) {
    return { avgScore: 100, scores, access };
  }
  const representativeAdult: Pick<Citizen, 'birthMonth' | 'jobThemeId' | 'attrs'> = {
    birthMonth: totalMonths - 30,
    jobThemeId: null,
    attrs: { physical: 50, professional: 50, social: 50, health: 50, intelligence: 50 },
  };
  return {
    avgScore: citizenFoodScore(representativeAdult, access, totalMonths),
    scores,
    access,
  };
}

/**
 * Pure helper: appends a citizen's daily food score (0..100 integer) to needHistory7 (newest last, cap 7).
 */
export function appendNeedHistory7(
  history: readonly number[] | undefined,
  score: number
): number[] {
  const safeScore = Number.isFinite(score)
    ? Math.max(0, Math.min(100, Math.round(score)))
    : 0;
  const base = Array.isArray(history) ? history : [];
  const next = [...base, safeScore];
  return next.length > NEED_HISTORY_CAP
    ? next.slice(next.length - NEED_HISTORY_CAP)
    : next;
}

/**
 * Sanitizes persisted Citizen.needHistory7 on hydrate: drops non-finite entries, clamps 0..100 integer, caps last 7.
 */
export function sanitizeNeedHistory7OnHydrate(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const clean: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    clean.push(Math.max(0, Math.min(100, Math.round(v))));
  }
  return clean.length > NEED_HISTORY_CAP
    ? clean.slice(clean.length - NEED_HISTORY_CAP)
    : clean;
}

/**
 * Computes rounded integer mean of a citizen's needHistory7 (or null if empty).
 */
export function meanNeedHistory7(
  history: readonly number[] | undefined
): number | null {
  if (!Array.isArray(history) || history.length === 0) return null;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < history.length; i++) {
    const v = history[i];
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  if (count === 0) return null;
  return Math.round(sum / count);
}

export type LeisureVenueTheme = 'restaurant' | 'cafe' | 'theater' | 'hotel';

export const LEISURE_VENUE_THEMES: ReadonlySet<ThemeId> = new Set<ThemeId>([
  'restaurant',
  'cafe',
  'theater',
  'hotel',
]);

function isLeisureVenueTheme(t: ThemeId | null): t is LeisureVenueTheme {
  return t !== null && LEISURE_VENUE_THEMES.has(t);
}

/**
 * Resolves a citizen's preferredVenueCubeId against the live map.
 * Returns the leisure theme only if the cube still exists, is player-owned,
 * and currently carries a leisure venue theme; otherwise returns null (never stale).
 */
export function resolvePreferredLeisureTheme(
  citizen: Pick<Citizen, 'preferredVenueCubeId'>,
  cubes: readonly Cube[]
): LeisureVenueTheme | null {
  const cubeId = citizen.preferredVenueCubeId;
  if (typeof cubeId !== 'number' || !Number.isFinite(cubeId)) return null;
  const cube = cubes.find((c) => c.id === cubeId && c.owner === 'player');
  if (!cube) return null;
  if (isLeisureVenueTheme(cube.themeId)) return cube.themeId;
  if (isLeisureVenueTheme(cube.secondThemeId)) return cube.secondThemeId;
  return null;
}

export interface CitizenCardNeedsView {
  todayFoodScore: number;
  avg7: number | null;
  needsLineAr: string;
  preferredThemeId: LeisureVenueTheme | null;
  preferredVenueNameAr: string | null;
}

/**
 * Single source of truth for the CitizenCard "احتياجاته" and "مكانه المفضل" rows.
 */
export function formatCitizenCardNeeds(
  citizen: Citizen,
  state: Pick<GameState, 'warehouse' | 'population' | 'citizens' | 'totalMonths' | 'cubes'>
): CitizenCardNeedsView {
  const agg = aggregateDailyFood({
    warehouse: state.warehouse,
    population: state.population,
    citizens: state.citizens,
    totalMonths: state.totalMonths,
  });
  const todayFoodScore =
    agg.scores.get(citizen.id) ??
    citizenFoodScore(citizen, agg.access, state.totalMonths);
  const avg7 = meanNeedHistory7(citizen.needHistory7);
  const needsLineAr =
    avg7 !== null
      ? `الغذاء اليوم: ${todayFoodScore} — متوسط آخر ٧ أيام: ${avg7}`
      : `الغذاء اليوم: ${todayFoodScore}`;
  const preferredThemeId = resolvePreferredLeisureTheme(citizen, state.cubes);
  const preferredVenueNameAr = preferredThemeId
    ? STRINGS.themes[preferredThemeId].name
    : null;

  return {
    todayFoodScore,
    avg7,
    needsLineAr,
    preferredThemeId,
    preferredVenueNameAr,
  };
}

