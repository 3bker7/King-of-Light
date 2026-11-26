import { ageYears } from './citizens';
import { CLOCK_CONSTANTS, formatClock, minuteOfDayOf } from './clock';
import { computeStaffing, makeSlotKey } from './production';
import { STRINGS } from './strings';
import type { Citizen, Cube, GameClock, ThemeId } from './types';

export type ShiftTemplate = 'DAY' | 'EARLY' | 'NIGHT' | 'SCHOOL';

export type SchedulePhase =
  | 'home_morning'
  | 'commute'
  | 'working'
  | 'school'
  | 'evening'
  | 'sleep';

export interface CitizenShift {
  template: ShiftTemplate;
  startMinute: number;
  endMinute: number;
}

export interface ScheduleStateView {
  clock: GameClock;
  cubes: Cube[];
  totalMonths: number;
  population: number;
  citizens?: Citizen[];
}

export const SCHEDULE_CONSTANTS = {
  COMMUTE_MINUTES: 30,
  SLEEP_START_MINUTE: 22 * 60, // 22:00 (1320)
  SLEEP_END_MINUTE: 5 * 60, // 05:00 (300)
  NIGHT_SLEEP_DURATION_MINUTES: 7 * 60, // 7h daytime rest after night shift
  JITTER_MIN_MINUTES: -30,
  JITTER_MAX_MINUTES: 30,
  EARLY_BASE_START: 6 * 60, // 06:00 (360)
  EARLY_BASE_END: 16 * 60, // 16:00 (960)
  DAY_BASE_START: 8 * 60, // 08:00 (480)
  DAY_BASE_END: 18 * 60, // 18:00 (1080)
  NIGHT_BASE_START: 18 * 60, // 18:00 (1080)
  NIGHT_BASE_END: 6 * 60, // 06:00 (360)
  SCHOOL_BASE_START: 8 * 60, // 08:00 (480)
  SCHOOL_BASE_END: 14 * 60, // 14:00 (840)
  SCHOOL_MIN_AGE: 6,
  SCHOOL_MAX_AGE: 13,
  MIN_WORK_AGE: 14,
} as const;

/**
 * Locked EARLY shift themes (06:00–16:00).
 * All other real work themes default to DAY (08:00–18:00).
 * NIGHT (18:00–06:00) is reserved exclusively for a police post staffing slot if one exists in the build.
 */
export const EARLY_SHIFT_THEMES: ReadonlySet<ThemeId> = new Set<ThemeId>([
  'bakery',
  'farm',
  'wheat_farm',
  'orchard',
  'sea',
  'grand_market',
  'shop',
]);

/**
 * Pure deterministic jitter in [-30, +30] minutes hashed solely from citizen.id.
 * No Math.random(), zero drift across days or reloads.
 */
