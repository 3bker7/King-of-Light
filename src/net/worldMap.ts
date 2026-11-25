import { getFirebaseServices, isOnlineWorldEnabled } from './firebase';
import { chebyshevWorldDistance } from './worldSpawn';
import {
  MAX_KINGDOM_NAME_LENGTH,
  MAX_RULER_NAME_LENGTH,
  MAX_WORLD_MAP_KINGDOMS,
  sanitizeDisplayText,
  type GoldBand,
  type WorldKingdom,
  type WorldPos,
} from './worldTypes';

/**
 * Element N2.1 & Harden N2 Privacy Contract:
 * The World Map reads ONLY these 10 summary fields from `worldKingdoms`.
 * It NEVER reads `cloudKingdoms`, exact treasury `gold`, `warehouse`, or `citizens`.
 */
export const WORLD_MAP_READ_FIELDS = [
  'uid',
  'nameAr',
  'rulerName',
  'wx',
  'wy',
  'reputation',
  'population',
  'provincesCount',
  'goldBand',
  'updatedAt',
] as const;

export const GOLD_BAND_LABELS_AR: Record<GoldBand, string> = {
  poor: 'خزينة محدودة',
  mid: 'خزينة متوسطة',
  rich: 'خزينة وفيرة',
};

function sanitizeGoldBand(raw: unknown): GoldBand {
  if (raw === 'poor' || raw === 'mid' || raw === 'rich') return raw;
  return 'mid';
}

export function parseWorldKingdomSummary(
  docId: string,
  raw: Record<string, unknown>
): WorldKingdom | null {
  if (!raw || typeof raw !== 'object') return null;
  const uid = typeof raw.uid === 'string' && raw.uid.trim().length > 0 ? raw.uid.trim() : docId;
  if (!uid) return null;

  const wx = typeof raw.wx === 'number' && Number.isFinite(raw.wx) ? Math.trunc(raw.wx) : 0;
  const wy = typeof raw.wy === 'number' && Number.isFinite(raw.wy) ? Math.trunc(raw.wy) : 0;
  const reputation =
    typeof raw.reputation === 'number' && Number.isFinite(raw.reputation)
      ? Math.max(0, Math.min(100, Math.round(raw.reputation)))
      : 50;
  const population =
    typeof raw.population === 'number' && Number.isFinite(raw.population)
      ? Math.max(0, Math.floor(raw.population))
      : 0;
  const provincesCount =
    typeof raw.provincesCount === 'number' && Number.isFinite(raw.provincesCount)
      ? Math.max(0, Math.floor(raw.provincesCount))
      : 0;
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? Math.max(0, Math.floor(raw.updatedAt))
      : 0;

  return {
    uid,
    nameAr: sanitizeDisplayText(
      typeof raw.nameAr === 'string' ? raw.nameAr : null,
      'مملكة مجاورة',
      MAX_KINGDOM_NAME_LENGTH
    ),
    rulerName: sanitizeDisplayText(
      typeof raw.rulerName === 'string' ? raw.rulerName : null,
      'ملك',
      MAX_RULER_NAME_LENGTH
    ),
    wx,
    wy,
    reputation,
    population,
    provincesCount,
    goldBand: sanitizeGoldBand(raw.goldBand),
    updatedAt,
  };
}

/**
 * Pure deterministic selection of up to `maxCount` (hard-capped at 200) kingdoms
 * nearest to `myPos` by Chebyshev distance. Tie-breaks by uid ASC.
 */
export function selectNearestKingdoms(
  kingdoms: readonly WorldKingdom[],
  myPos: WorldPos,
  maxCount = MAX_WORLD_MAP_KINGDOMS
): WorldKingdom[] {
  const cap = Math.max(
    0,
    Math.min(MAX_WORLD_MAP_KINGDOMS, Math.floor(maxCount))
  );
  if (cap === 0 || kingdoms.length === 0) return [];

  const deduped = new Map<string, WorldKingdom>();
  for (const k of kingdoms) {
    if (!k || typeof k.uid !== 'string' || !k.uid) continue;
    deduped.set(k.uid, k);
  }

  return Array.from(deduped.values())
    .sort((a, b) => {
      const da = chebyshevWorldDistance(a, myPos);
      const db = chebyshevWorldDistance(b, myPos);
      if (da !== db) return da - db;
      return a.uid.localeCompare(b.uid);
    })
    .slice(0, cap);
}

/**
 * Fetches up to 200 nearest kingdoms from `worldKingdoms` only.
 * Local mode (`firebaseConfig = null`): returns [] immediately with zero network calls.
 */
export async function fetchWorldKingdomsNearest(
  myPos: WorldPos,
  maxCount = MAX_WORLD_MAP_KINGDOMS
): Promise<WorldKingdom[]> {
  if (!isOnlineWorldEnabled()) return [];
  const services = await getFirebaseServices();
  if (!services) return [];

  const { collection, getDocs, limit, query } = await import('firebase/firestore');
  const cap = Math.max(
    1,
    Math.min(MAX_WORLD_MAP_KINGDOMS, Math.floor(maxCount))
  );
  // Read bounded window from `worldKingdoms` summaries only (never `cloudKingdoms`).
  const q = query(
    collection(services.db, 'worldKingdoms'),
    limit(Math.max(cap * 2, 400))
  );
  const snap = await getDocs(q);

  const parsed: WorldKingdom[] = [];
  snap.forEach((docSnap) => {
    const item = parseWorldKingdomSummary(
      docSnap.id,
      docSnap.data() as Record<string, unknown>
    );
    if (item) parsed.push(item);
  });

  return selectNearestKingdoms(parsed, myPos, cap);
}
