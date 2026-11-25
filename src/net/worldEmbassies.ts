import { borderDistance, isValidCampCube } from '../game/arrivalCamp';
import { findPalaceCube } from '../game/production';
import { PROVINCE_COLORS } from '../game/provinces';
import type { Cube, EmbassyPlotMarker } from '../game/types';
import { getFirebaseServices, isOnlineWorldEnabled } from './firebase';
import { getWorldEpochDay } from './worldBourse';
import {
  makeEmbassyAgreementId,
  MAX_EMBASSY_AGREEMENTS_PER_KINGDOM,
  MAX_KINGDOM_NAME_LENGTH,
  sanitizeDisplayText,
  type EmbassyAgreement,
  type EmbassyPaymentDoc,
  type EmbassyStatus,
} from './worldTypes';

export const EMBASSY_MIN_PRICE = 100;
export const EMBASSY_MAX_PRICE = 100000;
export const EMBASSY_BASE_MONTHLY_FEE = 250;
export const EMBASSY_SUSPEND_ARREARS = 2;
export const EMBASSY_DISSOLVE_ARREARS = 3;

export function getWorldEpochMonth(nowMs = Date.now()): number {
  return Math.floor(getWorldEpochDay(nowMs) / 30);
}

/**
 * Element N1.1 & Harden N1:
 * Pure embassy monthly fee formula:
 * round(250 * clamp(worldInflationIndex, 50, 300) / 100)
 * -> at 80: 200, at 100: 250, at 120: 300.
 */
export function computeEmbassyFee(worldInflationIndex: number): number {
  const safe = Number.isFinite(worldInflationIndex) ? worldInflationIndex : 100;
  const clamped = Math.max(50, Math.min(300, safe));
  return Math.round((EMBASSY_BASE_MONTHLY_FEE * clamped) / 100);
}

/**
 * Element N1.1 & Harden N1:
 * Validity check for an embassy plot cube reusing Prompt 7 camp rules + Prompts 4/5/7 locks:
 * - king-owned ('player') LAND cube (not sea)
 * - not rocky
 * - no theme in either slot
 * - not the palace cube
 * - NOT bank-collateral-locked (Prompt 5)
 * - NOT the arrival-camp cube (Prompt 7)
 * - NOT privately owned (Prompt 4)
 * - NOT already designated to another embassy plot
 */
export function isValidEmbassyPlotCube(
  cube: Cube | undefined,
  palaceCubeId: number | null,
  campCubeId: number | null = null,
  occupiedEmbassyCubeIds?: ReadonlySet<number>
): boolean {
  if (!isValidCampCube(cube, palaceCubeId, occupiedEmbassyCubeIds)) return false;
  if (!cube) return false;
  if (campCubeId !== null && cube.id === campCubeId) return false;
  return true;
}

/**
 * Element N1.1 & Harden N1:
 * Picks the host's free owned LAND cube nearest his border (tie-break: lowest cube.id).
 * Returns null if no valid plot cube exists.
 */
export function pickEmbassyPlotCube(
  cubes: Cube[],
  campCubeId: number | null = null,
  occupiedEmbassyCubeIds?: ReadonlySet<number>
): Cube | null {
  const palace = findPalaceCube(cubes);
  const palaceCubeId = palace ? palace.id : null;

  let best: Cube | null = null;
  let bestBorder = Infinity;

  for (let i = 0; i < cubes.length; i++) {
    const c = cubes[i];
    if (!isValidEmbassyPlotCube(c, palaceCubeId, campCubeId, occupiedEmbassyCubeIds)) {
      continue;
    }
    const bd = borderDistance(c);
    if (bd < bestBorder || (bd === bestBorder && (!best || c.id < best.id))) {
      bestBorder = bd;
      best = c;
    }
  }

  return best;
}

/**
 * Element N1.5:
 * Returns set of partner UIDs with an ACTIVE embassy agreement (suspended/pending/dissolved excluded).
 */
export function getActiveAlliedUids(
  agreements: readonly EmbassyAgreement[],
  myUid: string | null
): Set<string> {
  const set = new Set<string>();
  if (!myUid) return set;
  for (const ag of agreements) {
    if (ag.status !== 'active') continue;
    if (ag.hostUid === myUid) set.add(ag.guestUid);
    else if (ag.guestUid === myUid) set.add(ag.hostUid);
  }
  return set;
}

/**
 * Element N1.2 & Harden N1:
 * Enforces one pending proposal per ordered pair + 1 world month rejection cooldown.
 */
