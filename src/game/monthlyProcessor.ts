import { runAgingAndMilestones } from './aging';
import { reconcileCitizens, sumCitizenWealth } from './citizens';
import { runHousingOffice } from './housingOffice';
import { applyMonthlyInstitutions } from './institutions';
import { distributePayrollToCitizens, runLaborMatching } from './laborOffice';
import { runMarriageOffice } from './marriageOffice';
import { computeMonthlyPayroll } from './payroll';
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
import { computeStaffing } from './production';
import { processBankMonth } from './bank';
import { runCitizenSpending } from './spending';
import type {
  BankLoan,
  Citizen,
  Cube,
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
  Warehouse,
} from './types';

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
  isOffline?: boolean;
  day: number;
  now?: number;
  rng?: () => number;
}

export interface MonthlyProcessorResult {
  totalMonths: number;
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
  ledgerItems: LedgerEntry[];
  paid: number;
  unheldSlots: number;
  citizenSpentTotal: number;
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
// Exact Prompt 3 + Prompt 4 order:
//   totalMonths++
//   -> (a) aging/milestones
//   -> (b) Crown Labor matching (never poaches private workers)
//   -> (c) Housing grants & fax
//   -> (d) Marriages
//   -> (e) School/Clinic/Elder modifiers
//   -> (f) reconcileCitizens + cleanupEmigratedPrivateOwners
//   -> (g) Crown Payroll + Private Payroll
//   -> (h) Flush monthlyBusinessTax to ledger
//   -> (i) Citizen Spending (food -> leisure, idempotent on lastSpentMonth)
//   -> (j) Private Construction + Land Requests (expiry & up to 1 new request)
//   -> (k) Private Job Ads sync & Private Labor Matching (from remaining unemployed CVs)
export function runMonthlyProcessor(
  input: MonthlyProcessorInput
): MonthlyProcessorResult {
  const nextTotalMonths = Math.max(0, Math.trunc(input.totalMonths)) + 1;
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
  let policeRecords = input.policeRecords;
  let officeFaxes = input.officeFaxes;
  let nextCitizenId = input.nextCitizenId;
  let citizenWealth = Math.max(0, Math.floor(input.citizenWealth));
  let privateAds = input.privateAds;

  // (a) Aging & milestones scan
  const agingRes = runAgingAndMilestones(
    input.citizens,
    cubes,
    nextTotalMonths
  );
  let citizens = agingRes.citizens;

  // (b) Crown Labor matching (skips private cubes & private workers)
  const laborRes = runLaborMatching(
    citizens,
    cubes,
    input.population,
    nextTotalMonths
  );
  citizens = laborRes.citizens;

  // (c) Housing grants & fax
  const housingRes = runHousingOffice(
    citizens,
    cubes,
    nextTotalMonths,
    policeRecords,
    officeFaxes
  );
  citizens = housingRes.citizens;
  policeRecords = housingRes.policeRecords;
  officeFaxes = housingRes.officeFaxes;

  // (d) Marriages
  const marriageRes = runMarriageOffice(
    citizens,
    nextTotalMonths,
    policeRecords
  );
  citizens = marriageRes.citizens;
  policeRecords = marriageRes.policeRecords;

  // (e) School / Clinic / Elder modifiers
  citizens = applyMonthlyInstitutions(citizens, cubes, nextTotalMonths);

  // (f) Reconcile citizens + Element 7.2 emigrated private owner cleanup
  const prevCitizensBeforeReconcile = citizens;
  const recRes = reconcileCitizens({
    citizens,
    nextCitizenId,
    population: input.population,
    totalMonths: nextTotalMonths,
    citizenWealth,
    policeRecords,
    rng: input.rng,
  });
  citizens = recRes.citizens;
  nextCitizenId = recRes.nextCitizenId;
  citizenWealth = recRes.citizenWealth;
  policeRecords = recRes.policeRecords;

  const emigCleanup = cleanupEmigratedPrivateOwners({
    cubes,
    previousCitizens: prevCitizensBeforeReconcile,
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

  // (g1) Crown Payroll (CROWN slots only)
  const payroll = computeMonthlyPayroll(cubes, input.population);
  const owed = Math.max(0, input.arrears) + payroll.due;
  const paid = Math.min(gold, owed);
  gold = Math.max(0, gold - paid);
  const nextArrears = Math.max(0, owed - paid);

  const distRes = distributePayrollToCitizens(
    citizens,
    cubes,
    input.population,
    paid
  );
  citizens = distRes.citizens;
  citizenWealth = sumCitizenWealth(citizens);

  pushLedger('payroll', -paid, 'رواتب الشهر');

  // (g2) Private Payroll (owners pay their own workers from personal wealth; never touches treasury/arrears)
  const privPayRes = runPrivatePayroll({
    citizens,
    privateAds,
    totalMonths: nextTotalMonths,
  });
  citizens = privPayRes.citizens;
  privateAds = privPayRes.privateAds;
  citizenWealth = privPayRes.citizenWealth;

  // (h) Flush accumulated monthly business tax (already in gold; emit single monthly ledger row)
  const businessTaxCollected = Math.max(
    0,
    Math.floor(input.monthlyBusinessTax)
  );
  if (businessTaxCollected > 0) {
    pushLedger('shop', businessTaxCollected, 'ضرائب أعمال خاصة');
  }

  // (i) Citizen Spending (food -> leisure, idempotent on lastSpentMonth)
  const staffingForSpending = computeStaffing(cubes, input.population, citizens);
  const spendRes = runCitizenSpending({
    cubes,
    warehouse,
    gold,
    population: input.population,
    inflationIndex: input.inflationIndex,
    citizens,
    totalMonths: nextTotalMonths,
    lastSpentMonth: input.lastSpentMonth,
    palaceOfPeople: input.palaceOfPeople,
    staffedSlots: staffingForSpending.staffedSlots,
    rng: input.rng,
  });
  warehouse = spendRes.warehouse;
  gold = spendRes.gold;
  citizens = spendRes.citizens;
  citizenWealth = spendRes.citizenWealth;
  let palaceOfPeople = spendRes.palaceOfPeople;
  const nextLastSpentMonth = spendRes.lastSpentMonth;
  for (const item of spendRes.ledgerItems) {
    pushLedger(item.kind, item.amount, item.labelAr);
  }

  // Hook processBankMonth (installments, bank trading, scoreboard)
  const bankRes = processBankMonth({
    cubes,
    gold,
    palaceOfPeople,
    bankTrust: input.bankTrust ?? 70,
    bankLoans: input.bankLoans ?? [],
    peoplesBank: input.peoplesBank ?? { gold: 5000, portfolio: {}, totalTrades: 0, lastTradeMonth: null, lastTradeAr: null },
    prices: input.prices,
    dailyBought: input.dailyBought ?? {},
    dailySold: input.dailySold ?? {},
    totalMonths: nextTotalMonths,
    day: input.day,
    lastBankNetWorthWarnMonth: input.lastBankNetWorthWarnMonth ?? 0,
    isOffline: input.isOffline,
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
  for (const fax of bankRes.officeFaxes) {
    officeFaxes = [...officeFaxes, fax];
  }

  // (j1) Private Construction on approved empty plots
  const constructRes = processPrivateConstruction({
    cubes,
    citizens,
    warehouse,
    prices: input.prices,
    gold,
    now: input.now,
  });
  cubes = constructRes.cubes;
  citizens = constructRes.citizens;
  warehouse = constructRes.warehouse;
  gold = constructRes.gold;
  citizenWealth = constructRes.citizenWealth;
  for (const item of constructRes.ledgerItems) {
    pushLedger(item.kind, item.amount, item.labelAr);
  }

  const lastMonthStats: LastMonthStats = {
    ...spendRes.lastMonthStats,
    businessTax: businessTaxCollected,
    importSink: spendRes.lastMonthStats.importSink + constructRes.importSink,
  };

  // (j2) Land Requests: expire old unanswered (>2 months) & generate up to 1 new request
  const landReqRes = runMonthlyLandRequests({
    cubes,
    citizens,
    landRequests: input.landRequests,
    totalMonths: nextTotalMonths,
  });
  const nextLandRequests = landReqRes.landRequests;

  // (k) Private Job Ads sync & Private Labor Matching (after crown matching & construction)
  const privMatchRes = runPrivateLaborMatching({
    cubes,
    citizens,
    privateAds,
    totalMonths: nextTotalMonths,
  });
  privateAds = privMatchRes.privateAds;
  citizens = privMatchRes.citizens;
  citizenWealth = sumCitizenWealth(citizens);

  const lastPayroll: PayrollRecord = {
    day: input.day,
    workers: payroll.workers,
    due: payroll.due,
    paid,
  };

  return {
    totalMonths: nextTotalMonths,
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
    ledgerItems,
    paid,
    unheldSlots: distRes.unheldSlots,
    citizenSpentTotal: spendRes.totalCitizenSpent,
    businessTaxCollected,
    offlineBankStats: bankRes.offlineStats,
    summary: {
      births: recRes.birthsCount,
      cvsFiled: agingRes.cvsFiled + recRes.cvsFiledCount,
      marriages: marriageRes.marriagesCount,
      housingGranted: housingRes.housingGranted,
      faxesSent: housingRes.faxesSent,
      privateBuilt: constructRes.builtCount,
      privateReverted: constructRes.revertedCount + emigCleanup.revertedPlots,
      landRequestsGenerated: landReqRes.generated ? 1 : 0,
      privateWagesPaid: privPayRes.privateWagesPaid,
    },
  };
}
