import { BASE_BUY_PRICES, TRADED_RESOURCES } from '../game/constants';
import type { FoodResourceKey, TradedResourceKey } from '../game/types';
import { getFirebaseServices, isOnlineWorldEnabled } from './firebase';
import { getWorldEpochDay } from './worldBourse';
import {
  makeEmbassyAgreementId,
  MAX_KINGDOM_NAME_LENGTH,
  MAX_LISTINGS_PER_KINGDOM,
  sanitizeDisplayText,
  type EmbassyAgreement,
  type MarketClaimDoc,
  type MarketListing,
  type MarketStatsDoc,
} from './worldTypes';

export const MARKET_LISTING_TTL_DAYS = 30;

export interface SaleSplit {
  buyerPays: number;
  sellerGets: number;
  palaceGets: number;
}

/**
 * Element M1.1 & Harden M1:
 * Pure sale split with exact integer conservation: buyerPays === sellerGets + palaceGets.
 * - Normal: buyerPays = total, sellerGets = floor(total * 0.95), palaceGets = total - sellerGets
 * - Allied: buyerPays = round(total * 0.80), sellerGets = round(total * 0.80), palaceGets = 0
 */
export function computeSaleSplit(total: number, allied: boolean): SaleSplit {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  if (allied) {
    const discounted = Math.round(safeTotal * 0.8);
    return {
      buyerPays: discounted,
      sellerGets: discounted,
      palaceGets: 0,
    };
  }
  const sellerGets = Math.floor(safeTotal * 0.95);
  const palaceGets = safeTotal - sellerGets;
  return {
    buyerPays: safeTotal,
    sellerGets,
    palaceGets,
  };
}

