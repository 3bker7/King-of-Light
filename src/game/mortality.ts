import { ageYears, createPoliceRecord, sumCitizenWealth } from './citizens';
import { transferGold, type GoldStateSlice } from './goldLedger';
import type {
  Citizen,
  DeceasedCause,
  DeceasedRecord,
  LedgerEntry,
  OfficeFax,
  PalaceOfPeople,
  PeoplesBank,
  PoliceRecord,
} from './types';

export const MAX_ETERNAL_RECORD_ENTRIES = 1000;

export const DEATH_CAUSE_LABELS_AR: Record<DeceasedCause, string> = {
  old_age: 'تقدّم في السن',
  health: 'تدهور الصحة',
};

const VALID_DECEASED_CAUSES: ReadonlySet<string> = new Set<DeceasedCause>([
  'old_age',
  'health',
]);

/**
 * Element 1 Hardening: Freezes a DeceasedRecord so it is strictly append-only
 * and can never be mutated after creation.
 */
export function freezeDeceasedRecord(record: DeceasedRecord): DeceasedRecord {
  const frozenParents = Object.freeze([...record.parentIds]);
  return Object.freeze({
    ...record,
    parentIds: frozenParents,
  });
}

/**
 * Element 1 Hardening: Entry-by-entry sanitizer for eternalRecord on hydrate.
 * Rejects malformed shapes, negative ages, unknown causes, duplicate citizenIds,
 * and trims oldest entries beyond MAX_ETERNAL_RECORD_ENTRIES (1000).
 */
export function sanitizeEternalRecordOnHydrate(
  raw: unknown
): DeceasedRecord[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const seenCitizenIds = new Set<number>();
  const clean: DeceasedRecord[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    if (
      typeof rec.citizenId !== 'number' ||
      !Number.isFinite(rec.citizenId) ||
      Math.trunc(rec.citizenId) < 1
    ) {
      continue;
    }
    const citizenId = Math.trunc(rec.citizenId);
    if (seenCitizenIds.has(citizenId)) continue;

    if (typeof rec.name !== 'string' || rec.name.trim().length === 0) {
      continue;
    }
    const name = rec.name.trim();

    if (rec.gender !== 'm' && rec.gender !== 'f') {
      continue;
    }
    const gender = rec.gender;

    if (typeof rec.birthMonth !== 'number' || !Number.isFinite(rec.birthMonth)) {
      continue;
    }
    const birthMonth = Math.trunc(rec.birthMonth);

    if (
      typeof rec.deathMonth !== 'number' ||
      !Number.isFinite(rec.deathMonth) ||
      Math.trunc(rec.deathMonth) < 0
    ) {
      continue;
    }
    const deathMonth = Math.trunc(rec.deathMonth);

    if (
      typeof rec.ageAtDeath !== 'number' ||
      !Number.isFinite(rec.ageAtDeath) ||
      rec.ageAtDeath < 0
    ) {
      continue;
    }
    const ageAtDeath = Math.trunc(rec.ageAtDeath);

    if (typeof rec.cause !== 'string' || !VALID_DECEASED_CAUSES.has(rec.cause)) {
      continue;
    }
    const cause = rec.cause as DeceasedCause;

    const lastJobThemeId =
      typeof rec.lastJobThemeId === 'string' && rec.lastJobThemeId.trim().length > 0
        ? rec.lastJobThemeId.trim()
        : null;

    const homeCubeId =
      typeof rec.homeCubeId === 'number' &&
      Number.isFinite(rec.homeCubeId) &&
      Math.trunc(rec.homeCubeId) >= 0
        ? Math.trunc(rec.homeCubeId)
        : null;

    const spouseId =
      typeof rec.spouseId === 'number' &&
      Number.isFinite(rec.spouseId) &&
      Math.trunc(rec.spouseId) >= 1 &&
      Math.trunc(rec.spouseId) !== citizenId
        ? Math.trunc(rec.spouseId)
        : null;

    const parentIds: number[] = [];
    if (Array.isArray(rec.parentIds)) {
      for (const pid of rec.parentIds) {
        if (
          typeof pid === 'number' &&
          Number.isFinite(pid) &&
          Math.trunc(pid) >= 1 &&
          Math.trunc(pid) !== citizenId &&
          !parentIds.includes(Math.trunc(pid))
        ) {
          parentIds.push(Math.trunc(pid));
          if (parentIds.length >= 2) break;
        }
      }
    }

    const childrenCount =
      typeof rec.childrenCount === 'number' &&
      Number.isFinite(rec.childrenCount) &&
      rec.childrenCount >= 0
        ? Math.trunc(rec.childrenCount)
        : 0;

    const monthsWorked =
      typeof rec.monthsWorked === 'number' &&
      Number.isFinite(rec.monthsWorked) &&
      rec.monthsWorked >= 0
        ? Math.trunc(rec.monthsWorked)
        : 0;

    const estateAmount =
      typeof rec.estateAmount === 'number' &&
      Number.isFinite(rec.estateAmount) &&
      rec.estateAmount >= 0
        ? Math.floor(rec.estateAmount)
        : 0;

    const wasMarried = Boolean(rec.wasMarried);

    seenCitizenIds.add(citizenId);
    clean.push(
      freezeDeceasedRecord({
        citizenId,
        name,
        gender,
        birthMonth,
        deathMonth,
        ageAtDeath,
        cause,
        lastJobThemeId,
        homeCubeId,
        spouseId,
        parentIds,
        childrenCount,
        monthsWorked,
        estateAmount,
        wasMarried,
      })
    );
  }

  return clean.length > MAX_ETERNAL_RECORD_ENTRIES
    ? clean.slice(clean.length - MAX_ETERNAL_RECORD_ENTRIES)
    : clean;
}

