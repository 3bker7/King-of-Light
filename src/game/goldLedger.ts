import { MAX_LEDGER_ENTRIES } from './constants';
import type {
  Citizen,
  LedgerEntry,
  LedgerKind,
  PalaceOfPeople,
  PeoplesBank,
} from './types';

export type GoldAccount = 'treasury' | 'citizens' | 'palace' | 'bank';

export const ACCOUNT_LABELS_AR: Record<GoldAccount, string> = {
  treasury: 'الخزينة',
  citizens: 'المواطنون',
  palace: 'قصر الشعب',
  bank: 'بنك الشعب',
};

export interface GoldStateSlice {
  gold: number;
  citizenWealth: number;
  palaceOfPeople: PalaceOfPeople;
  peoplesBank: PeoplesBank;
  ledger: LedgerEntry[];
  day: number;
  citizens?: Citizen[];
}

export interface CitizenGoldShare {
  citizenId: number;
  amount: number;
}

export interface TransferGoldParams {
  from: GoldAccount;
  to: GoldAccount;
  amount: number;
  kind: LedgerKind;
  labelAr: string;
  citizenId?: number;
  citizenShares?: ReadonlyArray<CitizenGoldShare>;
  exact?: boolean;
  logNonTreasury?: boolean;
  day?: number;
}

export interface TransferGoldResult<S extends GoldStateSlice> {
  state: S;
  moved: number;
  ok: boolean;
}

let goldLedgerSeq = 1;

export function syncGoldLedgerCounter(ledger: ReadonlyArray<LedgerEntry>): void {
  for (let i = 0; i < ledger.length; i++) {
    const entry = ledger[i];
    if (!entry || typeof entry.id !== 'string') continue;
    const match = /^led-\d+-(\d+)$/.exec(entry.id);
    if (match) {
      const seq = Number(match[1]);
      if (Number.isFinite(seq) && seq > goldLedgerSeq) {
        goldLedgerSeq = seq;
      }
    }
  }
}

export function appendGoldLedgerEntry(
  existing: LedgerEntry[],
  day: number,
  kind: LedgerKind,
  amount: number,
  labelAr: string
): LedgerEntry[] {
  goldLedgerSeq += 1;
  const entry: LedgerEntry = {
    id: `led-${day}-${goldLedgerSeq}`,
    day,
    kind,
    amount,
    labelAr,
  };
  const next = [...existing, entry];
  return next.length > MAX_LEDGER_ENTRIES
    ? next.slice(next.length - MAX_LEDGER_ENTRIES)
    : next;
}

export function formatTransferLabelAr(
  from: GoldAccount,
  to: GoldAccount,
  detail: string
): string {
  const trimmed = detail.trim();
  const route = `${ACCOUNT_LABELS_AR[from]} ← ${ACCOUNT_LABELS_AR[to]}`;
  if (trimmed.length === 0) return route;
  if (trimmed.includes('←')) return trimmed;
  return `${route} — ${trimmed}`;
}

export function createOpeningEndowmentLedger(params: {
  treasuryGold: number;
  palaceGold: number;
  bankGold: number;
  citizenGold?: number;
}): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  const t = Math.max(0, Math.floor(params.treasuryGold));
  const p = Math.max(0, Math.floor(params.palaceGold));
  const b = Math.max(0, Math.floor(params.bankGold));
  const c = Math.max(0, Math.floor(params.citizenGold ?? 0));

  if (t > 0) {
    entries.push({
      id: 'led-0-init-treasury',
      day: 0,
      kind: 'gift',
      amount: t,
      labelAr: `تأسيس ← ${ACCOUNT_LABELS_AR.treasury} — رصيد افتتاحي`,
    });
  }
  if (p > 0) {
    entries.push({
      id: 'led-0-init-palace',
      day: 0,
      kind: 'gift',
      amount: p,
      labelAr: `تأسيس ← ${ACCOUNT_LABELS_AR.palace} — وقف صندوق السوق`,
    });
  }
  if (b > 0) {
    entries.push({
      id: 'led-0-init-bank',
      day: 0,
      kind: 'gift',
      amount: b,
      labelAr: `تأسيس ← ${ACCOUNT_LABELS_AR.bank} — رأس مال تأسيسي`,
    });
  }
  if (c > 0) {
    entries.push({
      id: 'led-0-init-citizens',
      day: 0,
      kind: 'gift',
      amount: c,
      labelAr: `تأسيس ← ${ACCOUNT_LABELS_AR.citizens} — ثروة ابتدائية`,
    });
  }
  return entries;
}

