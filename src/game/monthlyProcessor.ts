import { runAgingAndMilestones } from './aging';
import {
  appendOrMergeFaxes,
  computeAdvisorBriefing,
} from './advisor';
import { syncArrivalCamp } from './arrivalCamp';
import { processBankMonth } from './bank';
import { reconcileCitizens, sumCitizenWealth } from './citizens';
import { ARREARS_SATISFACTION_CAP } from './constants';
import {
  logDecree,
  measureDecreeActuals,
  trimDecrees,
} from './decrees';
import {
  formatTransferLabelAr,
  transferGold,
  type CitizenGoldShare,
  type GoldStateSlice,
} from './goldLedger';
import { runHousingOffice } from './housingOffice';
import { applyMonthlyInstitutions } from './institutions';
import { distributePayrollToCitizens, runLaborMatching } from './laborOffice';
import { runMarriageOffice } from './marriageOffice';
import { processDeaths } from './mortality';
import { computeMonthlyPayroll } from './payroll';
import { computeNeedsAndSatisfaction } from './people';
import { addCitizenMemory, computeOpinionDrift } from './personality';
import {
  cleanupEmigratedPrivateOwners,
  runPrivateLaborMatching,
  runPrivatePayroll,
  syncPrivateAds,
} from './privateJobs';
import {
  processPrivateConstruction,
  runMonthlyLandRequests,
} from './privateLand';
import { computeStaffing, findPalaceCube } from './production';
import {
  computeProvinces,
  createProvinceEvent,
  diffProvincesForEvents,
  recordProvinceEvents,
} from './provinces';
import { runCitizenSpending } from './spending';
import { computeTaxMoodDelta, DEFAULT_TAX_POLICY } from './taxPolicy';
import type {
  AdvisorBriefing,
  ArrivalCamp,
  BankLoan,
  Citizen,
  Cube,
  DeceasedRecord,
  Decree,
  LastMonthStats,
  LandRequest,
  LedgerEntry,
  OfficeFax,
  PalaceOfPeople,
  PayrollRecord,
  PeoplesBank,
  PoliceRecord,
  PriceMap,
  PrivateAd,
  Province,
  ProvinceEvent,
  TaxPolicy,
  Warehouse,
} from './types';

const MAX_STORED_FAXES = 30;

export interface MonthlyProcessorInput {
  cubes: Cube[];
  warehouse: Warehouse;
  prices: PriceMap;
  inflationIndex: number;
  population: number;
  gold: number;
  arrears: number;
  citizenWealth: number;
  citizens: Citizen[];
  nextCitizenId: number;
  totalMonths: number;
  officeFaxes: OfficeFax[];
  policeRecords: PoliceRecord[];
  monthlyBusinessTax: number;
  landRequests: LandRequest[];
  privateAds: PrivateAd[];
  lastSpentMonth: number;
  palaceOfPeople?: PalaceOfPeople;
  bankTrust?: number;
  bankLoans?: BankLoan[];
  peoplesBank?: PeoplesBank;
  dailyBought?: Record<string, number>;
  dailySold?: Record<string, number>;
  lastBankNetWorthWarnMonth?: number;
  taxPolicy?: TaxPolicy;
  decrees?: Decree[];
  advisorBriefing?: AdvisorBriefing | null;
  provinces?: Province[];
  camp?: ArrivalCamp;
  provinceEvents?: ProvinceEvent[];
  embassyCubeIds?: ReadonlySet<number>;
  hungerFlag?: boolean;
  skipBriefing?: boolean;
  isOffline?: boolean;
  eternalRecord?: DeceasedRecord[];
  lastDeathMonth?: number;
  day: number;
  now?: number;
  rng?: () => number;
}

