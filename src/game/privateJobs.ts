import { THEMES, WAGE_BY_THEME } from './constants';
import { ageYears, createPoliceRecord, sumCitizenWealth } from './citizens';
import { scoreCitizenForTheme } from './laborOffice';
import { applyWageTaxTransform, DEFAULT_TAX_POLICY } from './taxPolicy';
import type {
  Citizen,
  Cube,
  PoliceRecord,
  PrivateAd,
  TaxPolicy,
  ThemeId,
} from './types';

export const PRIVATE_WAGE_MULTIPLIER = 1.15;

let privateAdSeq = 1;

export function getPrivateAdWage(themeId: ThemeId): number {
  const base = WAGE_BY_THEME[themeId] ?? 0;
  return Math.round(base * PRIVATE_WAGE_MULTIPLIER);
}

// Element 4.2: Sync private ads with live private businesses (post missing slots, close invalid/orphaned ads)
export function syncPrivateAds(input: {
  cubes: Cube[];
  citizens: Citizen[];
  privateAds: PrivateAd[];
  totalMonths: number;
}): {
  privateAds: PrivateAd[];
  citizens: Citizen[];
} {
  const currentMonth = Math.max(0, Math.trunc(input.totalMonths));
  const nextCitizens: Citizen[] = input.citizens.map((c) => ({
    ...c,
    attrs: { ...c.attrs },
    parentIds: c.parentIds ? ([c.parentIds[0], c.parentIds[1]] as [number, number]) : null,
  }));
  const citizenById = new Map<number, Citizen>();
  for (const c of nextCitizens) {
    citizenById.set(c.id, c);
  }

  // Build map of live private workplaces (cubeId -> { ownerId, themeId, workers })
  const livePrivateWorkplaces = new Map<
    number,
    { ownerId: number; themeId: ThemeId; workers: number }
  >();
  for (const cube of input.cubes) {
    if (cube.owner !== 'player') continue;
    if (typeof cube.privateOwnerId !== 'number') continue;
    if (!citizenById.has(cube.privateOwnerId)) continue;
    if (!cube.themeId) continue;
    const def = THEMES[cube.themeId];
    if (def.workers <= 0) continue;
    livePrivateWorkplaces.set(cube.id, {
      ownerId: cube.privateOwnerId,
      themeId: cube.themeId,
      workers: def.workers,
    });
  }

  // Release any citizen whose private employment no longer matches a live private workplace
  for (const c of nextCitizens) {
    if (c.employerId == null) continue;
    const wp = c.jobCubeId !== null ? livePrivateWorkplaces.get(c.jobCubeId) : null;
    if (!wp || wp.ownerId !== c.employerId || c.jobThemeId !== wp.themeId) {
      c.jobCubeId = null;
      c.jobSlot = null;
      c.jobThemeId = null;
      c.employerId = null;
      if (ageYears(c, currentMonth) >= 14) {
        c.cvFiled = true;
        c.cvFiledMonth = currentMonth;
      }
    }
  }

  // Keep valid existing ads up to each workplace's required worker count
  const adsByCube = new Map<number, PrivateAd[]>();
  const claimedWorkers = new Set<number>();

  for (const ad of input.privateAds) {
    const wp = livePrivateWorkplaces.get(ad.cubeId);
    if (!wp || wp.ownerId !== ad.ownerId || wp.themeId !== ad.themeId) {
      continue;
    }
    const list = adsByCube.get(ad.cubeId) ?? [];
    if (list.length >= wp.workers) continue;

    let filledBy: number | null = null;
    if (ad.filledBy !== null && !claimedWorkers.has(ad.filledBy)) {
      const worker = citizenById.get(ad.filledBy);
      const owner = citizenById.get(wp.ownerId);
      const isSelfOrSpouse =
        !worker ||
        worker.id === wp.ownerId ||
        worker.spouseId === wp.ownerId ||
        owner?.spouseId === worker.id;
      if (
        worker &&
        !isSelfOrSpouse &&
        worker.jobCubeId === ad.cubeId &&
        worker.employerId === wp.ownerId &&
        worker.jobThemeId === wp.themeId
      ) {
        filledBy = worker.id;
        claimedWorkers.add(worker.id);
      }
    }

    list.push({
      ...ad,
      wage: getPrivateAdWage(wp.themeId),
      filledBy,
    });
    adsByCube.set(ad.cubeId, list);
  }

  // Post missing ads automatically for any unfilled worker slots
  const finalAds: PrivateAd[] = [];
  const sortedCubeIds = Array.from(livePrivateWorkplaces.keys()).sort((a, b) => a - b);

  for (const cubeId of sortedCubeIds) {
    const wp = livePrivateWorkplaces.get(cubeId)!;
    const list = adsByCube.get(cubeId) ?? [];

    // Re-attach any living private worker on this cube not yet bound to an ad
    const owner = citizenById.get(wp.ownerId);
    const unboundWorkers = nextCitizens
      .filter(
        (c) =>
          c.jobCubeId === cubeId &&
          c.employerId === wp.ownerId &&
          c.id !== wp.ownerId &&
          c.spouseId !== wp.ownerId &&
          owner?.spouseId !== c.id &&
          !claimedWorkers.has(c.id)
      )
      .sort((a, b) => a.id - b.id);

    while (list.length < wp.workers) {
      privateAdSeq += 1;
      const attach = unboundWorkers.shift() ?? null;
      if (attach) claimedWorkers.add(attach.id);
      list.push({
        id: `pad-${cubeId}-${list.length}-${privateAdSeq}`,
        ownerId: wp.ownerId,
        cubeId,
        themeId: wp.themeId,
        wage: getPrivateAdWage(wp.themeId),
        filledBy: attach ? attach.id : null,
      });
    }

    finalAds.push(...list);
  }

  return {
    privateAds: finalAds,
    citizens: nextCitizens,
  };
}

