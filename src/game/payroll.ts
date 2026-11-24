import { THEMES, WAGE_BY_THEME } from './constants';
import { computeStaffing, makeSlotKey } from './production';
import type { Cube, SlotIndex, ThemeId } from './types';

export interface MonthlyPayrollBreakdown {
  workers: number;
  due: number;
  perTheme: Partial<Record<ThemeId, number>>;
}

// Reuses computeStaffing so ONLY staffed CROWN slots are paid by the treasury.
// Private buildings are paid by their owners (Element 4.5); themes with workers === 0 pay nothing.
export function computeMonthlyPayroll(
  cubes: Cube[],
  population: number
): MonthlyPayrollBreakdown {
  const staffing = computeStaffing(cubes, population);
  let workers = 0;
  let due = 0;
  const perTheme: Partial<Record<ThemeId, number>> = {};

  for (const cube of cubes) {
    if (cube.owner !== 'player') continue;
    if (typeof cube.privateOwnerId === 'number') continue;

    const slots: Array<{ slot: SlotIndex; themeId: ThemeId | null }> = [
      { slot: 0, themeId: cube.themeId },
      { slot: 1, themeId: cube.secondThemeId },
    ];

    for (const entry of slots) {
      if (!entry.themeId) continue;
      const def = THEMES[entry.themeId];
      if (def.workers <= 0) continue;
      if (!staffing.staffedSlots.has(makeSlotKey(cube.id, entry.slot))) continue;

      const wagePerWorker = WAGE_BY_THEME[entry.themeId] ?? 0;
      const slotDue = wagePerWorker * def.workers;
      workers += def.workers;
      due += slotDue;
      perTheme[entry.themeId] = (perTheme[entry.themeId] ?? 0) + slotDue;
    }
  }

  return { workers, due, perTheme };
}