export interface MonthlyProcessorResult {
  totalMonths: number;
  population: number;
  cubes: Cube[];
  warehouse: Warehouse;
  gold: number;
  arrears: number;
  citizenWealth: number;
  lastPayroll: PayrollRecord;
  citizens: Citizen[];
  nextCitizenId: number;
  officeFaxes: OfficeFax[];
  policeRecords: PoliceRecord[];
  lastMonthStats: LastMonthStats;
  monthlyBusinessTax: number;
  landRequests: LandRequest[];
  privateAds: PrivateAd[];
  lastSpentMonth: number;
  palaceOfPeople: PalaceOfPeople;
  bankTrust: number;
  bankLoans: BankLoan[];
  peoplesBank: PeoplesBank;
  dailyBought: Record<string, number>;
  dailySold: Record<string, number>;
  lastBankNetWorthWarnMonth: number;
  advisorBriefing: AdvisorBriefing | null;
  decrees: Decree[];
  provinces: Province[];
  camp: ArrivalCamp;
  pendingArrivals: number;
  provinceEvents: ProvinceEvent[];
  addedProvinceEvents: ProvinceEvent[];
  eternalRecord: DeceasedRecord[];
  lastDeathMonth: number;
  deaths: DeceasedRecord[];
  ledgerItems: LedgerEntry[];
  paid: number;
  unheldSlots: number;
  citizenSpentTotal: number;
  importedFoodUnits: number;
  businessTaxCollected: number;
  offlineBankStats?: {
    loanInstallmentsPaid: number;
    loanDeferredAdded: number;
    bankTradesCount: number;
  };
  summary: {
    births: number;
    cvsFiled: number;
    marriages: number;
    housingGranted: number;
    faxesSent: number;
    privateBuilt: number;
    privateReverted: number;
    landRequestsGenerated: number;
    privateWagesPaid: number;
  };
}

