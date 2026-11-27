import { BASE_BUY_PRICES, THEMES } from './constants';
import {
  ageYears,
  createPoliceRecord,
  getTopAttribute,
  sumCitizenWealth,
} from './citizens';
import {
  formatTransferLabelAr,
  transferGold,
  type GoldStateSlice,
} from './goldLedger';
import { addCitizenMemory } from './personality';
import { findPalaceCube, getCubePurchasePrice } from './production';
import type {
  Citizen,
  Cube,
  LandRequest,
  LedgerKind,
  PalaceOfPeople,
  PoliceRecord,
  PriceMap,
  ThemeId,
  TradedResourceKey,
  Warehouse,
} from './types';

export const LAND_DENIAL_COOLDOWN_MONTHS = 3;
export const LAND_REQUEST_EXPIRY_MONTHS = 2;
export const PRIVATE_LAND_PRICE_MULTIPLIER = 3;
export const PRIVATE_LAND_MAX_SHARE = 0.25;
export const PRIVATE_BUILD_MAX_RETRIES = 3;

let landRequestSeq = 1;

export interface PrivateLandLedgerItem {
  kind: LedgerKind;
  amount: number;
  labelAr: string;
}

export function getOwnedCubeCount(cubes: Cube[]): number {
  let count = 0;
  for (const c of cubes) {
    if (c.owner === 'player') count += 1;
  }
  return count;
}

export function countPrivatePlots(cubes: Cube[]): number {
  let count = 0;
  for (const c of cubes) {
    if (c.owner === 'player' && typeof c.privateOwnerId === 'number') {
      count += 1;
    }
  }
  return count;
}

// Hardening 3: Uses Math.floor and live owned-cube counts so kingdom can never drift majority-private
export function getPrivatePlotCap(cubes: Cube[]): number {
  return Math.floor(getOwnedCubeCount(cubes) * PRIVATE_LAND_MAX_SHARE);
}

export function isEligiblePrivateTargetCube(
  cubes: Cube[],
  cube: Cube,
  pendingCubeIds: ReadonlySet<number>,
  palaceCubeId: number | null,
  campCubeId: number | null = null,
  embassyCubeIds?: ReadonlySet<number>
): boolean {
  if (cube.owner !== 'player') return false;
  if (cube.privateOwnerId != null) return false;
  if (cube.collateralLoanId != null) return false;
  if (cube.themeId !== null || cube.secondThemeId !== null) return false;
  if (cube.isRocky) return false;
  if (palaceCubeId !== null && cube.id === palaceCubeId) return false;
  if (campCubeId !== null && cube.id === campCubeId) return false;
  if (embassyCubeIds && embassyCubeIds.has(cube.id)) return false;
  if (pendingCubeIds.has(cube.id)) return false;
  return true;
}

export function pickIntendedBusinessTheme(
  citizen: Citizen,
  availableWealth: number
): ThemeId {
  const top = getTopAttribute(citizen.attrs);
  if (top === 'social') {
    return availableWealth < THEMES.restaurant.cost + 40 ? 'cafe' : 'restaurant';
  }
  if (top === 'intelligence') {
    return availableWealth < THEMES.hotel.cost + 60 ? 'shop' : 'hotel';
  }
  return 'shop';
}

function manhattanDistance(a: Cube, b: Cube): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