function readAccountBalance(state: GoldStateSlice, account: GoldAccount): number {
  let raw = 0;
  switch (account) {
    case 'treasury':
      raw = state.gold;
      break;
    case 'citizens':
      raw = state.citizenWealth;
      break;
    case 'palace':
      raw = state.palaceOfPeople.gold;
      break;
    case 'bank':
      raw = state.peoplesBank.gold;
      break;
  }
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

export function totalWorldGold(
  state: Pick<
    GoldStateSlice,
    'gold' | 'citizenWealth' | 'palaceOfPeople' | 'peoplesBank'
  >
): number {
  const t = Number.isFinite(state.gold) ? state.gold : 0;
  const c = Number.isFinite(state.citizenWealth) ? state.citizenWealth : 0;
  const p = Number.isFinite(state.palaceOfPeople?.gold)
    ? state.palaceOfPeople.gold
    : 0;
  const b = Number.isFinite(state.peoplesBank?.gold)
    ? state.peoplesBank.gold
    : 0;
  return t + c + p + b;
}

export function transferGold<S extends GoldStateSlice>(
  state: S,
  params: TransferGoldParams
): TransferGoldResult<S> {
  const { from, to, kind, labelAr, exact = false, logNonTreasury = false } = params;

  if (from === to) {
    return { state, moved: 0, ok: false };
  }
  if (!Number.isFinite(params.amount)) {
    return { state, moved: 0, ok: false };
  }
  const requested = Math.floor(params.amount);
  if (requested <= 0) {
    return { state, moved: 0, ok: false };
  }

  let moved = 0;
  let nextCitizens: Citizen[] | undefined = state.citizens;

  const hasShares =
    Array.isArray(params.citizenShares) && params.citizenShares.length > 0;
  const hasSingleCitizen =
    !hasShares &&
    typeof params.citizenId === 'number' &&
    Number.isFinite(params.citizenId);

  if (from === 'citizens' && hasShares) {
    if (!state.citizens) {
      return { state, moved: 0, ok: false };
    }
    const citizenById = new Map<number, Citizen>();
    for (const c of state.citizens) citizenById.set(c.id, c);

    const requestedByCitizen = new Map<number, number>();
    for (const share of params.citizenShares!) {
      if (!Number.isFinite(share.amount)) continue;
      const amt = Math.floor(share.amount);
      if (amt <= 0) continue;
      if (!citizenById.has(share.citizenId)) {
        return { state, moved: 0, ok: false };
      }
      requestedByCitizen.set(
        share.citizenId,
        (requestedByCitizen.get(share.citizenId) ?? 0) + amt
      );
    }

    const totalCitizenPool = readAccountBalance(state, 'citizens');
    let remainingPool = Math.min(requested, totalCitizenPool);
    const appliedByCitizen = new Map<number, number>();
    let totalApplied = 0;

    for (const [cid, reqAmt] of requestedByCitizen.entries()) {
      if (remainingPool <= 0) break;
      const c = citizenById.get(cid)!;
      const avail = Math.max(0, Math.floor(Number.isFinite(c.wealth) ? c.wealth : 0));
      const take = Math.min(reqAmt, avail, remainingPool);
      if (take > 0) {
        appliedByCitizen.set(cid, take);
        totalApplied += take;
        remainingPool -= take;
      }
    }

    if (exact && totalApplied < requested) {
      return { state, moved: 0, ok: false };
    }
    if (totalApplied <= 0) {
      return { state, moved: 0, ok: false };
    }

    moved = totalApplied;
    nextCitizens = state.citizens.map((c) => {
      const dec = appliedByCitizen.get(c.id);
      if (!dec) return c;
      return { ...c, wealth: Math.max(0, c.wealth - dec) };
    });
  } else if (to === 'citizens' && hasShares) {
    if (!state.citizens) {
      return { state, moved: 0, ok: false };
    }
    const citizenById = new Map<number, Citizen>();
    for (const c of state.citizens) citizenById.set(c.id, c);

    const shareByCitizen = new Map<number, number>();
    let shareSum = 0;
    for (const share of params.citizenShares!) {
      if (!Number.isFinite(share.amount)) continue;
      const amt = Math.floor(share.amount);
      if (amt <= 0) continue;
      if (!citizenById.has(share.citizenId)) {
        return { state, moved: 0, ok: false };
      }
      shareByCitizen.set(
        share.citizenId,
        (shareByCitizen.get(share.citizenId) ?? 0) + amt
      );
      shareSum += amt;
    }

    const payerAvail = readAccountBalance(state, from);
    const cap = Math.min(requested, payerAvail, shareSum);
    if (exact && cap < requested) {
      return { state, moved: 0, ok: false };
    }
    if (cap <= 0) {
      return { state, moved: 0, ok: false };
    }

    let remaining = cap;
    const appliedByCitizen = new Map<number, number>();
    let totalApplied = 0;
    for (const [cid, shareAmt] of shareByCitizen.entries()) {
      if (remaining <= 0) break;
      const give = Math.min(shareAmt, remaining);
      if (give > 0) {
        appliedByCitizen.set(cid, give);
        totalApplied += give;
        remaining -= give;
      }
    }
    if (totalApplied <= 0) {
      return { state, moved: 0, ok: false };
    }

    moved = totalApplied;
    nextCitizens = state.citizens.map((c) => {
      const inc = appliedByCitizen.get(c.id);
      if (!inc) return c;
      return { ...c, wealth: c.wealth + inc };
    });
  } else if ((from === 'citizens' || to === 'citizens') && hasSingleCitizen) {
    const cid = params.citizenId!;
    let targetIdx = -1;
    if (state.citizens) {
      targetIdx = state.citizens.findIndex((c) => c.id === cid);
      if (targetIdx === -1) {
        return { state, moved: 0, ok: false };
      }
    }

    let payerAvail = readAccountBalance(state, from);
    if (from === 'citizens' && state.citizens && targetIdx >= 0) {
      const cWealth = state.citizens[targetIdx].wealth;
      const safeCWealth = Number.isFinite(cWealth)
        ? Math.max(0, Math.floor(cWealth))
        : 0;
      payerAvail = Math.min(payerAvail, safeCWealth);
    }

    if (exact && payerAvail < requested) {
      return { state, moved: 0, ok: false };
    }
    moved = Math.min(requested, payerAvail);
    if (moved <= 0) {
      return { state, moved: 0, ok: false };
    }

    if (state.citizens && targetIdx >= 0) {
      nextCitizens = state.citizens.map((c, idx) => {
        if (idx !== targetIdx) return c;
        const nextW = from === 'citizens' ? Math.max(0, c.wealth - moved) : c.wealth + moved;
        return { ...c, wealth: nextW };
      });
    }
  } else {
    const payerAvail = readAccountBalance(state, from);
    if (exact && payerAvail < requested) {
      return { state, moved: 0, ok: false };
    }
    moved = Math.min(requested, payerAvail);
    if (moved <= 0) {
      return { state, moved: 0, ok: false };
    }
  }

  let nextGold = state.gold;
  let nextCitizenWealth = state.citizenWealth;
  let nextPalace = state.palaceOfPeople;
  let nextBank = state.peoplesBank;

  switch (from) {
    case 'treasury':
      nextGold -= moved;
      break;
    case 'citizens':
      nextCitizenWealth -= moved;
      break;
    case 'palace':
      nextPalace = { ...nextPalace, gold: nextPalace.gold - moved };
      break;
    case 'bank':
      nextBank = { ...nextBank, gold: nextBank.gold - moved };
      break;
  }

  switch (to) {
    case 'treasury':
      nextGold += moved;
      break;
    case 'citizens':
      nextCitizenWealth += moved;
      break;
    case 'palace':
      nextPalace = { ...nextPalace, gold: nextPalace.gold + moved };
      break;
    case 'bank':
      nextBank = { ...nextBank, gold: nextBank.gold + moved };
      break;
  }

  const involvesTreasury = from === 'treasury' || to === 'treasury';
  let nextLedger = state.ledger;
  if (involvesTreasury) {
    const signedAmount = to === 'treasury' ? moved : -moved;
    nextLedger = appendGoldLedgerEntry(
      state.ledger,
      params.day ?? state.day,
      kind,
      signedAmount,
      formatTransferLabelAr(from, to, labelAr)
    );
  } else if (logNonTreasury) {
    nextLedger = appendGoldLedgerEntry(
      state.ledger,
      params.day ?? state.day,
      kind,
      0,
      formatTransferLabelAr(from, to, `${labelAr} (${moved})`)
    );
  }

  const nextState: S = {
    ...state,
    gold: nextGold,
    citizenWealth: nextCitizenWealth,
    palaceOfPeople: nextPalace,
    peoplesBank: nextBank,
    ledger: nextLedger,
    ...(state.citizens !== undefined ? { citizens: nextCitizens } : {}),
  };

  return { state: nextState, moved, ok: true };
}
