import { BASE_BUY_PRICES, STRINGS, TRADED_RESOURCES } from './constants';
import { findPalaceCube, getCubePurchasePrice } from './production';
import type {
  BankLoan,
  Cube,
  GameState,
  LedgerEntry,
  OfficeFax,
  PalaceOfPeople,
  PeoplesBank,
  ThemeId,
  TradedResourceKey,
} from './types';

// ============================================================================
// B1. CONSTANTS (Exact values from B1 specification)
// ============================================================================
export const BANK_PROFIT_RATE = 0.10;
export const LOAN_TERMS = [3, 6, 12] as const;
export type LoanTermMonths = (typeof LOAN_TERMS)[number];
export const MIN_LOAN = 100;
export const TRUST_START = 70;
export const TRUST_DELTA_REPAID = 10;
export const TRUST_DELTA_MISSED = -5;
export const TRUST_DELTA_DEFAULT = -40;
export const MISSES_TO_DEFAULT = 3;
export const PALACE_START_GOLD = 1000;
export const BANK_START_GOLD = 5000;
export const BANK_RESERVE_FLOOR = 1000;
export const BANK_TRADE_UNITS = 10;
export const BANK_PORTFOLIO_CAP = 50;
export const BANK_BUY_AT = 0.85;
export const BANK_SELL_AT = 1.20;
export const BUYBACK_START_MULT = 1.2;

export function getMaxLoan(trust: number): number {
  const clampedTrust = Math.max(0, Math.min(100, Math.floor(trust)));
  return 100 + clampedTrust * 19;
}

export function computeRepayable(principal: number): number {
  return Math.round(principal * (1 + BANK_PROFIT_RATE));
}

export function getScheduledInstallment(
  repayable: number,
  termMonths: LoanTermMonths,
  monthsElapsed: number,
  paidSoFar: number
): number {
  if (monthsElapsed + 1 >= termMonths) {
    return Math.max(0, repayable - paidSoFar);
  }
  return Math.min(repayable - paidSoFar, Math.ceil(repayable / termMonths));
}

export function isEligibleCollateralCube(
  cubes: Cube[],
  cube: Cube,
  palaceCubeId: number | null
): boolean {
  if (cube.owner !== 'player') return false;
  if (cube.themeId !== null || cube.secondThemeId !== null) return false;
  if (cube.isRocky) return false;
  if (palaceCubeId !== null && cube.id === palaceCubeId) return false;
  if (cube.privateOwnerId != null) return false;
  if (cube.collateralLoanId != null) return false;
  return true;
}

export function getBankCubeAskPrice(
  cubes: Cube[],
  cube: Cube,
  currentMonth: number
): number {
  const plainPrice = getCubePurchasePrice(cubes, cube);
  const seizedMonth = cube.bankSeizedMonth ?? currentMonth;
  const heldMonths = Math.max(0, currentMonth - seizedMonth);
  const clampedHeld = Math.min(12, heldMonths);
  // Linearly decays from 1.2 at 0 months to 1.0 at 12 months held
  const mult = BUYBACK_START_MULT - 0.2 * (clampedHeld / 12);
  return Math.max(plainPrice, Math.round(plainPrice * mult));
}

export function computePeoplesBankNetWorth(
  peoplesBank: PeoplesBank,
  cubes: Cube[],
  prices: Record<string, number>,
  currentMonth: number
): number {
  let total = peoplesBank.gold;
  for (const [res, count] of Object.entries(peoplesBank.portfolio)) {
    if (typeof count === 'number' && count > 0) {
      const price = prices[res] ?? BASE_BUY_PRICES[res as TradedResourceKey] ?? 1;
      total += count * price;
    }
  }
  for (const cube of cubes) {
    if (cube.owner === 'bank') {
      total += getBankCubeAskPrice(cubes, cube, currentMonth);
    }
  }
  return total;
}

export function sanitizeBankCubesOnHydrate(
  cubes: Cube[],
  currentMonth: number
): Cube[] {
  return cubes.map((cube) => {
    if (cube.owner === 'bank') {
      const ask =
        typeof cube.bankAskPrice === 'number' && cube.bankAskPrice > 0
          ? cube.bankAskPrice
          : Math.round(getCubePurchasePrice(cubes, cube) * BUYBACK_START_MULT);
      return {
        ...cube,
        owner: 'bank' as const,
        collateralLoanId: null,
        bankSeizedMonth:
          typeof cube.bankSeizedMonth === 'number'
            ? cube.bankSeizedMonth
            : currentMonth,
        bankAskPrice: ask,
      };
    }
    return {
      ...cube,
      collateralLoanId: cube.collateralLoanId ?? null,
    };
  });
}