/**
 * Element 1 Hardening: Sanitizes PalaceOfPeople on hydrate, clamping heldEstates
 * strictly to [0, palace.gold] since heldEstates is a sub-accounting of palace.gold.
 */
export function sanitizePalaceOfPeopleOnHydrate(
  raw: Partial<PalaceOfPeople> | undefined | null,
  defaultGold: number
): PalaceOfPeople {
  const safeDefault = Math.max(0, Math.floor(defaultGold));
  if (!raw || typeof raw !== 'object') {
    return { gold: safeDefault, heldEstates: 0 };
  }
  const gold =
    typeof raw.gold === 'number' && Number.isFinite(raw.gold)
      ? Math.max(0, Math.floor(raw.gold))
      : safeDefault;
  const rawHeld =
    typeof raw.heldEstates === 'number' && Number.isFinite(raw.heldEstates)
      ? Math.floor(raw.heldEstates)
      : 0;
  const heldEstates = Math.max(0, Math.min(gold, rawHeld));

  const out: PalaceOfPeople = { gold, heldEstates };
  if (
    typeof raw.totalSinksCollected === 'number' &&
    Number.isFinite(raw.totalSinksCollected) &&
    raw.totalSinksCollected >= 0
  ) {
    out.totalSinksCollected = Math.floor(raw.totalSinksCollected);
  }
  return out;
}

/**
 * LOCKED MORTALITY TABLE (V5 Prompt 4):
 * - age < 50: 0 (unless health < 15, then 0.004)
 * - 50-59: 0.002
 * - 60-69: 0.006
 * - 70-79: 0.015
 * - 80-89: 0.040
 * - 90+:   0.100
 * Health modifier on the age >= 50 band probability:
 * - health >= 70 -> x0.7
 * - health < 30  -> x1.8
 */