export function canProposeEmbassyPair(
  existing: EmbassyAgreement | null | undefined,
  currentWorldMonth: number
): { ok: boolean; reasonAr?: string } {
  if (!existing) return { ok: true };
  if (existing.status === 'pending') {
    return { ok: false, reasonAr: 'يوجد بالفعل طلب سفارة معلّق لهذه المملكة' };
  }
  if (existing.status === 'active' || existing.status === 'suspended') {
    return { ok: false, reasonAr: 'توجد سفارة قائمة بالفعل مع هذه المملكة' };
  }
  if (
    existing.status === 'dissolved' &&
    typeof existing.rejectedMonth === 'number' &&
    currentWorldMonth <= existing.rejectedMonth
  ) {
    return {
      ok: false,
      reasonAr: 'لا يمكن إعادة اقتراح السفارة بعد الرفض قبل مرور شهر عالمي كامل',
    };
  }
  return { ok: true };
}

/**
 * Element N1.3 & N1.4 truth rule:
 * Keeps an embassy plot marker ONLY while an active or suspended agreement names this host+guest
 * AND the plot cube still qualifies; immediately removes it on dissolution or if cube disqualifies.
 */
export function reconcileEmbassyPlots(
  currentPlots: readonly EmbassyPlotMarker[],
  agreements: readonly EmbassyAgreement[],
  myUid: string | null,
  cubes: Cube[],
  campCubeId: number | null
): EmbassyPlotMarker[] {
  if (!myUid) return [];
  const palace = findPalaceCube(cubes);
  const palaceCubeId = palace ? palace.id : null;

  const myHostedByAgreementId = new Map<string, EmbassyAgreement>();
  for (const ag of agreements) {
    if (
      ag.hostUid === myUid &&
      (ag.status === 'active' || ag.status === 'suspended')
    ) {
      myHostedByAgreementId.set(ag.id, ag);
    }
  }

  const next: EmbassyPlotMarker[] = [];
  const seenCubes = new Set<number>();

  for (const marker of currentPlots) {
    const ag = myHostedByAgreementId.get(marker.agreementId);
    if (!ag || ag.guestUid !== marker.guestUid) continue;
    const cube = cubes[marker.cubeId];
    if (!isValidEmbassyPlotCube(cube, palaceCubeId, campCubeId, seenCubes)) {
      continue;
    }
    seenCubes.add(marker.cubeId);
    next.push({
      agreementId: ag.id,
      cubeId: marker.cubeId,
      guestUid: ag.guestUid,
      guestNameAr: ag.guestNameAr ?? marker.guestNameAr,
      guestColor: ag.guestColor ?? marker.guestColor ?? PROVINCE_COLORS[1],
    });
  }

  return next;
}

export function sanitizeEmbassyPlotsOnHydrate(
  raw: EmbassyPlotMarker[] | undefined,
  cubes: Cube[],
  campCubeId: number | null
): EmbassyPlotMarker[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const palace = findPalaceCube(cubes);
  const palaceCubeId = palace ? palace.id : null;
  const seenCubes = new Set<number>();
  const seenAgreements = new Set<string>();
  const clean: EmbassyPlotMarker[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    if (
      typeof item.agreementId !== 'string' ||
      item.agreementId.length === 0 ||
      typeof item.guestUid !== 'string' ||
      item.guestUid.length === 0
    ) {
      continue;
    }
    if (
      typeof item.cubeId !== 'number' ||
      !Number.isInteger(item.cubeId) ||
      item.cubeId < 0 ||
      item.cubeId >= cubes.length
    ) {
      continue;
    }
    if (seenCubes.has(item.cubeId) || seenAgreements.has(item.agreementId)) {
      continue;
    }
    if (!isValidEmbassyPlotCube(cubes[item.cubeId], palaceCubeId, campCubeId, seenCubes)) {
      continue;
    }
    seenCubes.add(item.cubeId);
    seenAgreements.add(item.agreementId);
    clean.push({
      agreementId: item.agreementId,
      cubeId: item.cubeId,
      guestUid: item.guestUid,
      guestNameAr:
        typeof item.guestNameAr === 'string'
          ? sanitizeDisplayText(item.guestNameAr, 'مملكة حليفة', MAX_KINGDOM_NAME_LENGTH)
          : undefined,
      guestColor:
        typeof item.guestColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(item.guestColor)
          ? item.guestColor
          : PROVINCE_COLORS[1],
    });
  }

  return clean;
}

export interface MonthlyEmbassyFeeStep {
  feePaid: number;
  arrearsDelta: number;
  nextStatus: EmbassyStatus;
  nextArrears: number;
  dissolvedBySchedule: boolean;
}

