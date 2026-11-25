import { THEMES, WAGE_BY_THEME } from './constants';
import { ageYears, getTopAttribute } from './citizens';
import { computeStaffing, makeSlotKey } from './production';
import { applyWageTaxTransform, DEFAULT_TAX_POLICY } from './taxPolicy';
import type {
  Citizen,
  CitizenAttrKey,
  Cube,
  SlotIndex,
  TaxPolicy,
  ThemeId,
} from './types';

export type MatchWeightRow = Partial<Record<CitizenAttrKey, number>>;

// Element 3.2: Exact competence weights (every row sums to 1.0)
export const MATCH_WEIGHTS: Partial<Record<ThemeId, MatchWeightRow>> = {
  // Mines & extraction
  iron_mine: { physical: 0.55, professional: 0.3, health: 0.15 },
  copper_mine: { physical: 0.55, professional: 0.3, health: 0.15 },
  gold_mine: { physical: 0.55, professional: 0.3, health: 0.15 },
  gem_mine: { physical: 0.55, professional: 0.3, health: 0.15 },
  oil_well: { physical: 0.55, professional: 0.3, health: 0.15 },
  quarry: { physical: 0.55, professional: 0.3, health: 0.15 },
  // Farming, forestry & sea
  farm: { physical: 0.45, professional: 0.35, health: 0.2 },
  wheat_farm: { physical: 0.45, professional: 0.35, health: 0.2 },
  orchard: { physical: 0.45, professional: 0.35, health: 0.2 },
  pasture: { physical: 0.45, professional: 0.35, health: 0.2 },
  forest: { physical: 0.45, professional: 0.35, health: 0.2 },
  sea: { physical: 0.45, professional: 0.35, health: 0.2 },
  // Crafts & baking
  workshop: { professional: 0.55, intelligence: 0.25, physical: 0.2 },
  jeweler: { professional: 0.55, intelligence: 0.25, physical: 0.2 },
  bakery: { professional: 0.55, intelligence: 0.25, physical: 0.2 },
  // Trade, hospitality & culture
  shop: { social: 0.5, professional: 0.3, intelligence: 0.2 },
  grand_market: { social: 0.5, professional: 0.3, intelligence: 0.2 },
  trade_office: { social: 0.5, professional: 0.3, intelligence: 0.2 },
  restaurant: { social: 0.5, professional: 0.3, intelligence: 0.2 },
  cafe: { social: 0.5, professional: 0.3, intelligence: 0.2 },
  theater: { social: 0.5, professional: 0.3, intelligence: 0.2 },
  hotel: { social: 0.5, professional: 0.3, intelligence: 0.2 },
  // Knowledge & health
  school: { intelligence: 0.55, professional: 0.3, social: 0.15 },
  clinic: { intelligence: 0.55, professional: 0.3, social: 0.15 },
  // Logistics & water
  warehouse_bldg: { physical: 0.4, professional: 0.4, health: 0.2 },
  well: { physical: 0.4, professional: 0.4, health: 0.2 },
};

export const LABOR_WAITING_BONUS_PER_MONTH = 2;
export const LABOR_REPLACEMENT_THRESHOLD = 15;

export interface CitizenCV {
  citizenId: number;
  filedMonth: number;
  waitingMonths: number;
  topAttribute: CitizenAttrKey;
}

export interface StaffedWorkplaceSlot {
  cubeId: number;
  slot: SlotIndex;
  themeId: ThemeId;
  slotKey: string;
  slotWage: number;
}