export function monthlyDeathProbability(age: number, health: number): number {
  const safeAge = Number.isFinite(age) ? age : 0;
  const safeHealth = Number.isFinite(health) ? health : 50;

  if (safeAge < 50) {
    return safeHealth < 15 ? 0.004 : 0;
  }

  let base: number;
  if (safeAge < 60) {
    base = 0.002;
  } else if (safeAge < 70) {
    base = 0.006;
  } else if (safeAge < 80) {
    base = 0.015;
  } else if (safeAge < 90) {
    base = 0.040;
  } else {
    base = 0.100;
  }

  if (safeHealth >= 70) {
    base *= 0.7;
  } else if (safeHealth < 30) {
    base *= 1.8;
  }

  return Math.max(0, Math.min(1, base));
}

/**
 * Element 2: Rolls a single citizen for monthly mortality using the locked table.
 * Returns 'old_age' | 'health' | null.
 * Guaranteed: age < 50 with health >= 15 NEVER dies (even if rng() === 0).
 */
export function monthlyDeathRoll(
  citizen: Pick<Citizen, 'birthMonth' | 'attrs'>,
  totalMonths: number,
  rng: () => number = Math.random
): DeceasedCause | null {
  const age = Math.max(0, ageYears(citizen, totalMonths));
  const health = Number.isFinite(citizen.attrs?.health) ? citizen.attrs.health : 50;
  const prob = monthlyDeathProbability(age, health);

  if (prob <= 0) {
    return null;
  }

  const roll = rng();
  if (!Number.isFinite(roll) || roll < 0 || roll >= prob) {
    return null;
  }

  // Cause discipline:
  // 'health' when under 50 via health<15 rule, OR when health < 15 at any age and roll kills;
  // 'old_age' when band roll kills at age >= 50 with health >= 15.
  if (age < 50 || health < 15) {
    return 'health';
  }
  return 'old_age';
}

export interface MortalityStateSlice {
  citizens: Citizen[];
  population: number;
  totalMonths: number;
  day: number;
  gold: number;
  citizenWealth: number;
  palaceOfPeople: PalaceOfPeople;
  peoplesBank: PeoplesBank;
  ledger: LedgerEntry[];
  policeRecords: PoliceRecord[];
  officeFaxes: OfficeFax[];
  eternalRecord: DeceasedRecord[];
  lastDeathMonth?: number;
}

export interface ProcessDeathsResult<S extends MortalityStateSlice> {
  state: S;
  deaths: DeceasedRecord[];
  bereavedSpouseIds: number[];
  newFaxes: OfficeFax[];
}

function countAllChildren(
  citizenId: number,
  livingCitizens: readonly Citizen[],
  eternalRecord: readonly DeceasedRecord[]
): number {
  const childIds = new Set<number>();
  for (let i = 0; i < livingCitizens.length; i++) {
    const c = livingCitizens[i];
    if (c.parentIds && (c.parentIds[0] === citizenId || c.parentIds[1] === citizenId)) {
      childIds.add(c.id);
    }
  }
  for (let i = 0; i < eternalRecord.length; i++) {
    const rec = eternalRecord[i];
    if (rec.parentIds.includes(citizenId)) {
      childIds.add(rec.citizenId);
    }
  }
  return childIds.size;
}

export function formatDeathsNoticeAr(deaths: readonly DeceasedRecord[]): string {
  const count = deaths.length;
  if (count === 0) return '';
  const shown = deaths.slice(0, 5).map((d) => d.name);
  const extra = count - shown.length;
  const namesText =
    extra > 0 ? `${shown.join('، ')} +${extra} آخرون` : shown.join('، ');
  if (count === 1) {
    return `وفاة مواطن هذا الشهر: ${namesText}.`;
  }
  return `سُجّلت ${count} وفيات هذا الشهر: ${namesText}.`;
}

function pickBestGuardian(candidates: Citizen[]): Citizen | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const aHoused = a.homeCubeId !== null ? 0 : 1;
    const bHoused = b.homeCubeId !== null ? 0 : 1;
    if (aHoused !== bHoused) return aHoused - bHoused;
    return a.id - b.id;
  });
  return sorted[0];
}

