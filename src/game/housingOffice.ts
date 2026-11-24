import { countHousedHouseholds, getHousedHouseholdHeadIds } from './aging';
import {
  ageYears,
  createPoliceRecord,
  getNextHouseholdId,
  getOwnedHouseUnits,
} from './citizens';
import type { Citizen, Cube, OfficeFax, PoliceRecord } from './types';

export interface HousingQueueItem {
  applicantId: number;
  spouseId: number | null;
  applicantName: string;
  spouseName: string | null;
  requestMonth: number;
  waitingMonths: number;
  employed: boolean;
  married: boolean;
  children: number;
  priority: number;
}

export function getHousingQueue(
  citizens: Citizen[],
  totalMonths: number
): HousingQueueItem[] {
  const byId = new Map<number, Citizen>();
  for (const c of citizens) byId.set(c.id, c);

  const headIds = getHousedHouseholdHeadIds(citizens, totalMonths);
  const visitedIds = new Set<number>();
  const queue: HousingQueueItem[] = [];

  for (const c of citizens) {
    if (visitedIds.has(c.id)) continue;
    if (headIds.has(c.id)) continue;

    const spouse =
      c.spouseId !== null ? byId.get(c.spouseId) ?? null : null;
    const validSpouse =
      spouse && spouse.spouseId === c.id && !headIds.has(spouse.id)
        ? spouse
        : null;

    // Determine if this citizen (or their spouse) has an active housing request
    const cReq = c.housingRequestMonth;
    const sReq = validSpouse ? validSpouse.housingRequestMonth : null;
    if (cReq === null && sReq === null) continue;

    // Primary applicant is lower id between spouses (or the single citizen)
    const primary =
      validSpouse && validSpouse.id < c.id ? validSpouse : c;
    const partner =
      validSpouse ? (primary.id === c.id ? validSpouse : c) : null;

    visitedIds.add(primary.id);
    if (partner) visitedIds.add(partner.id);

    if (ageYears(primary, totalMonths) < 15 && (!partner || ageYears(partner, totalMonths) < 15)) {
      continue;
    }

    const requestMonth =
      cReq !== null && sReq !== null
        ? Math.min(cReq, sReq)
        : (cReq ?? sReq ?? totalMonths);

    const waitingMonths = Math.max(0, totalMonths - requestMonth);
    const employed =
      primary.jobCubeId !== null ||
      (partner !== null && partner.jobCubeId !== null);
    const married = partner !== null;

    // Count actual dependent children of primary/partner (never siblings in parents' house)
    let children = 0;
    for (const other of citizens) {
      if (other.id === primary.id || (partner && other.id === partner.id)) continue;
      if (
        other.parentIds &&
        (other.parentIds[0] === primary.id ||
          other.parentIds[1] === primary.id ||
          (partner &&
            (other.parentIds[0] === partner.id ||
              other.parentIds[1] === partner.id))) &&
        !headIds.has(other.id) &&
        other.spouseId === null
      ) {
        children += 1;
      }
    }

    // Element 4.3 exact priority formula
    const priority =
      waitingMonths * 10 +
      (employed ? 25 : 0) +
      (married ? 20 : 0) +
      children * 5;

    queue.push({
      applicantId: primary.id,
      spouseId: partner ? partner.id : null,
      applicantName: primary.name,
      spouseName: partner ? partner.name : null,
      requestMonth,
      waitingMonths,
      employed,
      married,
      children,
      priority,
    });
  }

  queue.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.requestMonth !== b.requestMonth) return a.requestMonth - b.requestMonth;
    return a.applicantId - b.applicantId;
  });

  return queue;
}

export interface HousingOfficeResult {
  citizens: Citizen[];
  policeRecords: PoliceRecord[];
  officeFaxes: OfficeFax[];
  housingGranted: number;
  faxesSent: number;
}

const MAX_STORED_FAXES = 30;