/**
 * Element N1.4 & Harden N1:
 * Pure monthly fee & arrears state transition for a guest kingdom's embassy:
 * - Normal active: pay `fee` if affordable, else arrears + 1 (at 2 -> suspended, at 3 -> dissolved).
 * - Suspended: paying all arrears + current month (`fee * (arrears + 1)`) returns status to 'active' with arrears = 0;
 *   otherwise arrears + 1 (at 3 -> dissolved).
 * - Scheduled dissolution (`dissolveEffectiveMonth <= totalMonths`): takes effect AFTER current month's fee is settled,
 *   preventing mid-month fee dodging.
 */
export function computeMonthlyEmbassyFeeStep(
  agreement: EmbassyAgreement,
  fee: number,
  availableGold: number,
  totalMonths: number
): MonthlyEmbassyFeeStep {
  const safeFee = Math.max(0, Math.floor(fee));
  const safeGold = Math.max(0, Math.floor(availableGold));
  const currentArrears = Math.max(0, Math.floor(agreement.feeArrearsMonths));
  const isDissolveDue =
    typeof agreement.dissolveEffectiveMonth === 'number' &&
    totalMonths >= agreement.dissolveEffectiveMonth;

  let feePaid = 0;
  let arrearsDelta = 0;
  let nextArrears = currentArrears;
  let nextStatus: EmbassyStatus = agreement.status;

  if (agreement.status === 'suspended') {
    const catchupDue = safeFee * (currentArrears + 1);
    if (safeGold >= catchupDue) {
      feePaid = catchupDue;
      nextArrears = 0;
      nextStatus = 'active';
    } else {
      nextArrears = currentArrears + 1;
      arrearsDelta = 1;
      nextStatus =
        nextArrears >= EMBASSY_DISSOLVE_ARREARS ? 'dissolved' : 'suspended';
    }
  } else if (agreement.status === 'active') {
    if (safeGold >= safeFee) {
      feePaid = safeFee;
      nextArrears = 0;
      nextStatus = 'active';
    } else {
      nextArrears = currentArrears + 1;
      arrearsDelta = 1;
      if (nextArrears >= EMBASSY_DISSOLVE_ARREARS) {
        nextStatus = 'dissolved';
      } else if (nextArrears >= EMBASSY_SUSPEND_ARREARS) {
        nextStatus = 'suspended';
      }
    }
  }

  // Dissolution scheduled mid-month takes effect at the month boundary AFTER current fee falls due
  let dissolvedBySchedule = false;
  if (isDissolveDue && nextStatus !== 'dissolved') {
    nextStatus = 'dissolved';
    dissolvedBySchedule = true;
  }

  return {
    feePaid,
    arrearsDelta,
    nextStatus,
    nextArrears,
    dissolvedBySchedule,
  };
}

function normalizeEmbassyDoc(
  id: string,
  raw: Partial<EmbassyAgreement>
): EmbassyAgreement | null {
  if (!raw || typeof raw.hostUid !== 'string' || typeof raw.guestUid !== 'string') {
    return null;
  }
  const status: EmbassyStatus =
    raw.status === 'pending' ||
    raw.status === 'active' ||
    raw.status === 'suspended' ||
    raw.status === 'dissolved'
      ? raw.status
      : 'dissolved';
  return {
    id,
    hostUid: raw.hostUid,
    guestUid: raw.guestUid,
    status,
    priceAgreed: Math.max(0, Math.floor(raw.priceAgreed ?? 0)),
    feeArrearsMonths: Math.max(0, Math.floor(raw.feeArrearsMonths ?? 0)),
    createdMonth: Math.max(0, Math.trunc(raw.createdMonth ?? 0)),
    lastFeeMonth:
      typeof raw.lastFeeMonth === 'number'
        ? Math.trunc(raw.lastFeeMonth)
        : undefined,
    priceSettled: Boolean(raw.priceSettled),
    dissolveEffectiveMonth:
      typeof raw.dissolveEffectiveMonth === 'number'
        ? Math.trunc(raw.dissolveEffectiveMonth)
        : null,
    rejectedMonth:
      typeof raw.rejectedMonth === 'number'
        ? Math.trunc(raw.rejectedMonth)
        : null,
    guestColor:
      typeof raw.guestColor === 'string' ? raw.guestColor : PROVINCE_COLORS[1],
    hostNameAr: sanitizeDisplayText(
      raw.hostNameAr,
      'المملكة المضيفة',
      MAX_KINGDOM_NAME_LENGTH
    ),
    guestNameAr: sanitizeDisplayText(
      raw.guestNameAr,
      'المملكة الضيفة',
      MAX_KINGDOM_NAME_LENGTH
    ),
    updatedAt:
      typeof raw.updatedAt === 'number' ? Math.trunc(raw.updatedAt) : undefined,
  };
}