function shareAnyParent(
  a: readonly number[] | null | undefined,
  b: readonly number[] | null | undefined
): boolean {
  if (!a || !b || a.length === 0 || b.length === 0) return false;
  for (let i = 0; i < a.length; i++) {
    if (b.includes(a[i])) return true;
  }
  return false;
}

/**
 * Elements 2 & 3: Rolls all living citizens for mortality for `state.totalMonths`,
 * transfers each deceased citizen's wealth to Palace heldEstates via `transferGold`
 * BEFORE removal, releases jobs via registry removal, clears bereaved spouses'
 * spouseId (returning bereavedSpouseIds for same-month re-marriage guard),
 * places orphaned under-14 children with adult siblings/relatives or flags an
 * orphan household registry fax while keeping them in their home, appends
 * DeceasedRecord + PoliceRecord('death') + registry death summary fax, and
 * decrements population by deaths.length so citizens.length === population holds.
 *
 * Strictly idempotent per month via `lastDeathMonth` and eternalRecord membership.
 */
export function processDeaths<S extends MortalityStateSlice>(
  state: S,
  rng: () => number = Math.random
): ProcessDeathsResult<S> {
  const totalMonths = Math.max(0, Math.trunc(state.totalMonths));

  // Idempotency guard: never roll deaths twice for the same month
  if (state.lastDeathMonth === totalMonths) {
    return {
      state,
      deaths: [],
      bereavedSpouseIds: [],
      newFaxes: [],
    };
  }

  const existingRecord = Array.isArray(state.eternalRecord)
    ? state.eternalRecord
    : [];
  const alreadyDeceasedIds = new Set<number>(
    existingRecord.map((r) => r.citizenId)
  );
  const marriedInEternal = new Set<number>();
  const eternalById = new Map<number, DeceasedRecord>();
  for (let i = 0; i < existingRecord.length; i++) {
    const rec = existingRecord[i];
    eternalById.set(rec.citizenId, rec);
    if (rec.spouseId !== null) marriedInEternal.add(rec.spouseId);
  }

  const rolledDead: Array<{ citizen: Citizen; cause: DeceasedCause }> = [];
  const deadIdSet = new Set<number>();

  for (let i = 0; i < state.citizens.length; i++) {
    const c = state.citizens[i];
    if (alreadyDeceasedIds.has(c.id)) continue;
    const cause = monthlyDeathRoll(c, totalMonths, rng);
    if (cause !== null) {
      rolledDead.push({ citizen: c, cause });
      deadIdSet.add(c.id);
    }
  }

  if (rolledDead.length === 0) {
    return {
      state: {
        ...state,
        lastDeathMonth: totalMonths,
      },
      deaths: [],
      bereavedSpouseIds: [],
      newFaxes: [],
    };
  }

  // Clone citizens before estate transfers & consequences
  const workingCitizens: Citizen[] = state.citizens.map((c) => ({
    ...c,
    attrs: { ...c.attrs },
    parentIds: c.parentIds
      ? ([c.parentIds[0], c.parentIds[1]] as [number, number])
      : null,
  }));

  // Index pre-death citizens by id for grandparent/relative parentIds lookup
  const preDeathById = new Map<number, Citizen>();
  for (let i = 0; i < workingCitizens.length; i++) {
    preDeathById.set(workingCitizens[i].id, workingCitizens[i]);
  }

  // Element 3 Estate: sequence transferGold('citizens' -> 'palace', citizenId = deceased)
  // WHILE the deceased citizen record still exists in goldSlice.citizens!
  let goldSlice: GoldStateSlice = {
    gold: Math.max(0, Math.floor(state.gold)),
    citizens: workingCitizens,
    citizenWealth: sumCitizenWealth(workingCitizens),
    palaceOfPeople: {
      ...state.palaceOfPeople,
      gold: Math.max(0, Math.floor(state.palaceOfPeople.gold)),
      heldEstates: Math.max(0, Math.floor(state.palaceOfPeople.heldEstates ?? 0)),
    },
    peoplesBank: state.peoplesBank,
    ledger: state.ledger,
    day: state.day,
  };

  const newDeaths: DeceasedRecord[] = [];
  const newPoliceRecords: PoliceRecord[] = [...state.policeRecords];

  for (let i = 0; i < rolledDead.length; i++) {
    const { citizen, cause } = rolledDead[i];
    const wealth = Math.max(0, Math.floor(citizen.wealth));
    let movedEstate = 0;

    if (wealth > 0) {
      const tx = transferGold(goldSlice, {
        from: 'citizens',
        to: 'palace',
        citizenId: citizen.id,
        amount: wealth,
        kind: 'gift',
        labelAr: `أمانة تركة — ${citizen.name}`,
        exact: true,
        day: state.day,
      });
      if (tx.ok && tx.moved > 0) {
        movedEstate = tx.moved;
        goldSlice = {
          ...tx.state,
          palaceOfPeople: {
            ...tx.state.palaceOfPeople,
            heldEstates:
              Math.max(0, Math.floor(tx.state.palaceOfPeople.heldEstates ?? 0)) +
              movedEstate,
          },
        };
      }
    }

    const ageAtDeath = Math.max(0, ageYears(citizen, totalMonths));
    const childrenCount = countAllChildren(
      citizen.id,
      state.citizens,
      existingRecord
    );
    const parentIds = citizen.parentIds
      ? [citizen.parentIds[0], citizen.parentIds[1]]
      : [];
    const wasMarried =
      citizen.spouseId !== null ||
      (typeof citizen.marriedMonth === 'number' &&
        Number.isFinite(citizen.marriedMonth)) ||
      marriedInEternal.has(citizen.id);

    const record = freezeDeceasedRecord({
      citizenId: citizen.id,
      name: citizen.name,
      gender: citizen.gender,
      birthMonth: citizen.birthMonth,
      deathMonth: totalMonths,
      ageAtDeath,
      cause,
      lastJobThemeId: citizen.jobThemeId ?? null,
      homeCubeId: citizen.homeCubeId ?? null,
      spouseId: citizen.spouseId ?? null,
      parentIds,
      childrenCount,
      monthsWorked: 0,
      estateAmount: movedEstate,
      wasMarried,
    });

    newDeaths.push(record);
    eternalById.set(record.citizenId, record);
    newPoliceRecords.push(
      createPoliceRecord(
        totalMonths,
        'death',
        `وفاة ${citizen.name} عن عمر ${ageAtDeath} عاماً (${DEATH_CAUSE_LABELS_AR[cause]})`,
        [citizen.id]
      )
    );
  }

  // Remove the dead from living citizens (their wealth is now 0, so sum(living.wealth) === goldSlice.citizenWealth)
  const livingCitizens: Citizen[] = (goldSlice.citizens ?? workingCitizens).filter(
    (c) => !deadIdSet.has(c.id)
  );
  const livingById = new Map<number, Citizen>();
  for (let i = 0; i < livingCitizens.length; i++) {
    livingById.set(livingCitizens[i].id, livingCitizens[i]);
  }

  // Element 3 Spouse: clear living spouse's spouseId & collect bereavedSpouseIds for same-month guard
  const bereavedSpouseSet = new Set<number>();
  for (let i = 0; i < livingCitizens.length; i++) {
    const c = livingCitizens[i];
    if (c.spouseId !== null && deadIdSet.has(c.spouseId)) {
      c.spouseId = null;
      bereavedSpouseSet.add(c.id);
    }
  }

  // Element 3 Children: orphans (< 14 whose other parent is also dead/absent)
  const livingAdults = livingCitizens.filter(
    (c) => ageYears(c, totalMonths) >= 18
  );
  const orphanedHouseholds = new Map<number, string[]>();

  for (let i = 0; i < livingCitizens.length; i++) {
    const child = livingCitizens[i];
    if (ageYears(child, totalMonths) >= 14) continue;
    if (!child.parentIds) continue;

    const [p1, p2] = child.parentIds;
    const lostParentThisMonth = deadIdSet.has(p1) || deadIdSet.has(p2);
    if (!lostParentThisMonth) continue;

    // Check if either parent is still living
    const p1Alive = livingById.has(p1);
    const p2Alive = livingById.has(p2);
    if (p1Alive || p2Alive) continue;

    // Both parents are now dead/absent -> search for guardian household
    // Priority 1: living adult sibling (18+) sharing a parent with child
    const adultSiblings = livingAdults.filter(
      (a) => a.id !== child.id && shareAnyParent(a.parentIds, child.parentIds)
    );
    let guardian = pickBestGuardian(adultSiblings);

    // Priority 2: living parent-recorded relative (grandparent, aunt/uncle, or adult in same household)
    if (!guardian) {
      const parentGrandparentIds = new Set<number>();
      for (const pid of child.parentIds) {
        const preParent = preDeathById.get(pid);
        if (preParent?.parentIds) {
          parentGrandparentIds.add(preParent.parentIds[0]);
          parentGrandparentIds.add(preParent.parentIds[1]);
        }
        const deadParent = eternalById.get(pid);
        if (deadParent?.parentIds) {
          for (const gp of deadParent.parentIds) {
            parentGrandparentIds.add(gp);
          }
        }
      }

      const gpList = [...parentGrandparentIds];
      const relatives = livingAdults.filter((a) => {
        if (a.id === child.id) return false;
        if (parentGrandparentIds.has(a.id)) return true; // living grandparent
        if (gpList.length > 0 && shareAnyParent(a.parentIds, gpList)) return true; // aunt/uncle
        if (a.householdId === child.householdId) return true; // adult already in child's household
        return false;
      });
      guardian = pickBestGuardian(relatives);
    }

    if (guardian) {
      child.householdId = guardian.householdId;
      child.homeCubeId = guardian.homeCubeId;
      child.housingRequestMonth = null;
    } else {
      // Child stays in their house — never evicted, never removed; flag household in registry fax
      const names = orphanedHouseholds.get(child.householdId) ?? [];
      names.push(child.name);
      orphanedHouseholds.set(child.householdId, names);
    }
  }

  // Element 3 Notices: registry death summary fax + any orphan household faxes
  const newFaxes: OfficeFax[] = [];
  newFaxes.push({
    id: `fax-death-${totalMonths}`,
    month: totalMonths,
    office: 'registry',
    textAr: formatDeathsNoticeAr(newDeaths),
    status: 'unread',
  });

  for (const [hhId, childNames] of orphanedHouseholds.entries()) {
    const shown = childNames.slice(0, 5);
    const extra = childNames.length - shown.length;
    const label =
      extra > 0 ? `${shown.join('، ')} +${extra} آخرون` : shown.join('، ');
    newFaxes.push({
      id: `fax-orphan-${totalMonths}-${hhId}`,
      month: totalMonths,
      office: 'registry',
      textAr: `أسرة يتيمة (#${hhId}): ${label} بحاجة لاهتمام الملك — الأطفال باقون في مسكنهم.`,
      status: 'unread',
    });
  }

  const nextPopulation = Math.max(0, state.population - newDeaths.length);
  const combinedEternal = [...existingRecord, ...newDeaths];
  const nextEternalRecord =
    combinedEternal.length > MAX_ETERNAL_RECORD_ENTRIES
      ? combinedEternal.slice(combinedEternal.length - MAX_ETERNAL_RECORD_ENTRIES)
      : combinedEternal;

  return {
    state: {
      ...state,
      gold: goldSlice.gold,
      citizens: livingCitizens,
      citizenWealth: sumCitizenWealth(livingCitizens),
      population: nextPopulation,
      palaceOfPeople: goldSlice.palaceOfPeople,
      peoplesBank: goldSlice.peoplesBank,
      ledger: goldSlice.ledger,
      policeRecords: newPoliceRecords,
      officeFaxes: [...state.officeFaxes, ...newFaxes],
      eternalRecord: nextEternalRecord,
      lastDeathMonth: totalMonths,
    },
    deaths: newDeaths,
    bereavedSpouseIds: [...bereavedSpouseSet],
    newFaxes,
  };
}

