import { BASE_BUY_PRICES, MONTH_DAYS, TRADED_RESOURCES } from './constants';
import { computePeoplesBankNetWorth, getBankCubeAskPrice } from './bank';
import { getHousingQueue } from './housingOffice';
import { getActiveCVs } from './laborOffice';
import {
  chebyshevDistance,
  findProvinceForCube,
  formatProvinceTitle,
  PALACE_PROVINCE_NAME,
} from './provinces';
import { STRINGS } from './strings';
import type {
  AdvisorAction,
  AdvisorBriefing,
  BankLoan,
  BriefLine,
  BriefSeverity,
  Citizen,
  Cube,
  FaxAdvice,
  GameState,
  LastMonthStats,
  LedgerEntry,
  OfficeFax,
  OfficeFaxStatus,
  PeoplesBank,
  PriceMap,
  Province,
  ProvinceEvent,
  ThemeId,
  TradedResourceKey,
} from './types';

const VALID_FAX_STATUSES: ReadonlySet<OfficeFaxStatus> = new Set([
  'unread',
  'read',
  'acted',
  'dismissed',
]);

const SEVERITY_ORDER: Record<BriefSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  positive: 3,
  info: 4,
};

export function sanitizeOfficeFaxesOnHydrate(
  raw: OfficeFax[] | undefined
): OfficeFax[] {
  if (!Array.isArray(raw)) return [];
  const seenIds = new Set<string>();
  return raw.map((f, idx) => {
    let id =
      typeof f.id === 'string' && f.id.length > 0 ? f.id : `fax-${f.month ?? 0}-${idx}`;
    if (seenIds.has(id)) {
      id = `${id}-dup-${idx}`;
    }
    seenIds.add(id);
    return {
      ...f,
      id,
      status: VALID_FAX_STATUSES.has(f.status) ? f.status : 'unread',
    };
  });
}

export function countUnreadFaxes(officeFaxes: OfficeFax[]): number {
  let count = 0;
  for (let i = 0; i < officeFaxes.length; i++) {
    if (officeFaxes[i].status === 'unread') count += 1;
  }
  return count;
}

export function classifyBankFaxKind(
  fax: OfficeFax
): 'networth' | 'seize' | 'missed_installment' {
  if (
    fax.id.startsWith('fax-bankwarn-') ||
    fax.textAr.includes('ثروة بنك الشعب')
  ) {
    return 'networth';
  }
  if (
    fax.id.startsWith('fax-seize-') ||
    fax.textAr.includes('محجوزة')
  ) {
    return 'seize';
  }
  return 'missed_installment';
}

export function getFaxIssueKey(fax: OfficeFax): string {
  if (fax.office === 'housing') return 'housing:queue';
  if (fax.office === 'labor') return 'labor:cv';
  if (fax.office === 'registry') {
    return fax.id.startsWith('fax-orphan-') ? 'registry:orphan' : 'registry:death';
  }
  if (fax.id.startsWith('fax-bank-offline-')) return 'bank:offline_deferred';
  return `bank:${classifyBankFaxKind(fax)}`;
}

// Element 5.1 & H5: Offline flood control — merge unread faxes of same (office, issueKey),
// never touching read/acted/dismissed history.
export function appendOrMergeFaxes(
  existing: OfficeFax[],
  incoming: OfficeFax[],
  isOffline: boolean
): OfficeFax[] {
  if (incoming.length === 0) return existing;
  const next = existing.map((f) => ({ ...f }));
  for (const fax of incoming) {
    const normalized: OfficeFax = {
      ...fax,
      status: VALID_FAX_STATUSES.has(fax.status) ? fax.status : 'unread',
    };
    if (isOffline && normalized.status === 'unread') {
      const key = getFaxIssueKey(normalized);
      let mergedIndex = -1;
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].status === 'unread' && getFaxIssueKey(next[i]) === key) {
          mergedIndex = i;
          break;
        }
      }
      if (mergedIndex !== -1) {
        next[mergedIndex] = {
          ...next[mergedIndex],
          month: normalized.month,
          textAr: normalized.textAr,
          actionThemeId: normalized.actionThemeId ?? next[mergedIndex].actionThemeId,
        };
        continue;
      }
    }
    next.push(normalized);
  }
  return next;
}

