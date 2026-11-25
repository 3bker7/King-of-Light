import { computePeoplesBankNetWorth } from '../game/bank';
import { TRADED_RESOURCES } from '../game/constants';
import { STRINGS } from '../game/strings';
import type { GameState, TradedResourceKey } from '../game/types';
import { getFirebaseServices, isOnlineWorldEnabled } from './firebase';
import { GOLD_BAND_LABELS_AR } from './worldMap';
import {
  MAX_KINGDOM_NAME_LENGTH,
  sanitizeDisplayText,
  type GoldBand,
  type MarketStatsDoc,
  type WorldBourse,
  type WorldKingdom,
  type WorldNewsletter,
} from './worldTypes';

export interface WorldNewsletterAggregates {
  worldBourse?: Pick<
    WorldBourse,
    'prices' | 'previousPrices' | 'inflationIndex'
  > | null;
  yesterdayMarketStats?: MarketStatsDoc | null;
  kingdoms?: ReadonlyArray<WorldKingdom> | null;
  activeEmbassiesCount?: number | null;
  worldPalaceGold?: number | null;
  peoplesBankNetWorth?: number | null;
}

const GOLD_BAND_RANK: Record<GoldBand, number> = {
  poor: 0,
  mid: 1,
  rich: 2,
};

function computeTopBourseMovers(
  worldBourse: Pick<WorldBourse, 'prices' | 'previousPrices'>
): Array<{ resource: TradedResourceKey; pct: number }> {
  if (!worldBourse.previousPrices) return [];
  const movers: Array<{ resource: TradedResourceKey; pct: number }> = [];

  for (const key of TRADED_RESOURCES) {
    const curr = worldBourse.prices[key];
    const prev = worldBourse.previousPrices[key];
    if (
      typeof curr !== 'number' ||
      typeof prev !== 'number' ||
      !Number.isFinite(curr) ||
      !Number.isFinite(prev) ||
      prev <= 0
    ) {
      continue;
    }
    const pct = Math.round(((curr - prev) / prev) * 100);
    if (pct !== 0) {
      movers.push({ resource: key, pct });
    }
  }

  movers.sort((a, b) => {
    const diff = Math.abs(b.pct) - Math.abs(a.pct);
    if (diff !== 0) return diff;
    return a.resource.localeCompare(b.resource);
  });

  return movers.slice(0, 3);
}

/**
 * Element N4.1 — Pure, deterministic daily world newsletter line builder.
 * Strictly omits any line whose underlying aggregate datum is unavailable
 * (never invents or fabricates numbers).
 */