export async function fetchMyEmbassyAgreements(
  uid: string
): Promise<EmbassyAgreement[]> {
  if (!isOnlineWorldEnabled() || !uid) return [];
  try {
    const services = await getFirebaseServices();
    if (!services) return [];
    const { collection, getDocs, query, where } = await import(
      'firebase/firestore'
    );
    const colRef = collection(services.db, 'embassyAgreements');
    const [hostSnap, guestSnap] = await Promise.all([
      getDocs(query(colRef, where('hostUid', '==', uid))),
      getDocs(query(colRef, where('guestUid', '==', uid))),
    ]);
    const map = new Map<string, EmbassyAgreement>();
    const absorb = (snap: typeof hostSnap) => {
      snap.forEach((d) => {
        const norm = normalizeEmbassyDoc(
          d.id,
          d.data() as Partial<EmbassyAgreement>
        );
        if (norm) map.set(norm.id, norm);
      });
    };
    absorb(hostSnap);
    absorb(guestSnap);
    return Array.from(map.values()).sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    );
  } catch {
    return [];
  }
}

export async function fetchMyEmbassyPayment(uid: string): Promise<number> {
  if (!isOnlineWorldEnabled() || !uid) return 0;
  try {
    const services = await getFirebaseServices();
    if (!services) return 0;
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(services.db, 'embassyPayments', uid));
    if (!snap.exists()) return 0;
    const data = snap.data() as Partial<EmbassyPaymentDoc>;
    return typeof data.pendingGold === 'number' && Number.isFinite(data.pendingGold)
      ? Math.max(0, Math.floor(data.pendingGold))
      : 0;
  } catch {
    return 0;
  }
}

/**
 * Element N1.2: Propose an embassy to hostUid with priceAgreed >= 100.
 * Enforces max 4 non-dissolved agreements, one pending per ordered pair, and 1-world-month rejection cooldown.
 */
export async function proposeEmbassy(params: {
  hostUid: string;
  guestUid: string;
  priceAgreed: number;
  createdMonth: number;
  hostNameAr: string;
  guestNameAr: string;
  guestColor?: string;
  currentWorldMonth?: number;
}): Promise<{ ok: boolean; agreement?: EmbassyAgreement; errorAr?: string }> {
  if (!isOnlineWorldEnabled() || !params.guestUid || !params.hostUid) {
    return { ok: false, errorAr: 'الوضع المحلي نشط — سجّل الدخول لاقتراح سفارة' };
  }
  if (params.hostUid === params.guestUid) {
    return { ok: false, errorAr: 'لا يمكنك اقتراح سفارة مع مملكتك نفسها' };
  }
  const priceAgreed = Math.floor(params.priceAgreed);
  if (
    !Number.isInteger(priceAgreed) ||
    priceAgreed < EMBASSY_MIN_PRICE ||
    priceAgreed > EMBASSY_MAX_PRICE
  ) {
    return {
      ok: false,
      errorAr: `ثمن أرض السفارة يجب أن يكون بين ${EMBASSY_MIN_PRICE} و${EMBASSY_MAX_PRICE} ذهب`,
    };
  }

  try {
    const services = await getFirebaseServices();
    if (!services) return { ok: false, errorAr: 'تعذر الاتصال بالسفارات' };
    const { doc, runTransaction } = await import('firebase/firestore');

    const myExisting = await fetchMyEmbassyAgreements(params.guestUid);
    const myActiveIds = myExisting
      .filter((a) => a.status !== 'dissolved')
      .map((a) => a.id);

    const agId = makeEmbassyAgreementId(params.hostUid, params.guestUid);
    const agRef = doc(services.db, 'embassyAgreements', agId);
    const worldMonth = params.currentWorldMonth ?? getWorldEpochMonth();

    const agreement = await runTransaction(services.db, async (tx) => {
      // Verify guest has < 4 non-dissolved agreements inside transaction
      let liveNonDissolved = 0;
      for (const existingId of myActiveIds) {
        const s = await tx.get(doc(services.db, 'embassyAgreements', existingId));
        if (s.exists()) {
          const d = s.data() as Partial<EmbassyAgreement>;
          if (d.status && d.status !== 'dissolved') {
            liveNonDissolved += 1;
          }
        }
      }
      if (liveNonDissolved >= MAX_EMBASSY_AGREEMENTS_PER_KINGDOM) {
        throw new Error('MAX_EMBASSIES');
      }

      const pairSnap = await tx.get(agRef);
      const existingPair = pairSnap.exists()
        ? normalizeEmbassyDoc(
            pairSnap.id,
            pairSnap.data() as Partial<EmbassyAgreement>
          )
        : null;
      const check = canProposeEmbassyPair(existingPair, worldMonth);
      if (!check.ok) {
        throw new Error(check.reasonAr ?? 'PAIR_BLOCKED');
      }

      const nowMs = Math.trunc(Date.now());
      const nextDoc: EmbassyAgreement = {
        id: agId,
        hostUid: params.hostUid,
        guestUid: params.guestUid,
        status: 'pending',
        priceAgreed,
        feeArrearsMonths: 0,
        createdMonth: Math.max(0, Math.trunc(params.createdMonth)),
        priceSettled: false,
        dissolveEffectiveMonth: null,
        rejectedMonth: null,
        guestColor: params.guestColor ?? PROVINCE_COLORS[1],
        hostNameAr: sanitizeDisplayText(
          params.hostNameAr,
          'المملكة المضيفة',
          MAX_KINGDOM_NAME_LENGTH
        ),
        guestNameAr: sanitizeDisplayText(
          params.guestNameAr,
          'المملكة الضيفة',
          MAX_KINGDOM_NAME_LENGTH
        ),
        updatedAt: nowMs,
      };
      tx.set(agRef, nextDoc);
      return nextDoc;
    });

    return { ok: true, agreement };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'MAX_EMBASSIES') {
      return {
        ok: false,
        errorAr: `الحد الأقصى ${MAX_EMBASSY_AGREEMENTS_PER_KINGDOM} سفارات نشطة أو معلّقة لكل مملكة`,
      };
    }
    return { ok: false, errorAr: msg || 'تعذر إرسال اقتراح السفارة' };
  }
}

