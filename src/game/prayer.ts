import { ageYears } from './citizens';
import { CLOCK_CONSTANTS, minuteOfDayOf } from './clock';
import { computeStaffing, makeSlotKey } from './production';
import { getSchedulePhase, type ScheduleStateView } from './schedules';
import type {
  Citizen,
  Cube,
  GameClock,
  PrayerKey,
  PrayerLogEntry,
} from './types';

export const PRAYER_LOG_CAP = 35;
export const PRAYER_BONUS_POOL_MAX = 1000;
export const MOSQUE_CAPACITY_PER_BUILDING = 24;
export const PRAYER_EFFICIENCY_BONUS = 0.28;
export const PRAYER_BUFF_DURATION_MINUTES = 60;
export const PRAYER_DURATION_MINUTES = 1;
export const PRAYER_SESSION_MAX_MINUTES = 5;

export const PRAYER_NAMES_AR: Record<PrayerKey, string> = {
  fajr: 'الفجر',
  dhuhr: 'الظهر',
  asr: 'العصر',
  maghrib: 'المغرب',
  isha: 'العشاء',
};

const VALID_PRAYER_KEYS: ReadonlySet<string> = new Set<PrayerKey>([
  'fajr',
  'dhuhr',
  'asr',
  'maghrib',
  'isha',
]);

/**
 * Locked Cairo prayer table (minutes of day): [Fajr, Dhuhr, Asr, Isha].
 * Maghrib is NEVER in this table — it always fires at the game's sunset (18:00 = minute 1080).
 */
export const PRAYER_TIMES_CAIRO: readonly (readonly [
  number,
  number,
  number,
  number,
])[] = [
  [320, 720, 915, 1130], // Jan (0)
  [310, 725, 930, 1150], // Feb (1)
  [285, 720, 935, 1170], // Mar (2)
  [255, 715, 935, 1195], // Apr (3)
  [230, 715, 940, 1220], // May (4)
  [215, 720, 945, 1240], // Jun (5)
  [225, 725, 950, 1240], // Jul (6)
  [250, 725, 950, 1210], // Aug (7)
  [275, 715, 940, 1175], // Sep (8)
  [295, 710, 930, 1145], // Oct (9)
  [310, 705, 915, 1125], // Nov (10)
  [320, 715, 910, 1120], // Dec (11)
] as const;

export interface PrayerTimeEntry {
  key: PrayerKey;
  nameAr: string;
  minute: number;
}

export interface NextPrayerInfo {
  key: PrayerKey;
  nameAr: string;
  minute: number;
  minutesUntil: number;
}

export interface PrayerAttendeeAssignment {
  citizenId: number;
  mosqueCubeId: number;
}

export function calendarMonthForDay(day: number): number {
  const safeDay =
    typeof day === 'number' && Number.isFinite(day)
      ? Math.max(1, Math.trunc(day))
      : 1;
  return ((Math.floor((safeDay - 1) / 30) % 12) + 12) % 12;
}

export function totalGameMinutes(
  source: { clock: GameClock } | GameClock
): number {
  const clock = 'clock' in source ? source.clock : source;
  const totalSec =
    typeof clock.totalGameSeconds === 'number' &&
    Number.isFinite(clock.totalGameSeconds)
      ? Math.max(0, Math.floor(clock.totalGameSeconds))
      : 0;
  return Math.floor(totalSec / 60);
}

/**
 * Pure & deterministic prayer schedule for the given day (or GameState).
 * Always returns 5 prayers sorted strictly ascending, with Maghrib fixed at CLOCK_CONSTANTS.SUNSET_MINUTE (1080).
 */
export function getPrayerTimesForDay(
  stateOrDay: { day: number } | number
): PrayerTimeEntry[] {
  const day = typeof stateOrDay === 'number' ? stateOrDay : stateOrDay.day;
  const monthIdx = calendarMonthForDay(day);
  const [fajr, dhuhr, asr, isha] = PRAYER_TIMES_CAIRO[monthIdx];
  const maghrib = CLOCK_CONSTANTS.SUNSET_MINUTE;

  const entries: PrayerTimeEntry[] = [
    { key: 'fajr', nameAr: PRAYER_NAMES_AR.fajr, minute: fajr },
    { key: 'dhuhr', nameAr: PRAYER_NAMES_AR.dhuhr, minute: dhuhr },
    { key: 'asr', nameAr: PRAYER_NAMES_AR.asr, minute: asr },
    { key: 'maghrib', nameAr: PRAYER_NAMES_AR.maghrib, minute: maghrib },
    { key: 'isha', nameAr: PRAYER_NAMES_AR.isha, minute: isha },
  ];
  entries.sort((a, b) => a.minute - b.minute);
  return entries;
}

