import { THEMES } from './constants';
import { pickCitizenName } from './names';
import {
  generateTraits,
  inheritTraits,
  sanitizeTraitsOnHydrate,
} from './personality';
import type {
  Citizen,
  CitizenAttrKey,
  CitizenAttrs,
  Cube,
  PoliceRecord,
  PoliceRecordKind,
  SlotIndex,
  ThemeId,
} from './types';

export const CITIZEN_ATTR_KEYS: readonly CitizenAttrKey[] = [
  'physical',
  'professional',
  'social',
  'health',
  'intelligence',
] as const;

let policeRecordSeq = 1;

export function createPoliceRecord(
  month: number,
  kind: PoliceRecordKind,
  textAr: string,
  citizenIds: number[]
): PoliceRecord {
  policeRecordSeq += 1;
  return {
    id: `pol-${month}-${policeRecordSeq}`,
    month,
    kind,
    textAr,
    citizenIds: [...citizenIds],
  };
}

export function sanitizePoliceRecordsOnHydrate(
  raw: PoliceRecord[] | undefined
): PoliceRecord[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  // Advance sequence counter past any existing pol-<month>-<seq> suffix so future IDs never collide
  for (const rec of raw) {
    if (rec && typeof rec.id === 'string') {
      const match = /^pol-\d+-(\d+)/.exec(rec.id);
      if (match) {
        const seq = Number(match[1]);
        if (Number.isFinite(seq) && seq > policeRecordSeq) {
          policeRecordSeq = seq;
        }
      }
    }
  }

  const seenIds = new Set<string>();
  const clean: PoliceRecord[] = [];
  for (const rec of raw) {
    if (!rec || typeof rec !== 'object') continue;
    const month =
      typeof rec.month === 'number' && Number.isFinite(rec.month)
        ? Math.max(0, Math.trunc(rec.month))
        : 0;
    let id =
      typeof rec.id === 'string' && rec.id.length > 0
        ? rec.id
        : `pol-${month}-${++policeRecordSeq}`;
    if (seenIds.has(id)) {
      policeRecordSeq += 1;
      id = `pol-${month}-${policeRecordSeq}`;
    }
    seenIds.add(id);
    clean.push({
      ...rec,
      id,
      month,
      citizenIds: Array.isArray(rec.citizenIds) ? [...rec.citizenIds] : [],
    });
  }
  return clean;
}

export function ageYears(
  citizen: Pick<Citizen, 'birthMonth'>,
  stateOrMonth: { totalMonths: number } | number
): number {
  const totalMonths =
    typeof stateOrMonth === 'number' ? stateOrMonth : stateOrMonth.totalMonths;
  return Math.trunc(totalMonths) - Math.trunc(citizen.birthMonth);
}

export function rollBellStat(rng: () => number = Math.random): number {
  const raw = Math.round((100 * (rng() + rng() + rng())) / 3);
  return Math.max(0, Math.min(100, raw));
}

export function generateBellAttrs(rng: () => number = Math.random): CitizenAttrs {
  return {
    physical: rollBellStat(rng),
    professional: rollBellStat(rng),
    social: rollBellStat(rng),
    health: rollBellStat(rng),
    intelligence: rollBellStat(rng),
  };
}

// Element 6.2: Inheritance with 10% regression toward 50 and uniform [-10, +10] noise
export function inheritAttrs(
  father: CitizenAttrs,
  mother: CitizenAttrs,
  rng: () => number = Math.random
): CitizenAttrs {
  const result = {} as CitizenAttrs;
  for (const key of CITIZEN_ATTR_KEYS) {
    const noise = rng() * 20 - 10;
    const val = Math.round(((father[key] + mother[key]) / 2) * 0.9 + 50 * 0.1 + noise);
    result[key] = Math.max(1, Math.min(100, val));
  }
  return result;
}

export function getTopAttribute(attrs: CitizenAttrs): CitizenAttrKey {
  let bestKey: CitizenAttrKey = 'physical';
  let bestVal = -1;
  for (const key of CITIZEN_ATTR_KEYS) {
    if (attrs[key] > bestVal) {
      bestVal = attrs[key];
      bestKey = key;
    }
  }
  return bestKey;
}

export function getOwnedHouseUnits(cubes: Cube[]): Array<{ cubeId: number; slot: SlotIndex }> {
  const units: Array<{ cubeId: number; slot: SlotIndex }> = [];
  for (const c of cubes) {
    if (c.owner !== 'player') continue;
    if (c.themeId === 'house') units.push({ cubeId: c.id, slot: 0 });
    if (c.secondThemeId === 'house') units.push({ cubeId: c.id, slot: 1 });
  }
  return units;
}

export function getNextHouseholdId(citizens: Citizen[]): number {
  let maxId = 0;
  for (const c of citizens) {
    if (c.householdId > maxId) maxId = c.householdId;
  }
  return maxId + 1;
}

export function sumCitizenWealth(citizens: Citizen[]): number {
  let total = 0;
  for (const c of citizens) {
    total += c.wealth;
  }
  return total;
}

function distributeWealth(citizens: Citizen[], totalWealth: number): void {
  const amount = Math.max(0, Math.floor(totalWealth));
  if (amount <= 0 || citizens.length === 0) return;
  const adults = citizens.filter((c) => c.cvFiled);
  const targets = adults.length > 0 ? adults : citizens;
  const baseShare = Math.floor(amount / targets.length);
  let rem = amount - baseShare * targets.length;
  for (const c of targets) {
    const extra = rem > 0 ? 1 : 0;
    if (rem > 0) rem -= 1;
    c.wealth += baseShare + extra;
  }
}