export function getStaffedWorkplaceSlots(
  cubes: Cube[],
  population: number
): StaffedWorkplaceSlot[] {
  const staffing = computeStaffing(cubes, population);
  const result: StaffedWorkplaceSlot[] = [];

  for (const cube of cubes) {
    if (cube.owner !== 'player') continue;
    // Element 4.4: Crown staffing & payroll skip private plots
    if (typeof cube.privateOwnerId === 'number') continue;
    const entries: Array<{ slot: SlotIndex; themeId: ThemeId | null }> = [
      { slot: 0, themeId: cube.themeId },
      { slot: 1, themeId: cube.secondThemeId },
    ];
    for (const entry of entries) {
      if (!entry.themeId) continue;
      const def = THEMES[entry.themeId];
      if (def.workers <= 0) continue;
      const slotKey = makeSlotKey(cube.id, entry.slot);
      if (!staffing.staffedSlots.has(slotKey)) continue;
      result.push({
        cubeId: cube.id,
        slot: entry.slot,
        themeId: entry.themeId,
        slotKey,
        slotWage: (WAGE_BY_THEME[entry.themeId] ?? 0) * def.workers,
      });
    }
  }

  result.sort((a, b) =>
    a.cubeId !== b.cubeId ? a.cubeId - b.cubeId : a.slot - b.slot
  );
  return result;
}

export function getActiveCVs(
  citizens: Citizen[],
  totalMonths: number
): CitizenCV[] {
  const cvs: CitizenCV[] = [];
  for (const c of citizens) {
    if (c.jobCubeId !== null) continue;
    if (!c.cvFiled || ageYears(c, totalMonths) < 14) continue;
    const filedMonth = c.cvFiledMonth ?? totalMonths;
    cvs.push({
      citizenId: c.id,
      filedMonth,
      waitingMonths: Math.max(0, totalMonths - filedMonth),
      topAttribute: getTopAttribute(c.attrs),
    });
  }
  cvs.sort((a, b) =>
    b.waitingMonths !== a.waitingMonths
      ? b.waitingMonths - a.waitingMonths
      : a.citizenId - b.citizenId
  );
  return cvs;
}

export function scoreCitizenForTheme(
  citizen: Citizen,
  themeId: ThemeId,
  totalMonths: number
): number {
  const weights = MATCH_WEIGHTS[themeId] ?? {
    physical: 0.4,
    professional: 0.4,
    health: 0.2,
  };
  let base = 0;
  for (const [attr, w] of Object.entries(weights) as Array<
    [CitizenAttrKey, number]
  >) {
    base += w * citizen.attrs[attr];
  }
  const waitingMonths =
    citizen.jobCubeId === null && citizen.cvFiled
      ? Math.max(0, totalMonths - (citizen.cvFiledMonth ?? totalMonths))
      : 0;
  return base + waitingMonths * LABOR_WAITING_BONUS_PER_MONTH;
}

export interface LaborMatchResult {
  citizens: Citizen[];
  assignedCount: number;
  reactivatedCvs: number;
}