export interface CitizenListingCandidate {
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

/**
 * Element M1.1 & Harden M1:
 * Pure selector for citizen living-demand food purchases:
 * - Picks cheapest listing by unitPrice (tie-break: higher seller reputation, earlier createdDay, id).
 * - If another listing's seller reputation >= cheapest seller's + 20 AND its unitPrice <= cheapest.unitPrice * 1.10,
 *   returns that higher-quality listing instead (if multiple qualify, cheapest among them, tie-break highest reputation, id).
 */
export function pickCitizenListing<T extends CitizenListingCandidate>(
  listings: readonly T[],
  _myReputation: number
): T | null {
  const valid = listings.filter(
    (l) =>
      l &&
      Number.isFinite(l.qty) &&
      l.qty > 0 &&
      Number.isFinite(l.unitPrice) &&
      l.unitPrice >= 1
  );
  if (valid.length === 0) return null;

  const getRep = (l: T): number =>
    typeof l.sellerReputation === 'number' && Number.isFinite(l.sellerReputation)
      ? l.sellerReputation
      : 50;

  const byCheapest = [...valid].sort((a, b) => {
    if (a.unitPrice !== b.unitPrice) return a.unitPrice - b.unitPrice;
    const repDiff = getRep(b) - getRep(a);
    if (repDiff !== 0) return repDiff;
    if (a.createdDay !== b.createdDay) return a.createdDay - b.createdDay;
    return a.id.localeCompare(b.id);
  });

  const cheapest = byCheapest[0];
  const cheapestRep = getRep(cheapest);
  const maxPremiumPrice = cheapest.unitPrice * 1.1 + 1e-9;

  const qualityCandidates = valid.filter(
    (l) =>
      l.id !== cheapest.id &&
      getRep(l) >= cheapestRep + 20 &&
      l.unitPrice <= maxPremiumPrice
  );

  if (qualityCandidates.length === 0) {
    return cheapest;
  }

  qualityCandidates.sort((a, b) => {
    if (a.unitPrice !== b.unitPrice) return a.unitPrice - b.unitPrice;
    const repDiff = getRep(b) - getRep(a);
    if (repDiff !== 0) return repDiff;
    if (a.createdDay !== b.createdDay) return a.createdDay - b.createdDay;
    return a.id.localeCompare(b.id);
  });

  return qualityCandidates[0];
}

export function isValidListingUnitPrice(
  resource: TradedResourceKey,
  unitPrice: number
): boolean {
  if (!Number.isInteger(unitPrice)) return false;
  const base = BASE_BUY_PRICES[resource];
  if (!base || base <= 0) return false;
  return unitPrice >= 1 && unitPrice <= base * 10;
}

export function getListingPriceBounds(resource: TradedResourceKey): {
  min: number;
  max: number;
} {
  const base = BASE_BUY_PRICES[resource] ?? 5;
  return { min: 1, max: base * 10 };
}

function isTradedResource(r: unknown): r is TradedResourceKey {
  return typeof r === 'string' && (TRADED_RESOURCES as readonly string[]).includes(r);
}

function normalizeMarketListing(
  id: string,
  raw: Partial<MarketListing>
): MarketListing | null {
  if (!raw || !isTradedResource(raw.resource)) return null;
  if (typeof raw.sellerUid !== 'string' || raw.sellerUid.length === 0) return null;
  const qty =
    typeof raw.qty === 'number' && Number.isFinite(raw.qty)
      ? Math.max(0, Math.floor(raw.qty))
      : 0;
  const unitPrice =
    typeof raw.unitPrice === 'number' && Number.isFinite(raw.unitPrice)
      ? Math.max(1, Math.floor(raw.unitPrice))
      : BASE_BUY_PRICES[raw.resource];
  const createdDay =
    typeof raw.createdDay === 'number' && Number.isFinite(raw.createdDay)
      ? Math.trunc(raw.createdDay)
      : 1;
  const expiresDay =
    typeof raw.expiresDay === 'number' && Number.isFinite(raw.expiresDay)
      ? Math.trunc(raw.expiresDay)
      : createdDay + MARKET_LISTING_TTL_DAYS;

  return {
    id,
    sellerUid: raw.sellerUid,
    sellerNameAr: sanitizeDisplayText(
      raw.sellerNameAr,
      'مملكة مجاورة',
      MAX_KINGDOM_NAME_LENGTH
    ),
    resource: raw.resource,
    qty,
    unitPrice,
    createdDay,
    expiresDay,
    embassyOnly: Boolean(raw.embassyOnly),
    sellerReputation:
      typeof raw.sellerReputation === 'number' &&
      Number.isFinite(raw.sellerReputation)
        ? Math.max(0, Math.min(100, Math.round(raw.sellerReputation)))
        : undefined,
  };
}

export async function fetchActiveMarketListings(
  currentWorldDay = getWorldEpochDay(),
  resourceFilter?: TradedResourceKey
): Promise<MarketListing[]> {
  if (!isOnlineWorldEnabled()) return [];
  try {
    const services = await getFirebaseServices();
    if (!services) return [];
    const { collection, getDocs, query, where } = await import(
      'firebase/firestore'
    );
    const colRef = collection(services.db, 'marketListings');
    const q = resourceFilter
      ? query(colRef, where('resource', '==', resourceFilter))
      : colRef;
    const snap = await getDocs(q);
    const out: MarketListing[] = [];
    snap.forEach((docSnap) => {
      const normalized = normalizeMarketListing(
        docSnap.id,
        docSnap.data() as Partial<MarketListing>
      );
      if (
        normalized &&
        normalized.qty > 0 &&
        normalized.expiresDay > currentWorldDay
      ) {
        out.push(normalized);
      }
    });
    out.sort((a, b) =>
      a.unitPrice !== b.unitPrice
        ? a.unitPrice - b.unitPrice
        : a.id.localeCompare(b.id)
    );
    return out;
  } catch {
    return [];
  }
}

export async function fetchMyMarketListings(uid: string): Promise<MarketListing[]> {
  if (!isOnlineWorldEnabled() || !uid) return [];
  try {
    const services = await getFirebaseServices();
    if (!services) return [];
    const { collection, getDocs, query, where } = await import(
      'firebase/firestore'
    );
    const q = query(
      collection(services.db, 'marketListings'),
      where('sellerUid', '==', uid)
    );
    const snap = await getDocs(q);
    const out: MarketListing[] = [];
    snap.forEach((docSnap) => {
      const normalized = normalizeMarketListing(
        docSnap.id,
        docSnap.data() as Partial<MarketListing>
      );
      if (normalized && normalized.qty > 0) {
        out.push(normalized);
      }
    });
    out.sort((a, b) => b.createdDay - a.createdDay);
    return out;
  } catch {
    return [];
  }
}

export async function fetchMyMarketClaim(uid: string): Promise<number> {
  if (!isOnlineWorldEnabled() || !uid) return 0;
  try {
    const services = await getFirebaseServices();
    if (!services) return 0;
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(services.db, 'marketClaims', uid));
    if (!snap.exists()) return 0;
    const data = snap.data() as Partial<MarketClaimDoc>;
    return typeof data.pendingGold === 'number' && Number.isFinite(data.pendingGold)
      ? Math.max(0, Math.floor(data.pendingGold))
      : 0;
  } catch {
    return 0;
  }
}

