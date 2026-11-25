import type { TaxPolicy, TaxPolicyMode } from './types';

export const DEFAULT_TAX_POLICY: TaxPolicy = {
  mode: 'none',
  percent: 0,
};

export const TAX_POLICY_MIN_PERCENT = 0;
export const TAX_POLICY_MAX_PERCENT = 50;
export const TAX_POLICY_STEP = 5;

const VALID_MODES: ReadonlySet<TaxPolicyMode> = new Set(['none', 'grant', 'take']);

// Element 2.1 & H2: Normalize & clamp strictly inside reducer/hydrate (forged 500% -> 50).
export function normalizeTaxPolicy(
  mode: unknown,
  percent: unknown
): TaxPolicy {
  const safeMode: TaxPolicyMode =
    typeof mode === 'string' && VALID_MODES.has(mode as TaxPolicyMode)
      ? (mode as TaxPolicyMode)
      : 'none';
  if (safeMode === 'none') {
    return { mode: 'none', percent: 0 };
  }
  const rawPct =
    typeof percent === 'number' && Number.isFinite(percent) ? percent : 0;
  const clamped = Math.max(
    TAX_POLICY_MIN_PERCENT,
    Math.min(TAX_POLICY_MAX_PERCENT, rawPct)
  );
  const stepped = Math.round(clamped / TAX_POLICY_STEP) * TAX_POLICY_STEP;
  return {
    mode: safeMode,
    percent: Math.max(
      TAX_POLICY_MIN_PERCENT,
      Math.min(TAX_POLICY_MAX_PERCENT, stepped)
    ),
  };
}

export function sanitizeTaxPolicyOnHydrate(raw: unknown): TaxPolicy {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TAX_POLICY };
  }
  const obj = raw as { mode?: unknown; percent?: unknown };
  return normalizeTaxPolicy(obj.mode, obj.percent);
}

export interface WageTaxTransformResult {
  credit: number;
  withheld: number;
  bonus: number;
}

// Element 2.2 & H2: Exact per-holder wage transform with zero rounding leakage.
// take:  credit = round(w * (1 - p/100)); withheld = w - credit (>= 0); credit + withheld === w
// grant: desiredCredit = round(w * (1 + p/100)); bonus = min(availableTreasuryGold, desiredCredit - w);
//        credit = w + bonus; credit - bonus === w
// none:  credit = w, withheld = 0, bonus = 0
export function applyWageTaxTransform(
  grossWage: number,
  policy: TaxPolicy,
  availableTreasuryGold: number = Infinity
): WageTaxTransformResult {
  const w = Math.max(0, Math.floor(grossWage));
  if (w === 0 || policy.mode === 'none' || policy.percent <= 0) {
    return { credit: w, withheld: 0, bonus: 0 };
  }

  const safePolicy = normalizeTaxPolicy(policy.mode, policy.percent);
  if (safePolicy.mode === 'take') {
    const credit = Math.max(
      0,
      Math.min(w, Math.round(w * (1 - safePolicy.percent / 100)))
    );
    const withheld = w - credit;
    return { credit, withheld, bonus: 0 };
  }

  if (safePolicy.mode === 'grant') {
    const desiredCredit = Math.max(
      w,
      Math.round(w * (1 + safePolicy.percent / 100))
    );
    const desiredBonus = desiredCredit - w;
    const cap = Number.isFinite(availableTreasuryGold)
      ? Math.max(0, Math.floor(availableTreasuryGold))
      : desiredBonus;
    const bonus = Math.min(cap, desiredBonus);
    return { credit: w + bonus, withheld: 0, bonus };
  }

  return { credit: w, withheld: 0, bonus: 0 };
}

// Element 2.4: Mood of the realm from current taxPolicy.
// take:  -round(percent * (avgCitizenWealth >= 100 ? 0.35 : 0.5))
// grant: +min(10, floor(percent / 2))
// none:  0
export function computeTaxMoodDelta(
  policy: TaxPolicy,
  citizenWealth: number,
  population: number
): number {
  const safe = normalizeTaxPolicy(policy.mode, policy.percent);
  if (safe.mode === 'none' || safe.percent <= 0) return 0;

  if (safe.mode === 'take') {
    const avgCitizenWealth = Math.floor(
      Math.max(0, citizenWealth) / Math.max(1, population)
    );
    const factor = avgCitizenWealth >= 100 ? 0.35 : 0.5;
    return -Math.round(safe.percent * factor);
  }

  if (safe.mode === 'grant') {
    return Math.min(10, Math.floor(safe.percent / 2));
  }

  return 0;
}

// Projected monthly treasury impact for Palace UI preview & Decree logging (signed: + for take, - for grant).
export function projectTaxPolicyMonthlyImpact(
  policy: TaxPolicy,
  grossPayrollBase: number
): number {
  const safe = normalizeTaxPolicy(policy.mode, policy.percent);
  const gross = Math.max(0, Math.floor(grossPayrollBase));
  if (safe.mode === 'none' || safe.percent <= 0 || gross === 0) return 0;
  const amount = Math.round((gross * safe.percent) / 100);
  return safe.mode === 'take' ? amount : -amount;
}