// Unified monthly heartbeat used by BOTH live TICK and offline simulation.
// Exact Prompt 6 Element 6.2 final order:
//   totalMonths++
//   -> (a) aging/milestones
//   -> (b) Crown Labor matching (never poaches private workers)
//   -> (c) Housing grants & fax
//   -> (d) Marriages
//   -> (e) School/Clinic/Elder modifiers
//   -> (f) reconcileCitizens + cleanupEmigratedPrivateOwners
//   -> (g) Crown Payroll + Private Payroll (both through tax/grant transform)
//   -> (h) Flush monthlyBusinessTax to ledger
//   -> (i) Citizen Spending (food -> leisure, idempotent on lastSpentMonth)
//   -> (j) Private Construction + Land Requests (expiry & up to 1 new request)
//   -> (k) Private Job Ads sync & Private Labor Matching
//   -> (l) Bank installments & Bank trades (processBankMonth)
//   -> (m) Advisor briefing (observer at end; skipped for non-final offline months)
//   -> (n) Decree actuals -> trim
export function runMonthlyProcessor(
  input: MonthlyProcessorInput
): MonthlyProcessorResult {
  const nextTotalMonths = Math.max(0, Math.trunc(input.totalMonths)) + 1;
  const isOffline = Boolean(input.isOffline);
  const taxPolicy: TaxPolicy = input.taxPolicy ?? DEFAULT_TAX_POLICY;
  const ledgerItems: LedgerEntry[] = [];
  let ledgerSeq = 0;
  const pushLedger = (
    kind: LedgerEntry['kind'],
    amount: number,
    labelAr: string
  ) => {
    ledgerSeq += 1;
    ledgerItems.push({
      id: `m-${nextTotalMonths}-${input.day}-${ledgerSeq}`,
      day: input.day,
      kind,
      amount,
      labelAr,
    });
  };

  let cubes = input.cubes.map((c) => ({ ...c }));
  let warehouse: Warehouse = { ...input.warehouse };
  let gold = Math.max(0, Math.floor(input.gold));
  let palaceOfPeople: PalaceOfPeople = {
    ...(input.palaceOfPeople ?? { gold: 0, heldEstates: 0 }),
    gold: Math.max(0, Math.floor(input.palaceOfPeople?.gold ?? 0)),
    heldEstates: Math.max(0, Math.floor(input.palaceOfPeople?.heldEstates ?? 0)),
  };
  const zeroBank: PeoplesBank = {
    gold: 0,
    portfolio: {},
    totalTrades: 0,
    lastTradeMonth: null,
    lastTradeAr: null,
  };
  let policeRecords = input.policeRecords;
  let officeFaxes = input.officeFaxes;
  let nextCitizenId = input.nextCitizenId;
  let citizenWealth = Math.max(0, Math.floor(input.citizenWealth));
  let privateAds = input.privateAds;
  let decrees: Decree[] = Array.isArray(input.decrees) ? [...input.decrees] : [];

  let population = Math.max(0, Math.floor(input.population));
  let eternalRecord: DeceasedRecord[] = Array.isArray(input.eternalRecord)
    ? input.eternalRecord
    : [];
  let lastDeathMonth =
    typeof input.lastDeathMonth === 'number' &&
    Number.isFinite(input.lastDeathMonth)
      ? Math.trunc(input.lastDeathMonth)
      : -1;

  // (a) Aging & milestones scan
  const agingRes = runAgingAndMilestones(
    input.citizens,
    cubes,
    nextTotalMonths
  );
  let citizens = agingRes.citizens;
  const citizensBeforeDeaths = citizens;

  // (a2) DEATHS (V5 Prompt 4): immediately after aging and before labor/housing/marriages/payroll
  const deathRes = processDeaths(
    {
      citizens,
      population,
      totalMonths: nextTotalMonths,
      day: input.day,
      gold,
      citizenWealth,
      palaceOfPeople,
      peoplesBank: zeroBank,
      ledger: [],
      policeRecords,
      officeFaxes: [],
      eternalRecord,
      lastDeathMonth,
    },
    input.rng
  );
  citizens = deathRes.state.citizens;
  population = deathRes.state.population;
  citizenWealth = deathRes.state.citizenWealth;
  palaceOfPeople = deathRes.state.palaceOfPeople;
  policeRecords = deathRes.state.policeRecords;
  eternalRecord = deathRes.state.eternalRecord;
  lastDeathMonth = deathRes.state.lastDeathMonth ?? nextTotalMonths;
  if (deathRes.newFaxes.length > 0) {
    officeFaxes = appendOrMergeFaxes(officeFaxes, deathRes.newFaxes, isOffline);
  }
  const bereavedSpouseSet =
    deathRes.bereavedSpouseIds.length > 0
      ? new Set<number>(deathRes.bereavedSpouseIds)
      : undefined;

  // V5 Prompt 5 Element 2: Bereaved spouse & living children record 'death_in_family'
  if (deathRes.deaths.length > 0) {
    for (const rec of deathRes.deaths) {
      const affectedIds = new Set<number>();
      if (rec.spouseId !== null) {
        affectedIds.add(rec.spouseId);
      }
      for (const c of citizens) {
        if (
          c.parentIds &&
          (c.parentIds[0] === rec.citizenId || c.parentIds[1] === rec.citizenId)
        ) {
          affectedIds.add(c.id);
        }
      }
      if (affectedIds.size > 0) {
        citizens = citizens.map((c) =>
          affectedIds.has(c.id)
            ? addCitizenMemory(c, {
                month: nextTotalMonths,
                kind: 'death_in_family',
                cubeId: null,
                amount: null,
              })
            : c
        );
      }
    }
  }

  // (b) Crown Labor matching (skips private cubes & private workers)
  const prevCrownJobById = new Map<number, number | null>();
  for (const c of citizens) {
    prevCrownJobById.set(c.id, c.jobCubeId);
  }
  const laborRes = runLaborMatching(
    citizens,
    cubes,
    population,
    nextTotalMonths
  );
  citizens = laborRes.citizens.map((c) => {
    const prevJob = prevCrownJobById.get(c.id) ?? null;
    if (prevJob === null && c.jobCubeId !== null) {
      return addCitizenMemory(c, {
        month: nextTotalMonths,
        kind: 'job_gained',
        cubeId: c.jobCubeId,
        amount: null,
      });
    }
    if (prevJob !== null && c.jobCubeId === null) {
      return addCitizenMemory(c, {
        month: nextTotalMonths,
        kind: 'job_lost',
        cubeId: prevJob,
        amount: null,
      });
    }
    return c;
  });

  // (c) Housing grants & fax (with offline flood-control merge for unread faxes)
  const prevFaxIds = new Set(officeFaxes.map((f) => f.id));
  const housingRes = runHousingOffice(
    citizens,
    cubes,
    nextTotalMonths,
    policeRecords,
    officeFaxes
  );
  citizens = housingRes.citizens;
  policeRecords = housingRes.policeRecords;
  const addedHousingFaxes = housingRes.officeFaxes.filter(
    (f) => !prevFaxIds.has(f.id)
  );
  officeFaxes = appendOrMergeFaxes(officeFaxes, addedHousingFaxes, isOffline);

  // (d) Marriages (bereaved spouses from this month excluded until next month)
  const marriageRes = runMarriageOffice(
    citizens,
    nextTotalMonths,
    policeRecords,
    bereavedSpouseSet
  );
  citizens = marriageRes.citizens;
  policeRecords = marriageRes.policeRecords;

  // (e) School / Clinic / Elder modifiers
  citizens = applyMonthlyInstitutions(citizens, cubes, nextTotalMonths);

  // (f) Reconcile citizens + emigrated/deceased private owner cleanup
  const recRes = reconcileCitizens({
    citizens,
    nextCitizenId,
    population,
    totalMonths: nextTotalMonths,
    citizenWealth,
    policeRecords,
    rng: input.rng,
  });
  citizens = recRes.citizens;
  nextCitizenId = recRes.nextCitizenId;
  citizenWealth = recRes.citizenWealth;
  policeRecords = recRes.policeRecords;
  if (recRes.localEmigratedWealth > 0) {
    const emigTx = transferGold(
      {
        gold,
        citizenWealth: citizenWealth + recRes.localEmigratedWealth,
        palaceOfPeople,
        peoplesBank: zeroBank,
        ledger: [],
        day: input.day,
      },
      {
        from: 'citizens',
        to: 'palace',
        amount: recRes.localEmigratedWealth,
        kind: 'gift',
        labelAr: 'تصفية تركة مهاجر',
        exact: true,
      }
    );
    if (emigTx.ok) {
      palaceOfPeople = emigTx.state.palaceOfPeople;
    }
  }

  const emigCleanup = cleanupEmigratedPrivateOwners({
    cubes,
    previousCitizens: citizensBeforeDeaths,
    citizens,
    privateAds,
    policeRecords,
    totalMonths: nextTotalMonths,
  });
  cubes = emigCleanup.cubes;
  citizens = emigCleanup.citizens;
  privateAds = emigCleanup.privateAds;
  policeRecords = emigCleanup.policeRecords;

  // Sync private ads against live buildings before payroll
  const prePaySync = syncPrivateAds({
    cubes,
    citizens,
    privateAds,
    totalMonths: nextTotalMonths,
  });
  privateAds = prePaySync.privateAds;
  citizens = prePaySync.citizens;

  // (g1) Crown Payroll (CROWN slots only) with Prompt 6 tax/grant transform — settled via transferGold
  const payroll = computeMonthlyPayroll(cubes, population);
  const owed = Math.max(0, input.arrears) + payroll.due;
  const paid = Math.min(gold, owed);
  const nextArrears = Math.max(0, owed - paid);
  const availableCrownGrantGold = Math.max(0, gold - paid);

  const prevWealthById = new Map<number, number>();
  for (const c of citizens) {
    prevWealthById.set(c.id, c.wealth);
  }
  const distRes = distributePayrollToCitizens(
    citizens,
    cubes,
    population,
    paid,
    taxPolicy,
    availableCrownGrantGold
  );

  const crownShares: CitizenGoldShare[] = [];
  for (const c of distRes.citizens) {
    const delta = c.wealth - (prevWealthById.get(c.id) ?? 0);
    if (delta > 0) {
      crownShares.push({ citizenId: c.id, amount: delta });
    }
  }

  if (distRes.distributed > 0 && crownShares.length > 0) {
    const crownSlice: GoldStateSlice = {
      gold,
      citizens,
      citizenWealth: sumCitizenWealth(citizens),
      palaceOfPeople,
      peoplesBank: zeroBank,
      ledger: [],
      day: input.day,
    };
    const txCrown = transferGold(crownSlice, {
      from: 'treasury',
      to: 'citizens',
      amount: distRes.distributed,
      citizenShares: crownShares,
      kind: 'payroll',
      labelAr: 'رواتب الشهر',
      exact: true,
    });
    if (txCrown.ok) {
      gold = txCrown.state.gold;
      citizens = txCrown.state.citizens ?? distRes.citizens;
      citizenWealth = txCrown.state.citizenWealth;
    }
  } else if (paid > 0) {
    // Unheld crown slots (temporary labor): settle via transferGold treasury -> palace (no burn)
    const txUnheld = transferGold(
      {
        gold,
        citizenWealth,
        palaceOfPeople,
        peoplesBank: zeroBank,
        ledger: [],
        day: input.day,
      },
      {
        from: 'treasury',
        to: 'palace',
        amount: paid,
        kind: 'payroll',
        labelAr: 'رواتب عمالة مؤقتة',
        exact: true,
      }
    );
    if (txUnheld.ok) {
      gold = txUnheld.state.gold;
      palaceOfPeople = txUnheld.state.palaceOfPeople;
    }
  }

  if (paid > 0) {
    pushLedger(
      'payroll',
      -paid,
      formatTransferLabelAr(
        'treasury',
        distRes.distributed > 0 ? 'citizens' : 'palace',
        'رواتب الشهر'
      )
    );
  }

  // (g2) Private Payroll (owners pay exact gross w; tax/grant transform settled via transferGold)
  const prePrivateCitizenWealth = sumCitizenWealth(citizens);
  const privPayRes = runPrivatePayroll({
    citizens,
    privateAds,
    totalMonths: nextTotalMonths,
    taxPolicy,
    availableGrantGold: gold,
  });
  citizens = privPayRes.citizens;
  privateAds = privPayRes.privateAds;
  let privSlice: GoldStateSlice = {
    gold,
    citizenWealth: prePrivateCitizenWealth,
    palaceOfPeople,
    peoplesBank: zeroBank,
    ledger: [],
    day: input.day,
  };
  if (privPayRes.taxWithheld > 0) {
    const txTax = transferGold(privSlice, {
      from: 'citizens',
      to: 'treasury',
      amount: privPayRes.taxWithheld,
      kind: 'payroll',
      labelAr: 'ضرائب مرتبات خاصة محتجزة',
      exact: true,
    });
    if (txTax.ok) privSlice = txTax.state;
  }
  if (privPayRes.grantsPaid > 0) {
    const txGrant = transferGold(privSlice, {
      from: 'treasury',
      to: 'citizens',
      amount: privPayRes.grantsPaid,
      kind: 'payroll',
      labelAr: 'منح ملكية على المرتبات الخاصة',
      exact: true,
    });
    if (txGrant.ok) privSlice = txGrant.state;
  }
  gold = privSlice.gold;
  citizenWealth = sumCitizenWealth(citizens);

  const totalTaxWithheld = distRes.taxWithheld + privPayRes.taxWithheld;
  const totalGrantsPaid = distRes.grantsPaid + privPayRes.grantsPaid;
  if (totalTaxWithheld > 0) {
    pushLedger(
      'payroll',
      totalTaxWithheld,
      formatTransferLabelAr('citizens', 'treasury', 'ضرائب مرتبات محتجزة')
    );
  }
  if (totalGrantsPaid > 0) {
    pushLedger(
      'payroll',
      -totalGrantsPaid,
      formatTransferLabelAr('treasury', 'citizens', 'منح ملكية على المرتبات')
    );
  }

  // (h) Flush accumulated monthly business tax (legacy field, zero after V5 Prompt 3)
  const businessTaxCollected = Math.max(
    0,
    Math.floor(input.monthlyBusinessTax)
  );
  if (businessTaxCollected > 0) {
    pushLedger('shop', businessTaxCollected, 'ضرائب أعمال خاصة');
  }

  // (i) Citizen Spending (food -> leisure, idempotent on lastSpentMonth)
  const staffingForSpending = computeStaffing(cubes, population, citizens);
  const spendRes = runCitizenSpending({
    cubes,
    warehouse,
    gold,
    population,
    inflationIndex: input.inflationIndex,
    citizens,
    totalMonths: nextTotalMonths,
    lastSpentMonth: input.lastSpentMonth,
    palaceOfPeople,
    staffedSlots: staffingForSpending.staffedSlots,
    rng: input.rng,
  });
  warehouse = spendRes.warehouse;
  gold = spendRes.gold;
  citizens = spendRes.citizens;
  citizenWealth = spendRes.citizenWealth;
  palaceOfPeople = spendRes.palaceOfPeople;
  const nextLastSpentMonth = spendRes.lastSpentMonth;
  for (const item of spendRes.ledgerItems) {
    pushLedger(item.kind, item.amount, item.labelAr);
  }

  // (j1) Private Construction on approved empty plots
  const constructRes = processPrivateConstruction({
    cubes,
    citizens,
    warehouse,
    prices: input.prices,
    gold,
    palaceOfPeople,
    now: input.now,
  });
  cubes = constructRes.cubes;
  citizens = constructRes.citizens;
  warehouse = constructRes.warehouse;
  gold = constructRes.gold;
  citizenWealth = constructRes.citizenWealth;
  palaceOfPeople = constructRes.palaceOfPeople;
  for (const item of constructRes.ledgerItems) {
    pushLedger(item.kind, item.amount, item.labelAr);
  }

  const lastMonthStats: LastMonthStats = {
    ...spendRes.lastMonthStats,
    businessTax: businessTaxCollected,
    importSink: spendRes.lastMonthStats.importSink + constructRes.importSink,
    taxWithheld: totalTaxWithheld,
    grantsPaid: totalGrantsPaid,
  };

  // (j2) Land Requests: expire old unanswered (>2 months) & generate up to 1 new request
  const landReqRes = runMonthlyLandRequests({
    cubes,
    citizens,
    landRequests: input.landRequests,
    totalMonths: nextTotalMonths,
    campCubeId: input.camp?.cubeId ?? null,
    embassyCubeIds: input.embassyCubeIds,
  });
  const nextLandRequests = landReqRes.landRequests;

  // (k) Private Job Ads sync & Private Labor Matching (after crown matching & construction)
  const prevPrivJobById = new Map<number, number | null>();
  for (const c of citizens) {
    prevPrivJobById.set(c.id, c.jobCubeId);
  }
  const privMatchRes = runPrivateLaborMatching({
    cubes,
    citizens,
    privateAds,
    totalMonths: nextTotalMonths,
  });
  privateAds = privMatchRes.privateAds;
  citizens = privMatchRes.citizens.map((c) => {
    const prevJob = prevPrivJobById.get(c.id) ?? null;
    if (prevJob === null && c.jobCubeId !== null) {
      return addCitizenMemory(c, {
        month: nextTotalMonths,
        kind: 'job_gained',
        cubeId: c.jobCubeId,
        amount: null,
      });
    }
    if (prevJob !== null && c.jobCubeId === null) {
      return addCitizenMemory(c, {
        month: nextTotalMonths,
        kind: 'job_lost',
        cubeId: prevJob,
        amount: null,
      });
    }
    return c;
  });
  citizenWealth = sumCitizenWealth(citizens);

  // (l) Bank installments & People's Bank trades (processBankMonth)
  const activeLoanIdBefore =
    (input.bankLoans ?? []).find((l) => l.status === 'active')?.id ?? null;
  const bankRes = processBankMonth({
    cubes,
    gold,
    palaceOfPeople,
    bankTrust: input.bankTrust ?? 70,
    bankLoans: input.bankLoans ?? [],
    peoplesBank: input.peoplesBank ?? {
      gold: 5000,
      portfolio: {},
      totalTrades: 0,
      lastTradeMonth: null,
      lastTradeAr: null,
    },
    prices: input.prices,
    dailyBought: input.dailyBought ?? {},
    dailySold: input.dailySold ?? {},
    totalMonths: nextTotalMonths,
    day: input.day,
    lastBankNetWorthWarnMonth: input.lastBankNetWorthWarnMonth ?? 0,
    isOffline,
  });
  cubes = bankRes.cubes;
  gold = bankRes.gold;
  palaceOfPeople = bankRes.palaceOfPeople;
  const bankTrust = bankRes.bankTrust;
  const bankLoans = bankRes.bankLoans;
  const peoplesBank = bankRes.peoplesBank;
  const nextDailyBought = bankRes.dailyBought;
  const nextDailySold = bankRes.dailySold;
  const nextBankNetWorthWarnMonth = bankRes.lastBankNetWorthWarnMonth;
  for (const item of bankRes.ledgerItems) {
    pushLedger(item.kind, item.amount, item.labelAr);
  }
  officeFaxes = appendOrMergeFaxes(officeFaxes, bankRes.officeFaxes, isOffline);
  if (officeFaxes.length > MAX_STORED_FAXES) {
    officeFaxes = officeFaxes.slice(officeFaxes.length - MAX_STORED_FAXES);
  }

  // Log decree when active-play scheduled installment completes the loan (never offline)
  if (!isOffline && activeLoanIdBefore !== null) {
    const finishedLoan = bankLoans.find((l) => l.id === activeLoanIdBefore);
    if (finishedLoan && finishedLoan.status === 'repaid') {
      decrees = logDecree(decrees, {
        month: nextTotalMonths,
        kind: 'loan_repaid',
        labelAr: 'اكتمال سداد تمويل البنك الشرعي',
        projectedAr: 'ثقة البنك +10 وتحرير الأراضي المرهونة',
        projectedValue: 10,
      });
    }
  }

  // Compute observed stored satisfaction at this boundary (same formula + mood + caps as reducer)
  const taxMoodDelta = computeTaxMoodDelta(
    taxPolicy,
    citizenWealth,
    population
  );
  const boundaryNeeds = computeNeedsAndSatisfaction(
    cubes,
    warehouse,
    population,
    Boolean(input.hungerFlag),
    taxMoodDelta
  );
  const observedSatisfaction =
    nextArrears > 0
      ? Math.min(ARREARS_SATISFACTION_CAP, boundaryNeeds.satisfaction)
      : boundaryNeeds.satisfaction;

  // (l2) Recompute provinces, sync arrival camp & record province events BEFORE Advisor briefing
  const prevProvinces: Province[] = input.provinces ?? [];
  const prevCamp: ArrivalCamp = input.camp ?? { cubeId: null, residentIds: [] };
  const prevProvinceEvents: ProvinceEvent[] = input.provinceEvents ?? [];

  const nextProvinces = computeProvinces({
    cubes,
    citizens,
    population,
  });
  const campResult = syncArrivalCamp(
    citizens,
    cubes,
    nextTotalMonths,
    prevCamp.cubeId,
    input.embassyCubeIds
  );
  citizens = campResult.citizens;
  const nextCamp = campResult.camp;
  const nextPendingArrivals = campResult.pendingArrivals;

  const provinceAdditions: ProvinceEvent[] = diffProvincesForEvents(
    prevProvinces,
    nextProvinces,
    nextTotalMonths
  );
  if (nextPendingArrivals > 0) {
    const palaceCube = findPalaceCube(cubes);
    const campRefCubeId = nextCamp.cubeId ?? palaceCube?.id ?? 0;
    provinceAdditions.push(
      createProvinceEvent(
        'camp_full',
        nextTotalMonths,
        campRefCubeId,
        `مخيم الوصول ممتلئ — ${nextPendingArrivals} قادم في الطريق`
      )
    );
  }
  const recProvEvents = recordProvinceEvents(
    prevProvinceEvents,
    provinceAdditions
  );
  const nextProvinceEvents = recProvEvents.events;
  const addedProvinceEvents = recProvEvents.added;

  // (l3) V5 Prompt 5 Element 3: Opinion of the king drift — LAST citizen step before trims
  // Monthly-only kinds match month === nextTotalMonths; live-play-only kinds match month === monthJustEnded
  // (plus child_born from live daily growth / offline pre-reconcile at monthJustEnded when step (f) did not birth).
  const monthJustEndedForOpinion = nextTotalMonths - 1;
  citizens = citizens.map((c) => {
    const thisMonthMemories = c.memories.filter((m) => {
      if (
        m.kind === 'prayer_attended' ||
        m.kind === 'land_bought' ||
        m.kind === 'land_denied'
      ) {
        return m.month === monthJustEndedForOpinion;
      }
      if (m.kind === 'child_born') {
        return (
          m.month === nextTotalMonths ||
          (recRes.birthsCount === 0 && m.month === monthJustEndedForOpinion)
        );
      }
      return m.month === nextTotalMonths;
    });
    const nextOpinion = computeOpinionDrift(c, thisMonthMemories);
    return nextOpinion === c.opinionOfKing
      ? c
      : { ...c, opinionOfKing: nextOpinion };
  });

  // (m) Advisor briefing (pure observer at end; runs once per month boundary; skipped on non-final offline months)
  const shouldComputeBriefing =
    !input.skipBriefing && input.advisorBriefing?.month !== nextTotalMonths;
  const advisorBriefing: AdvisorBriefing | null = shouldComputeBriefing
    ? computeAdvisorBriefing({
        month: nextTotalMonths,
        arrears: nextArrears,
        bankLoans,
        inflationIndex: input.inflationIndex,
        lastMonthStats,
        citizens,
        totalMonths: nextTotalMonths,
        peoplesBank,
        cubes,
        prices: input.prices,
        gold,
        citizenWealth,
        population,
        satisfaction: observedSatisfaction,
        provinces: nextProvinces,
        provinceEvents: nextProvinceEvents,
        pendingArrivals: nextPendingArrivals,
      })
    : (input.advisorBriefing ?? null);

  // (n) Decree actuals -> trim (measure FIRST, trim AFTER so unmeasured decrees are never dropped)
  const monthJustEnded = nextTotalMonths - 1;
  decrees = measureDecreeActuals(
    decrees,
    monthJustEnded,
    lastMonthStats,
    observedSatisfaction
  );
  decrees = trimDecrees(decrees);

  const lastPayroll: PayrollRecord = {
    day: input.day,
    workers: payroll.workers,
    due: payroll.due,
    paid,
  };

  return {
    totalMonths: nextTotalMonths,
    population,
    cubes,
    warehouse,
    gold,
    arrears: nextArrears,
    citizenWealth,
    lastPayroll,
    citizens,
    nextCitizenId,
    officeFaxes,
    policeRecords,
    lastMonthStats,
    monthlyBusinessTax: 0,
    landRequests: nextLandRequests,
    privateAds,
    lastSpentMonth: nextLastSpentMonth,
    palaceOfPeople,
    bankTrust,
    bankLoans,
    peoplesBank,
    dailyBought: nextDailyBought,
    dailySold: nextDailySold,
    lastBankNetWorthWarnMonth: nextBankNetWorthWarnMonth,
    advisorBriefing,
    decrees,
    provinces: nextProvinces,
    camp: nextCamp,
    pendingArrivals: nextPendingArrivals,
    provinceEvents: nextProvinceEvents,
    addedProvinceEvents,
    eternalRecord,
    lastDeathMonth,
    deaths: deathRes.deaths,
    ledgerItems,
    paid,
    unheldSlots: distRes.unheldSlots,
    citizenSpentTotal: spendRes.totalCitizenSpent,
    importedFoodUnits: spendRes.importedFoodUnits ?? 0,
    businessTaxCollected,
    offlineBankStats: bankRes.offlineStats,
    summary: {
      births: recRes.birthsCount,
      cvsFiled: agingRes.cvsFiled + recRes.cvsFiledCount,
      marriages: marriageRes.marriagesCount,
      housingGranted: housingRes.housingGranted,
      faxesSent: housingRes.faxesSent + deathRes.newFaxes.length,
      privateBuilt: constructRes.builtCount,
      privateReverted: constructRes.revertedCount + emigCleanup.revertedPlots,
      landRequestsGenerated: landReqRes.generated ? 1 : 0,
      privateWagesPaid: privPayRes.privateWagesPaid,
    },
  };
}