/**
 * Element N1.2: Host approves a pending embassy proposal in ONE transaction.
 * Picks a plot cube locally via pickEmbassyPlotCube — if null, agreement is STILL active WITHOUT a plot.
 */
export async function approveEmbassyProposal(params: {
  hostUid: string;
  agreementId: string;
  cubes: Cube[];
  campCubeId: number | null;
  existingPlots: readonly EmbassyPlotMarker[];
}): Promise<{
  ok: boolean;
  agreement?: EmbassyAgreement;
  plotMarker?: EmbassyPlotMarker | null;
  errorAr?: string;
}> {
  if (!isOnlineWorldEnabled() || !params.hostUid || !params.agreementId) {
    return { ok: false, errorAr: 'العملية غير متاحة حالياً' };
  }
  try {
    const services = await getFirebaseServices();
    if (!services) return { ok: false, errorAr: 'تعذر الاتصال بالسفارات' };
    const { doc, runTransaction } = await import('firebase/firestore');

    const myExisting = await fetchMyEmbassyAgreements(params.hostUid);
    const myNonDissolvedIds = myExisting
      .filter((a) => a.status !== 'dissolved' && a.id !== params.agreementId)
      .map((a) => a.id);

    const agRef = doc(services.db, 'embassyAgreements', params.agreementId);

    const agreement = await runTransaction(services.db, async (tx) => {
      let otherCount = 0;
      for (const id of myNonDissolvedIds) {
        const s = await tx.get(doc(services.db, 'embassyAgreements', id));
        if (s.exists()) {
          const d = s.data() as Partial<EmbassyAgreement>;
          if (d.status && d.status !== 'dissolved') otherCount += 1;
        }
      }
      if (otherCount >= MAX_EMBASSY_AGREEMENTS_PER_KINGDOM) {
        throw new Error('MAX_EMBASSIES');
      }

      const snap = await tx.get(agRef);
      if (!snap.exists()) throw new Error('NOT_FOUND');
      const live = normalizeEmbassyDoc(
        snap.id,
        snap.data() as Partial<EmbassyAgreement>
      );
      if (!live || live.hostUid !== params.hostUid || live.status !== 'pending') {
        throw new Error('INVALID_STATE');
      }

      const updated: EmbassyAgreement = {
        ...live,
        status: 'active',
        feeArrearsMonths: 0,
        priceSettled: false,
        dissolveEffectiveMonth: null,
        rejectedMonth: null,
        updatedAt: Math.trunc(Date.now()),
      };
      tx.set(agRef, updated);
      return updated;
    });

    const occupied = new Set<number>(params.existingPlots.map((p) => p.cubeId));
    const plotCube = pickEmbassyPlotCube(params.cubes, params.campCubeId, occupied);
    const plotMarker: EmbassyPlotMarker | null = plotCube
      ? {
          agreementId: agreement.id,
          cubeId: plotCube.id,
          guestUid: agreement.guestUid,
          guestNameAr: agreement.guestNameAr,
          guestColor: agreement.guestColor ?? PROVINCE_COLORS[1],
        }
      : null;

    return { ok: true, agreement, plotMarker };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'MAX_EMBASSIES') {
      return {
        ok: false,
        errorAr: `بلغت الحد الأقصى (${MAX_EMBASSY_AGREEMENTS_PER_KINGDOM}) من السفارات`,
      };
    }
    return { ok: false, errorAr: 'تعذر قبول اقتراح السفارة' };
  }
}