// Element 1.2 & H1: Pure, deterministic live-state advice (never stored, never uses Date.now/Math.random).
export function adviseFax(fax: OfficeFax, state: GameState): FaxAdvice {
  if (fax.office === 'housing') {
    const queue = getHousingQueue(state.citizens, state.totalMonths);
    const oldestWaiting = queue.reduce((m, q) => Math.max(m, q.waitingMonths), 0);
    if (queue.length === 0) {
      return {
        dataAr: 'طابور الإسكان الحالي: 0 أسرة منتظرة',
        recommendationAr: 'انتهت الحاجة — تم حل مشكلة السكن',
        action: { type: 'none' },
        resolved: true,
      };
    }
    return {
      dataAr: `طابور الإسكان الحالي: ${queue.length} أسرة · أقدم انتظار: ${oldestWaiting} شهر`,
      recommendationAr: `يُنصح ببناء ${queue.length} بيت (بيت لكل أسرة منتظرة)`,
      action: { type: 'arm_theme', themeId: 'house' },
      resolved: false,
    };
  }

  if (fax.office === 'bank') {
    const kind = classifyBankFaxKind(fax);

    if (kind === 'networth' || kind === 'seize') {
      const bankNetWorth = computePeoplesBankNetWorth(
        state.peoplesBank,
        state.cubes,
        state.prices,
        state.totalMonths
      );
      const bankCubes = state.cubes.filter((c) => c.owner === 'bank');
      let cheapestCube: Cube | null = null;
      let cheapestAsk = Infinity;
      for (const c of bankCubes) {
        const ask = getBankCubeAskPrice(state.cubes, c, state.totalMonths);
        if (
          ask < cheapestAsk ||
          (ask === cheapestAsk && cheapestCube !== null && c.id < cheapestCube.id)
        ) {
          cheapestAsk = ask;
          cheapestCube = c;
        }
      }

      if (kind === 'seize') {
        if (bankCubes.length === 0) {
          return {
            dataAr: `أراضي بنك الشعب حالياً: 0 · خزنة المملكة: ${state.gold} ذهب`,
            recommendationAr: 'انتهت الحاجة — تم استرداد الأراضي المحجوزة',
            action: { type: 'none' },
            resolved: true,
          };
        }
        return {
          dataAr: `أراضي لدى بنك الشعب: ${bankCubes.length} · أرخص سعر استرداد: ${cheapestAsk} ذهب`,
          recommendationAr: cheapestCube
            ? `راجع الأراضي المحجوزة للاسترداد (الأرخص حالياً ${cheapestAsk} ذهب)`
            : 'راجع لوحة البنك لاسترداد الأراضي المحجوزة',
          action: cheapestCube
            ? { type: 'focus_cube', cubeId: cheapestCube.id }
            : { type: 'open_bank' },
          resolved: false,
        };
      }

      // People's Bank netWorth warning fax
      const dataAr = `ثروة بنك الشعب: ${bankNetWorth} ذهب · خزنة المملكة: ${state.gold} ذهب`;
      if (bankNetWorth <= 2 * state.gold) {
        return {
          dataAr,
          recommendationAr: 'انتهت الحاجة — ثروة بنك الشعب لم تعد تتجاوز ضعف خزنتك',
          action: { type: 'none' },
          resolved: true,
        };
      }

      if (cheapestCube) {
        return {
          dataAr,
          recommendationAr: `يُنصح بمراجعة الأراضي المحجوزة للاسترداد (الأرخص ${cheapestAsk} ذهب)`,
          action: { type: 'focus_cube', cubeId: cheapestCube.id },
          resolved: false,
        };
      }
      return {
        dataAr,
        recommendationAr: 'راجع لوحة بنك الشعب لموازنة الخزنة ومتابعة استثماراته',
        action: { type: 'open_bank' },
        resolved: false,
      };
    }

    // Missed-installment / offline deferred bank fax
    const activeLoan = state.bankLoans.find((l) => l.status === 'active') ?? null;
    if (!activeLoan) {
      return {
        dataAr: 'لا يوجد تمويل قائم حالياً في البنك الشرعي',
        recommendationAr: 'انتهت الحاجة — لا يوجد تمويل قائم',
        action: { type: 'none' },
        resolved: true,
      };
    }

    const dataAr = `التمويل القائم: المسدّد ${activeLoan.paidSoFar}/${activeLoan.repayable} ذهب · تعثرات: ${activeLoan.missedCount}/3`;

    // Check warehouse surplus: qty >= 20 and price >= base (only if Bourse is unlocked at level >= 2)
    let bestResource: TradedResourceKey | null = null;
    let bestSurplusValue = -1;
    if (state.level >= 2) {
      for (const res of TRADED_RESOURCES) {
        const qty = state.warehouse[res] ?? 0;
        const price = state.prices[res] ?? 0;
        const base = BASE_BUY_PRICES[res] ?? Infinity;
        if (qty >= 20 && price >= base) {
          const val = qty * price;
          if (val > bestSurplusValue) {
            bestSurplusValue = val;
            bestResource = res;
          }
        }
      }
    }

    if (bestResource) {
      const resLabel = STRINGS.resources[bestResource] ?? bestResource;
      return {
        dataAr,
        recommendationAr: `بِع من فائض ${resLabel} في البورصة لتغطية القسط`,
        action: { type: 'open_bourse' },
        resolved: false,
      };
    }

    return {
      dataAr,
      recommendationAr: 'راجع لوحة البنك وادفع من الخزنة أو اسدد مبكراً جزئياً',
      action: { type: 'open_bank' },
      resolved: false,
    };
  }

  if (fax.office === 'registry') {
    const totalDeceased = state.eternalRecord.length;
    const heldEstates = state.palaceOfPeople.heldEstates;
    if (fax.id.startsWith('fax-orphan-')) {
      return {
        dataAr: `بلاغ أسرة يتيمة من السجل المدني · إجمالي السجل الأبدي: ${totalDeceased}`,
        recommendationAr: 'الأطفال في مسكنهم بأمان — تابع أحوال السجل المدني ورعايتهم',
        action: { type: 'none' },
        resolved: false,
      };
    }
    return {
      dataAr: `إجمالي الوفيات في السجل الأبدي: ${totalDeceased} · تركات محفوظة: ${heldEstates} ذهب`,
      recommendationAr: 'اطّلع على تبويب السجل الأبدي في مكاتب القصر لحفظ أسماء المتوفين',
      action: { type: 'none' },
      resolved: false,
    };
  }

  // office === 'labor'
  const cvs = getActiveCVs(state.citizens, state.totalMonths);
  const unfilledAds = state.privateAds.filter((a) => a.filledBy === null).length;
  const dataAr = `السير الذاتية النشطة: ${cvs.length} · إعلانات القطاع الخاص الشاغرة: ${unfilledAds}`;

  if (cvs.length === 0) {
    return {
      dataAr,
      recommendationAr: 'انتهت الحاجة — لا توجد سير ذاتية بانتظار التوظيف',
      action: { type: 'none' },
      resolved: true,
    };
  }

  // Bucket CV top attributes into farms (physical), workshops (professional), services (social)
  let physicalCount = 0;
  let professionalCount = 0;
  let socialCount = 0;
  for (const cv of cvs) {
    if (cv.topAttribute === 'physical' || cv.topAttribute === 'health') {
      physicalCount += 1;
    } else if (
      cv.topAttribute === 'professional' ||
      cv.topAttribute === 'intelligence'
    ) {
      professionalCount += 1;
    } else {
      socialCount += 1;
    }
  }

  let recommendedTheme: ThemeId = 'farm';
  let bucketLabel = 'المزارع';
  if (
    state.level >= 2 &&
    professionalCount > physicalCount &&
    professionalCount >= socialCount
  ) {
    recommendedTheme = 'workshop';
    bucketLabel = 'الورش الحرفية';
  } else if (
    state.level >= 2 &&
    socialCount > physicalCount &&
    socialCount > professionalCount
  ) {
    recommendedTheme = 'shop';
    bucketLabel = 'المحلات والخدمات';
  }

  const themeName = STRINGS.themes[recommendedTheme]?.name ?? recommendedTheme;
  return {
    dataAr,
    recommendationAr: `أعلى طلب توظيف في ${bucketLabel} — يُنصح ببناء ${themeName}`,
    action: { type: 'arm_theme', themeId: recommendedTheme },
    resolved: false,
  };
}