/**
 * Returns the next upcoming prayer from the current game minute.
 * After Isha, wraps cleanly to tomorrow's (day + 1) Fajr.
 */
export function getNextPrayer(state: {
  day: number;
  clock: GameClock;
}): NextPrayerInfo {
  const currentMinute = minuteOfDayOf(state.clock);
  const today = getPrayerTimesForDay(state.day);

  for (let i = 0; i < today.length; i++) {
    const p = today[i];
    if (p.minute > currentMinute) {
      return {
        key: p.key,
        nameAr: p.nameAr,
        minute: p.minute,
        minutesUntil: p.minute - currentMinute,
      };
    }
  }

  // Wrap to tomorrow's Fajr (respecting month rollover on day 30 -> 31)
  const tomorrowFajr = getPrayerTimesForDay(state.day + 1)[0];
  const minutesUntil =
    CLOCK_CONSTANTS.GAME_MINUTES_PER_DAY - currentMinute + tomorrowFajr.minute;
  return {
    key: tomorrowFajr.key,
    nameAr: tomorrowFajr.nameAr,
    minute: tomorrowFajr.minute,
    minutesUntil,
  };
}

export function makePrayerTriggerKey(day: number, key: PrayerKey): string {
  const safeDay =
    typeof day === 'number' && Number.isFinite(day)
      ? Math.max(1, Math.trunc(day))
      : 1;
  return `${safeDay}:${key}`;
}

/**
 * Detects whether advancing from prevTotalMinutes to nextTotalMinutes crossed a prayer minute
 * for the given day, guarded by lastPrayerTriggerKey so each (day, prayerKey) fires at most once.
 */
export function detectPrayerCrossing(
  prevTotalMinutes: number,
  nextTotalMinutes: number,
  day: number,
  nextClock: GameClock,
  lastPrayerTriggerKey: string | null
): { entry: PrayerTimeEntry; triggerKey: string; absMinute: number } | null {
  if (nextTotalMinutes <= prevTotalMinutes) return null;

  const nextMinuteOfDay = minuteOfDayOf(nextClock);
  const dayStartAbsMin = nextTotalMinutes - nextMinuteOfDay;
  const times = getPrayerTimesForDay(day);

  for (let i = 0; i < times.length; i++) {
    const entry = times[i];
    const prayerAbsMin = dayStartAbsMin + entry.minute;
    if (prevTotalMinutes < prayerAbsMin && prayerAbsMin <= nextTotalMinutes) {
      const triggerKey = makePrayerTriggerKey(day, entry.key);
      if (lastPrayerTriggerKey === triggerKey) {
        return null;
      }
      return { entry, triggerKey, absMinute: prayerAbsMin };
    }
  }

  return null;
}

/**
 * Returns all player-owned mosque cubes whose mosque slot is staffed per computeStaffing.
 */
export function getStaffedMosqueCubes(
  cubes: Cube[],
  population: number,
  citizens?: Citizen[],
  precomputedStaffedSlots?: Set<string>
): Cube[] {
  const staffedSlots =
    precomputedStaffedSlots ??
    computeStaffing(cubes, population, citizens).staffedSlots;

  const mosques: Cube[] = [];
  for (let i = 0; i < cubes.length; i++) {
    const c = cubes[i];
    if (c.owner !== 'player') continue;
    const slot0Staffed =
      c.themeId === 'mosque' && staffedSlots.has(makeSlotKey(c.id, 0));
    const slot1Staffed =
      c.secondThemeId === 'mosque' && staffedSlots.has(makeSlotKey(c.id, 1));
    if (slot0Staffed || slot1Staffed) {
      mosques.push(c);
    }
  }
  return mosques;
}

function findCubeById(cubes: Cube[], id: number | null): Cube | null {
  if (id === null || id < 0) return null;
  const direct = cubes[id];
  if (direct && direct.id === id) return direct;
  for (let i = 0; i < cubes.length; i++) {
    if (cubes[i].id === id) return cubes[i];
  }
  return null;
}

function manhattanDistance(a: Cube, b: Cube): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