/**
 * Element N1.2: Host rejects a pending embassy proposal (final for that proposal; 1 world month cooldown).
 */
export async function rejectEmbassyProposal(
  hostUid: string,
  agreementId: string,
  currentWorldMonth = getWorldEpochMonth()
): Promise<{ ok: boolean; errorAr?: string }> {
  if (!isOnlineWorldEnabled() || !hostUid || !agreementId) {
    return { ok: false, errorAr: 'العملية غير متاحة حالياً' };
  }
  try {
    const services = await getFirebaseServices();
    if (!services) return { ok: false, errorAr: 'تعذر الاتصال بالسفارات' };
    const { doc, runTransaction } = await import('firebase/firestore');
    const agRef = doc(services.db, 'embassyAgreements', agreementId);

    await runTransaction(services.db, async (tx) => {
      const snap = await tx.get(agRef);
      if (!snap.exists()) throw new Error('NOT_FOUND');
      const live = normalizeEmbassyDoc(
        snap.id,
        snap.data() as Partial<EmbassyAgreement>
      );
      if (!live || live.hostUid !== hostUid || live.status !== 'pending') {
        throw new Error('INVALID_STATE');
      }
      tx.set(agRef, {
        ...live,
        status: 'dissolved',
        rejectedMonth: currentWorldMonth,
        updatedAt: Math.trunc(Date.now()),
      } satisfies EmbassyAgreement);
    });
    return { ok: true };
  } catch {
    return { ok: false, errorAr: 'تعذر رفض الطلب' };
  }
}

/**
 * Element N1.4 & Harden N1 (fee-dodging defense):
 * Either king may request dissolution from the overlay.
 * Dissolution takes effect at the NEXT month boundary (`dissolveEffectiveMonth = currentTotalMonths + 1`)
 * so the current month's fee STILL falls due. Already paid fees are never refunded.
 */
export async function requestDissolveEmbassy(params: {
  actorUid: string;
  agreementId: string;
  currentTotalMonths: number;
}): Promise<{ ok: boolean; agreement?: EmbassyAgreement; errorAr?: string }> {
  if (!isOnlineWorldEnabled() || !params.actorUid || !params.agreementId) {
    return { ok: false, errorAr: 'العملية غير متاحة حالياً' };
  }
  try {
    const services = await getFirebaseServices();
    if (!services) return { ok: false, errorAr: 'تعذر الاتصال بالسفارات' };
    const { doc, runTransaction } = await import('firebase/firestore');
    const agRef = doc(services.db, 'embassyAgreements', params.agreementId);

    const updated = await runTransaction(services.db, async (tx) => {
      const snap = await tx.get(agRef);
      if (!snap.exists()) throw new Error('NOT_FOUND');
      const live = normalizeEmbassyDoc(
        snap.id,
        snap.data() as Partial<EmbassyAgreement>
      );
      if (
        !live ||
        (live.hostUid !== params.actorUid && live.guestUid !== params.actorUid)
      ) {
        throw new Error('FORBIDDEN');
      }
      if (live.status === 'dissolved') return live;

      const effectiveMonth = Math.max(0, Math.trunc(params.currentTotalMonths)) + 1;
      const next: EmbassyAgreement = {
        ...live,
        dissolveEffectiveMonth:
          live.dissolveEffectiveMonth != null
            ? Math.min(live.dissolveEffectiveMonth, effectiveMonth)
            : effectiveMonth,
        updatedAt: Math.trunc(Date.now()),
      };
      tx.set(agRef, next);
      return next;
    });

    return { ok: true, agreement: updated };
  } catch {
    return { ok: false, errorAr: 'تعذر تسجيل طلب حلّ السفارة' };
  }
}