// Element 3.5: Process pending private construction on approved empty private plots
export function processPrivateConstruction(input: {
  cubes: Cube[];
  citizens: Citizen[];
  warehouse: Warehouse;
  prices: PriceMap;
  gold: number;
  palaceOfPeople?: PalaceOfPeople;
  now?: number;
}): {
  cubes: Cube[];
  citizens: Citizen[];
  warehouse: Warehouse;
  gold: number;
  citizenWealth: number;
  palaceOfPeople: PalaceOfPeople;
  ledgerItems: PrivateLandLedgerItem[];
  importSink: number;
  builtCount: number;
  revertedCount: number;
} {
  const now = input.now ?? Date.now();
  const nextCubes = input.cubes.map((c) => ({ ...c }));
  let goldSlice: GoldStateSlice = {
    gold: Math.max(0, Math.floor(input.gold)),
    citizens: input.citizens.map((c) => ({
      ...c,
      attrs: { ...c.attrs },
      parentIds: c.parentIds ? ([c.parentIds[0], c.parentIds[1]] as [number, number]) : null,
    })),
    citizenWealth: sumCitizenWealth(input.citizens),
    palaceOfPeople: {
      ...(input.palaceOfPeople ?? { gold: 0, heldEstates: 0 }),
      gold: Math.max(0, Math.floor(input.palaceOfPeople?.gold ?? 0)),
      heldEstates: Math.max(0, Math.floor(input.palaceOfPeople?.heldEstates ?? 0)),
    },
    peoplesBank: {
      gold: 0,
      portfolio: {},
      totalTrades: 0,
      lastTradeMonth: null,
      lastTradeAr: null,
    },
    ledger: [],
    day: 0,
  };
  const nextWarehouse: Warehouse = { ...input.warehouse };
  let importSink = 0;
  let builtCount = 0;
  let revertedCount = 0;
  const ledgerItems: PrivateLandLedgerItem[] = [];

  const getOwner = (id: number): Citizen | undefined =>
    goldSlice.citizens?.find((c) => c.id === id);

  for (let i = 0; i < nextCubes.length; i++) {
    const cube = nextCubes[i];
    if (cube.owner !== 'player') continue;
    if (typeof cube.privateOwnerId !== 'number') continue;
    if (cube.themeId !== null || cube.secondThemeId !== null) continue;

    const owner = getOwner(cube.privateOwnerId);
    if (!owner) {
      // Owner no longer exists — revert safely to crown
      cube.privateOwnerId = null;
      cube.privateIntendedTheme = null;
      cube.privateBuildRetries = 0;
      revertedCount += 1;
      continue;
    }

    const themeId: ThemeId = cube.privateIntendedTheme ?? 'shop';
    const def = THEMES[themeId];
    const goldCost = def.cost;

    let warehouseCharge = 0;
    let importCharge = 0;
    const matDraws: Array<{ res: TradedResourceKey; qty: number }> = [];

    if (def.materialCosts) {
      for (const [res, needed] of Object.entries(def.materialCosts) as Array<
        [TradedResourceKey, number]
      >) {
        if (needed <= 0) continue;
        const have = Math.max(0, nextWarehouse[res] ?? 0);
        const fromWh = Math.min(have, needed);
        const missing = needed - fromWh;
        const unitPrice = input.prices[res] ?? BASE_BUY_PRICES[res] ?? 1;
        if (fromWh > 0) {
          warehouseCharge += fromWh * unitPrice;
          matDraws.push({ res, qty: fromWh });
        }
        if (missing > 0) {
          importCharge += Math.round(missing * unitPrice * 1.25);
        }
      }
    }

    const totalCost = goldCost + warehouseCharge + importCharge;
    if (owner.wealth >= totalCost) {
      let nextSlice = goldSlice;
      let paidOk = true;
      if (warehouseCharge > 0) {
        const txWh = transferGold(nextSlice, {
          from: 'citizens',
          to: 'treasury',
          citizenId: owner.id,
          amount: warehouseCharge,
          kind: 'materials',
          labelAr: 'خامات بناء خاص',
          exact: true,
        });
        paidOk = txWh.ok;
        if (txWh.ok) nextSlice = txWh.state;
      }
      const palaceAmount = goldCost + importCharge;
      if (paidOk && palaceAmount > 0) {
        const txPalace = transferGold(nextSlice, {
          from: 'citizens',
          to: 'palace',
          citizenId: owner.id,
          amount: palaceAmount,
          kind: 'build',
          labelAr: 'تكلفة بناء خاص واستيراد خامات',
          exact: true,
        });
        paidOk = txPalace.ok;
        if (txPalace.ok) nextSlice = txPalace.state;
      }

      if (paidOk) {
        goldSlice = nextSlice;
        for (const draw of matDraws) {
          nextWarehouse[draw.res] = Math.max(
            0,
            (nextWarehouse[draw.res] ?? 0) - draw.qty
          );
        }
        if (warehouseCharge > 0) {
          ledgerItems.push({
            kind: 'materials',
            amount: warehouseCharge,
            labelAr: formatTransferLabelAr('citizens', 'treasury', 'خامات بناء خاص'),
          });
        }
        importSink += importCharge;

        cube.themeId = themeId;
        cube.builtAt = now;
        cube.progress = 0;
        cube.shortage = null;
        cube.privateIntendedTheme = null;
        cube.privateBuildRetries = 0;
        builtCount += 1;
      }
    } else {
      const retries = (cube.privateBuildRetries ?? 0) + 1;
      if (retries >= PRIVATE_BUILD_MAX_RETRIES) {
        cube.privateOwnerId = null;
        cube.privateIntendedTheme = null;
        cube.privateBuildRetries = 0;
        revertedCount += 1;
      } else {
        cube.privateBuildRetries = retries;
      }
    }
  }

  return {
    cubes: nextCubes,
    citizens: goldSlice.citizens ?? input.citizens,
    warehouse: nextWarehouse,
    gold: goldSlice.gold,
    citizenWealth: goldSlice.citizenWealth,
    palaceOfPeople: goldSlice.palaceOfPeople,
    ledgerItems,
    importSink,
    builtCount,
    revertedCount,
  };
}