export interface AdvisorBriefingInput {
  month: number;
  arrears: number;
  bankLoans: BankLoan[];
  inflationIndex: number;
  lastMonthStats: LastMonthStats;
  citizens: Citizen[];
  totalMonths: number;
  peoplesBank: PeoplesBank;
  cubes: Cube[];
  prices: PriceMap;
  gold: number;
  citizenWealth: number;
  population: number;
  satisfaction: number;
  provinces?: Province[];
  provinceEvents?: ProvinceEvent[];
  pendingArrivals?: number;
}

// Element 1.3 & H1: Pure, deterministic monthly briefing computed once per month boundary.
export function computeAdvisorBriefing(
  input: AdvisorBriefingInput
): AdvisorBriefing {
  const lines: BriefLine[] = [];
  const activeLoan = input.bankLoans.find((l) => l.status === 'active') ?? null;
  const housingQueue = getHousingQueue(input.citizens, input.totalMonths);
  const bankNetWorth = computePeoplesBankNetWorth(
    input.peoplesBank,
    input.cubes,
    input.prices,
    input.totalMonths
  );
  const avgCitizenWealth = Math.floor(
    input.citizenWealth / Math.max(1, input.population)
  );

  // 1. arrears > 0 -> critical
  if (input.arrears > 0) {
    lines.push({
      severity: 'critical',
      textAr: `متأخرات رواتب ${input.arrears} ذهب — رضا الشعب مسقوف عند 50 حتى السداد`,
      action: { type: 'none' },
    });
  }

  // 2. active loan && missedCount >= 2 -> critical
  if (activeLoan && activeLoan.missedCount >= 2) {
    lines.push({
      severity: 'critical',
      textAr: 'قسطان متعثران — الحجز بعد شهر واحد',
      action: { type: 'open_bank' },
    });
  }

  // 3. inflationIndex > 130 -> high
  if (input.inflationIndex > 130) {
    lines.push({
      severity: 'high',
      textAr: `مؤشر الغلاء ${input.inflationIndex} — الأسعار تلتهم المرتبات`,
      action: { type: 'open_bourse' },
    });
  }

  // 4. lastMonthStats.unmetFood > 0 -> high
  if (input.lastMonthStats.unmetFood > 0) {
    lines.push({
      severity: 'high',
      textAr: `${input.lastMonthStats.unmetFood} مواطن لم يجد غذاءً كافياً الشهر الماضي`,
      action: { type: 'arm_theme', themeId: 'farm' },
    });
  }

  // 5. housing queue >= 5 -> medium
  if (housingQueue.length >= 5) {
    lines.push({
      severity: 'medium',
      textAr: `طابور الإسكان وصل ${housingQueue.length} أسرة`,
      action: { type: 'arm_theme', themeId: 'house' },
    });
  }

  // 6. peoplesBank netWorth > 2 * gold -> medium
  if (bankNetWorth > 2 * input.gold) {
    lines.push({
      severity: 'medium',
      textAr: `ثروة بنك الشعب ${bankNetWorth} تتضخم مقابل خزنتك`,
      action: { type: 'open_bank' },
    });
  }

  // 7. average citizen wealth < 20 && population >= 10 -> medium
  if (avgCitizenWealth < 20 && input.population >= 10) {
    lines.push({
      severity: 'medium',
      textAr: `متوسط ثروة المواطن ${avgCitizenWealth} — الشعب فقير`,
      action: { type: 'none' },
    });
  }

  // 8. gold > 3000 && no active loan -> positive
  if (input.gold > 3000 && !activeLoan) {
    lines.push({
      severity: 'positive',
      textAr: `الخزنة ممتلئة (${input.gold}) — التوسع أو سداد المستقبل أرخص الآن`,
      action: { type: 'none' },
    });
  }

  // 9. satisfaction >= 75 -> positive
  if (input.satisfaction >= 75) {
    lines.push({
      severity: 'positive',
      textAr: `الشعب راضٍ (${input.satisfaction}) — ظروف مثالية للنمو والتوسع`,
      action: { type: 'none' },
    });
  }

  // Prompt 7 Element 5.2: Province & Arrival Camp briefing lines
  const provinces = input.provinces ?? [];
  const provinceEvents = input.provinceEvents ?? [];
  const pendingArrivals = Math.max(0, Math.floor(input.pendingArrivals ?? 0));
  const resolveProvinceTitle = (centerCubeId: number): string => {
    const direct = findProvinceForCube(provinces, centerCubeId);
    if (direct) return formatProvinceTitle(direct.nameAr);
    const refCube = input.cubes[centerCubeId];
    if (refCube && provinces.length > 0) {
      let nearest = provinces[0];
      let bestDist = Infinity;
      for (let i = 0; i < provinces.length; i++) {
        const pCube = input.cubes[provinces[i].centerCubeId];
        if (!pCube) continue;
        const d = chebyshevDistance(refCube, pCube);
        if (
          d < bestDist ||
          (d === bestDist && provinces[i].centerCubeId < nearest.centerCubeId)
        ) {
          bestDist = d;
          nearest = provinces[i];
        }
      }
      if (bestDist < Infinity) {
        return formatProvinceTitle(nearest.nameAr);
      }
    }
    return formatProvinceTitle(PALACE_PROVINCE_NAME);
  };

  const monthEvents = provinceEvents.filter((ev) => ev.month === input.month);
  const emittedProvinceTexts = new Set<string>();
  const pushUniqueLine = (line: BriefLine) => {
    if (emittedProvinceTexts.has(line.textAr)) return;
    emittedProvinceTexts.add(line.textAr);
    lines.push(line);
  };

  for (let i = 0; i < monthEvents.length; i++) {
    const ev = monthEvents[i];
    if (ev.kind === 'village_joined') {
      const title = resolveProvinceTitle(ev.centerCubeId);
      pushUniqueLine({
        severity: 'positive',
        textAr: `انضمت قرية جديدة — ${title} كبرت`,
        action: { type: 'none' },
      });
    } else if (ev.kind === 'village_defected') {
      const title = resolveProvinceTitle(ev.centerCubeId);
      pushUniqueLine({
        severity: 'critical',
        textAr: `قرية انفصلت عنك — راجع رضا ${title}`,
        action: { type: 'none' },
      });
    } else if (ev.kind === 'province_formed') {
      const title = resolveProvinceTitle(ev.centerCubeId);
      pushUniqueLine({
        severity: 'info',
        textAr: `تشكلت ولاية جديدة: ${title}`,
        action: { type: 'none' },
      });
    }
  }

  if (pendingArrivals > 0) {
    lines.push({
      severity: 'medium',
      textAr: `مخيم الوصول ممتلئ — ${pendingArrivals} قادم ينتظر`,
      action: { type: 'arm_theme', themeId: 'house' },
    });
  }

  // Stable sort by severity
  lines.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const topLine = lines.find((l) => l.action.type !== 'none');
  const topAction: AdvisorAction = topLine ? topLine.action : { type: 'none' };

  return {
    month: input.month,
    lines,
    topAction,
  };
}