// =============================================================================
// Element 5 — Pure display helpers for السجل الأبدي, Citizen Registry & AwayReport
// =============================================================================

export const MAX_ETERNAL_DISPLAY_ROWS = 50;
export const ETERNAL_RECORD_EMPTY_AR = 'لا وفيات مسجلة بعد — رعاياك أحياء يرزقون';

/**
 * Formats a game month honestly, handling negative founding birthMonths.
 */
export function formatGameMonthAr(month: number): string {
  const safe = Number.isFinite(month) ? Math.trunc(month) : 0;
  if (safe < 0) {
    return `قبل التأسيس (${Math.abs(safe)} شهر)`;
  }
  return `شهر ${safe}`;
}

/**
 * Returns the most recent Eternal Record entries (most recent first), capped at `cap` (default 50).
 */
export function getVisibleEternalRecord(
  eternalRecord: readonly DeceasedRecord[],
  cap: number = MAX_ETERNAL_DISPLAY_ROWS
): DeceasedRecord[] {
  if (!Array.isArray(eternalRecord) || eternalRecord.length === 0) return [];
  const safeCap = Math.max(0, Math.floor(cap));
  if (safeCap === 0) return [];
  return eternalRecord.slice(-safeCap).reverse();
}

/**
 * Plain Arabic estate custody line for records with estateAmount > 0.
 */
