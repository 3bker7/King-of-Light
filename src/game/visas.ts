import { syncArrivalCamp } from './arrivalCamp';
import { ageYears, reconcileCitizens } from './citizens';
import type { Citizen, CitizenAttrs, GameState } from './types';
import { chebyshevWorldDistance } from '../net/worldSpawn';
import {
  MAX_VISA_APPLICATIONS_PER_MONTH,
  sanitizeDisplayText,
  type CitizenSnapshot,
  type WorldKingdom,
  type WorldPos,
} from '../net/worldTypes';

export const VISA_FEE_GOLD = 20;
export const VISA_COOLDOWN_MONTHS = 12;
export const VISA_MAX_PER_MONTH = MAX_VISA_APPLICATIONS_PER_MONTH; // 3
export const VISA_MAX_CHEBYSHEV_DIST = 6;
export const VISA_MIN_DEST_REPUTATION = 60;
export const VISA_MIN_REP_ADVANTAGE = 15;
export const VISA_UNEMPLOYED_WEALTH_FLOOR = 50;
export const VISA_SATISFACTION_TRIGGER = 45;
export const VISA_CV_WAIT_TRIGGER_MONTHS = 2;

export interface VisaApplicantChoice {
  citizenId: number;
  toUid: string;
  toKingdomNameAr: string;
  reasonAr: string;
}

export interface VisaDeparturePayload {
  citizenId: number;
  citizenName: string;
  snapshot: CitizenSnapshot;
  feeGold: number;
  carriedWealth: number;
  nextState: GameState;
}

function clampVisaAttr(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 50;
  return Math.max(1, Math.min(100, n));
}

/**
 * Harden N3 Security:
 * Clamps all 5 attributes to integer 1..100, wealth >= 0, ageMonths to adult bounds,
 * and strips unsafe control/HTML characters from citizen name.
 */
export function sanitizeCitizenSnapshot(
  raw: Partial<CitizenSnapshot> | null | undefined
): CitizenSnapshot {
  const attrs = (raw?.attributes ?? {}) as Partial<CitizenAttrs>;
  const safeAge =
    typeof raw?.ageMonths === 'number' && Number.isFinite(raw.ageMonths)
      ? Math.max(14, Math.min(85, Math.trunc(raw.ageMonths)))
      : 24;
  const safeWealth =
    typeof raw?.wealth === 'number' && Number.isFinite(raw.wealth)
      ? Math.max(0, Math.floor(raw.wealth))
      : 0;

  return {
    name: sanitizeDisplayText(raw?.name, 'مواطن مسافر', 32),
    gender: raw?.gender === 'f' ? 'f' : 'm',
    ageMonths: safeAge,
    attributes: {
      physical: clampVisaAttr(attrs.physical),
      professional: clampVisaAttr(attrs.professional),
      social: clampVisaAttr(attrs.social),
      health: clampVisaAttr(attrs.health),
      intelligence: clampVisaAttr(attrs.intelligence),
    },
    wealth: safeWealth,
  };
}

/**
 * Element N3.1 — Pure deterministic visa applicant selection.
 *
 * Citizen qualifies when ALL hold:
 *  - state.borderOpen !== false
 *  - age >= 14 (adult) and departure will not strand a child < 14 alone
 *  - Motivation: state.satisfaction < 45 OR (unemployed & cvFiled & waiting >= 2 months)
 *  - Means: employed (jobCubeId !== null) OR wealth >= 50
 *  - Cooldown: lastVisaMonth == null OR (totalMonths - lastVisaMonth >= 12)
 *
 * Destination qualifies when ALL hold:
 *  - uid !== myUid
 *  - Chebyshev distance <= 6 from myPos
 *  - neighbor.reputation >= 60
 *  - neighbor.reputation >= state.reputation + 15
 *
 * Ordering & cap:
 *  - Longest CV wait first (earliest cvFiledMonth ASC, nulls last), tie-break lowest citizen.id ASC.
 *  - At most 3 applicants per month.
 */
