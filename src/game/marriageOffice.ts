import { getHousedHouseholdHeadIds } from './aging';
import {
  ageYears,
  createPoliceRecord,
  getNextHouseholdId,
} from './citizens';
import { addCitizenMemory } from './personality';
import type { Citizen, PoliceRecord } from './types';

export const MAX_MARRIAGES_PER_MONTH = 3;

function areCloseRelatives(a: Citizen, b: Citizen): boolean {
  // Parent-child check
  if (a.parentIds && (a.parentIds[0] === b.id || a.parentIds[1] === b.id)) {
    return true;
  }
  if (b.parentIds && (b.parentIds[0] === a.id || b.parentIds[1] === a.id)) {
    return true;
  }
  // Full/half sibling check (share a parent)
  if (a.parentIds && b.parentIds) {
    if (
      a.parentIds[0] === b.parentIds[0] ||
      a.parentIds[0] === b.parentIds[1] ||
      a.parentIds[1] === b.parentIds[0] ||
      a.parentIds[1] === b.parentIds[1]
    ) {
      return true;
    }
  }
  return false;
}

// Element 5.1: Eligibility gate enforced strictly in logic (never UI-only)
export function canMarry(
  a: Citizen | undefined,
  b: Citizen | undefined,
  citizens: Citizen[],
  totalMonths: number,
  excludedCitizenIds?: ReadonlySet<number>
): { ok: boolean; reason?: string } {
  if (!a || !b) return { ok: false, reason: 'missing_citizen' };
  if (excludedCitizenIds && (excludedCitizenIds.has(a.id) || excludedCitizenIds.has(b.id))) {
    return { ok: false, reason: 'bereaved_this_month' };
  }
  if (a.id === b.id) return { ok: false, reason: 'same_person' };
  if (a.gender === b.gender) return { ok: false, reason: 'same_gender' };
  if (areCloseRelatives(a, b)) return { ok: false, reason: 'close_relative' };

  if (ageYears(a, totalMonths) < 15 || ageYears(b, totalMonths) < 15) {
    return { ok: false, reason: 'underage' };
  }

  // Bigamy impossible by construction: check direct spouseId AND scan for any third party pointing to a or b
  if (a.spouseId !== null || b.spouseId !== null) {
    return { ok: false, reason: 'already_married' };
  }
  for (const other of citizens) {
    if (other.spouseId === a.id || other.spouseId === b.id) {
      return { ok: false, reason: 'already_married' };
    }
  }

  // Responsibility gate: at least one employed OR both have active CVs
  const oneEmployed = a.jobCubeId !== null || b.jobCubeId !== null;
  const bothActiveCv = a.cvFiled && b.cvFiled;
  if (!oneEmployed && !bothActiveCv) {
    return { ok: false, reason: 'no_work_or_cv' };
  }

  return { ok: true };
}

export interface MarryResult {
  ok: boolean;
  reason?: string;
  citizens: Citizen[];
  policeRecords: PoliceRecord[];
}