export function buildNewsletterLines(
  aggregates: WorldNewsletterAggregates
): string[] {
  const lines: string[] = [];

  // 1. Top 3 bourse movers recomputed from prices vs previousPrices
  if (aggregates.worldBourse) {
    const movers = computeTopBourseMovers(aggregates.worldBourse);
    if (movers.length > 0) {
      const formatted = movers
        .map(
          (m) =>
            `${STRINGS.resources[m.resource]} (${m.pct > 0 ? `+${m.pct}%` : `${m.pct}%`})`
        )
        .join('، ');
      lines.push(`أبرز تحركات بورصة العالم: ${formatted}.`);
    }
  }

  // 2. Yesterday's market volume + largest single sale
  const stats = aggregates.yesterdayMarketStats;
  if (
    stats &&
    typeof stats.totalVolume === 'number' &&
    Number.isFinite(stats.totalVolume) &&
    stats.totalVolume > 0
  ) {
    const vol = Math.floor(stats.totalVolume);
    const hasLargest =
      typeof stats.largestSaleAmount === 'number' &&
      Number.isFinite(stats.largestSaleAmount) &&
      stats.largestSaleAmount > 0 &&
      typeof stats.largestSaleSellerNameAr === 'string' &&
      stats.largestSaleSellerNameAr.trim().length > 0;
    if (hasLargest) {
      const seller = sanitizeDisplayText(
        stats.largestSaleSellerNameAr,
        'مملكة',
        MAX_KINGDOM_NAME_LENGTH
      );
      lines.push(
        `تداولات السوق العالمي بالأمس: ${vol} وحدة — أكبر صفقة ${Math.floor(
          stats.largestSaleAmount
        )} ذهب لمملكة «${seller}».`
      );
    } else {
      lines.push(`تداولات السوق العالمي بالأمس: ${vol} وحدة.`);
    }
  }

  // 3. Registered kingdoms count + newest kingdom name
  const kingdoms = aggregates.kingdoms;
  if (Array.isArray(kingdoms) && kingdoms.length > 0) {
    const sortedNewest = [...kingdoms].sort((a, b) => {
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
      return a.uid.localeCompare(b.uid);
    });
    const newestName = sanitizeDisplayText(
      sortedNewest[0].nameAr,
      'مملكة جديدة',
      MAX_KINGDOM_NAME_LENGTH
    );
    lines.push(
      `الممالك المسجّلة في العالم: ${kingdoms.length} مملكة — أحدثها «${newestName}».`
    );
  }

  // 4. Active embassies count
  if (
    typeof aggregates.activeEmbassiesCount === 'number' &&
    Number.isFinite(aggregates.activeEmbassiesCount) &&
    aggregates.activeEmbassiesCount >= 0
  ) {
    lines.push(
      `السفارات الدبلوماسية النشطة: ${Math.floor(aggregates.activeEmbassiesCount)} سفارة.`
    );
  }

  // 5. World Palace gold
  if (
    typeof aggregates.worldPalaceGold === 'number' &&
    Number.isFinite(aggregates.worldPalaceGold) &&
    aggregates.worldPalaceGold >= 0
  ) {
    lines.push(
      `خزينة قصر العالم: ${Math.floor(aggregates.worldPalaceGold)} ذهب.`
    );
  }

  // 6. People's Bank net worth (Prompt 5 formula) vs richest kingdom goldBand
  if (
    typeof aggregates.peoplesBankNetWorth === 'number' &&
    Number.isFinite(aggregates.peoplesBankNetWorth) &&
    Array.isArray(kingdoms) &&
    kingdoms.length > 0
  ) {
    let richestBand: GoldBand = 'poor';
    for (const k of kingdoms) {
      const band: GoldBand =
        k.goldBand === 'rich' || k.goldBand === 'mid' ? k.goldBand : 'poor';
      if (GOLD_BAND_RANK[band] > GOLD_BAND_RANK[richestBand]) {
        richestBand = band;
      }
    }
    lines.push(
      `صافي أصول بنك الشعب: ${Math.floor(
        aggregates.peoplesBankNetWorth
      )} ذهب، مقارنة بأعلى شريحة بين الممالك (${GOLD_BAND_LABELS_AR[richestBand]}).`
    );
  }

  // 7. World inflation index
  if (
    aggregates.worldBourse &&
    typeof aggregates.worldBourse.inflationIndex === 'number' &&
    Number.isFinite(aggregates.worldBourse.inflationIndex)
  ) {
    lines.push(
      `مؤشر الغلاء العالمي اليوم: ${Math.round(
        aggregates.worldBourse.inflationIndex
      )} نقطة.`
    );
  }

  return lines;
}

/**
 * Element N4.3 — Pure helper for the "من العالم" section inside the local bourse
 * when online. Omitted completely in local mode.
 */
export function buildLocalFromWorldLines(
  worldBourse: Pick<
    WorldBourse,
    'prices' | 'previousPrices' | 'inflationIndex'
  > | null,
  localInflationIndex: number
): string[] {
  if (!worldBourse) return [];
  const lines: string[] = [];

  if (
    typeof worldBourse.inflationIndex === 'number' &&
    Number.isFinite(worldBourse.inflationIndex)
  ) {
    const worldInf = Math.round(worldBourse.inflationIndex);
    const localInf = Math.round(localInflationIndex);
    const diff = worldInf - localInf;
    const relation =
      diff === 0
        ? 'متطابق مع المؤشر المحلي'
        : diff > 0
          ? `أعلى من المؤشر المحلي بـ ${diff} نقطة`
          : `أقل من المؤشر المحلي بـ ${Math.abs(diff)} نقطة`;
    lines.push(`الغلاء العالمي ${worldInf} (${relation}).`);
  }

  const movers = computeTopBourseMovers(worldBourse);
  if (movers.length > 0) {
    const text = movers
      .map(
        (m) =>
          `${STRINGS.resources[m.resource]} ${m.pct > 0 ? `+${m.pct}%` : `${m.pct}%`}`
      )
      .join(' · ');
    lines.push(`أكبر التغيّرات العالمية: ${text}.`);
  }

  return lines;
}