// Element 4.2, 4.3 & 4.4: Sequential live-capacity grants + at most 1 housing fax per month
export function runHousingOffice(
  citizens: Citizen[],
  cubes: Cube[],
  totalMonths: number,
  policeRecords: PoliceRecord[],
  officeFaxes: OfficeFax[]
): HousingOfficeResult {
  const next: Citizen[] = citizens.map((c) => ({
    ...c,
    attrs: { ...c.attrs },
    parentIds: c.parentIds
      ? ([c.parentIds[0], c.parentIds[1]] as [number, number])
      : null,
  }));
  const nextRecords: PoliceRecord[] = [...policeRecords];
  const nextFaxes: OfficeFax[] = [...officeFaxes];

  // Clear stale housing requests on anyone who is already a housed household head
  const initialHeadIds = getHousedHouseholdHeadIds(next, totalMonths);
  for (const c of next) {
    if (initialHeadIds.has(c.id) && c.housingRequestMonth !== null) {
      c.housingRequestMonth = null;
    }
  }

  // Per-cube house building slots (1 or 2)
  const houseSlotsByCube = new Map<number, number>();
  const houseCubeIds: number[] = [];
  for (const unit of getOwnedHouseUnits(cubes)) {
    const prev = houseSlotsByCube.get(unit.cubeId) ?? 0;
    houseSlotsByCube.set(unit.cubeId, prev + 1);
    if (prev === 0) houseCubeIds.push(unit.cubeId);
  }
  houseCubeIds.sort((a, b) => a - b);

  const totalHouseBuildings = getOwnedHouseUnits(cubes).length;

  // Live count of distinct housed households per cube
  const findFreeHouseCube = (): number | null => {
    const liveHeadIds = getHousedHouseholdHeadIds(next, totalMonths);
    const liveTotalHouseholds = countHousedHouseholds(next, totalMonths);
    if (liveTotalHouseholds >= totalHouseBuildings) return null;

    const occupiedByCube = new Map<number, Set<number>>();
    for (const c of next) {
      if (liveHeadIds.has(c.id) && c.homeCubeId !== null) {
        let set = occupiedByCube.get(c.homeCubeId);
        if (!set) {
          set = new Set<number>();
          occupiedByCube.set(c.homeCubeId, set);
        }
        set.add(c.householdId);
      }
    }

    for (const cubeId of houseCubeIds) {
      const cap = houseSlotsByCube.get(cubeId) ?? 0;
      const used = occupiedByCube.get(cubeId)?.size ?? 0;
      if (used < cap) {
        return cubeId;
      }
    }
    return null;
  };

  let nextHouseholdId = getNextHouseholdId(next);
  let housingGranted = 0;

  // Process sequentially against LIVE capacity & LIVE queue
  while (true) {
    const freeCubeId = findFreeHouseCube();
    if (freeCubeId === null) break;

    const queue = getHousingQueue(next, totalMonths);
    if (queue.length === 0) break;

    const top = queue[0];
    const applicant = next.find((c) => c.id === top.applicantId);
    if (!applicant) break;
    const spouse =
      top.spouseId !== null
        ? next.find((c) => c.id === top.spouseId) ?? null
        : null;

    const newHhId = nextHouseholdId++;
    const liveHeadIds = getHousedHouseholdHeadIds(next, totalMonths);

    // Move applicant, spouse, and their dependent unmarried non-head children
    applicant.householdId = newHhId;
    applicant.homeCubeId = freeCubeId;
    applicant.housingRequestMonth = null;

    if (spouse) {
      spouse.householdId = newHhId;
      spouse.homeCubeId = freeCubeId;
      spouse.housingRequestMonth = null;
    }

    for (const other of next) {
      if (other.id === applicant.id || (spouse && other.id === spouse.id)) continue;
      if (liveHeadIds.has(other.id) || other.spouseId !== null) continue;
      if (
        other.parentIds &&
        (other.parentIds[0] === applicant.id ||
          other.parentIds[1] === applicant.id ||
          (spouse &&
            (other.parentIds[0] === spouse.id ||
              other.parentIds[1] === spouse.id)))
      ) {
        other.householdId = newHhId;
        other.homeCubeId = freeCubeId;
      }
    }

    housingGranted += 1;
    const label = spouse
      ? `تخصيص مسكن لأسرة ${applicant.name} و${spouse.name}`
      : `تخصيص مسكن للمواطن ${applicant.name}`;
    const ids = spouse ? [applicant.id, spouse.id] : [applicant.id];
    nextRecords.push(createPoliceRecord(totalMonths, 'housing', label, ids));
  }

  // Element 4.4: Palace Fax — at most one housing fax per month
  let faxesSent = 0;
  const remainingQueue = getHousingQueue(next, totalMonths);
  if (remainingQueue.length > 0) {
    const maxWaiting = remainingQueue.reduce(
      (m, q) => Math.max(m, q.waitingMonths),
      0
    );
    const alreadySentThisMonth = nextFaxes.some(
      (f) => f.office === 'housing' && f.month === totalMonths
    );
    if (
      !alreadySentThisMonth &&
      (remainingQueue.length >= 3 || maxWaiting >= 2)
    ) {
      const n = remainingQueue.length;
      const m = Math.max(1, maxWaiting);
      nextFaxes.push({
        id: `fax-housing-${totalMonths}`,
        month: totalMonths,
        office: 'housing',
        textAr: `مكتب الإسكان: ${n} أسرة تنتظر سكناً منذ ${m} شهر — يُنصح ببناء بيوت جديدة`,
        actionThemeId: 'house',
      });
      faxesSent = 1;
    }
  }

  const trimmedFaxes =
    nextFaxes.length > MAX_STORED_FAXES
      ? nextFaxes.slice(nextFaxes.length - MAX_STORED_FAXES)
      : nextFaxes;

  return {
    citizens: next,
    policeRecords: nextRecords,
    officeFaxes: trimmedFaxes,
    housingGranted,
    faxesSent,
  };
}