// Element 3.2 & 3.3: Expire unanswered requests (>2 months) & generate at most 1 new request per month
export function runMonthlyLandRequests(input: {
  cubes: Cube[];
  citizens: Citizen[];
  landRequests: LandRequest[];
  totalMonths: number;
  campCubeId?: number | null;
  embassyCubeIds?: ReadonlySet<number>;
}): {
  landRequests: LandRequest[];
  generated: LandRequest | null;
  expiredCount: number;
} {
  const currentMonth = Math.max(0, Math.trunc(input.totalMonths));
  const campCubeId = input.campCubeId ?? null;
  const embassyCubeIds = input.embassyCubeIds;
  const palace = findPalaceCube(input.cubes);
  const palaceCubeId = palace ? palace.id : null;

  const citizenById = new Map<number, Citizen>();
  for (const c of input.citizens) {
    citizenById.set(c.id, c);
  }

  const ownedPlotByCitizen = new Set<number>();
  for (const cube of input.cubes) {
    if (cube.owner === 'player' && typeof cube.privateOwnerId === 'number') {
      ownedPlotByCitizen.add(cube.privateOwnerId);
    }
  }

  // 1. Prune expired (>= 2 months old) or invalidated requests
  const kept: LandRequest[] = [];
  const pendingCubeIds = new Set<number>();
  const pendingCitizenIds = new Set<number>();
  let expiredCount = 0;

  for (const req of input.landRequests) {
    const ageMonths = currentMonth - req.month;
    if (ageMonths >= LAND_REQUEST_EXPIRY_MONTHS) {
      expiredCount += 1;
      continue;
    }
    const cit = citizenById.get(req.citizenId);
    const cube = input.cubes[req.cubeId];
    if (
      !cit ||
      ownedPlotByCitizen.has(cit.id) ||
      !cube ||
      cube.owner !== 'player' ||
      cube.privateOwnerId != null ||
      cube.themeId !== null ||
      cube.secondThemeId !== null ||
      cube.isRocky ||
      (palaceCubeId !== null && cube.id === palaceCubeId) ||
      (campCubeId !== null && cube.id === campCubeId) ||
      (embassyCubeIds && embassyCubeIds.has(cube.id)) ||
      pendingCubeIds.has(cube.id) ||
      pendingCitizenIds.has(cit.id)
    ) {
      expiredCount += 1;
      continue;
    }
    kept.push(req);
    pendingCubeIds.add(cube.id);
    pendingCitizenIds.add(cit.id);
  }

  // 2. Cap check: privatePlots < floor(ownedCubes * 0.25)
  const privatePlots = countPrivatePlots(input.cubes);
  const cap = getPrivatePlotCap(input.cubes);
  if (privatePlots >= cap) {
    return { landRequests: kept, generated: null, expiredCount };
  }

  // Collect all currently eligible target cubes
  const eligibleCubes = input.cubes.filter((cube) =>
    isEligiblePrivateTargetCube(
      input.cubes,
      cube,
      pendingCubeIds,
      palaceCubeId,
      campCubeId,
      embassyCubeIds
    )
  );
  if (eligibleCubes.length === 0) {
    return { landRequests: kept, generated: null, expiredCount };
  }

  // 3. Find eligible citizens and pick highest (wealth * intelligence)
  interface Candidate {
    citizen: Citizen;
    targetCube: Cube;
    price: number;
    score: number;
  }

  const candidates: Candidate[] = [];
  for (const c of input.citizens) {
    if (ageYears(c, currentMonth) < 18) continue;
    if (c.attrs.intelligence < 50) continue;
    if (ownedPlotByCitizen.has(c.id)) continue;
    if (pendingCitizenIds.has(c.id)) continue;
    if (
      typeof c.deniedLandMonth === 'number' &&
      currentMonth - c.deniedLandMonth < LAND_DENIAL_COOLDOWN_MONTHS
    ) {
      continue;
    }

    // Target cube = eligible cube nearest to his home cube (fallback to palace)
    const refCube =
      (c.homeCubeId !== null ? input.cubes[c.homeCubeId] : null) ?? palace;
    const sortedTargets = [...eligibleCubes].sort((a, b) => {
      if (refCube) {
        const da = manhattanDistance(a, refCube);
        const db = manhattanDistance(b, refCube);
        if (da !== db) return da - db;
      }
      return a.id - b.id;
    });

    const targetCube = sortedTargets[0];
    if (!targetCube) continue;

    const price =
      PRIVATE_LAND_PRICE_MULTIPLIER * getCubePurchasePrice(input.cubes, targetCube);
    const employed = c.jobCubeId !== null;
    if (c.wealth < price) continue;
    if (!employed && c.wealth < 2 * price) continue;

    candidates.push({
      citizen: c,
      targetCube,
      price,
      score: c.wealth * c.attrs.intelligence,
    });
  }

  if (candidates.length === 0) {
    return { landRequests: kept, generated: null, expiredCount };
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.citizen.wealth !== a.citizen.wealth) {
      return b.citizen.wealth - a.citizen.wealth;
    }
    return a.citizen.id - b.citizen.id;
  });

  const best = candidates[0];
  landRequestSeq += 1;
  const newReq: LandRequest = {
    id: `lreq-${currentMonth}-${best.citizen.id}-${landRequestSeq}`,
    citizenId: best.citizen.id,
    cubeId: best.targetCube.id,
    price: best.price,
    month: currentMonth,
    businessThemeId: pickIntendedBusinessTheme(best.citizen, best.citizen.wealth),
  };

  return {
    landRequests: [...kept, newReq],
    generated: newReq,
    expiredCount,
  };
}