export interface ListResourceParams {
  uid: string;
  sellerNameAr: string;
  sellerReputation: number;
  resource: TradedResourceKey;
  qty: number;
  unitPrice: number;
  localWarehouseStock: number;
  embassyOnly?: boolean;
  currentWorldDay?: number;
}

export interface ListResourceResult {
  ok: boolean;
  listing?: MarketListing;
  errorAr?: string;
}

/**
 * Element M1.2:
 * Create a MarketListing in ONE Firestore transaction after verifying:
 * - qty in 1..localWarehouseStock
 * - unitPrice in 1..10x base
 * - Seller currently has < 20 active listings (re-verified inside transaction)
 * Local warehouse deduction happens ONLY after this returns { ok: true }.
 */
export async function listResource(
  params: ListResourceParams
): Promise<ListResourceResult> {
  if (!isOnlineWorldEnabled() || !params.uid) {
    return { ok: false, errorAr: 'الوضع المحلي نشط — سجّل الدخول للنشر في السوق العالمي' };
  }
  const qty = Math.floor(params.qty);
  const unitPrice = Math.floor(params.unitPrice);
  const stock = Math.max(0, Math.floor(params.localWarehouseStock));
  if (!isTradedResource(params.resource)) {
    return { ok: false, errorAr: 'مورد غير صالح للتداول' };
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > stock) {
    return { ok: false, errorAr: 'الكمية غير صالحة أو تتجاوز المخزون المتاح' };
  }
  if (!isValidListingUnitPrice(params.resource, unitPrice)) {
    const bounds = getListingPriceBounds(params.resource);
    return {
      ok: false,
      errorAr: `السعر يجب أن يكون بين ${bounds.min} و${bounds.max} ذهب`,
    };
  }

  try {
    const services = await getFirebaseServices();
    if (!services) {
      return { ok: false, errorAr: 'تعذر الاتصال بالسوق العالمي' };
    }
    const { collection, doc, getDocs, query, runTransaction, where } =
      await import('firebase/firestore');

    // Pre-fetch seller's existing listing IDs so the transaction can verify live count <= 20
    const existingSnap = await getDocs(
      query(
        collection(services.db, 'marketListings'),
        where('sellerUid', '==', params.uid)
      )
    );
    const candidateIds: string[] = [];
    existingSnap.forEach((d) => candidateIds.push(d.id));

    const worldDay = params.currentWorldDay ?? getWorldEpochDay();
    const newDocRef = doc(collection(services.db, 'marketListings'));
    const safeName = sanitizeDisplayText(
      params.sellerNameAr,
      'مملكة نور الشعب',
      MAX_KINGDOM_NAME_LENGTH
    );
    const safeRep = Math.max(0, Math.min(100, Math.round(params.sellerReputation)));

    const createdListing = await runTransaction(services.db, async (tx) => {
      let activeCount = 0;
      for (const existingId of candidateIds) {
        const snap = await tx.get(doc(services.db, 'marketListings', existingId));
        if (!snap.exists()) continue;
        const d = snap.data() as Partial<MarketListing>;
        if ((d.qty ?? 0) > 0 && (d.expiresDay ?? 0) > worldDay) {
          activeCount += 1;
        }
      }
      if (activeCount >= MAX_LISTINGS_PER_KINGDOM) {
        throw new Error('MAX_LISTINGS_REACHED');
      }

      const payload: Omit<MarketListing, 'id'> = {
        sellerUid: params.uid,
        sellerNameAr: safeName,
        resource: params.resource,
        qty,
        unitPrice,
        createdDay: worldDay,
        expiresDay: worldDay + MARKET_LISTING_TTL_DAYS,
        embassyOnly: Boolean(params.embassyOnly),
        sellerReputation: safeRep,
      };
      tx.set(newDocRef, payload);
      return { id: newDocRef.id, ...payload };
    });

    return { ok: true, listing: createdListing };
  } catch (err) {
    if (err instanceof Error && err.message === 'MAX_LISTINGS_REACHED') {
      return {
        ok: false,
        errorAr: `الحد الأقصى ${MAX_LISTINGS_PER_KINGDOM} عرضاً نشطاً لكل مملكة`,
      };
    }
    return { ok: false, errorAr: 'تعذر إنشاء العرض في السوق العالمي' };
  }
}

