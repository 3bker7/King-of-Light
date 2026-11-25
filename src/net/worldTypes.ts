import type {
  CitizenAttrs,
  PriceMap,
  TradedResourceKey,
  TradeVolumeMap,
} from '../game/types';

// Prompt 8 Shared World Hard Caps
export const MAX_LISTINGS_PER_KINGDOM = 20;
export const MAX_VISA_APPLICATIONS_PER_MONTH = 3;
export const MAX_EMBASSY_AGREEMENTS_PER_KINGDOM = 4;
export const MAX_WORLD_MAP_KINGDOMS = 200;
export const ONLINE_BOURSE_DAILY_KINGDOM_CAP = 500;
export const MAX_RULER_NAME_LENGTH = 32;
export const MAX_KINGDOM_NAME_LENGTH = 40;

export type GoldBand = 'poor' | 'mid' | 'rich';

export interface WorldPos {
  wx: number;
  wy: number;
}

/**
 * Privacy by design (Element 0.2 & Harden 0):
 * Exposes ONLY `goldBand` ('poor' | 'mid' | 'rich') — NEVER another kingdom's exact treasury gold.
 */
export interface WorldKingdom {
  uid: string;
  nameAr: string;
  rulerName: string;
  wx: number;
  wy: number;
  reputation: number;
  population: number;
  provincesCount: number;
  goldBand: GoldBand;
  updatedAt: number;
}

export interface WorldCellLock {
  uid: string;
  wx: number;
  wy: number;
  createdAt: number;
}

export interface CloudKingdomSave {
  saveJson: string;
  updatedAt: number;
  totalMonths: number;
}

export type CloudSyncStatus = 'local-only' | 'pending' | 'synced';

export interface WorldBourse {
  day: number;
  prices: PriceMap;
  previousPrices?: PriceMap;
  inflationIndex: number;
  dailyBought: TradeVolumeMap;
  dailySold: TradeVolumeMap;
  lastRollEpochDay?: number;
  updatedAt?: number;
}

export interface WorldBourseKingdomVolume {
  uid: string;
  day: number;
  counts: Partial<Record<TradedResourceKey, number>>;
  updatedAt: number;
}

export interface MarketListing {
  id: string;
  sellerUid: string;
  sellerNameAr: string;
  resource: TradedResourceKey;
  qty: number;
  unitPrice: number;
  createdDay: number;
  expiresDay: number;
  embassyOnly: boolean;
  sellerReputation?: number;
}

export interface MarketClaimDoc {
  uid: string;
  pendingGold: number;
  updatedAt: number;
}

export interface MarketStatsDoc {
  day: number;
  totalVolume: number;
  largestSaleAmount: number;
  largestSaleSellerNameAr: string;
  updatedAt: number;
}

export type EmbassyStatus = 'pending' | 'active' | 'suspended' | 'dissolved';

export interface EmbassyAgreement {
  id: string;
  hostUid: string;
  guestUid: string;
  status: EmbassyStatus;
  priceAgreed: number;
  feeArrearsMonths: number;
  createdMonth: number;
  lastFeeMonth?: number;
  priceSettled?: boolean;
  dissolveEffectiveMonth?: number | null;
  rejectedMonth?: number | null;
  guestColor?: string;
  hostNameAr?: string;
  guestNameAr?: string;
  updatedAt?: number;
}

export interface EmbassyPaymentDoc {
  uid: string;
  pendingGold: number;
  updatedAt: number;
}

export interface CitizenSnapshot {
  name: string;
  gender: 'm' | 'f';
  ageMonths: number;
  attributes: CitizenAttrs;
  wealth: number;
}

export type VisaStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'granted'
  | 'received';

export interface VisaApplication {
  id: string;
  fromUid: string;
  toUid?: string;
  citizenSnapshot: CitizenSnapshot;
  status: VisaStatus;
  month: number;
  fromKingdomNameAr?: string;
  updatedAt?: number;
}

export interface WorldPalace {
  gold: number;
}

export interface WorldNewsletter {
  day: number;
  lines: string[];
}

export interface OnlineWorldUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export function makeEmbassyAgreementId(hostUid: string, guestUid: string): string {
  return `${hostUid}__${guestUid}`;
}

/**
 * Element 1.3 & Harden 0:
 * Maps local treasury gold to a coarse privacy-preserving band.
 * <500 => 'poor', <2000 => 'mid', else 'rich'.
 */
export function computeGoldBand(gold: number): GoldBand {
  const safeGold = Number.isFinite(gold) ? gold : 0;
  if (safeGold < 500) return 'poor';
  if (safeGold < 2000) return 'mid';
  return 'rich';
}

/**
 * Harden 1 Security:
 * Sanitizes ruler/kingdom display names before storage or text rendering:
 * trims, removes control characters & angle brackets, collapses spaces, caps length.
 */
export function sanitizeDisplayText(
  raw: string | null | undefined,
  fallback: string,
  maxLength: number
): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function formatWorldCellKey(wx: number, wy: number): string {
  return `${Math.trunc(wx)}_${Math.trunc(wy)}`;
}