export function formatEstateHeldLineAr(estateAmount: number): string | null {
  if (!Number.isFinite(estateAmount) || estateAmount <= 0) return null;
  return `تركة محفوظة لدى قصر الشعب: ${Math.floor(estateAmount)}`;
}

/**
 * Resolves deceased parents and deceased former spouse for a living citizen
 * directly from the Eternal Record so the Citizen Registry shows "متوفى" honestly.
 */
export function resolveDeceasedFamilyForCitizen(
  citizen: Citizen,
  eternalById: ReadonlyMap<number, DeceasedRecord>,
  eternalRecord: readonly DeceasedRecord[]
): {
  deceasedParents: DeceasedRecord[];
  deceasedSpouse: DeceasedRecord | null;
} {
  const deceasedParents: DeceasedRecord[] = [];
  if (citizen.parentIds) {
    const seen = new Set<number>();
    for (let i = 0; i < citizen.parentIds.length; i++) {
      const pid = citizen.parentIds[i];
      if (seen.has(pid)) continue;
      const rec = eternalById.get(pid);
      if (rec) {
        seen.add(pid);
        deceasedParents.push(rec);
      }
    }
  }

  let deceasedSpouse: DeceasedRecord | null = null;
  if (citizen.spouseId === null) {
    for (let i = eternalRecord.length - 1; i >= 0; i--) {
      const rec = eternalRecord[i];
      if (rec.spouseId === citizen.id) {
        deceasedSpouse = rec;
        break;
      }
    }
  }

  return { deceasedParents, deceasedSpouse };
}

/**
 * Somber, dignified Arabic summary line for deaths during an away period, naming up to 5 citizens.
 */
export function formatAwayDeathsLineAr(deaths: readonly DeceasedRecord[]): string {
  const count = deaths.length;
  if (count === 0) return '';
  const shown = deaths.slice(0, 5).map((d) => d.name);
  const extra = count - shown.length;
  const names =
    extra > 0 ? `${shown.join('، ')} +${extra} آخرون` : shown.join('، ');
  if (count === 1) {
    return `تُوفي أثناء غيابك: ${names}.`;
  }
  return `تُوفي أثناء غيابك (${count}): ${names}.`;
}