/**
 * Selects eligible prayer attendees at a prayer trigger:
 * - Citizens aged >= 14 whose schedule phase at the trigger minute is 'working' or 'evening'.
 * - Sorted by (Manhattan distance from homeCube to nearest staffed mosque, citizen.id).
 * - Capped at total capacity = 24 * number of staffed mosques.
 * - Each attendee is assigned to his nearest staffed mosque (tie-break by mosque cube.id).
 */
export function selectPrayerAttendees(
  state: ScheduleStateView & { citizens: Citizen[] },
  staffedMosques: Cube[],
  precomputedStaffedSlots?: Set<string>
): PrayerAttendeeAssignment[] {
  if (staffedMosques.length === 0) return [];

  const capacity = staffedMosques.length * MOSQUE_CAPACITY_PER_BUILDING;
  const staffedSlots =
    precomputedStaffedSlots ??
    computeStaffing(state.cubes, state.population, state.citizens).staffedSlots;

  const candidates: Array<{
    citizenId: number;
    mosqueCubeId: number;
    dist: number;
  }> = [];

  for (let i = 0; i < state.citizens.length; i++) {
    const cit = state.citizens[i];
    if (cit.inCamp) continue;
    const age = ageYears(cit, state.totalMonths);
    if (age < 14) continue;

    const phase = getSchedulePhase(cit, state, staffedSlots);
    if (phase !== 'working' && phase !== 'evening') continue;

    const homeCube = findCubeById(state.cubes, cit.homeCubeId);
    let bestMosque = staffedMosques[0];
    let bestDist = homeCube
      ? manhattanDistance(homeCube, bestMosque)
      : Number.MAX_SAFE_INTEGER;

    for (let m = 1; m < staffedMosques.length; m++) {
      const mq = staffedMosques[m];
      const d = homeCube
        ? manhattanDistance(homeCube, mq)
        : Number.MAX_SAFE_INTEGER;
      if (d < bestDist || (d === bestDist && mq.id < bestMosque.id)) {
        bestDist = d;
        bestMosque = mq;
      }
    }

    candidates.push({
      citizenId: cit.id,
      mosqueCubeId: bestMosque.id,
      dist: bestDist,
    });
  }

  candidates.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    return a.citizenId - b.citizenId;
  });

  return candidates.slice(0, capacity).map((c) => ({
    citizenId: c.citizenId,
    mosqueCubeId: c.mosqueCubeId,
  }));
}

export function appendPrayerLog(
  log: PrayerLogEntry[],
  entry: PrayerLogEntry
): PrayerLogEntry[] {
  const safeAttendance = Math.max(0, Math.floor(entry.attendance));
  const next = [
    ...log,
    {
      day: Math.max(1, Math.trunc(entry.day)),
      key: entry.key,
      attendance: safeAttendance,
    },
  ];
  return next.length > PRAYER_LOG_CAP
    ? next.slice(next.length - PRAYER_LOG_CAP)
    : next;
}

export function sanitizePrayerLogOnHydrate(raw: unknown): PrayerLogEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const valid: PrayerLogEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const rec = item as Partial<PrayerLogEntry>;
    if (typeof rec.key !== 'string' || !VALID_PRAYER_KEYS.has(rec.key)) {
      continue;
    }
    const day =
      typeof rec.day === 'number' && Number.isFinite(rec.day)
        ? Math.max(1, Math.trunc(rec.day))
        : 1;
    const attendance =
      typeof rec.attendance === 'number' && Number.isFinite(rec.attendance)
        ? Math.max(0, Math.floor(rec.attendance))
        : 0;
    valid.push({ day, key: rec.key as PrayerKey, attendance });
  }
  return valid.length > PRAYER_LOG_CAP
    ? valid.slice(valid.length - PRAYER_LOG_CAP)
    : valid;
}

export function sanitizePrayerBonusPoolOnHydrate(
  raw: unknown
): Record<number, number> {
  const out: Record<number, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const cubeId = Number(k);
    if (!Number.isInteger(cubeId) || cubeId < 0) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const clamped = Math.max(0, Math.min(PRAYER_BONUS_POOL_MAX, v));
    if (clamped > 0) {
      out[cubeId] = clamped;
    }
  }
  return out;
}

export function sanitizeLastPrayerTriggerKeyOnHydrate(
  raw: unknown
): string | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d+):(fajr|dhuhr|asr|maghrib|isha)$/.exec(raw);
  if (!match) return null;
  return raw;
}