// Element 1.4: Generate initial citizens for a fresh game or legacy save migration
export function generateInitialCitizens(
  cubes: Cube[],
  population: number,
  totalMonths: number,
  initialCitizenWealth = 0,
  rng: () => number = Math.random
): { citizens: Citizen[]; nextCitizenId: number } {
  const target = Math.max(0, Math.floor(population));
  if (target === 0) {
    return { citizens: [], nextCitizenId: 1 };
  }

  const houseUnits = getOwnedHouseUnits(cubes);
  const home1 = houseUnits[0]?.cubeId ?? null;
  const home2 = houseUnits[1]?.cubeId ?? home1;

  interface SeedSpec {
    gender: 'm' | 'f';
    age: number;
    householdIdx: number;
    spouseSeedIdx?: number;
    parentSeedIdxs?: [number, number];
    wantsOwnHouse?: boolean;
  }

  // First 10 citizens form 2 realistic households with couples, kids 10-13, teen, worker adults & elder
  const baseSpecs: SeedSpec[] = [
    // Household 1 (home1)
    { gender: 'm', age: 32, householdIdx: 1, spouseSeedIdx: 1 }, // 0: Father 1
    { gender: 'f', age: 29, householdIdx: 1, spouseSeedIdx: 0 }, // 1: Mother 1
    { gender: 'm', age: 13, householdIdx: 1, parentSeedIdxs: [0, 1] }, // 2: Child 13 (turns 14 on month 1)
    { gender: 'f', age: 11, householdIdx: 1, parentSeedIdxs: [0, 1] }, // 3: Child 11 (turns 14 on month 3)
    { gender: 'm', age: 64, householdIdx: 1 }, // 4: Elder
    // Household 2 (home2)
    { gender: 'm', age: 36, householdIdx: 2, spouseSeedIdx: 6 }, // 5: Father 2
    { gender: 'f', age: 33, householdIdx: 2, spouseSeedIdx: 5 }, // 6: Mother 2
    { gender: 'm', age: 16, householdIdx: 2, parentSeedIdxs: [5, 6] }, // 7: Teen 16
    { gender: 'f', age: 12, householdIdx: 2, parentSeedIdxs: [5, 6] }, // 8: Child 12 (turns 14 on month 2)
    { gender: 'f', age: 24, householdIdx: 2 }, // 9: Single worker-age adult in household 2
  ];

  const citizens: Citizen[] = [];
  let nextId = 1;

  const baseCount = Math.min(target, baseSpecs.length);
  for (let i = 0; i < baseCount; i++) {
    const spec = baseSpecs[i];
    const id = nextId++;
    const homeCubeId = spec.householdIdx === 1 ? home1 : home2;
    const isAdultCv = spec.age >= 14;
    const birthMonth = totalMonths - spec.age;
    citizens.push({
      id,
      name: pickCitizenName(spec.gender, id * 7 + i * 3),
      gender: spec.gender,
      birthMonth,
      householdId: spec.householdIdx,
      homeCubeId,
      spouseId: null,
      parentIds: null,
      jobCubeId: null,
      jobSlot: null,
      jobThemeId: null,
      wealth: 0,
      attrs: generateBellAttrs(rng),
      traits: generateTraits(id, birthMonth),
      cvFiled: isAdultCv,
      cvFiledMonth: isAdultCv ? totalMonths : null,
      housingRequestMonth: null,
      marriedMonth: null,
    });
  }

  // Wire spouse & parent links cleanly for included seed citizens (and inherit traits for founding children)
  for (let i = 0; i < baseCount; i++) {
    const spec = baseSpecs[i];
    if (spec.spouseSeedIdx !== undefined && spec.spouseSeedIdx < baseCount) {
      citizens[i].spouseId = citizens[spec.spouseSeedIdx].id;
      citizens[i].marriedMonth = totalMonths - 6;
    }
    if (
      spec.parentSeedIdxs &&
      spec.parentSeedIdxs[0] < baseCount &&
      spec.parentSeedIdxs[1] < baseCount
    ) {
      const father = citizens[spec.parentSeedIdxs[0]];
      const mother = citizens[spec.parentSeedIdxs[1]];
      citizens[i].parentIds = [father.id, mother.id];
      citizens[i].traits = inheritTraits(
        citizens[i].id,
        citizens[i].birthMonth,
        mother,
        father
      );
    }
  }

  // If migrating an older save with population > 10, fill remaining households cleanly
  let nextHouseholdId = 3;
  let houseCursor = 2;
  while (citizens.length < target) {
    const rem = target - citizens.length;
    const homeCubeId =
      houseCursor < houseUnits.length ? houseUnits[houseCursor++].cubeId : null;
    const hhId = nextHouseholdId++;

    if (rem >= 3) {
      const fatherId = nextId++;
      const motherId = nextId++;
      const childId = nextId++;
      const fatherAttrs = generateBellAttrs(rng);
      const motherAttrs = generateBellAttrs(rng);
      const fAge = 24 + Math.floor(rng() * 14);
      const mAge = 22 + Math.floor(rng() * 12);
      const cAge = 4 + Math.floor(rng() * 9);
      const fBirth = totalMonths - fAge;
      const mBirth = totalMonths - mAge;
      const cBirth = totalMonths - cAge;
      const fTraits = generateTraits(fatherId, fBirth);
      const mTraits = generateTraits(motherId, mBirth);
      citizens.push(
        {
          id: fatherId,
          name: pickCitizenName('m', fatherId * 5),
          gender: 'm',
          birthMonth: fBirth,
          householdId: hhId,
          homeCubeId,
          spouseId: motherId,
          parentIds: null,
          jobCubeId: null,
          jobSlot: null,
          jobThemeId: null,
          wealth: 0,
          attrs: fatherAttrs,
          traits: fTraits,
          cvFiled: true,
          cvFiledMonth: totalMonths,
          housingRequestMonth: homeCubeId === null ? totalMonths : null,
          marriedMonth: totalMonths - 3,
        },
        {
          id: motherId,
          name: pickCitizenName('f', motherId * 5),
          gender: 'f',
          birthMonth: mBirth,
          householdId: hhId,
          homeCubeId,
          spouseId: fatherId,
          parentIds: null,
          jobCubeId: null,
          jobSlot: null,
          jobThemeId: null,
          wealth: 0,
          attrs: motherAttrs,
          traits: mTraits,
          cvFiled: true,
          cvFiledMonth: totalMonths,
          housingRequestMonth: null,
          marriedMonth: totalMonths - 3,
        },
        {
          id: childId,
          name: pickCitizenName(childId % 2 === 0 ? 'f' : 'm', childId * 7),
          gender: childId % 2 === 0 ? 'f' : 'm',
          birthMonth: cBirth,
          householdId: hhId,
          homeCubeId,
          spouseId: null,
          parentIds: [fatherId, motherId],
          jobCubeId: null,
          jobSlot: null,
          jobThemeId: null,
          wealth: 0,
          attrs: inheritAttrs(fatherAttrs, motherAttrs, rng),
          traits: inheritTraits(childId, cBirth, mTraits, fTraits),
          cvFiled: cAge >= 14,
          cvFiledMonth: cAge >= 14 ? totalMonths : null,
          housingRequestMonth: null,
          marriedMonth: null,
        }
      );
    } else {
      const id = nextId++;
      const gender: 'm' | 'f' = id % 2 === 0 ? 'f' : 'm';
      const age = 19 + Math.floor(rng() * 20);
      const birthMonth = totalMonths - age;
      citizens.push({
        id,
        name: pickCitizenName(gender, id * 11),
        gender,
        birthMonth,
        householdId: hhId,
        homeCubeId,
        spouseId: null,
        parentIds: null,
        jobCubeId: null,
        jobSlot: null,
        jobThemeId: null,
        wealth: 0,
        attrs: generateBellAttrs(rng),
        traits: generateTraits(id, birthMonth),
        cvFiled: true,
        cvFiledMonth: totalMonths,
        housingRequestMonth: homeCubeId === null ? totalMonths : null,
        marriedMonth: null,
      });
    }
  }

  distributeWealth(citizens, initialCitizenWealth);

  return { citizens, nextCitizenId: nextId };
}