// Element 3.2 & 3.3: Pure, deterministic competence matching (no Math.random).
// Never changes HOW MANY slots are staffed — decides WHO holds each staffed slot.
export function runLaborMatching(
  citizens: Citizen[],
  cubes: Cube[],
  population: number,
  totalMonths: number
): LaborMatchResult {
  const slots = getStaffedWorkplaceSlots(cubes, population);
  const slotByKey = new Map<string, StaffedWorkplaceSlot>();
  for (const s of slots) slotByKey.set(s.slotKey, s);

  const next: Citizen[] = citizens.map((c) => ({
    ...c,
    attrs: { ...c.attrs },
    parentIds: c.parentIds
      ? ([c.parentIds[0], c.parentIds[1]] as [number, number])
      : null,
  }));

  // Map currently valid holders (ensuring at most 1 holder per slot, tie-break lower id)
  const holderBySlot = new Map<string, Citizen>();
  const sortedById = [...next].sort((a, b) => a.id - b.id);
  let reactivatedCvs = 0;

  // Track which citizens have been assigned in this pass (at most 1 job per citizen)
  const assignedCitizenIds = new Set<number>();

  for (const c of sortedById) {
    // Element 4.3: Private employees belong to the private sector — crown matching never poaches them
    if (c.employerId != null) {
      assignedCitizenIds.add(c.id);
      continue;
    }
    if (c.jobCubeId === null || c.jobThemeId === null) continue;
    const slotIdx: SlotIndex = c.jobSlot === 1 ? 1 : 0;
    const key = makeSlotKey(c.jobCubeId, slotIdx);
    const activeSlot = slotByKey.get(key);
    const stillValid =
      activeSlot !== undefined &&
      activeSlot.themeId === c.jobThemeId &&
      ageYears(c, totalMonths) >= 14 &&
      !holderBySlot.has(key);

    if (stillValid) {
      c.jobSlot = slotIdx;
      c.employerId = null;
      holderBySlot.set(key, c);
    } else {
      // Element 3.3: Building demolished or became unstaffed -> reactivate CV immediately
      c.jobCubeId = null;
      c.jobSlot = null;
      c.jobThemeId = null;
      c.employerId = null;
      if (ageYears(c, totalMonths) >= 14) {
        c.cvFiled = true;
        c.cvFiledMonth = totalMonths;
        reactivatedCvs += 1;
      }
    }
  }

  for (const holder of holderBySlot.values()) {
    assignedCitizenIds.add(holder.id);
  }

  const pickBestUnemployed = (themeId: ThemeId): { citizen: Citizen; score: number } | null => {
    let best: Citizen | null = null;
    let bestScore = -Infinity;
    for (const c of sortedById) {
      if (assignedCitizenIds.has(c.id)) continue;
      if (c.jobCubeId !== null || c.employerId != null) continue;
      if (!c.cvFiled || ageYears(c, totalMonths) < 14) continue;
      const sc = scoreCitizenForTheme(c, themeId, totalMonths);
      if (
        sc > bestScore + 1e-9 ||
        (Math.abs(sc - bestScore) <= 1e-9 && best !== null && c.id < best.id)
      ) {
        best = c;
        bestScore = sc;
      }
    }
    return best ? { citizen: best, score: bestScore } : null;
  };

  let assignedCount = 0;

  // Pass 1: Fill open staffed slots greedily by best score (tie-break lower id)
  for (const s of slots) {
    if (holderBySlot.has(s.slotKey)) continue;
    const picked = pickBestUnemployed(s.themeId);
    if (!picked) continue;
    picked.citizen.jobCubeId = s.cubeId;
    picked.citizen.jobSlot = s.slot;
    picked.citizen.jobThemeId = s.themeId;
    picked.citizen.employerId = null;
    picked.citizen.cvFiledMonth = null;
    assignedCitizenIds.add(picked.citizen.id);
    holderBySlot.set(s.slotKey, picked.citizen);
    assignedCount += 1;
  }

  // Pass 2: Stability check — replace an incumbent ONLY if an unemployed candidate beats them by >= 15
  for (const s of slots) {
    const incumbent = holderBySlot.get(s.slotKey);
    if (!incumbent) continue;
    const picked = pickBestUnemployed(s.themeId);
    if (!picked) continue;
    const incumbentScore = scoreCitizenForTheme(incumbent, s.themeId, totalMonths);
    if (picked.score >= incumbentScore + LABOR_REPLACEMENT_THRESHOLD) {
      // Displace incumbent -> reactivate incumbent's CV cleanly
      incumbent.jobCubeId = null;
      incumbent.jobSlot = null;
      incumbent.jobThemeId = null;
      incumbent.employerId = null;
      incumbent.cvFiled = true;
      incumbent.cvFiledMonth = totalMonths;
      assignedCitizenIds.delete(incumbent.id);
      reactivatedCvs += 1;

      // Seat better candidate
      picked.citizen.jobCubeId = s.cubeId;
      picked.citizen.jobSlot = s.slot;
      picked.citizen.jobThemeId = s.themeId;
      picked.citizen.employerId = null;
      picked.citizen.cvFiledMonth = null;
      assignedCitizenIds.add(picked.citizen.id);
      holderBySlot.set(s.slotKey, picked.citizen);
      assignedCount += 1;
    }
  }

  return {
    citizens: next,
    assignedCount,
    reactivatedCvs,
  };
}

export interface PayrollDistributionResult {
  citizens: Citizen[];
  distributed: number;
  unheldSlots: number;
  taxWithheld: number;
  grantsPaid: number;
}