// Element 4.3: Match open private ads AFTER crown matching, drawing ONLY from unemployed CV pool.
// Hardening 4: Owner cannot employ himself or his spouse.
export function runPrivateLaborMatching(input: {
  cubes: Cube[];
  citizens: Citizen[];
  privateAds: PrivateAd[];
  totalMonths: number;
}): {
  privateAds: PrivateAd[];
  citizens: Citizen[];
  filledCount: number;
} {
  const currentMonth = Math.max(0, Math.trunc(input.totalMonths));
  const synced = syncPrivateAds(input);
  const nextCitizens = synced.citizens;
  const nextAds = synced.privateAds.map((a) => ({ ...a }));

  const citizenById = new Map<number, Citizen>();
  for (const c of nextCitizens) {
    citizenById.set(c.id, c);
  }

  let filledCount = 0;

  // Fill open ads in deterministic cubeId/id order
  for (const ad of nextAds) {
    if (ad.filledBy !== null) continue;
    const owner = citizenById.get(ad.ownerId);
    if (!owner) continue;

    let bestCandidate: Citizen | null = null;
    let bestScore = -Infinity;

    for (const c of nextCitizens) {
      // Only unemployed citizens with active CVs (no poaching from crown or other private jobs)
      if (c.jobCubeId !== null) continue;
      if (!c.cvFiled || ageYears(c, currentMonth) < 14) continue;
      // Hardening 4: Owner cannot employ himself or his spouse
      if (
        c.id === ad.ownerId ||
        c.spouseId === ad.ownerId ||
        owner.spouseId === c.id
      ) {
        continue;
      }

      const score = scoreCitizenForTheme(c, ad.themeId, currentMonth);
      if (
        bestCandidate === null ||
        score > bestScore ||
        (score === bestScore && c.id < bestCandidate.id)
      ) {
        bestCandidate = c;
        bestScore = score;
      }
    }

    if (bestCandidate) {
      bestCandidate.jobCubeId = ad.cubeId;
      bestCandidate.jobSlot = 0;
      bestCandidate.jobThemeId = ad.themeId;
      bestCandidate.employerId = ad.ownerId;
      bestCandidate.cvFiledMonth = null;
      ad.filledBy = bestCandidate.id;
      filledCount += 1;
    }
  }

  return {
    privateAds: nextAds,
    citizens: nextCitizens,
    filledCount,
  };
}