export interface ReconcileVisaArrival {
  name: string;
  gender: 'm' | 'f';
  ageMonths: number;
  attributes: CitizenAttrs;
  wealth: number;
  lastVisaMonth: number;
}

export interface ReconcileInput {
  citizens: Citizen[];
  nextCitizenId: number;
  population: number;
  totalMonths: number;
  citizenWealth: number;
  policeRecords: PoliceRecord[];
  rng?: () => number;
  forcedEmigrateIds?: ReadonlySet<number>;
  visaArrivals?: ReadonlyArray<ReconcileVisaArrival>;
}

export interface ReconcileResult {
  citizens: Citizen[];
  nextCitizenId: number;
  citizenWealth: number;
  policeRecords: PoliceRecord[];
  birthsCount: number;
  cvsFiledCount: number;
  localEmigratedWealth: number;
}

function findEligibleBirthCouple(
  citizens: Citizen[],
  totalMonths: number
): { father: Citizen; mother: Citizen } | null {
  const byId = new Map<number, Citizen>();
  for (const c of citizens) byId.set(c.id, c);

  // Count children per household
  const childrenByHousehold = new Map<number, number>();
  for (const c of citizens) {
    if (c.parentIds !== null || ageYears(c, totalMonths) < 18) {
      childrenByHousehold.set(
        c.householdId,
        (childrenByHousehold.get(c.householdId) ?? 0) + 1
      );
    }
  }

  const candidates: Array<{
    father: Citizen;
    mother: Citizen;
    marriedMonth: number;
    keyId: number;
  }> = [];

  const seenPairs = new Set<string>();
  for (const c of citizens) {
    if (c.spouseId === null || c.homeCubeId === null) continue;
    const spouse = byId.get(c.spouseId);
    if (!spouse || spouse.spouseId !== c.id || spouse.homeCubeId === null) continue;

    const a = Math.min(c.id, spouse.id);
    const b = Math.max(c.id, spouse.id);
    const pairKey = `${a}:${b}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const wife = c.gender === 'f' ? c : spouse.gender === 'f' ? spouse : null;
    const husband = c.gender === 'm' ? c : spouse.gender === 'm' ? spouse : null;
    if (!wife || !husband) continue;

    const wifeAge = ageYears(wife, totalMonths);
    if (wifeAge < 18 || wifeAge > 40) continue;

    const hhChildren = childrenByHousehold.get(wife.householdId) ?? 0;
    if (hhChildren >= 4) continue;

    const mMonth = Math.min(
      wife.marriedMonth ?? totalMonths - 1,
      husband.marriedMonth ?? totalMonths - 1
    );
    if (totalMonths - mMonth < 1) continue;

    candidates.push({
      father: husband,
      mother: wife,
      marriedMonth: mMonth,
      keyId: a,
    });
  }

  if (candidates.length === 0) return null;

  // Element 6.1: longest-married first, deterministic tie-break by lower id
  candidates.sort((x, y) => {
    if (x.marriedMonth !== y.marriedMonth) return x.marriedMonth - y.marriedMonth;
    return x.keyId - y.keyId;
  });

  return { father: candidates[0].father, mother: candidates[0].mother };
}

// Element 1.5: The ONLY function allowed to add or remove citizens.
// Restores citizens.length === population after day rollovers, month boundaries, and hydrate.
export function reconcileCitizens(input: ReconcileInput): ReconcileResult {
  const rng = input.rng ?? Math.random;
  const target = Math.max(0, Math.floor(input.population));
  const totalMonths = Math.max(0, Math.trunc(input.totalMonths));
  const list: Citizen[] = input.citizens.map((c) => ({
    ...c,
    attrs: { ...c.attrs },
    traits: c.traits ? { ...c.traits } : generateTraits(c.id, c.birthMonth),
    parentIds: c.parentIds ? ([c.parentIds[0], c.parentIds[1]] as [number, number]) : null,
  }));
  let nextId = Math.max(
    input.nextCitizenId,
    list.reduce((m, c) => Math.max(m, c.id), 0) + 1
  );
  let nextHouseholdId = getNextHouseholdId(list);
  let nextCitizenWealth = Math.max(0, Math.floor(input.citizenWealth));
  const policeRecords: PoliceRecord[] = [...input.policeRecords];
  let birthsCount = 0;
  let cvsFiledCount = 0;
  let localEmigratedWealth = 0;

  const removeCitizensById = (idsToRemove: Set<number>, isExternalVisa = false) => {
    const leaving = list.filter((c) => idsToRemove.has(c.id));
    for (const remCitizen of leaving) {
      const remWealth = Math.max(0, Math.floor(remCitizen.wealth));
      nextCitizenWealth = Math.max(0, nextCitizenWealth - remWealth);
      if (!isExternalVisa && remWealth > 0) {
        localEmigratedWealth += remWealth;
      }
      if (remCitizen.spouseId !== null && !idsToRemove.has(remCitizen.spouseId)) {
        const spouse = list.find((s) => s.id === remCitizen.spouseId);
        if (spouse) {
          spouse.spouseId = null;
          spouse.marriedMonth = null;
          policeRecords.push(
            createPoliceRecord(
              totalMonths,
              'dissolution',
              `انفصال أسري بعد مغادرة ${remCitizen.name} — تبقى ${spouse.name} في المملكة`,
              [remCitizen.id, spouse.id]
            )
          );
        }
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      if (idsToRemove.has(list[i].id)) {
        list.splice(i, 1);
      }
    }
  };

  // Optional online visa departures (untouched in local mode)
  if (input.forcedEmigrateIds && input.forcedEmigrateIds.size > 0) {
    removeCitizensById(new Set(input.forcedEmigrateIds), true);
  }

  // Optional online visa arrivals (untouched in local mode)
  if (input.visaArrivals && input.visaArrivals.length > 0) {
    const clampVisaAttr = (v: number): number =>
      Math.max(1, Math.min(100, Number.isFinite(v) ? Math.round(v) : 50));
    for (const arrival of input.visaArrivals) {
      if (list.length >= target) break;
      const id = nextId++;
      const hhId = nextHouseholdId++;
      const safeAge = Math.max(
        14,
        Math.min(85, Number.isFinite(arrival.ageMonths) ? Math.trunc(arrival.ageMonths) : 24)
      );
      const arrivalBirthMonth = totalMonths - safeAge;
      list.push({
        id,
        name: arrival.name,
        gender: arrival.gender === 'f' ? 'f' : 'm',
        birthMonth: arrivalBirthMonth,
        householdId: hhId,
        homeCubeId: null,
        spouseId: null,
        parentIds: null,
        jobCubeId: null,
        jobSlot: null,
        jobThemeId: null,
        wealth: Math.max(0, Math.floor(Number.isFinite(arrival.wealth) ? arrival.wealth : 0)),
        attrs: {
          physical: clampVisaAttr(arrival.attributes.physical),
          professional: clampVisaAttr(arrival.attributes.professional),
          social: clampVisaAttr(arrival.attributes.social),
          health: clampVisaAttr(arrival.attributes.health),
          intelligence: clampVisaAttr(arrival.attributes.intelligence),
        },
        traits: generateTraits(id, arrivalBirthMonth),
        cvFiled: true,
        cvFiledMonth: totalMonths,
        housingRequestMonth: totalMonths,
        marriedMonth: null,
        lastVisaMonth: Math.min(totalMonths, Math.trunc(arrival.lastVisaMonth)),
      });
      cvsFiledCount += 1;
    }
  }

  // GROWTH: prefer births when an eligible married housed couple exists; else arrivals
  while (list.length < target) {
    const rem = target - list.length;
    const birthCouple = findEligibleBirthCouple(list, totalMonths);

    if (birthCouple) {
      const id = nextId++;
      const gender: 'm' | 'f' = rng() < 0.5 ? 'm' : 'f';
      const name = pickCitizenName(gender, id * 13 + totalMonths * 3);
      const child: Citizen = {
        id,
        name,
        gender,
        birthMonth: totalMonths,
        householdId: birthCouple.mother.householdId,
        homeCubeId: birthCouple.mother.homeCubeId,
        spouseId: null,
        parentIds: [birthCouple.father.id, birthCouple.mother.id],
        jobCubeId: null,
        jobSlot: null,
        jobThemeId: null,
        wealth: 0,
        attrs: inheritAttrs(birthCouple.father.attrs, birthCouple.mother.attrs, rng),
        traits: inheritTraits(
          id,
          totalMonths,
          birthCouple.mother,
          birthCouple.father
        ),
        cvFiled: false,
        cvFiledMonth: null,
        housingRequestMonth: null,
        marriedMonth: null,
      };
      list.push(child);
      birthsCount += 1;
      policeRecords.push(
        createPoliceRecord(
          totalMonths,
          'birth',
          `ولادة ${child.name} لأسرة ${birthCouple.father.name} و${birthCouple.mother.name}`,
          [child.id, birthCouple.father.id, birthCouple.mother.id]
        )
      );
      continue;
    }

    // Arrivals: 60% single adult (18-40), 30% couple, 10% couple + child (1-6)
    const roll = rng();
    const hhId = nextHouseholdId++;

    if (rem >= 3 && roll >= 0.9) {
      // Couple + 1 child (1-6)
      const fId = nextId++;
      const mId = nextId++;
      const cId = nextId++;
      const fAge = 22 + Math.floor(rng() * 17);
      const mAge = 20 + Math.floor(rng() * 17);
      const cAge = 1 + Math.floor(rng() * 6);
      const fAttrs = generateBellAttrs(rng);
      const mAttrs = generateBellAttrs(rng);
      const cGender: 'm' | 'f' = rng() < 0.5 ? 'm' : 'f';

      const fBirth = totalMonths - fAge;
      const mBirth = totalMonths - mAge;
      const cBirth = totalMonths - cAge;
      const fTraits = generateTraits(fId, fBirth);
      const mTraits = generateTraits(mId, mBirth);

      list.push(
        {
          id: fId,
          name: pickCitizenName('m', fId * 7 + totalMonths),
          gender: 'm',
          birthMonth: fBirth,
          householdId: hhId,
          homeCubeId: null,
          spouseId: mId,
          parentIds: null,
          jobCubeId: null,
          jobSlot: null,
          jobThemeId: null,
          wealth: 0,
          attrs: fAttrs,
          traits: fTraits,
          cvFiled: true,
          cvFiledMonth: totalMonths,
          housingRequestMonth: totalMonths,
          marriedMonth: totalMonths - 1,
        },
        {
          id: mId,
          name: pickCitizenName('f', mId * 7 + totalMonths),
          gender: 'f',
          birthMonth: mBirth,
          householdId: hhId,
          homeCubeId: null,
          spouseId: fId,
          parentIds: null,
          jobCubeId: null,
          jobSlot: null,
          jobThemeId: null,
          wealth: 0,
          attrs: mAttrs,
          traits: mTraits,
          cvFiled: true,
          cvFiledMonth: totalMonths,
          housingRequestMonth: null,
          marriedMonth: totalMonths - 1,
        },
        {
          id: cId,
          name: pickCitizenName(cGender, cId * 7 + totalMonths),
          gender: cGender,
          birthMonth: cBirth,
          householdId: hhId,
          homeCubeId: null,
          spouseId: null,
          parentIds: [fId, mId],
          jobCubeId: null,
          jobSlot: null,
          jobThemeId: null,
          wealth: 0,
          attrs: inheritAttrs(fAttrs, mAttrs, rng),
          traits: inheritTraits(cId, cBirth, mTraits, fTraits),
          cvFiled: false,
          cvFiledMonth: null,
          housingRequestMonth: null,
          marriedMonth: null,
        }
      );
      cvsFiledCount += 2;
    } else if (rem >= 2 && roll >= 0.6) {
      // Couple (18-40)
      const fId = nextId++;
      const mId = nextId++;
      const fAge = 18 + Math.floor(rng() * 23);
      const mAge = 18 + Math.floor(rng() * 23);
      const fBirth = totalMonths - fAge;
      const mBirth = totalMonths - mAge;
      list.push(
        {
          id: fId,
          name: pickCitizenName('m', fId * 11 + totalMonths),
          gender: 'm',
          birthMonth: fBirth,
          householdId: hhId,
          homeCubeId: null,
          spouseId: mId,
          parentIds: null,
          jobCubeId: null,
          jobSlot: null,
          jobThemeId: null,
          wealth: 0,
          attrs: generateBellAttrs(rng),
          traits: generateTraits(fId, fBirth),
          cvFiled: true,
          cvFiledMonth: totalMonths,
          housingRequestMonth: totalMonths,
          marriedMonth: totalMonths - 1,
        },
        {
          id: mId,
          name: pickCitizenName('f', mId * 11 + totalMonths),
          gender: 'f',
          birthMonth: mBirth,
          householdId: hhId,
          homeCubeId: null,
          spouseId: fId,
          parentIds: null,
          jobCubeId: null,
          jobSlot: null,
          jobThemeId: null,
          wealth: 0,
          attrs: generateBellAttrs(rng),
          traits: generateTraits(mId, mBirth),
          cvFiled: true,
          cvFiledMonth: totalMonths,
          housingRequestMonth: null,
          marriedMonth: totalMonths - 1,
        }
      );
      cvsFiledCount += 2;
    } else {
      // Single adult (18-40)
      const id = nextId++;
      const gender: 'm' | 'f' = rng() < 0.5 ? 'm' : 'f';
      const age = 18 + Math.floor(rng() * 23);
      const birthMonth = totalMonths - age;
      list.push({
        id,
        name: pickCitizenName(gender, id * 17 + totalMonths),
        gender,
        birthMonth,
        householdId: hhId,
        homeCubeId: null,
        spouseId: null,
        parentIds: null,
        jobCubeId: null,
        jobSlot: null,
        jobThemeId: null,
        wealth: 0,
        attrs: generateBellAttrs(rng),
        traits: generateTraits(id, birthMonth),
        cvFiled: true,
        cvFiledMonth: totalMonths,
        housingRequestMonth: totalMonths,
        marriedMonth: null,
      });
      cvsFiledCount += 1;
    }
  }

  // EMIGRATION: unemployed single adults first, then oldest singles; child < 14 never leaves alone
  while (list.length > target) {
    const rem = list.length - target;

    const hhMembers = new Map<number, Citizen[]>();
    for (const c of list) {
      const arr = hhMembers.get(c.householdId);
      if (arr) arr.push(c);
      else hhMembers.set(c.householdId, [c]);
    }

    const householdHasYoungChild = (hhId: number): boolean =>
      (hhMembers.get(hhId) ?? []).some((m) => ageYears(m, totalMonths) < 14);

    const householdAdultCount = (hhId: number): number =>
      (hhMembers.get(hhId) ?? []).filter((m) => ageYears(m, totalMonths) >= 14).length;

    // Priority 1: Unemployed single adults (14+) whose exit won't strand a child < 14 alone
    const unemployedSingles = list
      .filter(
        (c) =>
          ageYears(c, totalMonths) >= 14 &&
          c.spouseId === null &&
          c.jobCubeId === null &&
          (!householdHasYoungChild(c.householdId) ||
            householdAdultCount(c.householdId) > 1)
      )
      .sort((a, b) => {
        const ageDiff = ageYears(b, totalMonths) - ageYears(a, totalMonths);
        return ageDiff !== 0 ? ageDiff : b.id - a.id;
      });

    if (unemployedSingles.length > 0) {
      removeCitizensById(new Set([unemployedSingles[0].id]));
      continue;
    }

    // Priority 2: Oldest single adults (14+) whose exit won't strand a child < 14 alone
    const otherSingles = list
      .filter(
        (c) =>
          ageYears(c, totalMonths) >= 14 &&
          c.spouseId === null &&
          (!householdHasYoungChild(c.householdId) ||
            householdAdultCount(c.householdId) > 1)
      )
      .sort((a, b) => {
        const ageDiff = ageYears(b, totalMonths) - ageYears(a, totalMonths);
        return ageDiff !== 0 ? ageDiff : b.id - a.id;
      });

    if (otherSingles.length > 0) {
      removeCitizensById(new Set([otherSingles[0].id]));
      continue;
    }

    // Priority 3: Whole households that fit within remaining delta (child < 14 leaves WITH household)
    const eligibleHouseholds = Array.from(hhMembers.entries())
      .filter(([, members]) => members.length <= rem)
      .sort((a, b) => {
        // Prefer unemployed households, then smaller households, then lower householdId
        const aEmployed = a[1].filter((m) => m.jobCubeId !== null).length;
        const bEmployed = b[1].filter((m) => m.jobCubeId !== null).length;
        if (aEmployed !== bEmployed) return aEmployed - bEmployed;
        if (a[1].length !== b[1].length) return a[1].length - b[1].length;
        return a[0] - b[0];
      });

    if (eligibleHouseholds.length > 0) {
      const ids = new Set(eligibleHouseholds[0][1].map((m) => m.id));
      removeCitizensById(ids);
      continue;
    }

    // Priority 4: A married adult from a household with >1 adult (other parent remains with any child < 14)
    const marriedAdultsSafe = list
      .filter(
        (c) =>
          ageYears(c, totalMonths) >= 14 &&
          c.spouseId !== null &&
          (!householdHasYoungChild(c.householdId) ||
            householdAdultCount(c.householdId) > 1)
      )
      .sort((a, b) => {
        const aEmp = a.jobCubeId !== null ? 1 : 0;
        const bEmp = b.jobCubeId !== null ? 1 : 0;
        if (aEmp !== bEmp) return aEmp - bEmp;
        const ageDiff = ageYears(b, totalMonths) - ageYears(a, totalMonths);
        return ageDiff !== 0 ? ageDiff : b.id - a.id;
      });

    if (marriedAdultsSafe.length > 0) {
      removeCitizensById(new Set([marriedAdultsSafe[0].id]));
      continue;
    }

    // Priority 5 (extreme safety fallback so reconcile can never stall if target < smallest household):
    const fallback = [...list].sort((a, b) => {
      const ageDiff = ageYears(b, totalMonths) - ageYears(a, totalMonths);
      return ageDiff !== 0 ? ageDiff : b.id - a.id;
    })[0];
    removeCitizensById(new Set([fallback.id]));
  }

  // Keep citizenWealth strictly equal to sum of citizens' wealth after reconciliation
  nextCitizenWealth = sumCitizenWealth(list);

  return {
    citizens: list,
    nextCitizenId: nextId,
    citizenWealth: nextCitizenWealth,
    policeRecords,
    birthsCount,
    cvsFiledCount,
    localEmigratedWealth,
  };
}

// Hardening 1: Clamp & self-heal any loaded/tampered citizen array on hydrate
export function sanitizeCitizensOnHydrate(
  rawCitizens: Citizen[] | undefined,
  totalMonths: number,
  cubes: Cube[],
  targetPopulation: number,
  savedCitizenWealth: number,
  policeRecords: PoliceRecord[]
): {
  citizens: Citizen[];
  nextCitizenId: number;
  citizenWealth: number;
  policeRecords: PoliceRecord[];
} {
  const safeTotalMonths = Math.max(0, Math.trunc(totalMonths));
  const safeTargetPop = Math.max(0, Math.floor(targetPopulation));
  const safeSavedWealth = Math.max(0, Math.floor(savedCitizenWealth));
  const cleanPoliceRecords = sanitizePoliceRecordsOnHydrate(policeRecords);

  if (!Array.isArray(rawCitizens) || rawCitizens.length === 0) {
    const gen = generateInitialCitizens(
      cubes,
      safeTargetPop,
      safeTotalMonths,
      safeSavedWealth
    );
    return {
      citizens: gen.citizens,
      nextCitizenId: gen.nextCitizenId,
      citizenWealth: sumCitizenWealth(gen.citizens),
      policeRecords: cleanPoliceRecords,
    };
  }

  const ownedHouseCubeIds = new Set(getOwnedHouseUnits(cubes).map((u) => u.cubeId));
  const usedIds = new Set<number>();
  let maxId = 0;

  // First pass: find max valid integer id so regenerated duplicates never collide
  for (const raw of rawCitizens) {
    if (
      raw &&
      typeof raw.id === 'number' &&
      Number.isFinite(raw.id) &&
      raw.id >= 1
    ) {
      maxId = Math.max(maxId, Math.floor(raw.id));
    }
  }

  const clampStat = (v: unknown): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 50;
    return Math.max(0, Math.min(100, n));
  };

  const occupiedJobCounts = new Map<string, number>();
  const sanitized: Citizen[] = [];

  for (let i = 0; i < rawCitizens.length; i++) {
    const raw = rawCitizens[i];
    if (!raw || typeof raw !== 'object') continue;

    let id =
      typeof raw.id === 'number' && Number.isFinite(raw.id) && raw.id >= 1
        ? Math.floor(raw.id)
        : ++maxId;
    if (usedIds.has(id)) {
      id = ++maxId;
    }
    usedIds.add(id);
    if (id > maxId) maxId = id;

    const gender: 'm' | 'f' = raw.gender === 'f' ? 'f' : 'm';
    const rawBirth =
      typeof raw.birthMonth === 'number' && Number.isFinite(raw.birthMonth)
        ? Math.trunc(raw.birthMonth)
        : safeTotalMonths - 22;
    const birthMonth = Math.min(safeTotalMonths, rawBirth);
    const householdId =
      typeof raw.householdId === 'number' &&
      Number.isFinite(raw.householdId) &&
      raw.householdId >= 1
        ? Math.floor(raw.householdId)
        : i + 1;

    const homeCubeId =
      typeof raw.homeCubeId === 'number' && ownedHouseCubeIds.has(raw.homeCubeId)
        ? raw.homeCubeId
        : null;

    let jobCubeId: number | null = null;
    let jobSlot: SlotIndex | null = null;
    let jobThemeId: ThemeId | null = null;
    let employerId: number | null = null;
    if (
      typeof raw.jobCubeId === 'number' &&
      typeof raw.jobThemeId === 'string' &&
      raw.jobThemeId in THEMES
    ) {
      const cube = cubes[raw.jobCubeId];
      const tId = raw.jobThemeId as ThemeId;
      if (cube && cube.owner === 'player' && THEMES[tId].workers > 0) {
        const isPrivateCube = typeof cube.privateOwnerId === 'number';
        const candidateSlot: SlotIndex | null = isPrivateCube
          ? cube.themeId === tId
            ? 0
            : null
          : raw.jobSlot === 1 && cube.secondThemeId === tId
            ? 1
            : cube.themeId === tId
              ? 0
              : cube.secondThemeId === tId
                ? 1
                : null;
        if (candidateSlot !== null) {
          const jKey = `${cube.id}:${candidateSlot}`;
          const prevCount = occupiedJobCounts.get(jKey) ?? 0;
          const maxHolders = isPrivateCube ? THEMES[tId].workers : 1;
          const validPrivateHolder =
            !isPrivateCube ||
            (raw.employerId === cube.privateOwnerId && id !== cube.privateOwnerId);
          if (validPrivateHolder && prevCount < maxHolders) {
            occupiedJobCounts.set(jKey, prevCount + 1);
            jobCubeId = cube.id;
            jobSlot = candidateSlot;
            jobThemeId = tId;
            employerId = isPrivateCube ? (cube.privateOwnerId as number) : null;
          }
        }
      }
    }

    const wealth =
      typeof raw.wealth === 'number' && Number.isFinite(raw.wealth)
        ? Math.max(0, Math.floor(raw.wealth))
        : 0;

    const rawAttrs = raw.attrs ?? ({} as Partial<CitizenAttrs>);
    const attrs: CitizenAttrs = {
      physical: clampStat(rawAttrs.physical),
      professional: clampStat(rawAttrs.professional),
      social: clampStat(rawAttrs.social),
      health: clampStat(rawAttrs.health),
      intelligence: clampStat(rawAttrs.intelligence),
    };

    const age = safeTotalMonths - birthMonth;
    const cvFiled = Boolean(raw.cvFiled) || age >= 14;
    const cvFiledMonth = cvFiled
      ? typeof raw.cvFiledMonth === 'number' && Number.isFinite(raw.cvFiledMonth)
        ? Math.min(safeTotalMonths, Math.trunc(raw.cvFiledMonth))
        : safeTotalMonths
      : null;

    const housingRequestMonth =
      typeof raw.housingRequestMonth === 'number' &&
      Number.isFinite(raw.housingRequestMonth)
        ? Math.min(safeTotalMonths, Math.trunc(raw.housingRequestMonth))
        : null;

    const marriedMonth =
      typeof raw.marriedMonth === 'number' && Number.isFinite(raw.marriedMonth)
        ? Math.min(safeTotalMonths, Math.trunc(raw.marriedMonth))
        : null;

    const parentIds: [number, number] | null =
      Array.isArray(raw.parentIds) &&
      raw.parentIds.length === 2 &&
      typeof raw.parentIds[0] === 'number' &&
      typeof raw.parentIds[1] === 'number'
        ? [Math.floor(raw.parentIds[0]), Math.floor(raw.parentIds[1])]
        : null;

    const deniedLandMonth =
      typeof raw.deniedLandMonth === 'number' &&
      Number.isFinite(raw.deniedLandMonth)
        ? Math.min(safeTotalMonths, Math.trunc(raw.deniedLandMonth))
        : null;

    const lastVisaMonth =
      typeof raw.lastVisaMonth === 'number' && Number.isFinite(raw.lastVisaMonth)
        ? Math.min(safeTotalMonths, Math.trunc(raw.lastVisaMonth))
        : null;

    const prayerBuffUntil =
      typeof raw.prayerBuffUntil === 'number' &&
      Number.isFinite(raw.prayerBuffUntil)
        ? Math.max(0, Math.floor(raw.prayerBuffUntil))
        : 0;

    sanitized.push({
      id,
      name:
        typeof raw.name === 'string' && raw.name.trim().length > 0
          ? raw.name.trim()
          : pickCitizenName(gender, id * 7),
      gender,
      birthMonth,
      householdId,
      homeCubeId,
      spouseId:
        typeof raw.spouseId === 'number' && Number.isFinite(raw.spouseId)
          ? Math.floor(raw.spouseId)
          : null,
      parentIds,
      jobCubeId,
      jobSlot,
      jobThemeId,
      employerId,
      deniedLandMonth,
      lastVisaMonth,
      prayerBuffUntil,
      wealth,
      attrs,
      traits: sanitizeTraitsOnHydrate(raw.traits, id, birthMonth),
      cvFiled,
      cvFiledMonth,
      housingRequestMonth,
      marriedMonth,
    });
  }

  // Enforce symmetric spouseId (no self-marriage, no dangling or one-way links)
  // and unify householdId/homeCubeId if a tampered save split spouses across households
  const byId = new Map<number, Citizen>();
  for (const c of sanitized) byId.set(c.id, c);
  for (const c of sanitized) {
    if (c.spouseId === null) continue;
    const spouse = byId.get(c.spouseId);
    if (!spouse || spouse.id === c.id || spouse.spouseId !== c.id) {
      c.spouseId = null;
      c.marriedMonth = null;
    } else if (c.id < spouse.id) {
      spouse.householdId = c.householdId;
      const sharedHome = c.homeCubeId ?? spouse.homeCubeId;
      c.homeCubeId = sharedHome;
      spouse.homeCubeId = sharedHome;
    }
  }

  // Reconcile length to match targetPopulation
  const reconciled = reconcileCitizens({
    citizens: sanitized,
    nextCitizenId: maxId + 1,
    population: safeTargetPop,
    totalMonths: safeTotalMonths,
    citizenWealth: sumCitizenWealth(sanitized),
    policeRecords: cleanPoliceRecords,
  });

  // If old wealth existed on save while individual wealths were all 0, distribute it
  if (reconciled.citizenWealth === 0 && safeSavedWealth > 0 && reconciled.citizens.length > 0) {
    distributeWealth(reconciled.citizens, safeSavedWealth);
    reconciled.citizenWealth = sumCitizenWealth(reconciled.citizens);
  }

  return {
    citizens: reconciled.citizens,
    nextCitizenId: reconciled.nextCitizenId,
    citizenWealth: reconciled.citizenWealth,
    policeRecords: reconciled.policeRecords,
  };
}