// Element 5.1 & 5.2: Executes a single validated marriage and appends one stamped PoliceRecord.
export function marryCitizens(
  citizens: Citizen[],
  idA: number,
  idB: number,
  totalMonths: number,
  policeRecords: PoliceRecord[]
): MarryResult {
  const aOrig = citizens.find((c) => c.id === idA);
  const bOrig = citizens.find((c) => c.id === idB);

  const check = canMarry(aOrig, bOrig, citizens, totalMonths);
  if (!check.ok) {
    return {
      ok: false,
      reason: check.reason,
      citizens,
      policeRecords,
    };
  }

  const next: Citizen[] = citizens.map((c) => ({
    ...c,
    attrs: { ...c.attrs },
    memories: Array.isArray(c.memories) ? [...c.memories] : [],
    parentIds: c.parentIds
      ? ([c.parentIds[0], c.parentIds[1]] as [number, number])
      : null,
  }));

  const a = next.find((c) => c.id === idA)!;
  const b = next.find((c) => c.id === idB)!;

  const headIds = getHousedHouseholdHeadIds(next, totalMonths);
  const aIsHousedHead = a.homeCubeId !== null && headIds.has(a.id);
  const bIsHousedHead = b.homeCubeId !== null && headIds.has(b.id);
  const aEmployed = a.jobCubeId !== null;
  const bEmployed = b.jobCubeId !== null;

  let targetHouseholdId: number;
  let targetHomeCubeId: number | null;
  let coupleHeadsHouse = false;

  // Merge into one household: employed partner's household (preferring housed head if employed), else a new one
  if (aEmployed && aIsHousedHead) {
    targetHouseholdId = a.householdId;
    targetHomeCubeId = a.homeCubeId;
    coupleHeadsHouse = true;
  } else if (bEmployed && bIsHousedHead) {
    targetHouseholdId = b.householdId;
    targetHomeCubeId = b.homeCubeId;
    coupleHeadsHouse = true;
  } else if (aIsHousedHead && !bEmployed) {
    targetHouseholdId = a.householdId;
    targetHomeCubeId = a.homeCubeId;
    coupleHeadsHouse = true;
  } else if (bIsHousedHead && !aEmployed) {
    targetHouseholdId = b.householdId;
    targetHomeCubeId = b.homeCubeId;
    coupleHeadsHouse = true;
  } else if (aEmployed && a.homeCubeId === null) {
    targetHouseholdId = a.householdId;
    targetHomeCubeId = null;
    coupleHeadsHouse = false;
  } else if (bEmployed && b.homeCubeId === null) {
    targetHouseholdId = b.householdId;
    targetHomeCubeId = null;
    coupleHeadsHouse = false;
  } else {
    // Neither heads an independent house -> form a new independent household waiting for housing
    targetHouseholdId = getNextHouseholdId(next);
    targetHomeCubeId = null;
    coupleHeadsHouse = false;
  }

  a.spouseId = b.id;
  b.spouseId = a.id;
  a.marriedMonth = totalMonths;
  b.marriedMonth = totalMonths;

  a.householdId = targetHouseholdId;
  b.householdId = targetHouseholdId;
  a.homeCubeId = targetHomeCubeId;
  b.homeCubeId = targetHomeCubeId;

  // Bring any unmarried dependent children of either partner into the merged household
  for (const child of next) {
    if (child.id === a.id || child.id === b.id) continue;
    if (child.spouseId !== null || headIds.has(child.id)) continue;
    if (
      child.parentIds &&
      (child.parentIds[0] === a.id ||
        child.parentIds[1] === a.id ||
        child.parentIds[0] === b.id ||
        child.parentIds[1] === b.id)
    ) {
      child.householdId = targetHouseholdId;
      child.homeCubeId = targetHomeCubeId;
    }
  }

  if (coupleHeadsHouse) {
    a.housingRequestMonth = null;
    b.housingRequestMonth = null;
  } else {
    // Auto-file ONE shared housing request on the lower-id spouse (preserving earliest wait if already waiting)
    const primary = a.id < b.id ? a : b;
    const secondary = primary.id === a.id ? b : a;
    const earliest =
      a.housingRequestMonth !== null && b.housingRequestMonth !== null
        ? Math.min(a.housingRequestMonth, b.housingRequestMonth)
        : (a.housingRequestMonth ?? b.housingRequestMonth ?? totalMonths);
    primary.housingRequestMonth = earliest;
    secondary.housingRequestMonth = null;
  }

  const husband = a.gender === 'm' ? a : b;
  const wife = a.gender === 'f' ? a : b;

  // V5 Prompt 5 Element 2: Both spouses record 'married' memory
  const marriedMemory = {
    month: totalMonths,
    kind: 'married' as const,
    cubeId: targetHomeCubeId,
    amount: null,
  };
  const aIdx = next.findIndex((c) => c.id === a.id);
  if (aIdx >= 0) next[aIdx] = addCitizenMemory(next[aIdx], marriedMemory);
  const bIdx = next.findIndex((c) => c.id === b.id);
  if (bIdx >= 0) next[bIdx] = addCitizenMemory(next[bIdx], marriedMemory);

  const nextRecords: PoliceRecord[] = [
    ...policeRecords,
    createPoliceRecord(
      totalMonths,
      'marriage',
      `عقد زواج ${husband.name} و${wife.name}`,
      [husband.id, wife.id]
    ),
  ];

  return {
    ok: true,
    citizens: next,
    policeRecords: nextRecords,
  };
}