export function pickVisaApplicants(
  state: Pick<
    GameState,
    'citizens' | 'totalMonths' | 'satisfaction' | 'reputation' | 'borderOpen'
  >,
  neighbors: readonly WorldKingdom[],
  myPos: WorldPos = { wx: 0, wy: 0 },
  myUid: string | null = null
): VisaApplicantChoice[] {
  if (state.borderOpen === false) return [];
  if (state.citizens.length === 0 || neighbors.length === 0) return [];

  const eligibleDestinations = neighbors
    .filter((n) => {
      if (!n || !n.uid) return false;
      if (myUid !== null && n.uid === myUid) return false;
      if (chebyshevWorldDistance(n, myPos) > VISA_MAX_CHEBYSHEV_DIST) return false;
      if (n.reputation < VISA_MIN_DEST_REPUTATION) return false;
      if (n.reputation < state.reputation + VISA_MIN_REP_ADVANTAGE) return false;
      return true;
    })
    .sort((a, b) => {
      if (b.reputation !== a.reputation) return b.reputation - a.reputation;
      const da = chebyshevWorldDistance(a, myPos);
      const db = chebyshevWorldDistance(b, myPos);
      if (da !== db) return da - db;
      return a.uid.localeCompare(b.uid);
    });

  if (eligibleDestinations.length === 0) return [];

  // Track household young children & adult counts so a departure never strands a child < 14 alone
  const hhYoungChild = new Set<number>();
  const hhAdultCount = new Map<number, number>();
  for (const c of state.citizens) {
    const age = ageYears(c, state.totalMonths);
    if (age < 14) {
      hhYoungChild.add(c.householdId);
    } else {
      hhAdultCount.set(c.householdId, (hhAdultCount.get(c.householdId) ?? 0) + 1);
    }
  }

  const eligibleCitizens: Array<{
    citizen: Citizen;
    cvSortKey: number;
    reasonAr: string;
  }> = [];

  for (const c of state.citizens) {
    if (ageYears(c, state.totalMonths) < 14) continue;

    // Never strand a child < 14 alone in a household
    if (
      hhYoungChild.has(c.householdId) &&
      (hhAdultCount.get(c.householdId) ?? 0) <= 1
    ) {
      continue;
    }

    const lowSatisfaction = state.satisfaction < VISA_SATISFACTION_TRIGGER;
    const longUnemployed =
      c.jobCubeId === null &&
      c.cvFiled &&
      c.cvFiledMonth != null &&
      state.totalMonths - c.cvFiledMonth >= VISA_CV_WAIT_TRIGGER_MONTHS;

    if (!lowSatisfaction && !longUnemployed) continue;

    const hasMeans =
      c.jobCubeId !== null || c.wealth >= VISA_UNEMPLOYED_WEALTH_FLOOR;
    if (!hasMeans) continue;

    const cooldownOk =
      c.lastVisaMonth == null ||
      state.totalMonths - c.lastVisaMonth >= VISA_COOLDOWN_MONTHS;
    if (!cooldownOk) continue;

    const cvSortKey =
      c.cvFiled && c.cvFiledMonth != null ? c.cvFiledMonth : Number.MAX_SAFE_INTEGER;
    const reasonAr = longUnemployed
      ? `يبحث عن عمل منذ ${state.totalMonths - (c.cvFiledMonth ?? state.totalMonths)} شهر`
      : `تراجع الرضا (${Math.round(state.satisfaction)}%)`;

    eligibleCitizens.push({ citizen: c, cvSortKey, reasonAr });
  }

  eligibleCitizens.sort((a, b) => {
    if (a.cvSortKey !== b.cvSortKey) return a.cvSortKey - b.cvSortKey;
    return a.citizen.id - b.citizen.id;
  });

  // Also ensure picking multiple applicants from the same household does not strand a young child
  const chosen: VisaApplicantChoice[] = [];
  const remainingAdultsByHh = new Map(hhAdultCount);
  const topDest = eligibleDestinations[0];

  for (const item of eligibleCitizens) {
    if (chosen.length >= VISA_MAX_PER_MONTH) break;
    const hhId = item.citizen.householdId;
    if (hhYoungChild.has(hhId) && (remainingAdultsByHh.get(hhId) ?? 0) <= 1) {
      continue;
    }
    remainingAdultsByHh.set(hhId, (remainingAdultsByHh.get(hhId) ?? 1) - 1);
    chosen.push({
      citizenId: item.citizen.id,
      toUid: topDest.uid,
      toKingdomNameAr: topDest.nameAr,
      reasonAr: item.reasonAr,
    });
  }

  return chosen;
}

/**
 * Element N3.3 — Pure local settlement of a granted visa departure.
 * - Citizen pays 20 gold fee out of `citizen.wealth`.
 * - If citizen.wealth < 20, the visa lapses silently (returns null — NO debt, NO departure).
 * - Otherwise removes the citizen through `reconcileCitizens` (keeping citizens.length === population),
 *   syncs arrival camp, and returns the exact sanitized CitizenSnapshot with carried wealth = wealth - 20.
 *
 * Exact conservation:
 *   before citizenWealth = W
 *   after citizenWealth  = W - (carriedWealth + 20)
 *   receiver gains       = carriedWealth
 *   worldPalace gains    = 20
 *   total                = W (exact to the piece)
 */