export interface FetchOrCreateNewsletterInput {
  epochDay: number;
  localState: Pick<GameState, 'peoplesBank' | 'cubes' | 'totalMonths'>;
  worldBourse: WorldBourse | null;
  kingdoms: ReadonlyArray<WorldKingdom>;
  activeEmbassiesCount: number | null;
}

/**
 * Element N4.2 — Fetches `worldNewsletter/{epochDay}`; if absent, computes it from
 * real aggregates and writes write-if-absent inside ONE Firestore transaction.
 * Local mode (`firebaseConfig = null`): returns null with zero network calls.
 */
export async function fetchOrCreateDailyWorldNewsletter(
  input: FetchOrCreateNewsletterInput
): Promise<WorldNewsletter | null> {
  if (!isOnlineWorldEnabled()) return null;
  const services = await getFirebaseServices();
  if (!services) return null;

  const safeDay = Math.max(0, Math.floor(input.epochDay));
  const { doc, getDoc, runTransaction } = await import('firebase/firestore');

  const newsletterRef = doc(services.db, 'worldNewsletter', String(safeDay));
  try {
    const existingSnap = await getDoc(newsletterRef);
    if (existingSnap.exists()) {
      const data = existingSnap.data() as Partial<WorldNewsletter>;
      if (Array.isArray(data.lines) && data.lines.length > 0) {
        return {
          day: typeof data.day === 'number' ? Math.floor(data.day) : safeDay,
          lines: data.lines
            .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
            .slice(0, 7)
            .map((l) => sanitizeDisplayText(l, '', 220))
            .filter((l) => l.length > 0),
        };
      }
    }

    // Gather missing aggregates for write-if-absent generation
    const [statsSnap, palaceSnap] = await Promise.all([
      getDoc(doc(services.db, 'marketStats', String(Math.max(0, safeDay - 1)))),
      getDoc(doc(services.db, 'worldPalace', 'current')),
    ]);

    const yesterdayMarketStats = statsSnap.exists()
      ? (statsSnap.data() as MarketStatsDoc)
      : null;

    const palaceRawGold = palaceSnap.exists()
      ? (palaceSnap.data() as Record<string, unknown>).gold
      : null;
    const worldPalaceGold =
      typeof palaceRawGold === 'number' && Number.isFinite(palaceRawGold)
        ? Math.max(0, Math.floor(palaceRawGold))
        : null;

    const peoplesBankNetWorth = input.worldBourse
      ? computePeoplesBankNetWorth(
          input.localState.peoplesBank,
          input.localState.cubes,
          input.worldBourse.prices,
          input.localState.totalMonths
        )
      : null;

    const generatedLines = buildNewsletterLines({
      worldBourse: input.worldBourse,
      yesterdayMarketStats,
      kingdoms: input.kingdoms,
      activeEmbassiesCount: input.activeEmbassiesCount,
      worldPalaceGold,
      peoplesBankNetWorth,
    });

    if (generatedLines.length === 0) {
      return null;
    }

    // Write-if-absent inside ONE Firestore transaction
    const written = await runTransaction(services.db, async (tx) => {
      const currentSnap = await tx.get(newsletterRef);
      if (currentSnap.exists()) {
        const existing = currentSnap.data() as Partial<WorldNewsletter>;
        if (Array.isArray(existing.lines) && existing.lines.length > 0) {
          return {
            day: typeof existing.day === 'number' ? Math.floor(existing.day) : safeDay,
            lines: existing.lines.filter((l): l is string => typeof l === 'string'),
          } satisfies WorldNewsletter;
        }
      }
      const payload: WorldNewsletter = {
        day: safeDay,
        lines: generatedLines,
      };
      tx.set(newsletterRef, payload);
      return payload;
    });

    return written;
  } catch {
    return null;
  }
}
