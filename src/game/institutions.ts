import { ageYears } from './citizens';
import { hasThemeBuilt } from './people';
import type { Citizen, Cube } from './types';

export const INSTITUTION_STAT_CAP = 90;
export const ELDER_PHYSICAL_FLOOR = 10;

// Element 6.3: Monthly institution modifiers checked LIVE against owned cubes at processing time.
// Demolishing a school or clinic stops its modifier immediately the same month.
export function applyMonthlyInstitutions(
  citizens: Citizen[],
  cubes: Cube[],
  totalMonths: number
): Citizen[] {
  const schoolExists = hasThemeBuilt(cubes, 'school');
  const clinicExists = hasThemeBuilt(cubes, 'clinic');

  return citizens.map((c) => {
    const age = ageYears(c, totalMonths);
    const attrs = { ...c.attrs };

    // School: citizens aged 6-13 gain +2 intelligence, +1 professional (capped at 90 without lowering natural prodigies)
    if (schoolExists && age >= 6 && age <= 13) {
      if (attrs.intelligence < INSTITUTION_STAT_CAP) {
        attrs.intelligence = Math.min(
          INSTITUTION_STAT_CAP,
          attrs.intelligence + 2
        );
      }
      if (attrs.professional < INSTITUTION_STAT_CAP) {
        attrs.professional = Math.min(
          INSTITUTION_STAT_CAP,
          attrs.professional + 1
        );
      }
    }

    // Clinic: every citizen gains +1 health (capped at 90 without lowering natural >90)
    if (clinicExists && attrs.health < INSTITUTION_STAT_CAP) {
      attrs.health = Math.min(INSTITUTION_STAT_CAP, attrs.health + 1);
    }

    // Aging: citizens aged 60+ lose 1 physical per month (floor 10)
    if (age >= 60 && attrs.physical > ELDER_PHYSICAL_FLOOR) {
      attrs.physical = Math.max(ELDER_PHYSICAL_FLOOR, attrs.physical - 1);
    }

    return {
      ...c,
      attrs,
      parentIds: c.parentIds
        ? ([c.parentIds[0], c.parentIds[1]] as [number, number])
        : null,
    };
  });
}