/**
 * Element N1.4:
 * Guest-side monthly embassy fee processing (runs online-only AFTER advisor briefing).
 * Uses held worldInflationIndex — if null/unavailable, skips this month and NEVER guesses.
 * Pays fee to worldPalace/current inside a Firestore transaction.
 */
export async function processEmbassyMonthlyFees(params: {
  guestUid: string;
  totalMonths: number;
  worldInflationIndex: number | null;
  availableGold: number;
  agreements: readonly EmbassyAgreement[];
}): Promise<{
  totalFeesPaid: number;
  arrearsAdded: number;
  updatedAgreements: EmbassyAgreement[];
}> {
  if (
    !isOnlineWorldEnabled() ||
    !params.guestUid ||
    params.worldInflationIndex === null ||
    !Number.isFinite(params.worldInflationIndex)
  ) {
    return { totalFeesPaid: 0, arrearsAdded: 0, updatedAgreements: [] };
  }

  const fee = computeEmbassyFee(params.worldInflationIndex);
  const dueAgreements = params.agreements.filter(
    (ag) =>
      ag.guestUid === params.guestUid &&
      (ag.status === 'active' || ag.status === 'suspended') &&
      (ag.lastFeeMonth ?? -1) < params.totalMonths
  );
  if (dueAgreements.length === 0) {
    return { totalFeesPaid: 0, arrearsAdded: 0, updatedAgreements: [] };
  }

  try {
    const services = await getFirebaseServices();
    if (!services) {
      return { totalFeesPaid: 0, arrearsAdded: 0, updatedAgreements: [] };
    }
    const { doc, runTransaction } = await import('firebase/firestore');
    const palaceRef = doc(services.db, 'worldPalace', 'current');

    let remainingGold = Math.max(0, Math.floor(params.availableGold));
    let totalFeesPaid = 0;
    let arrearsAdded = 0;
    const updatedAgreements: EmbassyAgreement[] = [];

    for (const candidate of dueAgreements) {
      const agRef = doc(services.db, 'embassyAgreements', candidate.id);
      try {
        const res = await runTransaction(services.db, async (tx) => {
          const [agSnap, palaceSnap] = await Promise.all([
            tx.get(agRef),
            tx.get(palaceRef),
          ]);
          if (!agSnap.exists()) return null;
          const live = normalizeEmbassyDoc(
            agSnap.id,
            agSnap.data() as Partial<EmbassyAgreement>
          );
          if (
            !live ||
            live.guestUid !== params.guestUid ||
            (live.status !== 'active' && live.status !== 'suspended') ||
            (live.lastFeeMonth ?? -1) >= params.totalMonths
          ) {
            return null;
          }

          const step = computeMonthlyEmbassyFeeStep(
            live,
            fee,
            remainingGold,
            params.totalMonths
          );
          const nextDoc: EmbassyAgreement = {
            ...live,
            status: step.nextStatus,
            feeArrearsMonths: step.nextArrears,
            lastFeeMonth: params.totalMonths,
            updatedAt: Math.trunc(Date.now()),
          };
          tx.set(agRef, nextDoc);

          if (step.feePaid > 0) {
            const prevPalace = palaceSnap.exists()
              ? Math.max(0, Math.floor((palaceSnap.data()?.gold as number) ?? 0))
              : 0;
            tx.set(palaceRef, { gold: prevPalace + step.feePaid });
          }

          return { step, nextDoc };
        });

        if (res) {
          remainingGold = Math.max(0, remainingGold - res.step.feePaid);
          totalFeesPaid += res.step.feePaid;
          arrearsAdded += res.step.arrearsDelta;
          updatedAgreements.push(res.nextDoc);
        }
      } catch {
        // Non-fatal: skip contended doc safely
      }
    }

    return { totalFeesPaid, arrearsAdded, updatedAgreements };
  } catch {
    return { totalFeesPaid: 0, arrearsAdded: 0, updatedAgreements: [] };
  }
}

/**
 * Element N1.2 & Harden N1:
 * Settles unpaid embassy land-price markers (`priceSettled === false`) at the guest's month processing.
 * Moves exact `priceAgreed` once into `embassyPayments/{hostUid}` inside ONE transaction.
 */