export interface CancelListingResult {
  ok: boolean;
  resource?: TradedResourceKey;
  returnedQty?: number;
  errorAr?: string;
}

/**
 * Element M1.2: Cancel own listing in one transaction and return exact remaining live qty to local warehouse.
 */
export async function cancelListing(
  uid: string,
  listingId: string
): Promise<CancelListingResult> {
  if (!isOnlineWorldEnabled() || !uid || !listingId) {
    return { ok: false, errorAr: 'العملية غير متاحة حالياً' };
  }
  try {
    const services = await getFirebaseServices();
    if (!services) return { ok: false, errorAr: 'تعذر الاتصال بالسوق' };
    const { doc, runTransaction } = await import('firebase/firestore');
    const listingRef = doc(services.db, 'marketListings', listingId);

    const res = await runTransaction(services.db, async (tx) => {
      const snap = await tx.get(listingRef);
      if (!snap.exists()) {
        throw new Error('NOT_FOUND');
      }
      const data = normalizeMarketListing(
        snap.id,
        snap.data() as Partial<MarketListing>
      );
      if (!data || data.sellerUid !== uid) {
        throw new Error('FORBIDDEN');
      }
      tx.delete(listingRef);
      return { resource: data.resource, returnedQty: data.qty };
    });

    return { ok: true, resource: res.resource, returnedQty: res.returnedQty };
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      return { ok: false, errorAr: 'العرض لم يعد موجوداً (ربما تم شراؤه بالكامل)' };
    }
    return { ok: false, errorAr: 'تعذر إلغاء العرض' };
  }
}

/**
 * Element M1.2 & Harden M1:
 * Returns-due check for expired (30-world-day) listings owned by this kingdom.
 * Never auto-sells; deletes expired listings transactionally and returns exact unbought qty to local warehouse.
 */
export async function checkMarketReturnsDue(
  uid: string,
  currentWorldDay = getWorldEpochDay()
): Promise<{
  returned: Partial<Record<TradedResourceKey, number>>;
  expiredCount: number;
}> {
  if (!isOnlineWorldEnabled() || !uid) {
    return { returned: {}, expiredCount: 0 };
  }
  try {
    const services = await getFirebaseServices();
    if (!services) return { returned: {}, expiredCount: 0 };
    const { collection, doc, getDocs, query, runTransaction, where } =
      await import('firebase/firestore');

    const mySnap = await getDocs(
      query(
        collection(services.db, 'marketListings'),
        where('sellerUid', '==', uid)
      )
    );
    const expiredIds: string[] = [];
    mySnap.forEach((d) => {
      const data = d.data() as Partial<MarketListing>;
      if ((data.expiresDay ?? Infinity) <= currentWorldDay && (data.qty ?? 0) > 0) {
        expiredIds.push(d.id);
      }
    });

    if (expiredIds.length === 0) {
      return { returned: {}, expiredCount: 0 };
    }

    const returned: Partial<Record<TradedResourceKey, number>> = {};
    let expiredCount = 0;

    for (const id of expiredIds) {
      const listingRef = doc(services.db, 'marketListings', id);
      try {
        const reclaimed = await runTransaction(services.db, async (tx) => {
          const snap = await tx.get(listingRef);
          if (!snap.exists()) return null;
          const live = normalizeMarketListing(
            snap.id,
            snap.data() as Partial<MarketListing>
          );
          if (
            !live ||
            live.sellerUid !== uid ||
            live.expiresDay > currentWorldDay ||
            live.qty <= 0
          ) {
            return null;
          }
          tx.delete(listingRef);
          return { resource: live.resource, qty: live.qty };
        });
        if (reclaimed) {
          returned[reclaimed.resource] =
            (returned[reclaimed.resource] ?? 0) + reclaimed.qty;
          expiredCount += 1;
        }
      } catch {
        // Skip contended doc; next check will reclaim safely
      }
    }

    return { returned, expiredCount };
  } catch {
    return { returned: {}, expiredCount: 0 };
  }
}