export function applyVisaDepartureLocally(
  state: GameState,
  citizenId: number,
  totalMonths: number = state.totalMonths
): VisaDeparturePayload | null {
  const citizen = state.citizens.find((c) => c.id === citizenId);
  if (!citizen) return null;

  const safeWealth = Math.max(0, Math.floor(citizen.wealth));
  if (safeWealth < VISA_FEE_GOLD) {
    return null;
  }

  const carriedWealth = safeWealth - VISA_FEE_GOLD;
  const snapshot = sanitizeCitizenSnapshot({
    name: citizen.name,
    gender: citizen.gender,
    ageMonths: ageYears(citizen, totalMonths),
    attributes: citizen.attrs,
    wealth: carriedWealth,
  });

  const nextPopulation = Math.max(0, state.population - 1);
  const reconciled = reconcileCitizens({
    citizens: state.citizens,
    nextCitizenId: state.nextCitizenId,
    population: nextPopulation,
    totalMonths,
    citizenWealth: state.citizenWealth,
    policeRecords: state.policeRecords,
    forcedEmigrateIds: new Set([citizenId]),
  });

  const embassyCubeIds = new Set(state.embassyPlots.map((p) => p.cubeId));
  const campSync = syncArrivalCamp(
    reconciled.citizens,
    state.cubes,
    totalMonths,
    state.camp.cubeId,
    embassyCubeIds
  );

  const nextState: GameState = {
    ...state,
    population: nextPopulation,
    citizens: campSync.citizens,
    nextCitizenId: reconciled.nextCitizenId,
    citizenWealth: reconciled.citizenWealth,
    policeRecords: reconciled.policeRecords,
    camp: campSync.camp,
    pendingArrivals: campSync.pendingArrivals,
  };

  return {
    citizenId,
    citizenName: citizen.name,
    snapshot,
    feeGold: VISA_FEE_GOLD,
    carriedWealth,
    nextState,
  };
}

/**
 * Element N3.4 — Pure local settlement of received granted visas.
 * - Sanitizes each incoming snapshot (attrs clamped 1..100, wealth >= 0).
 * - Adds citizens strictly through `reconcileCitizens` (keeping citizens.length === population).
 * - Sets `lastVisaMonth = totalMonths`, `homeCubeId = null`, `housingRequestMonth = totalMonths`.
 * - Syncs arrival camp so unhoused arrivals enter the Prompt 7 camp via existing queue rules.
 */
export function applyVisaArrivalsLocally(
  state: GameState,
  snapshots: ReadonlyArray<Partial<CitizenSnapshot>>,
  totalMonths: number = state.totalMonths
): { nextState: GameState; addedCount: number; addedWealth: number } {
  if (snapshots.length === 0) {
    return { nextState: state, addedCount: 0, addedWealth: 0 };
  }

  const sanitized = snapshots.map((raw) => sanitizeCitizenSnapshot(raw));
  const nextPopulation = state.population + sanitized.length;

  const reconciled = reconcileCitizens({
    citizens: state.citizens,
    nextCitizenId: state.nextCitizenId,
    population: nextPopulation,
    totalMonths,
    citizenWealth: state.citizenWealth,
    policeRecords: state.policeRecords,
    visaArrivals: sanitized.map((s) => ({
      name: s.name,
      gender: s.gender,
      ageMonths: s.ageMonths,
      attributes: s.attributes,
      wealth: s.wealth,
      lastVisaMonth: totalMonths,
    })),
  });

  const embassyCubeIds = new Set(state.embassyPlots.map((p) => p.cubeId));
  const campSync = syncArrivalCamp(
    reconciled.citizens,
    state.cubes,
    totalMonths,
    state.camp.cubeId,
    embassyCubeIds
  );

  const addedWealth = sanitized.reduce((sum, s) => sum + s.wealth, 0);

  return {
    nextState: {
      ...state,
      population: nextPopulation,
      citizens: campSync.citizens,
      nextCitizenId: reconciled.nextCitizenId,
      citizenWealth: reconciled.citizenWealth,
      policeRecords: reconciled.policeRecords,
      camp: campSync.camp,
      pendingArrivals: campSync.pendingArrivals,
    },
    addedCount: sanitized.length,
    addedWealth,
  };
}
