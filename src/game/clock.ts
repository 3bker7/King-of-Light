import type { GameClock, GameState } from './types';

export const CLOCK_CONSTANTS = {
  REAL_SECONDS_PER_GAME_DAY: 28_800, // 8 real hours
  REAL_SECONDS_PER_GAME_HOUR: 1_200, // 20 real minutes
  REAL_SECONDS_PER_GAME_MINUTE: 20, // 20 real seconds
  GAME_SECONDS_PER_TICK: 3, // 1 real second tick = 3 game seconds
  GAME_SECONDS_PER_DAY: 86_400, // 24 * 60 * 60
  GAME_MINUTES_PER_DAY: 1_440, // 24 * 60
  DEFAULT_START_SECONDS_OF_DAY: 8 * 3_600, // 08:00 morning light on fresh game
  SUNRISE_MINUTE: 6 * 60, // 06:00
  SUNSET_MINUTE: 18 * 60, // 18:00
  SUNRISE_SECONDS: 6 * 3_600, // 21,600
  SUNSET_SECONDS: 18 * 3_600, // 64,800
  MAX_OFFLINE_GAME_DAYS: 90,
  MAX_OFFLINE_REAL_SECONDS: 90 * 28_800, // 2,592,000 real seconds = 90 game days
} as const;

export function createInitialClock(): GameClock {
  return {
    secondsOfDay: CLOCK_CONSTANTS.DEFAULT_START_SECONDS_OF_DAY,
    totalGameSeconds: 0,
  };
}

export function clampSecondsOfDay(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return CLOCK_CONSTANTS.DEFAULT_START_SECONDS_OF_DAY;
  }
  const floored = Math.floor(raw);
  if (floored < 0) return 0;
  if (floored >= CLOCK_CONSTANTS.GAME_SECONDS_PER_DAY) {
    return CLOCK_CONSTANTS.GAME_SECONDS_PER_DAY - 1;
  }
  return floored;
}

export function sanitizeClockOnHydrate(
  raw: Partial<GameClock> | null | undefined,
  minTotalGameSeconds = 0
): GameClock {
  const floorMin =
    typeof minTotalGameSeconds === 'number' && Number.isFinite(minTotalGameSeconds)
      ? Math.max(0, Math.floor(minTotalGameSeconds))
      : 0;

  if (!raw || typeof raw !== 'object') {
    return {
      secondsOfDay: CLOCK_CONSTANTS.DEFAULT_START_SECONDS_OF_DAY,
      totalGameSeconds: floorMin,
    };
  }

  const secondsOfDay = clampSecondsOfDay(raw.secondsOfDay);
  const parsedTotal =
    typeof raw.totalGameSeconds === 'number' && Number.isFinite(raw.totalGameSeconds)
      ? Math.max(0, Math.floor(raw.totalGameSeconds))
      : 0;

  return {
    secondsOfDay,
    totalGameSeconds: Math.max(floorMin, parsedTotal),
  };
}

export function advanceClock(
  clock: GameClock,
  realSeconds = 1
): { clock: GameClock; daysWrapped: number } {
  const safeCurrent = clampSecondsOfDay(clock.secondsOfDay);
  const safeTotal =
    typeof clock.totalGameSeconds === 'number' && Number.isFinite(clock.totalGameSeconds)
      ? Math.max(0, Math.floor(clock.totalGameSeconds))
      : 0;

  const safeReal =
    typeof realSeconds === 'number' && Number.isFinite(realSeconds) && realSeconds > 0
      ? Math.floor(realSeconds)
      : 0;

  if (safeReal === 0) {
    return {
      clock: { secondsOfDay: safeCurrent, totalGameSeconds: safeTotal },
      daysWrapped: 0,
    };
  }

  const deltaGameSeconds = safeReal * CLOCK_CONSTANTS.GAME_SECONDS_PER_TICK;
  const combined = safeCurrent + deltaGameSeconds;
  const daysWrapped = Math.floor(combined / CLOCK_CONSTANTS.GAME_SECONDS_PER_DAY);
  const nextSecondsOfDay = combined % CLOCK_CONSTANTS.GAME_SECONDS_PER_DAY;

  return {
    clock: {
      secondsOfDay: nextSecondsOfDay,
      totalGameSeconds: safeTotal + deltaGameSeconds,
    },
    daysWrapped,
  };
}

export function minuteOfDayOf(
  source: Pick<GameState, 'clock'> | GameClock
): number {
  const secondsOfDay =
    'clock' in source ? source.clock.secondsOfDay : source.secondsOfDay;
  return Math.floor(clampSecondsOfDay(secondsOfDay) / 60);
}

export function formatClock(minuteOfDay: number): string {
  const safeMin =
    typeof minuteOfDay === 'number' && Number.isFinite(minuteOfDay)
      ? ((Math.floor(minuteOfDay) % CLOCK_CONSTANTS.GAME_MINUTES_PER_DAY) +
          CLOCK_CONSTANTS.GAME_MINUTES_PER_DAY) %
        CLOCK_CONSTANTS.GAME_MINUTES_PER_DAY
      : Math.floor(CLOCK_CONSTANTS.DEFAULT_START_SECONDS_OF_DAY / 60);
  const hours = Math.floor(safeMin / 60);
  const mins = safeMin % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function isNightMinute(minuteOfDay: number): boolean {
  const safeMin =
    typeof minuteOfDay === 'number' && Number.isFinite(minuteOfDay)
      ? ((Math.floor(minuteOfDay) % CLOCK_CONSTANTS.GAME_MINUTES_PER_DAY) +
          CLOCK_CONSTANTS.GAME_MINUTES_PER_DAY) %
        CLOCK_CONSTANTS.GAME_MINUTES_PER_DAY
      : Math.floor(CLOCK_CONSTANTS.DEFAULT_START_SECONDS_OF_DAY / 60);
  return (
    safeMin < CLOCK_CONSTANTS.SUNRISE_MINUTE ||
    safeMin >= CLOCK_CONSTANTS.SUNSET_MINUTE
  );
}

export function sunProgressOf(minuteOfDay: number): number {
  const safeMin =
    typeof minuteOfDay === 'number' && Number.isFinite(minuteOfDay)
      ? ((Math.floor(minuteOfDay) % CLOCK_CONSTANTS.GAME_MINUTES_PER_DAY) +
          CLOCK_CONSTANTS.GAME_MINUTES_PER_DAY) %
        CLOCK_CONSTANTS.GAME_MINUTES_PER_DAY
      : Math.floor(CLOCK_CONSTANTS.DEFAULT_START_SECONDS_OF_DAY / 60);
  const span = CLOCK_CONSTANTS.SUNSET_MINUTE - CLOCK_CONSTANTS.SUNRISE_MINUTE;
  const raw = (safeMin - CLOCK_CONSTANTS.SUNRISE_MINUTE) / span;
  return Math.max(0, Math.min(1, raw));
}

export function sunProgressFromSeconds(secondsOfDay: number): number {
  const s = clampSecondsOfDay(secondsOfDay);
  const span = CLOCK_CONSTANTS.SUNSET_SECONDS - CLOCK_CONSTANTS.SUNRISE_SECONDS;
  const raw = (s - CLOCK_CONSTANTS.SUNRISE_SECONDS) / span;
  return Math.max(0, Math.min(1, raw));
}