// ============================================================================
// B2 & B3. MONTHLY PROCESSOR BANK HOOK
// ============================================================================
export interface ProcessBankMonthInput {
  cubes: Cube[];
  gold: number;
  palaceOfPeople: PalaceOfPeople;
  bankTrust: number;
  bankLoans: BankLoan[];
  peoplesBank: PeoplesBank;
  prices: Record<string, number>;
  dailyBought: Record<string, number>;
  dailySold: Record<string, number>;
  totalMonths: number;
  day: number;
  lastBankNetWorthWarnMonth: number;
  isOffline?: boolean;
}

export interface ProcessBankMonthResult {
  cubes: Cube[];
  gold: number;
  palaceOfPeople: PalaceOfPeople;
  bankTrust: number;
  bankLoans: BankLoan[];
  peoplesBank: PeoplesBank;
  dailyBought: Record<string, number>;
  dailySold: Record<string, number>;
  lastBankNetWorthWarnMonth: number;
  ledgerItems: Array<{ kind: 'trade' | 'land'; amount: number; labelAr: string }>;
  officeFaxes: OfficeFax[];
  toastMsg?: { message: string; tone: 'info' | 'success' | 'warning' };
  offlineStats?: {
    loanInstallmentsPaid: number;
    loanDeferredAdded: number;
    bankTradesCount: number;
  };
}