// Element 4.5 & Prompt 6 Element 2.2: Private payroll — owners pay exact gross wage w from personal wealth;
// tax/grant transform redistributes worker credit & treasury delta without owner ever paying extra or going negative.
export function runPrivatePayroll(input: {
  citizens: Citizen[];
  privateAds: PrivateAd[];
  totalMonths: number;
  taxPolicy?: TaxPolicy;
  availableGrantGold?: number;
}): {
  citizens: Citizen[];
  privateAds: PrivateAd[];
  citizenWealth: number;
  privateWagesPaid: number;
  releasedWorkers: number;
  taxWithheld: number;
  grantsPaid: number;
} {
  const currentMonth = Math.max(0, Math.trunc(input.totalMonths));
  const policy = input.taxPolicy ?? DEFAULT_TAX_POLICY;
  let remainingGrantGold =
    typeof input.availableGrantGold === 'number'
      ? Math.max(0, Math.floor(input.availableGrantGold))
      : Infinity;

  const nextCitizens: Citizen[] = input.citizens.map((c) => ({
    ...c,
    wealth: Math.max(0, Math.floor(c.wealth)),
    attrs: { ...c.attrs },
    parentIds: c.parentIds ? ([c.parentIds[0], c.parentIds[1]] as [number, number]) : null,
  }));
  const nextAds: PrivateAd[] = input.privateAds.map((a) => ({ ...a }));

  const citizenById = new Map<number, Citizen>();
  for (const c of nextCitizens) {
    citizenById.set(c.id, c);
  }

  let privateWagesPaid = 0;
  let releasedWorkers = 0;
  let taxWithheld = 0;
  let grantsPaid = 0;

  for (const ad of nextAds) {
    if (ad.filledBy === null) continue;
    const owner = citizenById.get(ad.ownerId);
    const worker = citizenById.get(ad.filledBy);

    if (
      !owner ||
      !worker ||
      worker.jobCubeId !== ad.cubeId ||
      worker.employerId !== ad.ownerId
    ) {
      ad.filledBy = null;
      if (worker && worker.employerId === ad.ownerId && worker.jobCubeId === ad.cubeId) {
        worker.jobCubeId = null;
        worker.jobSlot = null;
        worker.jobThemeId = null;
        worker.employerId = null;
        if (ageYears(worker, currentMonth) >= 14) {
          worker.cvFiled = true;
          worker.cvFiledMonth = currentMonth;
        }
      }
      continue;
    }

    const wage = Math.max(0, Math.floor(ad.wage));
    if (owner.wealth >= wage) {
      owner.wealth -= wage;
      const tr = applyWageTaxTransform(wage, policy, remainingGrantGold);
      worker.wealth += tr.credit;
      taxWithheld += tr.withheld;
      grantsPaid += tr.bonus;
      if (Number.isFinite(remainingGrantGold)) {
        remainingGrantGold = Math.max(0, remainingGrantGold - tr.bonus);
      }
      privateWagesPaid += wage;
    } else {
      // Insolvent owner: pay nothing, release worker, reopen ad
      worker.jobCubeId = null;
      worker.jobSlot = null;
      worker.jobThemeId = null;
      worker.employerId = null;
      if (ageYears(worker, currentMonth) >= 14) {
        worker.cvFiled = true;
        worker.cvFiledMonth = currentMonth;
      }
      ad.filledBy = null;
      releasedWorkers += 1;
    }
  }

  return {
    citizens: nextCitizens,
    privateAds: nextAds,
    citizenWealth: sumCitizenWealth(nextCitizens),
    privateWagesPaid,
    releasedWorkers,
    taxWithheld,
    grantsPaid,
  };
}

// Element 7.2: Cleanup when any private plot owner emigrates (called right after reconcileCitizens)
export function cleanupEmigratedPrivateOwners(input: {
  cubes: Cube[];
  previousCitizens: Citizen[];
  citizens: Citizen[];
  privateAds: PrivateAd[];
  policeRecords: PoliceRecord[];
  totalMonths: number;
}): {
  cubes: Cube[];
  citizens: Citizen[];
  privateAds: PrivateAd[];
  policeRecords: PoliceRecord[];
  revertedPlots: number;
} {
  const currentMonth = Math.max(0, Math.trunc(input.totalMonths));
  const livingIds = new Set<number>(input.citizens.map((c) => c.id));
  const prevById = new Map<number, Citizen>();
  for (const c of input.previousCitizens) {
    prevById.set(c.id, c);
  }

  const emigratedOwnerIds = new Set<number>();
  for (const cube of input.cubes) {
    if (
      cube.owner === 'player' &&
      typeof cube.privateOwnerId === 'number' &&
      !livingIds.has(cube.privateOwnerId)
    ) {
      emigratedOwnerIds.add(cube.privateOwnerId);
    }
  }

  if (emigratedOwnerIds.size === 0) {
    return {
      cubes: input.cubes,
      citizens: input.citizens,
      privateAds: input.privateAds,
      policeRecords: input.policeRecords,
      revertedPlots: 0,
    };
  }

  let revertedPlots = 0;
  const nextPoliceRecords = [...input.policeRecords];

  const nextCubes = input.cubes.map((cube) => {
    if (
      cube.owner === 'player' &&
      typeof cube.privateOwnerId === 'number' &&
      emigratedOwnerIds.has(cube.privateOwnerId)
    ) {
      revertedPlots += 1;
      const ownerName = prevById.get(cube.privateOwnerId)?.name ?? 'مواطن';
      nextPoliceRecords.push(
        createPoliceRecord(
          currentMonth,
          'housing',
          `عادت أرض ${ownerName} للتاج لهجرته`,
          [cube.privateOwnerId]
        )
      );
      return {
        ...cube,
        privateOwnerId: null,
        privateIntendedTheme: null,
        privateBuildRetries: 0,
      };
    }
    return cube;
  });

  // Release employees of emigrated owners & close their ads
  const nextCitizens = input.citizens.map((c) => {
    if (c.employerId != null && emigratedOwnerIds.has(c.employerId)) {
      return {
        ...c,
        jobCubeId: null,
        jobSlot: null,
        jobThemeId: null,
        employerId: null,
        cvFiled: ageYears(c, currentMonth) >= 14 ? true : c.cvFiled,
        cvFiledMonth:
          ageYears(c, currentMonth) >= 14 ? currentMonth : c.cvFiledMonth,
      };
    }
    return c;
  });

  const nextAds = input.privateAds.filter(
    (ad) => !emigratedOwnerIds.has(ad.ownerId)
  );

  return {
    cubes: nextCubes,
    citizens: nextCitizens,
    privateAds: nextAds,
    policeRecords: nextPoliceRecords,
    revertedPlots,
  };
}