export interface BuyListingParams {
  buyerUid: string;
  listingId: string;
  qty: number;
  availableGold: number;
  currentWorldDay?: number;
}

export interface BuyListingResult {
  ok: boolean;
  resource?: TradedResourceKey;
  boughtQty?: number;
  unitPrice?: number;
  buyerPays?: number;
  sellerGets?: number;
  palaceGets?: number;
  allied?: boolean;
  sellerNameAr?: string;
  errorAr?: string;
}

/**
 * Element M1.3 & M1.4 & Harden M1:
 * Purchase from a global MarketListing in ONE Firestore transaction:
 * - Re-reads live listing price and qty (never trusts client price/split)
 * - Checks active EmbassyAgreement between buyer and seller inside the transaction
 * - Applies computeSaleSplit(liveTotal, allied)
 * - Decrements listing qty (deletes doc at 0)
 * - Increments marketClaims/{sellerUid}.pendingGold by sellerGets
 * - Increments worldPalace/current.gold by palaceGets
 * - Increments daily marketStats/{epochDay} for the World Newsletter (M5)
 * Local gold/warehouse update runs ONLY after this transaction succeeds.
 */
export async function buyListing(
  params: BuyListingParams
): Promise<BuyListingResult> {
  if (!isOnlineWorldEnabled() || !params.buyerUid || !params.listingId) {
    return { ok: false, errorAr: 'السوق العالمي غير متاح في الوضع المحلي' };
  }
  const requestedQty = Math.floor(params.qty);
  const availableGold = Math.max(0, Math.floor(params.availableGold));
  if (!Number.isInteger(requestedQty) || requestedQty < 1) {
    return { ok: false, errorAr: 'الكمية غير صالحة' };
  }

  try {
    const services = await getFirebaseServices();
    if (!services) return { ok: false, errorAr: 'تعذر الاتصال بالسوق' };
    const { doc, runTransaction } = await import('firebase/firestore');

    const listingRef = doc(services.db, 'marketListings', params.listingId);
    const palaceRef = doc(services.db, 'worldPalace', 'current');
    const worldDay = params.currentWorldDay ?? getWorldEpochDay();
    const statsRef = doc(services.db, 'marketStats', String(worldDay));

    const result = await runTransaction(services.db, async (tx) => {
      const listingSnap = await tx.get(listingRef);
      if (!listingSnap.exists()) {
        throw new Error('LISTING_GONE');
      }
      const live = normalizeMarketListing(
        listingSnap.id,
        listingSnap.data() as Partial<MarketListing>
      );
      if (!live || live.qty <= 0 || live.expiresDay <= worldDay) {
        throw new Error('LISTING_EXPIRED');
      }

      // Check active EmbassyAgreement between buyer and seller (either direction)
      let allied = false;
      if (live.sellerUid !== params.buyerUid) {
        const embRefA = doc(
          services.db,
          'embassyAgreements',
          makeEmbassyAgreementId(params.buyerUid, live.sellerUid)
        );
        const embRefB = doc(
          services.db,
          'embassyAgreements',
          makeEmbassyAgreementId(live.sellerUid, params.buyerUid)
        );
        const [embA, embB] = await Promise.all([tx.get(embRefA), tx.get(embRefB)]);
        const statusA = embA.exists()
          ? (embA.data() as Partial<EmbassyAgreement>).status
          : null;
        const statusB = embB.exists()
          ? (embB.data() as Partial<EmbassyAgreement>).status
          : null;
        allied = statusA === 'active' || statusB === 'active';
      }

      if (live.embassyOnly && !allied && live.sellerUid !== params.buyerUid) {
        throw new Error('EMBASSY_ONLY');
      }

      const boughtQty = Math.min(requestedQty, live.qty);
      const liveTotal = boughtQty * live.unitPrice;
      const split = computeSaleSplit(liveTotal, allied);

      if (split.buyerPays > availableGold) {
        throw new Error('INSUFFICIENT_GOLD');
      }

      const claimRef = doc(services.db, 'marketClaims', live.sellerUid);
      const [claimSnap, palaceSnap, statsSnap] = await Promise.all([
        tx.get(claimRef),
        tx.get(palaceRef),
        tx.get(statsRef),
      ]);

      const nowMs = Math.trunc(Date.now());
      const remainingQty = live.qty - boughtQty;
      if (remainingQty <= 0) {
        tx.delete(listingRef);
      } else {
        tx.update(listingRef, { qty: remainingQty });
      }

      const prevClaimGold = claimSnap.exists()
        ? Math.max(
            0,
            Math.floor(
              ((claimSnap.data() as Partial<MarketClaimDoc>).pendingGold ?? 0)
            )
          )
        : 0;
      const nextClaim: MarketClaimDoc = {
        uid: live.sellerUid,
        pendingGold: prevClaimGold + split.sellerGets,
        updatedAt: nowMs,
      };
      tx.set(claimRef, nextClaim);

      if (split.palaceGets > 0) {
        const prevPalaceGold = palaceSnap.exists()
          ? Math.max(0, Math.floor((palaceSnap.data()?.gold as number) ?? 0))
          : 0;
        tx.set(palaceRef, { gold: prevPalaceGold + split.palaceGets });
      }

      const prevStats = statsSnap.exists()
        ? (statsSnap.data() as Partial<MarketStatsDoc>)
        : null;
      const prevVolume = Math.max(0, Math.floor(prevStats?.totalVolume ?? 0));
      const prevLargest = Math.max(
        0,
        Math.floor(prevStats?.largestSaleAmount ?? 0)
      );
      const isNewLargest = split.buyerPays > prevLargest;
      const nextStats: MarketStatsDoc = {
        day: worldDay,
        totalVolume: prevVolume + boughtQty,
        largestSaleAmount: isNewLargest ? split.buyerPays : prevLargest,
        largestSaleSellerNameAr: isNewLargest
          ? live.sellerNameAr
          : sanitizeDisplayText(
              prevStats?.largestSaleSellerNameAr,
              live.sellerNameAr,
              MAX_KINGDOM_NAME_LENGTH
            ),
        updatedAt: nowMs,
      };
      tx.set(statsRef, nextStats);

      return {
        resource: live.resource,
        boughtQty,
        unitPrice: live.unitPrice,
        buyerPays: split.buyerPays,
        sellerGets: split.sellerGets,
        palaceGets: split.palaceGets,
        allied,
        sellerNameAr: live.sellerNameAr,
      };
    });

    return { ok: true, ...result };
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'LISTING_GONE' || code === 'LISTING_EXPIRED') {
      return { ok: false, errorAr: 'العرض لم يعد متاحاً' };
    }
    if (code === 'EMBASSY_ONLY') {
      return { ok: false, errorAr: 'هذا العرض مخصص لحلفاء السفارات فقط' };
    }
    if (code === 'INSUFFICIENT_GOLD') {
      return { ok: false, errorAr: 'الذهب غير كافٍ لإتمام الشراء بالسعر الحالي' };
    }
    return { ok: false, errorAr: 'تعذر إتمام عملية الشراء' };
  }
}