export function computeCitizenJitterMinutes(citizenId: number): number {
  const safeId =
    typeof citizenId === 'number' && Number.isFinite(citizenId)
      ? Math.trunc(citizenId)
      : 0;
  let h = (safeId ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  const span =
    SCHEDULE_CONSTANTS.JITTER_MAX_MINUTES -
    SCHEDULE_CONSTANTS.JITTER_MIN_MINUTES +
    1; // 61
  return (h % span) + SCHEDULE_CONSTANTS.JITTER_MIN_MINUTES;
}

/**
 * Returns true iff the kingdom has at least one owned, currently staffed school building.
 */
export function hasStaffedSchool(
  state: Pick<ScheduleStateView, 'cubes' | 'population' | 'citizens'>,
  precomputedStaffedSlots?: Set<string>
): boolean {
  const staffedSlots =
    precomputedStaffedSlots ??
    computeStaffing(state.cubes, state.population, state.citizens).staffedSlots;

  for (let i = 0; i < state.cubes.length; i++) {
    const c = state.cubes[i];
    if (c.owner !== 'player') continue;
    if (c.themeId === 'school' && staffedSlots.has(makeSlotKey(c.id, 0))) {
      return true;
    }
    if (
      c.secondThemeId === 'school' &&
      staffedSlots.has(makeSlotKey(c.id, 1))
    ) {
      return true;
    }
  }
  return false;
}

function findCubeById(cubes: Cube[], cubeId: number): Cube | null {
  const direct = cubes[cubeId];
  if (direct && direct.id === cubeId) return direct;
  for (let i = 0; i < cubes.length; i++) {
    if (cubes[i].id === cubeId) return cubes[i];
  }
  return null;
}

function clampDayShiftRange(
  baseStart: number,
  baseEnd: number,
  jitter: number
): { startMinute: number; endMinute: number } {
  const maxMin = CLOCK_CONSTANTS.GAME_MINUTES_PER_DAY - 1; // 1439
  const minStart = SCHEDULE_CONSTANTS.COMMUTE_MINUTES; // 30 so commute never crosses midnight
  const duration = Math.max(1, baseEnd - baseStart);
  const rawStart = baseStart + jitter;
  const startMinute = Math.max(
    minStart,
    Math.min(maxMin - duration, rawStart)
  );
  const endMinute = Math.min(maxMin, startMinute + duration);
  return { startMinute, endMinute };
}

function wrapMinuteOfDay(raw: number): number {
  const day = CLOCK_CONSTANTS.GAME_MINUTES_PER_DAY;
  return ((Math.trunc(raw) % day) + day) % day;
}

/**
 * Computes a citizen's daily shift strictly from real registry fields (birthMonth, jobCubeId, jobThemeId)
 * and real kingdom buildings (owned cube verification + staffed school check).
 * Unemployed adults and children under 6 (or children without a staffed school) return null.
 */
export function getCitizenShift(
  citizen: Citizen,
  state: ScheduleStateView,
  precomputedStaffedSlots?: Set<string>
): CitizenShift | null {
  const age = ageYears(citizen, state.totalMonths);
  const jitter = computeCitizenJitterMinutes(citizen.id);

  // Children (< 14) NEVER take a work shift, even if a save record were corrupted with a jobCubeId.
  if (age < SCHEDULE_CONSTANTS.MIN_WORK_AGE) {
    if (
      age >= SCHEDULE_CONSTANTS.SCHOOL_MIN_AGE &&
      age <= SCHEDULE_CONSTANTS.SCHOOL_MAX_AGE &&
      hasStaffedSchool(state, precomputedStaffedSlots)
    ) {
      const range = clampDayShiftRange(
        SCHEDULE_CONSTANTS.SCHOOL_BASE_START,
        SCHEDULE_CONSTANTS.SCHOOL_BASE_END,
        jitter
      );
      return {
        template: 'SCHOOL',
        startMinute: range.startMinute,
        endMinute: range.endMinute,
      };
    }
    return null;
  }

  // Adults must hold a real registry job pointing to a real player-owned cube with that exact theme.
  if (citizen.jobCubeId === null || citizen.jobThemeId === null) {
    return null;
  }

  const jobCube = findCubeById(state.cubes, citizen.jobCubeId);
  if (
    !jobCube ||
    jobCube.owner !== 'player' ||
    (jobCube.themeId !== citizen.jobThemeId &&
      jobCube.secondThemeId !== citizen.jobThemeId)
  ) {
    return null;
  }

  // NIGHT shift is reserved exclusively for a police-post staffing slot if one exists in the build.
  // In the current ThemeId set, no police_post staffing slot exists, so NIGHT stays unused.
  const themeKey = citizen.jobThemeId as string;
  if (themeKey === 'police_post') {
    return {
      template: 'NIGHT',
      startMinute: wrapMinuteOfDay(SCHEDULE_CONSTANTS.NIGHT_BASE_START + jitter),
      endMinute: wrapMinuteOfDay(SCHEDULE_CONSTANTS.NIGHT_BASE_END + jitter),
    };
  }

  if (EARLY_SHIFT_THEMES.has(citizen.jobThemeId)) {
    const range = clampDayShiftRange(
      SCHEDULE_CONSTANTS.EARLY_BASE_START,
      SCHEDULE_CONSTANTS.EARLY_BASE_END,
      jitter
    );
    return {
      template: 'EARLY',
      startMinute: range.startMinute,
      endMinute: range.endMinute,
    };
  }

  const range = clampDayShiftRange(
    SCHEDULE_CONSTANTS.DAY_BASE_START,
    SCHEDULE_CONSTANTS.DAY_BASE_END,
    jitter
  );
  return {
    template: 'DAY',
    startMinute: range.startMinute,
    endMinute: range.endMinute,
  };
}

/**
 * Computes the schedule phase for a citizen at the current state.clock minute.
 * Guarantees:
 * - Children (< 14) NEVER return 'working'.
 * - Unemployed citizens (shift === null) NEVER return 'working' or 'commute'.
 * - All non-NIGHT citizens return 'sleep' throughout 22:00–05:00.
 */
export function getSchedulePhase(
  citizen: Citizen,
  state: ScheduleStateView,
  precomputedStaffedSlots?: Set<string>
): SchedulePhase {
  const minute = minuteOfDayOf(state.clock);
  const shift = getCitizenShift(citizen, state, precomputedStaffedSlots);

  if (!shift) {
    if (
      minute >= SCHEDULE_CONSTANTS.SLEEP_START_MINUTE ||
      minute < SCHEDULE_CONSTANTS.SLEEP_END_MINUTE
    ) {
      return 'sleep';
    }
    return minute < 12 * 60 ? 'home_morning' : 'evening';
  }

  if (shift.template === 'NIGHT') {
    // Wraps across midnight: working when minute >= startMinute OR minute < endMinute
    if (minute >= shift.startMinute || minute < shift.endMinute) {
      return 'working';
    }
    const commuteStart = shift.startMinute - SCHEDULE_CONSTANTS.COMMUTE_MINUTES;
    if (minute >= commuteStart && minute < shift.startMinute) {
      return 'commute';
    }
    const daySleepEnd =
      shift.endMinute + SCHEDULE_CONSTANTS.NIGHT_SLEEP_DURATION_MINUTES;
    if (minute >= shift.endMinute && minute < daySleepEnd) {
      return 'sleep';
    }
    return 'home_morning';
  }

  // Non-NIGHT shifts (EARLY, DAY, SCHOOL)
  if (
    minute >= SCHEDULE_CONSTANTS.SLEEP_START_MINUTE ||
    minute < SCHEDULE_CONSTANTS.SLEEP_END_MINUTE
  ) {
    return 'sleep';
  }

  if (minute >= shift.startMinute && minute < shift.endMinute) {
    return shift.template === 'SCHOOL' ? 'school' : 'working';
  }

  const commuteStart = shift.startMinute - SCHEDULE_CONSTANTS.COMMUTE_MINUTES;
  if (minute >= commuteStart && minute < shift.startMinute) {
    return 'commute';
  }

  if (minute < commuteStart) {
    return 'home_morning';
  }

  return 'evening';
}

/**
 * Pure Arabic summary for CitizenCard's "جدوله اليوم" line, derived exclusively
 * from getCitizenShift + getSchedulePhase + real jobThemeId.
 * Impossible to contradict S1's schedule phase.
 */
export function formatCitizenScheduleLineAr(
  citizen: Citizen,
  state: ScheduleStateView,
  precomputedStaffedSlots?: Set<string>
): string {
  const age = ageYears(citizen, state.totalMonths);
  const shift = getCitizenShift(citizen, state, precomputedStaffedSlots);
  const phase = getSchedulePhase(citizen, state, precomputedStaffedSlots);

  if (shift && shift.template === 'SCHOOL') {
    const range = `${formatClock(shift.startMinute)}–${formatClock(shift.endMinute)}`;
    switch (phase) {
      case 'sleep':
        return 'طفل — نائم في بيته';
      case 'school':
        return `طفل — في المدرسة ${range}`;
      case 'commute':
        return `طفل — في طريقه إلى المدرسة ${range}`;
      case 'home_morning':
        return `طفل — في بيته قبل المدرسة (${formatClock(shift.startMinute)})`;
      case 'evening':
        return `طفل — في استراحة بعد المدرسة (${range})`;
      default:
        return `طفل — في المدرسة ${range}`;
    }
  }

  if (age < SCHEDULE_CONSTANTS.MIN_WORK_AGE) {
    return phase === 'sleep' ? 'طفل — نائم في بيته' : 'طفل — في بيته مع أسرته';
  }

  if (!shift || !citizen.jobThemeId) {
    return phase === 'sleep' ? 'بلا عمل حالياً — نائم في بيته' : 'بلا عمل حالياً';
  }

  const placeName = STRINGS.themes[citizen.jobThemeId].name;
  const range = `${formatClock(shift.startMinute)}–${formatClock(shift.endMinute)}`;

  switch (phase) {
    case 'working':
      return `يعمل في ${placeName} ${range} — الآن في عمله`;
    case 'commute':
      return `في طريقه إلى ${placeName} — يبدأ عمله ${formatClock(shift.startMinute)}`;
    case 'home_morning':
      return `في بيته — يبدأ عمله في ${placeName} ${formatClock(shift.startMinute)}`;
    case 'evening':
      return `في استراحة — عمله في ${placeName} ${range}`;
    case 'sleep':
      return 'نائم في بيته';
    default:
      return `يعمل في ${placeName} ${range}`;
  }
}