// Element 3.4: Resolve pending land request (Approve or Reject)
// Hardening 3: consumes request atomically, uses stored request.price, re-validates all invariants
export function resolveLandRequest(input: {
  cubes: Cube[];
  citizens: Citizen[];
  landRequests: LandRequest[];
  policeRecords: PoliceRecord[];
  gold: number;
  totalMonths: number;
  requestId: string;
  approve: boolean;
  campCubeId?: number | null;
}): {
  cubes: Cube[];
  citizens: Citizen[];
  landRequests: LandRequest[];
  policeRecords: PoliceRecord[];
  gold: number;
  citizenWealth: number;
  resolved: boolean;
  approved: boolean;
  ledgerItem: PrivateLandLedgerItem | null;
} {
  const reqIndex = input.landRequests.findIndex((r) => r.id === input.requestId);
  if (reqIndex === -1) {
    return {
      cubes: input.cubes,
      citizens: input.citizens,
      landRequests: input.landRequests,
      policeRecords: input.policeRecords,
      gold: input.gold,
      citizenWealth: sumCitizenWealth(input.citizens),
      resolved: false,
      approved: false,
      ledgerItem: null,
    };
  }

  const req = input.landRequests[reqIndex];
  const remainingRequests = input.landRequests.filter((r) => r.id !== req.id);
  const currentMonth = Math.max(0, Math.trunc(input.totalMonths));

  if (!input.approve) {
    const nextCitizens = input.citizens.map((c) =>
      c.id === req.citizenId
        ? addCitizenMemory(
            { ...c, deniedLandMonth: currentMonth },
            {
              month: currentMonth,
              kind: 'land_denied',
              cubeId: req.cubeId,
              amount: null,
            }
          )
        : c
    );
    return {
      cubes: input.cubes,
      citizens: nextCitizens,
      landRequests: remainingRequests,
      policeRecords: input.policeRecords,
      gold: input.gold,
      citizenWealth: sumCitizenWealth(nextCitizens),
      resolved: true,
      approved: false,
      ledgerItem: null,
    };
  }

  // Re-validate before approval (Hardening 3)
  const citizen = input.citizens.find((c) => c.id === req.citizenId);
  const cube = input.cubes[req.cubeId];
  const palace = findPalaceCube(input.cubes);
  const alreadyOwnsPlot = input.cubes.some(
    (c) => c.owner === 'player' && c.privateOwnerId === req.citizenId
  );
  const capReached =
    countPrivatePlots(input.cubes) >= getPrivatePlotCap(input.cubes);

  const isValid =
    Boolean(citizen) &&
    citizen!.wealth >= req.price &&
    !alreadyOwnsPlot &&
    Boolean(cube) &&
    cube.owner === 'player' &&
    cube.privateOwnerId == null &&
    cube.collateralLoanId == null &&
    cube.themeId === null &&
    cube.secondThemeId === null &&
    !cube.isRocky &&
    (!palace || cube.id !== palace.id) &&
    (input.campCubeId == null || cube.id !== input.campCubeId) &&
    !capReached;

  if (!isValid || !citizen || !cube) {
    // Request lapses silently
    return {
      cubes: input.cubes,
      citizens: input.citizens,
      landRequests: remainingRequests,
      policeRecords: input.policeRecords,
      gold: input.gold,
      citizenWealth: sumCitizenWealth(input.citizens),
      resolved: true,
      approved: false,
      ledgerItem: null,
    };
  }

  const slice: GoldStateSlice = {
    gold: Math.max(0, Math.floor(input.gold)),
    citizens: input.citizens,
    citizenWealth: sumCitizenWealth(input.citizens),
    palaceOfPeople: { gold: 0, heldEstates: 0 },
    peoplesBank: {
      gold: 0,
      portfolio: {},
      totalTrades: 0,
      lastTradeMonth: null,
      lastTradeAr: null,
    },
    ledger: [],
    day: 0,
  };
  const saleLabel = `بيع أرض للمواطن ${citizen.name}`;
  const tx = transferGold(slice, {
    from: 'citizens',
    to: 'treasury',
    citizenId: citizen.id,
    amount: req.price,
    kind: 'land',
    labelAr: saleLabel,
    exact: true,
  });
  if (!tx.ok) {
    return {
      cubes: input.cubes,
      citizens: input.citizens,
      landRequests: remainingRequests,
      policeRecords: input.policeRecords,
      gold: input.gold,
      citizenWealth: sumCitizenWealth(input.citizens),
      resolved: true,
      approved: false,
      ledgerItem: null,
    };
  }

  const rawNextCitizens = tx.state.citizens ?? input.citizens;
  const nextCitizens = rawNextCitizens.map((c) =>
    c.id === citizen.id
      ? addCitizenMemory(c, {
          month: currentMonth,
          kind: 'land_bought',
          cubeId: cube.id,
          amount: req.price,
        })
      : c
  );

  const nextCubes = input.cubes.map((c) =>
    c.id === cube.id
      ? {
          ...c,
          privateOwnerId: citizen.id,
          privateIntendedTheme: req.businessThemeId,
          privateBuildRetries: 0,
        }
      : c
  );

  // Prune any other pending requests for the same cube or same citizen
  const prunedRequests = remainingRequests.filter(
    (r) => r.cubeId !== cube.id && r.citizenId !== citizen.id
  );

  const policeRec = createPoliceRecord(
    currentMonth,
    'land_sale',
    `بيع الأرض (${cube.row + 1}، ${cube.col + 1}) للمواطن ${citizen.name} بمبلغ ${req.price} ذهب`,
    [citizen.id]
  );

  return {
    cubes: nextCubes,
    citizens: nextCitizens,
    landRequests: prunedRequests,
    policeRecords: [...input.policeRecords, policeRec],
    gold: tx.state.gold,
    citizenWealth: tx.state.citizenWealth,
    resolved: true,
    approved: true,
    ledgerItem: {
      kind: 'land',
      amount: tx.moved,
      labelAr: formatTransferLabelAr('citizens', 'treasury', saleLabel),
    },
  };
}