export interface CollectClaimsResult {
  ok: boolean;
  collectedGold: number;
  claimUpdatedAt: number;
  errorAr?: string;
}

/**
 * Element M1.5 & Harden M1:
 * Collect pending market sale proceeds in ONE transaction:
 * reads marketClaims/{uid}.pendingGold, zeroes it atomically, and returns the exact collected amount + timestamp.
 */
export async function collectClaims(uid: string): Promise<CollectClaimsResult> {
  if (!isOnlineWorldEnabled() || !uid) {
    return { ok: false, collectedGold: 0, claimUpdatedAt: 0 };
  }
  try {
    const services = await getFirebaseServices();
    if (!services) {
      return {
        ok: false,
        collectedGold: 0,
        claimUpdatedAt: 0,
        errorAr: 'تعذر الاتصال بالسوق العالمي',
      };
    }
    const { doc, runTransaction } = await import('firebase/firestore');
    const claimRef = doc(services.db, 'marketClaims', uid);

    const out = await runTransaction(services.db, async (tx) => {
      const snap = await tx.get(claimRef);
      if (!snap.exists()) {
        return { collectedGold: 0, claimUpdatedAt: 0 };
      }
      const data = snap.data() as Partial<MarketClaimDoc>;
      const pendingGold =
        typeof data.pendingGold === 'number' && Number.isFinite(data.pendingGold)
          ? Math.max(0, Math.floor(data.pendingGold))
          : 0;
      if (pendingGold <= 0) {
        return { collectedGold: 0, claimUpdatedAt: 0 };
      }
      const nowMs = Math.trunc(Date.now());
      tx.set(claimRef, {
        uid,
        pendingGold: 0,
        updatedAt: nowMs,
      } satisfies MarketClaimDoc);
      return { collectedGold: pendingGold, claimUpdatedAt: nowMs };
    });

    return { ok: true, ...out };
  } catch {
    return {
      ok: false,
      collectedGold: 0,
      claimUpdatedAt: 0,
      errorAr: 'تعذر تحصيل المستحقات',
    };
  }
}