export async function settleEmbassyPricesDue(params: {
  guestUid: string;
  agreements: readonly EmbassyAgreement[];
  availableGold: number;
}): Promise<{
  totalSettledGold: number;
  settledAgreements: EmbassyAgreement[];
}> {
  if (!isOnlineWorldEnabled() || !params.guestUid) {
    return { totalSettledGold: 0, settledAgreements: [] };
  }

  const unpaid = params.agreements.filter(
    (ag) =>
      ag.guestUid === params.guestUid &&
      (ag.status === 'active' || ag.status === 'suspended') &&
      !ag.priceSettled &&
      ag.priceAgreed > 0
  );
  if (unpaid.length === 0) {
    return { totalSettledGold: 0, settledAgreements: [] };
  }

  try {
    const services = await getFirebaseServices();
    if (!services) return { totalSettledGold: 0, settledAgreements: [] };
    const { doc, runTransaction } = await import('firebase/firestore');

    let remainingGold = Math.max(0, Math.floor(params.availableGold));
    let totalSettledGold = 0;
    const settledAgreements: EmbassyAgreement[] = [];

    for (const candidate of unpaid) {
      if (remainingGold < candidate.priceAgreed) continue;
      const agRef = doc(services.db, 'embassyAgreements', candidate.id);
      const payRef = doc(services.db, 'embassyPayments', candidate.hostUid);
      try {
        const res = await runTransaction(services.db, async (tx) => {
          const [agSnap, paySnap] = await Promise.all([
            tx.get(agRef),
            tx.get(payRef),
          ]);
          if (!agSnap.exists()) return null;
          const live = normalizeEmbassyDoc(
            agSnap.id,
            agSnap.data() as Partial<EmbassyAgreement>
          );
          if (
            !live ||
            live.guestUid !== params.guestUid ||
            live.priceSettled ||
            live.priceAgreed <= 0 ||
            live.priceAgreed > remainingGold ||
            (live.status !== 'active' && live.status !== 'suspended')
          ) {
            return null;
          }

          const nowMs = Math.trunc(Date.now());
          const prevPay = paySnap.exists()
            ? Math.max(
                0,
                Math.floor(
                  ((paySnap.data() as Partial<EmbassyPaymentDoc>).pendingGold ?? 0)
                )
              )
            : 0;
          const nextDoc: EmbassyAgreement = {
            ...live,
            priceSettled: true,
            updatedAt: nowMs,
          };
          tx.set(agRef, nextDoc);
          tx.set(payRef, {
            uid: live.hostUid,
            pendingGold: prevPay + live.priceAgreed,
            updatedAt: nowMs,
          } satisfies EmbassyPaymentDoc);
          return { amount: live.priceAgreed, nextDoc };
        });

        if (res) {
          remainingGold = Math.max(0, remainingGold - res.amount);
          totalSettledGold += res.amount;
          settledAgreements.push(res.nextDoc);
        }
      } catch {
        // Non-fatal
      }
    }

    return { totalSettledGold, settledAgreements };
  } catch {
    return { totalSettledGold: 0, settledAgreements: [] };
  }
}

/**
 * Element N1.2: Host collects pending embassy land-price payments in ONE transaction.
 */
export async function collectEmbassyPayments(hostUid: string): Promise<{
  ok: boolean;
  collectedGold: number;
  claimUpdatedAt: number;
  errorAr?: string;
}> {
  if (!isOnlineWorldEnabled() || !hostUid) {
    return { ok: false, collectedGold: 0, claimUpdatedAt: 0 };
  }
  try {
    const services = await getFirebaseServices();
    if (!services) {
      return {
        ok: false,
        collectedGold: 0,
        claimUpdatedAt: 0,
        errorAr: 'تعذر الاتصال بالسفارات',
      };
    }
    const { doc, runTransaction } = await import('firebase/firestore');
    const payRef = doc(services.db, 'embassyPayments', hostUid);

    const out = await runTransaction(services.db, async (tx) => {
      const snap = await tx.get(payRef);
      if (!snap.exists()) return { collectedGold: 0, claimUpdatedAt: 0 };
      const data = snap.data() as Partial<EmbassyPaymentDoc>;
      const pendingGold =
        typeof data.pendingGold === 'number' && Number.isFinite(data.pendingGold)
          ? Math.max(0, Math.floor(data.pendingGold))
          : 0;
      if (pendingGold <= 0) return { collectedGold: 0, claimUpdatedAt: 0 };
      const nowMs = Math.trunc(Date.now());
      tx.set(payRef, {
        uid: hostUid,
        pendingGold: 0,
        updatedAt: nowMs,
      } satisfies EmbassyPaymentDoc);
      return { collectedGold: pendingGold, claimUpdatedAt: nowMs };
    });

    return { ok: true, ...out };
  } catch {
    return {
      ok: false,
      collectedGold: 0,
      claimUpdatedAt: 0,
      errorAr: 'تعذر تحصيل عائد السفارات',
    };
  }
}