export function processBankMonth(
  input: ProcessBankMonthInput
): ProcessBankMonthResult {
  let cubes = input.cubes.map((c) => ({ ...c }));
  let gold = Math.max(0, Math.floor(input.gold));
  let palaceOfPeople: PalaceOfPeople = {
    gold: Math.max(0, Math.floor(input.palaceOfPeople.gold)),
  };
  let bankTrust = Math.max(0, Math.min(100, Math.floor(input.bankTrust)));
  let bankLoans: BankLoan[] = input.bankLoans.map((l) => ({ ...l }));
  let peoplesBank: PeoplesBank = {
    gold: Math.max(0, Math.floor(input.peoplesBank.gold)),
    portfolio: { ...input.peoplesBank.portfolio },
    lastTradeAr: input.peoplesBank.lastTradeAr,
  };
  const dailyBought = { ...input.dailyBought };
  const dailySold = { ...input.dailySold };
  let lastBankNetWorthWarnMonth = input.lastBankNetWorthWarnMonth;
  const ledgerItems: Array<{ kind: 'trade' | 'land'; amount: number; labelAr: string }> = [];
  const officeFaxes: OfficeFax[] = [];
  let toastMsg: { message: string; tone: 'info' | 'success' | 'warning' } | undefined;
  const offlineStats = {
    loanInstallmentsPaid: 0,
    loanDeferredAdded: 0,
    bankTradesCount: 0,
  };

  // 1. Process active loan installments
  const activeLoanIndex = bankLoans.findIndex((l) => l.status === 'active');
  if (activeLoanIndex !== -1) {
    const loan = bankLoans[activeLoanIndex];
    const scheduled = getScheduledInstallment(
      loan.repayable,
      loan.termMonths as LoanTermMonths,
      loan.monthsElapsed,
      loan.paidSoFar
    );
    const due = Math.min(loan.repayable - loan.paidSoFar, loan.deferredDue + scheduled);

    if (input.isOffline) {
      if (gold >= due) {
        gold -= due;
        palaceOfPeople.gold += due;
        loan.paidSoFar += due;
        loan.deferredDue = 0;
        loan.monthsElapsed += 1;
        offlineStats.loanInstallmentsPaid += due;
        ledgerItems.push({
          kind: 'trade',
          amount: -due,
          labelAr: 'قسط تمويل البنك الشرعي',
        });
        if (loan.paidSoFar >= loan.repayable) {
          loan.status = 'repaid';
          bankTrust = Math.min(100, bankTrust + TRUST_DELTA_REPAID);
          for (const cid of loan.collateralCubeIds) {
            const cube = cubes[cid];
            if (cube && cube.collateralLoanId === loan.id) {
              cube.collateralLoanId = null;
            }
          }
        }
      } else {
        // Broke offline: defer, no missedCount increment, NO seizure offline
        loan.deferredDue = Math.min(
          loan.repayable - loan.paidSoFar,
          loan.deferredDue + scheduled
        );
        loan.monthsElapsed += 1;
        offlineStats.loanDeferredAdded += scheduled;
      }
    } else {
      // Active play month
      if (gold >= due) {
        gold -= due;
        palaceOfPeople.gold += due;
        loan.paidSoFar += due;
        loan.deferredDue = 0;
        loan.monthsElapsed += 1;
        ledgerItems.push({
          kind: 'trade',
          amount: -due,
          labelAr: 'قسط تمويل البنك الشرعي',
        });
        if (loan.paidSoFar >= loan.repayable) {
          loan.status = 'repaid';
          bankTrust = Math.min(100, bankTrust + TRUST_DELTA_REPAID);
          for (const cid of loan.collateralCubeIds) {
            const cube = cubes[cid];
            if (cube && cube.collateralLoanId === loan.id) {
              cube.collateralLoanId = null;
            }
          }
          toastMsg = {
            message: 'تم سداد التمويل بالكامل بنجاح وارتفعت ثقة البنك الشرعي',
            tone: 'success',
          };
        }
      } else {
        // Active miss
        loan.missedCount += 1;
        loan.deferredDue = Math.min(
          loan.repayable - loan.paidSoFar,
          loan.deferredDue + scheduled
        );
        loan.monthsElapsed += 1;
        bankTrust = Math.max(0, bankTrust + TRUST_DELTA_MISSED);
        officeFaxes.push({
          id: `fax-bank-${input.totalMonths}-${loan.missedCount}`,
          month: input.totalMonths,
          office: 'bank',
          textAr: `البنك الشرعي: تعذّر سداد قسط هذا الشهر (${loan.missedCount}/3) — الأراضي المرهونة في خطر`,
        });

        if (loan.missedCount >= MISSES_TO_DEFAULT) {
          // B3 Seizure (atomic): all collateral cubes transfer to bank
          loan.status = 'defaulted';
          bankTrust = Math.max(0, bankTrust + TRUST_DELTA_DEFAULT);
          for (const cid of loan.collateralCubeIds) {
            const cube = cubes[cid];
            if (cube) {
              cube.owner = 'bank';
              cube.collateralLoanId = null;
              cube.bankSeizedMonth = input.totalMonths;
              cube.bankAskPrice = Math.round(
                getCubePurchasePrice(cubes, cube) * BUYBACK_START_MULT
              );
            }
          }
          officeFaxes.push({
            id: `fax-seize-${input.totalMonths}`,
            month: input.totalMonths,
            office: 'bank',
            textAr: `بنك الشعب استلم ${loan.collateralCubeIds.length} أرض محجوزة من البنك الشرعي`,
          });
          toastMsg = {
            message: `تم حجز ${loan.collateralCubeIds.length} أرض لصالح بنك الشعب لتعثر السداد`,
            tone: 'warning',
          };
        }
      }
    }
  }

  // 2. People's Bank monthly bourse trading (B3)
  const trades: string[] = [];
  for (const res of TRADED_RESOURCES) {
    const base = BASE_BUY_PRICES[res];
    if (typeof base !== 'number') continue;
    const price = input.prices[res] ?? base;
    const currentPortfolio = peoplesBank.portfolio[res] ?? 0;
    const buyThreshold = 0.85 * base;
    const sellThreshold = 1.20 * base;

    if (
      price <= buyThreshold &&
      peoplesBank.gold - 10 * price > BANK_RESERVE_FLOOR &&
      currentPortfolio < BANK_PORTFOLIO_CAP
    ) {
      peoplesBank.gold -= 10 * price;
      peoplesBank.portfolio[res] = currentPortfolio + BANK_TRADE_UNITS;
      dailyBought[res] = (dailyBought[res] ?? 0) + BANK_TRADE_UNITS;
      trades.push(`اشترى 10 ${STRINGS.resources[res] ?? res}`);
    } else if (price >= sellThreshold && currentPortfolio >= BANK_TRADE_UNITS) {
      const proceeds = BANK_TRADE_UNITS * Math.round(price * 0.7);
      peoplesBank.gold += proceeds;
      peoplesBank.portfolio[res] = currentPortfolio - BANK_TRADE_UNITS;
      dailySold[res] = (dailySold[res] ?? 0) + BANK_TRADE_UNITS;
      trades.push(`باع 10 ${STRINGS.resources[res] ?? res}`);
    }
  }

  if (trades.length > 0) {
    peoplesBank.lastTradeAr = trades.join('، ');
    if (input.isOffline) {
      offlineStats.bankTradesCount += trades.length;
    }
  } else {
    peoplesBank.lastTradeAr = 'لم يتداول هذا الشهر';
  }

  // 3. People's Bank scoreboard check (B3)
  const netWorth = computePeoplesBankNetWorth(
    peoplesBank,
    cubes,
    input.prices,
    input.totalMonths
  );
  if (netWorth > 3 * Math.max(1, gold)) {
    if (
      lastBankNetWorthWarnMonth === 0 ||
      input.totalMonths - lastBankNetWorthWarnMonth >= 3
    ) {
      officeFaxes.push({
        id: `fax-bankwarn-${input.totalMonths}`,
        month: input.totalMonths,
        office: 'bank',
        textAr: `تحذير: ثروة بنك الشعب (${netWorth}) تجاوزت 3 أضعاف خزنتك — البوت يكسب`,
      });
      lastBankNetWorthWarnMonth = input.totalMonths;
    }
  }

  return {
    cubes,
    gold,
    palaceOfPeople,
    bankTrust,
    bankLoans,
    peoplesBank,
    dailyBought,
    dailySold,
    lastBankNetWorthWarnMonth,
    ledgerItems,
    officeFaxes,
    toastMsg,
    offlineStats,
  };
}