const FOOD_RESOURCES: readonly FoodResourceKey[] = [
  'fish',
  'crops',
  'wheat',
  'fruit',
  'meat',
  'bread',
];

/**
 * Element M1.4:
 * Online citizen living-demand import execution.
 * Fetches active food listings (excluding own kingdom so citizens import from the world),
 * selects via pickCitizenListing(listings, myReputation), and buys min(needed, listed, affordable)
 * using the exact M1.3 transaction. Unmet remainder stays in the local Palace x1.5 import sink.
 */
export async function executeOnlineCitizenFoodImport(params: {
  buyerUid: string;
  myReputation: number;
  neededUnits: number;
  availableCitizenImportGold: number;
  currentWorldDay?: number;
}): Promise<{ boughtQty: number; buyerPays: number; sellerNameAr?: string }> {
  if (
    !isOnlineWorldEnabled() ||
    !params.buyerUid ||
    params.neededUnits <= 0 ||
    params.availableCitizenImportGold <= 0
  ) {
    return { boughtQty: 0, buyerPays: 0 };
  }

  const worldDay = params.currentWorldDay ?? getWorldEpochDay();
  const allActive = await fetchActiveMarketListings(worldDay);
  const foodListings = allActive.filter(
    (l) =>
      l.sellerUid !== params.buyerUid &&
      (FOOD_RESOURCES as readonly string[]).includes(l.resource)
  );
  const chosen = pickCitizenListing(foodListings, params.myReputation);
  if (!chosen) return { boughtQty: 0, buyerPays: 0 };

  const maxAffordable = Math.floor(
    params.availableCitizenImportGold / Math.max(1, chosen.unitPrice)
  );
  const buyQty = Math.min(params.neededUnits, chosen.qty, maxAffordable);
  if (buyQty <= 0) return { boughtQty: 0, buyerPays: 0 };

  const res = await buyListing({
    buyerUid: params.buyerUid,
    listingId: chosen.id,
    qty: buyQty,
    availableGold: params.availableCitizenImportGold,
    currentWorldDay: worldDay,
  });

  if (!res.ok || !res.boughtQty || !res.buyerPays) {
    return { boughtQty: 0, buyerPays: 0 };
  }
  return {
    boughtQty: res.boughtQty,
    buyerPays: res.buyerPays,
    sellerNameAr: res.sellerNameAr,
  };
}
