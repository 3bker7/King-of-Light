import { ageYears } from './citizens';
import type { Citizen, Cube } from './types';

// Derived helper (never stored separately): identifies which citizens currently head a housed household.
// In a housed household (homeCubeId !== null):
// - If a married couple lives in the household, the founding married couple (lowest id pair) are co-heads.
// - Otherwise, the eldest adult (age >= 15, tie-break lowest id) is the head.
export function getHousedHouseholdHeadIds(
  citizens: Citizen[],
  totalMonths: number
): Set<number> {
  const byHousehold = new Map<number, Citizen[]>();
  const byId = new Map<number, Citizen>();

  for (const c of citizens) {
    byId.set(c.id, c);
    if (c.homeCubeId === null) continue;
    const arr = byHousehold.get(c.householdId);
    if (arr) arr.push(c);
    else byHousehold.set(c.householdId, [c]);
  }

  const headIds = new Set<number>();

  for (const [, members] of byHousehold.entries()) {
    // Check for married couples inside this housed household
    const couples: Array<[Citizen, Citizen]> = [];
    const seen = new Set<number>();
    for (const m of members) {
      if (seen.has(m.id) || m.spouseId === null) continue;
      const spouse = byId.get(m.spouseId);
      if (
        spouse &&
        spouse.spouseId === m.id &&
        spouse.householdId === m.householdId &&
        spouse.homeCubeId !== null
      ) {
        seen.add(m.id);
        seen.add(spouse.id);
        couples.push(m.id < spouse.id ? [m, spouse] : [spouse, m]);
      }
    }

    if (couples.length > 0) {
      couples.sort((a, b) => a[0].id - b[0].id);
      headIds.add(couples[0][0].id);
      headIds.add(couples[0][1].id);
      continue;
    }

    // Single-adult housed household: eldest member aged >= 15 (fallback eldest member)
    const adults = members.filter((m) => ageYears(m, totalMonths) >= 15);
    const pool = adults.length > 0 ? adults : members;
    pool.sort((a, b) => {
      const ageDiff = ageYears(b, totalMonths) - ageYears(a, totalMonths);
      return ageDiff !== 0 ? ageDiff : a.id - b.id;
    });
    if (pool.length > 0) {
      headIds.add(pool[0].id);
    }
  }

  return headIds;
}

// Derived count of housed households (Element 4 / H4: always derived from citizens)
export function countHousedHouseholds(
  citizens: Citizen[],
  totalMonths: number
): number {
  const headIds = getHousedHouseholdHeadIds(citizens, totalMonths);
  const hhIds = new Set<number>();
  for (const c of citizens) {
    if (headIds.has(c.id) && c.homeCubeId !== null) {
      hhIds.add(c.householdId);
    }
  }
  return hhIds.size;
}

export interface AgingMilestonesResult {
  citizens: Citizen[];
  cvsFiled: number;
  housingRequestsFiled: number;
}

// Element 2.2: Exact integer milestone checks.
// Also clears stale homeCubeId if a house cube was demolished so homeless families enter the queue.
export function runAgingAndMilestones(
  citizens: Citizen[],
  cubes: Cube[],
  totalMonths: number
): AgingMilestonesResult {
  const houseSlotsByCube = new Map<number, number>();
  for (const cube of cubes) {
    if (cube.owner !== 'player') continue;
    let count = 0;
    if (cube.themeId === 'house') count += 1;
    if (cube.secondThemeId === 'house') count += 1;
    if (count > 0) houseSlotsByCube.set(cube.id, count);
  }

  // Ensure each cube holds at most as many housed households as it has house buildings (1 or 2)
  const householdsByCube = new Map<number, number[]>();
  for (const c of citizens) {
    if (c.homeCubeId === null) continue;
    const arr = householdsByCube.get(c.homeCubeId);
    if (!arr) {
      householdsByCube.set(c.homeCubeId, [c.householdId]);
    } else if (!arr.includes(c.householdId)) {
      arr.push(c.householdId);
    }
  }
  const allowedHouseholdsByCube = new Map<number, Set<number>>();
  for (const [cubeId, hhList] of householdsByCube.entries()) {
    const cap = houseSlotsByCube.get(cubeId) ?? 0;
    hhList.sort((a, b) => a - b);
    allowedHouseholdsByCube.set(cubeId, new Set(hhList.slice(0, cap)));
  }

  const next: Citizen[] = citizens.map((c) => {
    const allowed =
      c.homeCubeId !== null
        ? allowedHouseholdsByCube.get(c.homeCubeId)?.has(c.householdId) ?? false
        : false;
    return {
      ...c,
      homeCubeId: allowed ? c.homeCubeId : null,
      attrs: { ...c.attrs },
      parentIds: c.parentIds
        ? ([c.parentIds[0], c.parentIds[1]] as [number, number])
        : null,
    };
  });

  const headIds = getHousedHouseholdHeadIds(next, totalMonths);
  const byId = new Map<number, Citizen>();
  for (const c of next) byId.set(c.id, c);

  let cvsFiled = 0;
  let housingRequestsFiled = 0;

  for (const c of next) {
    const age = ageYears(c, totalMonths);

    // Milestone 1: Reaching age 14 -> file CV once (Labor Office)
    if (age >= 14 && !c.cvFiled) {
      c.cvFiled = true;
      c.cvFiledMonth = totalMonths;
      cvsFiled += 1;
    }

    // Milestone 2: Reaching age 15 -> eligible for independent housing request if not a housed head
    if (age >= 15 && c.housingRequestMonth === null && !headIds.has(c.id)) {
      // If married, ensure only ONE spouse carries the couple's housing request
      const spouse = c.spouseId !== null ? byId.get(c.spouseId) : undefined;
      if (spouse && spouse.spouseId === c.id) {
        if (spouse.housingRequestMonth !== null) continue;
        // Let the lower-id spouse hold the shared request so couples never double-file
        if (c.id > spouse.id && ageYears(spouse, totalMonths) >= 15 && !headIds.has(spouse.id)) {
          continue;
        }
      }
      c.housingRequestMonth = totalMonths;
      housingRequestsFiled += 1;
    }
  }

  return {
    citizens: next,
    cvsFiled,
    housingRequestsFiled,
  };
}