export function countMarriageEligibleSingles(
  citizens: Citizen[],
  totalMonths: number
): number {
  let count = 0;
  for (const c of citizens) {
    if (c.spouseId !== null) continue;
    if (ageYears(c, totalMonths) < 15) continue;
    if (c.jobCubeId !== null || c.cvFiled) count += 1;
  }
  return count;
}

export interface MarriageOfficeResult {
  citizens: Citizen[];
  policeRecords: PoliceRecord[];
  marriagesCount: number;
}

// Element 5.2: Monthly matching — minimize age gap, tie-break higher combined social, max 3/month
export function runMarriageOffice(
  citizens: Citizen[],
  totalMonths: number,
  policeRecords: PoliceRecord[],
  excludedCitizenIds?: ReadonlySet<number>
): MarriageOfficeResult {
  let currentCitizens = citizens;
  let currentRecords = policeRecords;

  const males = currentCitizens.filter(
    (c) =>
      c.gender === 'm' &&
      c.spouseId === null &&
      !(excludedCitizenIds?.has(c.id)) &&
      ageYears(c, totalMonths) >= 15 &&
      (c.jobCubeId !== null || c.cvFiled)
  );
  const females = currentCitizens.filter(
    (c) =>
      c.gender === 'f' &&
      c.spouseId === null &&
      !(excludedCitizenIds?.has(c.id)) &&
      ageYears(c, totalMonths) >= 15 &&
      (c.jobCubeId !== null || c.cvFiled)
  );

  interface PairCandidate {
    maleId: number;
    femaleId: number;
    ageGap: number;
    combinedSocial: number;
    minId: number;
    maxId: number;
  }

  const candidates: PairCandidate[] = [];
  for (const m of males) {
    const mAge = ageYears(m, totalMonths);
    for (const f of females) {
      if (!canMarry(m, f, currentCitizens, totalMonths, excludedCitizenIds).ok) continue;
      const fAge = ageYears(f, totalMonths);
      candidates.push({
        maleId: m.id,
        femaleId: f.id,
        ageGap: Math.abs(mAge - fAge),
        combinedSocial: m.attrs.social + f.attrs.social,
        minId: Math.min(m.id, f.id),
        maxId: Math.max(m.id, f.id),
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.ageGap !== b.ageGap) return a.ageGap - b.ageGap;
    if (b.combinedSocial !== a.combinedSocial) {
      return b.combinedSocial - a.combinedSocial;
    }
    if (a.minId !== b.minId) return a.minId - b.minId;
    return a.maxId - b.maxId;
  });

  const marriedThisPass = new Set<number>();
  let marriagesCount = 0;

  for (const pair of candidates) {
    if (marriagesCount >= MAX_MARRIAGES_PER_MONTH) break;
    if (marriedThisPass.has(pair.maleId) || marriedThisPass.has(pair.femaleId)) {
      continue;
    }
    const res = marryCitizens(
      currentCitizens,
      pair.maleId,
      pair.femaleId,
      totalMonths,
      currentRecords
    );
    if (res.ok) {
      currentCitizens = res.citizens;
      currentRecords = res.policeRecords;
      marriedThisPass.add(pair.maleId);
      marriedThisPass.add(pair.femaleId);
      marriagesCount += 1;
    }
  }

  return {
    citizens: currentCitizens,
    policeRecords: currentRecords,
    marriagesCount,
  };
}
