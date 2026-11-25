import { computeMonthlyPayroll } from './payroll';
import type {
  Cube,
  Decree,
  DecreeKind,
  LastMonthStats,
  PayrollRecord,
  PrivateAd,
  TaxPolicyMode,
} from './types';

export const MAX_DECREES = 40;
export const LONG_TERM_ACTUAL_AR = 'أثر طويل الأمد — يُقاس بميزان المملكة';

let decreeCounter = 1;

export interface LogDecreeInput {
  month: number;
  kind: DecreeKind;
  labelAr: string;
  projectedAr: string;
  projectedValue: number | null;
  taxMode?: TaxPolicyMode;
}

// Element 3.2 & H3: Frozen projections created ONLY inside reducer decision actions.
// Never trims unmeasured decrees before month boundary measurement (trim happens after measurement,
// and only caps above MAX_DECREES dropping the oldest entries).
export function logDecree(
  existing: Decree[],
  input: LogDecreeInput
): Decree[] {
  decreeCounter += 1;
  const entry: Decree = {
    id: `dec-${input.month}-${decreeCounter}`,
    month: Math.max(0, Math.trunc(input.month)),
    kind: input.kind,
    labelAr: input.labelAr,
    projectedAr: input.projectedAr,
    projectedValue: input.projectedValue,
    actualValue: null,
    actualAr: null,
    ...(input.taxMode !== undefined ? { taxMode: input.taxMode } : {}),
  };
  return [...existing, entry];
}

// Element 3.3 & H3: Single actuals-writer, invoked ONCE per month boundary BEFORE trimming.
// Writes actualValue & actualAr strictly once (only when d.actualAr === null and d.month === monthJustEnded).
// Never mutates projectedAr, projectedValue, or already-measured decrees.
export function measureDecreeActuals(
  decrees: Decree[],
  monthJustEnded: number,
  lastMonthStats: LastMonthStats,
  observedSatisfaction: number
): Decree[] {
  if (decrees.length === 0) return decrees;
  let changed = false;

  const next = decrees.map((d) => {
    if (d.actualAr !== null) return d;
    if (d.month !== monthJustEnded) return d;

    changed = true;
    if (d.kind === 'tax_policy') {
      const mode = d.taxMode ?? 'none';
      const actualValue =
        mode === 'take'
          ? lastMonthStats.taxWithheld
          : mode === 'grant'
            ? -lastMonthStats.grantsPaid
            : 0;
      const signPrefix = actualValue > 0 ? '+' : '';
      return {
        ...d,
        actualValue,
        actualAr: `الفعلي: ${signPrefix}${actualValue} ذهب، ومزاج الشعب ${observedSatisfaction}`,
      };
    }

    return {
      ...d,
      actualValue: null,
      actualAr: LONG_TERM_ACTUAL_AR,
    };
  });

  return changed ? next : decrees;
}

// H3: Always called AFTER measureDecreeActuals so current month's unmeasured decrees are never dropped prematurely.
export function trimDecrees(
  decrees: Decree[],
  cap: number = MAX_DECREES
): Decree[] {
  if (decrees.length <= cap) return decrees;
  return decrees.slice(decrees.length - cap);
}

export function sanitizeDecreesOnHydrate(raw: Decree[] | undefined): Decree[] {
  if (!Array.isArray(raw)) return [];
  for (const d of raw) {
    if (d && typeof d.id === 'string') {
      const match = /^dec-\d+-(\d+)/.exec(d.id);
      if (match) {
        const seq = Number(match[1]);
        if (Number.isFinite(seq) && seq > decreeCounter) {
          decreeCounter = seq;
        }
      }
    }
  }
  const seenIds = new Set<string>();
  const cleaned: Decree[] = [];
  for (const d of raw) {
    if (!d || typeof d !== 'object' || typeof d.id !== 'string') continue;
    const month =
      typeof d.month === 'number' && Number.isFinite(d.month)
        ? Math.max(0, Math.trunc(d.month))
        : 0;
    let id = d.id;
    if (!id || seenIds.has(id)) {
      decreeCounter += 1;
      id = `dec-${month}-${decreeCounter}`;
    }
    seenIds.add(id);
    cleaned.push({
      id,
      month,
      kind: d.kind,
      labelAr: typeof d.labelAr === 'string' ? d.labelAr : '',
      projectedAr: typeof d.projectedAr === 'string' ? d.projectedAr : '',
      projectedValue:
        typeof d.projectedValue === 'number' && Number.isFinite(d.projectedValue)
          ? d.projectedValue
          : null,
      actualValue:
        typeof d.actualValue === 'number' && Number.isFinite(d.actualValue)
          ? d.actualValue
          : null,
      actualAr: typeof d.actualAr === 'string' ? d.actualAr : null,
      ...(d.taxMode !== undefined ? { taxMode: d.taxMode } : {}),
    });
  }
  return trimDecrees(cleaned);
}

// Shared selector used by BOTH Palace UI tax preview (Element 2.5) and SET_TAX_POLICY decree projection (Element 3.2).
export function getGrossPayrollBase(input: {
  lastPayroll: PayrollRecord | null;
  cubes: Cube[];
  population: number;
  privateAds: PrivateAd[];
}): number {
  const filledPrivateWages = input.privateAds.reduce(
    (sum, ad) => (ad.filledBy !== null ? sum + Math.max(0, Math.floor(ad.wage)) : sum),
    0
  );
  if (input.lastPayroll && input.lastPayroll.due > 0) {
    return input.lastPayroll.due + filledPrivateWages;
  }
  return computeMonthlyPayroll(input.cubes, input.population).due + filledPrivateWages;
}