// Element 3.4 & Prompt 6 Element 2.2: Credit slot wages directly to named holders through the
// per-holder tax/grant transform so sum(citizen.wealth) === citizenWealth and conservation is exact.
export function distributePayrollToCitizens(
  citizens: Citizen[],
  cubes: Cube[],
  population: number,
  paidGold: number,
  taxPolicy: TaxPolicy = DEFAULT_TAX_POLICY,
  availableGrantGold: number = Infinity
): PayrollDistributionResult {
  const next: Citizen[] = citizens.map((c) => ({
    ...c,
    attrs: { ...c.attrs },
    parentIds: c.parentIds
      ? ([c.parentIds[0], c.parentIds[1]] as [number, number])
      : null,
  }));

  const slots = getStaffedWorkplaceSlots(cubes, population);
  const holderByKey = new Map<string, Citizen>();
  for (const c of next) {
    if (c.jobCubeId === null || c.jobThemeId === null || c.employerId != null) continue;
    const key = makeSlotKey(c.jobCubeId, c.jobSlot === 1 ? 1 : 0);
    if (!holderByKey.has(key)) {
      holderByKey.set(key, c);
    }
  }

  const heldEntries: Array<{ citizen: Citizen; wage: number }> = [];
  let unheldSlots = 0;
  let totalHeldWage = 0;

  for (const s of slots) {
    const holder = holderByKey.get(s.slotKey);
    if (!holder) {
      unheldSlots += 1;
      continue;
    }
    heldEntries.push({ citizen: holder, wage: s.slotWage });
    totalHeldWage += s.slotWage;
  }

  const toDistribute = Math.max(0, Math.floor(paidGold));
  if (toDistribute <= 0 || heldEntries.length === 0 || totalHeldWage <= 0) {
    return {
      citizens: next,
      distributed: 0,
      unheldSlots,
      taxWithheld: 0,
      grantsPaid: 0,
    };
  }

  // Compute each holder's exact gross share first (exact match or largest-remainder integer split)
  const grossAllocations: Array<{ citizen: Citizen; gross: number }> = [];
  if (toDistribute === totalHeldWage) {
    for (const h of heldEntries) {
      grossAllocations.push({ citizen: h.citizen, gross: h.wage });
    }
  } else {
    const shares = heldEntries.map((h) => {
      const exact = (toDistribute * h.wage) / totalHeldWage;
      const floor = Math.floor(exact);
      return { citizen: h.citizen, gross: floor, rem: exact - floor };
    });

    let allocated = 0;
    for (const sh of shares) {
      allocated += sh.gross;
    }

    let leftover = toDistribute - allocated;
    shares.sort((a, b) => {
      if (Math.abs(b.rem - a.rem) > 1e-12) return b.rem - a.rem;
      return a.citizen.id - b.citizen.id;
    });

    for (let i = 0; i < shares.length && leftover > 0; i++) {
      shares[i].gross += 1;
      leftover -= 1;
    }
    // Restore deterministic citizen-id order before applying grant cap
    shares.sort((a, b) => a.citizen.id - b.citizen.id);
    for (const sh of shares) {
      grossAllocations.push({ citizen: sh.citizen, gross: sh.gross });
    }
  }

  let totalCredited = 0;
  let taxWithheld = 0;
  let grantsPaid = 0;
  let remainingGrantGold = availableGrantGold;

  for (const alloc of grossAllocations) {
    const tr = applyWageTaxTransform(alloc.gross, taxPolicy, remainingGrantGold);
    alloc.citizen.wealth += tr.credit;
    totalCredited += tr.credit;
    taxWithheld += tr.withheld;
    grantsPaid += tr.bonus;
    if (Number.isFinite(remainingGrantGold)) {
      remainingGrantGold = Math.max(0, remainingGrantGold - tr.bonus);
    }
  }

  return {
    citizens: next,
    distributed: totalCredited,
    unheldSlots,
    taxWithheld,
    grantsPaid,
  };
}