// ============================================================================
// B2 & B3. REDUCER ACTIONS: TAKE_LOAN, REPAY_LOAN_FULL, BUYBACK_CUBE
// ============================================================================
export function executeTakeLoan(
  state: GameState,
  action: {
    principal: number;
    termMonths: 3 | 6 | 12;
    collateralCubeIds: number[];
  }
): { state: GameState; success: boolean; errorAr?: string } {
  const principal = Math.floor(action.principal);
  const maxLoanVal = getMaxLoan(state.bankTrust);

  if (principal < MIN_LOAN || principal > maxLoanVal) {
    return { state, success: false, errorAr: 'مبلغ التمويل خارج الحدود المسموحة' };
  }
  if (!LOAN_TERMS.includes(action.termMonths as any)) {
    return { state, success: false, errorAr: 'مدة التمويل غير صالحة' };
  }
  if (state.bankLoans.some((l) => l.status === 'active')) {
    return { state, success: false, errorAr: 'يوجد تمويل قائم بالفعل' };
  }
  if (!Array.isArray(action.collateralCubeIds) || action.collateralCubeIds.length === 0) {
    return { state, success: false, errorAr: 'يجب اختيار أراضٍ مرهونة' };
  }
  const uniqueIds = new Set(action.collateralCubeIds);
  if (uniqueIds.size !== action.collateralCubeIds.length) {
    return { state, success: false, errorAr: 'تكرار في اختيار الأراضي المرهونة' };
  }

  const palace = findPalaceCube(state.cubes);
  const palaceCubeId = palace ? palace.id : null;

  let collateralTotalValue = 0;
  for (const cid of action.collateralCubeIds) {
    const cube = state.cubes[cid];
    if (!cube || !isEligibleCollateralCube(state.cubes, cube, palaceCubeId)) {
      return { state, success: false, errorAr: 'أحد الأراضي المختارة غير مؤهلة للرهن' };
    }
    collateralTotalValue += getCubePurchasePrice(state.cubes, cube);
  }

  if (collateralTotalValue < principal) {
    return { state, success: false, errorAr: 'قيمة الأراضي المرهونة أقل من مبلغ التمويل' };
  }
  if (state.palaceOfPeople.gold < principal) {
    return { state, success: false, errorAr: 'سيولة قصر الشعب غير كافية لتقديم هذا التمويل' };
  }

  const loanId = `loan-${state.totalMonths}-${Date.now()}`;
  const repayable = computeRepayable(principal);
  const newLoan: BankLoan = {
    id: loanId,
    principal,
    repayable,
    paidSoFar: 0,
    termMonths: action.termMonths,
    monthsElapsed: 0,
    missedCount: 0,
    deferredDue: 0,
    collateralCubeIds: [...action.collateralCubeIds],
    status: 'active',
    startMonth: state.totalMonths,
  };

  const nextCubes = state.cubes.map((c) =>
    uniqueIds.has(c.id) ? { ...c, collateralLoanId: loanId } : c
  );

  const nextLedger: LedgerEntry = {
    id: `tx-loan-${state.day}-${Date.now()}`,
    day: state.day,
    kind: 'trade',
    amount: principal,
    labelAr: 'تمويل البنك الشرعي',
  };

  return {
    state: {
      ...state,
      cubes: nextCubes,
      gold: state.gold + principal,
      palaceOfPeople: { gold: state.palaceOfPeople.gold - principal },
      bankLoans: [...state.bankLoans, newLoan],
      ledger: [...state.ledger, nextLedger],
    },
    success: true,
  };
}