// Element 1.3 & H1: Pure, deterministic monthly briefing computed directly from GameState.
export function advisorBriefing(state: GameState): AdvisorBriefing {
  return computeAdvisorBriefing({
    month: state.totalMonths,
    arrears: state.arrears,
    bankLoans: state.bankLoans,
    inflationIndex: state.inflationIndex,
    lastMonthStats: state.lastMonthStats,
    citizens: state.citizens,
    totalMonths: state.totalMonths,
    peoplesBank: state.peoplesBank,
    cubes: state.cubes,
    prices: state.prices,
    gold: state.gold,
    citizenWealth: state.citizenWealth,
    population: state.population,
    satisfaction: state.satisfaction,
    provinces: state.provinces,
    provinceEvents: state.provinceEvents,
    pendingArrivals: state.pendingArrivals,
  });
}

// H4 Shared selector: single source of truth for month window treasury summary used by BOTH
// Inspector (خزنة المملكة) and AdvisorOverlay (موجز المملكة).
export function computeMonthLedgerSummary(ledger: LedgerEntry[], day: number): {
  monthStart: number;
  monthIn: number;
  monthOut: number;
  monthNet: number;
} {
  const safeDay = Math.max(1, day);
  const monthStart = Math.floor((safeDay - 1) / MONTH_DAYS) * MONTH_DAYS + 1;
  let monthIn = 0;
  let monthOut = 0;
  for (let i = 0; i < ledger.length; i++) {
    const e = ledger[i];
    if (e.day < monthStart) continue;
    if (e.amount > 0) monthIn += e.amount;
    else if (e.amount < 0) monthOut += Math.abs(e.amount);
  }
  return {
    monthStart,
    monthIn,
    monthOut,
    monthNet: monthIn - monthOut,
  };
}