// Hardening 3: Clear privateOwnerId pointing at non-existent/duplicate citizens on hydrate
export function sanitizePrivateLandOnHydrate(
  cubes: Cube[],
  citizens: Citizen[],
  rawRequests: LandRequest[] | undefined
): { cubes: Cube[]; landRequests: LandRequest[] } {
  const livingIds = new Set<number>(citizens.map((c) => c.id));
  const seenOwners = new Set<number>();
  const cap = getPrivatePlotCap(cubes);

  const cleanCubes = cubes.map((cube) => {
    const rawOwner = cube.privateOwnerId;
    if (
      cube.owner === 'player' &&
      typeof rawOwner === 'number' &&
      livingIds.has(rawOwner) &&
      !seenOwners.has(rawOwner) &&
      seenOwners.size < cap
    ) {
      seenOwners.add(rawOwner);
      return {
        ...cube,
        privateOwnerId: rawOwner,
        privateIntendedTheme: cube.privateIntendedTheme ?? null,
        privateBuildRetries:
          typeof cube.privateBuildRetries === 'number'
            ? Math.max(0, Math.floor(cube.privateBuildRetries))
            : 0,
      };
    }
    if (
      cube.privateOwnerId !== null ||
      cube.privateIntendedTheme !== null ||
      cube.privateBuildRetries !== 0
    ) {
      return {
        ...cube,
        privateOwnerId: null,
        privateIntendedTheme: null,
        privateBuildRetries: 0,
      };
    }
    return cube;
  });

  const cleanRequests: LandRequest[] = [];
  if (Array.isArray(rawRequests)) {
    const usedCubes = new Set<number>();
    const usedCitizens = new Set<number>();
    for (const r of rawRequests) {
      if (!r || typeof r !== 'object') continue;
      if (
        typeof r.id !== 'string' ||
        typeof r.citizenId !== 'number' ||
        typeof r.cubeId !== 'number' ||
        typeof r.price !== 'number' ||
        r.price <= 0 ||
        typeof r.month !== 'number' ||
        !(r.businessThemeId in THEMES)
      ) {
        continue;
      }
      if (!livingIds.has(r.citizenId) || seenOwners.has(r.citizenId)) continue;
      const cube = cleanCubes[r.cubeId];
      if (!cube || cube.owner !== 'player' || cube.privateOwnerId != null) continue;
      if (cube.themeId !== null || cube.secondThemeId !== null || cube.isRocky) continue;
      if (usedCubes.has(r.cubeId) || usedCitizens.has(r.citizenId)) continue;
      usedCubes.add(r.cubeId);
      usedCitizens.add(r.citizenId);
      cleanRequests.push({
        id: r.id,
        citizenId: r.citizenId,
        cubeId: r.cubeId,
        price: Math.floor(r.price),
        month: Math.trunc(r.month),
        businessThemeId: r.businessThemeId,
      });
    }
  }

  return { cubes: cleanCubes, landRequests: cleanRequests };
}