export function executeRepayLoanFull(state: GameState): {
  state: GameState;
  success: boolean;
  errorAr?: string;
} {
  const activeLoan = state.bankLoans.find((l) => l.status === 'active');
  if (!activeLoan) {
    return { state, success: false, errorAr: 'لا يوجد تمويل قائم للسداد' };
  }

  const remaining = activeLoan.repayable - activeLoan.paidSoFar;
  if (state.gold < remaining) {
    return { state, success: false, errorAr: 'الذهب غير كافٍ لسداد كامل التمويل' };
  }

  const collateralSet = new Set(activeLoan.collateralCubeIds);
  const nextCubes = state.cubes.map((c) =>
    collateralSet.has(c.id) && c.collateralLoanId === activeLoan.id
      ? { ...c, collateralLoanId: null }
      : c
  );

  const updatedLoans = state.bankLoans.map((l) =>
    l.id === activeLoan.id
      ? {
          ...l,
          paidSoFar: l.repayable,
          status: 'repaid' as const,
          deferredDue: 0,
        }
      : l
  );

  const nextLedger: LedgerEntry = {
    id: `tx-repay-${state.day}-${Date.now()}`,
    day: state.day,
    kind: 'trade',
    amount: -remaining,
    labelAr: 'سداد كامل مبكر لتمويل البنك الشرعي',
  };

  return {
    state: {
      ...state,
      cubes: nextCubes,
      gold: state.gold - remaining,
      palaceOfPeople: { gold: state.palaceOfPeople.gold + remaining },
      bankTrust: Math.min(100, state.bankTrust + TRUST_DELTA_REPAID),
      bankLoans: updatedLoans,
      ledger: [...state.ledger, nextLedger],
    },
    success: true,
  };
}

export function executeBuybackCube(
  state: GameState,
  cubeId: number
): { state: GameState; success: boolean; errorAr?: string } {
  const cube = state.cubes[cubeId];
  if (!cube || cube.owner !== 'bank') {
    return { state, success: false, errorAr: 'هذه الأرض ليست بحوزة بنك الشعب' };
  }

  const askPrice = getBankCubeAskPrice(state.cubes, cube, state.totalMonths);
  if (state.gold < askPrice) {
    return { state, success: false, errorAr: 'الذهب غير كافٍ لاسترداد الأرض' };
  }

  const nextCubes = state.cubes.map((c) =>
    c.id === cubeId
      ? {
          ...c,
          owner: 'player' as const,
          collateralLoanId: null,
          bankSeizedMonth: null,
          bankAskPrice: null,
        }
      : c
  );

  const nextLedger: LedgerEntry = {
    id: `tx-buyback-${state.day}-${Date.now()}`,
    day: state.day,
    kind: 'land',
    amount: -askPrice,
    labelAr: 'استرداد أرض من بنك الشعب',
  };

  return {
    state: {
      ...state,
      cubes: nextCubes,
      gold: state.gold - askPrice,
      peoplesBank: {
        ...state.peoplesBank,
        gold: state.peoplesBank.gold + askPrice,
      },
      ledger: [...state.ledger, nextLedger],
    },
    success: true,
  };
}
