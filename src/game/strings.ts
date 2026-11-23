import type { ResourceKey, ShortageReason, ThemeId, TradedResourceKey } from './types';

export const STRINGS = {
  appName: 'نور الشعب',
  dayLabel: (day: number) => `اليوم ${day}`,
  goldLabel: 'الذهب',
  populationLabel: 'السكان',
  satisfactionLabel: 'الرضا',
  reputationLabel: 'السمعة',
  bourseButton: 'البورصة',
  settingsButton: 'الإعدادات',
  levelTitles: {
    1: 'المستوى 1: البداية',
    2: 'المستوى 2: أول مدينة',
  } as Record<1 | 2, string>,

  resources: {
    fish: 'السمك',
    crops: 'المحاصيل',
    meat: 'اللحوم',
    wood: 'الخشب',
    water: 'المياه',
    bread: 'الخبز',
    cotton: 'القطن',
    clothes: 'الملابس',
    oil: 'البترول',
    stone: 'الحجر',
  } as Record<ResourceKey, string>,

  themes: {
    sea: {
      name: 'بحر',
      summary: 'ينتج 2 سمك كل 60 ثانية ويمنح ترفيهاً للبيوت المجاورة.',
    },
    well: {
      name: 'بئر',
      summary: 'ينتج 3 مياه كل 45 ثانية دون الحاجة لعمال.',
    },
    farm: {
      name: 'مزرعة',
      summary: 'تنتج 3 محاصيل كل 90 ثانية وتستهلك 1 مياه.',
    },
    forest: {
      name: 'غابة',
      summary: 'تنتج 2 خشب كل 75 ثانية وتحتاج عاملاً واحداً.',
    },
    pasture: {
      name: 'مرعى',
      summary: 'ينتج 2 لحوم كل 120 ثانية ويستهلك 1 محاصيل.',
    },
    house: {
      name: 'بيت',
      summary: 'يؤوي 5 من السكان في نصف مكعب.',
    },
    shop: {
      name: 'محل',
      summary: 'يحوّل 1 وحدة طعام فائض إلى 4 ذهب كل 60 ثانية.',
    },
  } as Record<ThemeId, { name: string; summary: string }>,

  footprint: {
    full: '1 مكعب',
    half: 'نصف مكعب',
  },

  buildDock: {
    title: 'البناء',
    cancelBuild: 'إلغاء البناء',
    activeHint: (themeName: string) => `انقر على مكعب مملوك لوضع: ${themeName}`,
    goldUnit: 'ذهب',
    workersNeeded: (n: number) => (n === 0 ? 'بدون عمال' : `${n} عمال`),
    level2Teaser: 'تُفتح الغابة والمرعى والمحل والبورصة في المستوى 2.',
  },

  inspector: {
    tabInfo: 'المملكة',
    tabBourse: 'البورصة',
    cubeTitle: (row: number, col: number) => `مكعب (${row + 1} ، ${col + 1})`,
    closeSelection: 'العودة للملخص',
    ownedSand: 'رمل مملوك',
    ownedSandHint: 'اختر مبنى من قائمة البناء لوضعه هنا.',
    neutralSand: 'أرض محايدة',
    neutralAdjacentHint: 'ملاصقة لأرضك ويمكنك شراؤها للتوسع.',
    neutralFarHint: 'اشترِ المكعبات المجاورة أولاً للوصول إلى هذه الأرض.',
    buyCubeAction: (cost: number) => `شراء المكعب (${cost} ذهب)`,
    notEnoughGold: 'الذهب غير كافٍ',
    slotPrimary: 'النصف الأول',
    slotSecondary: 'النصف الثاني',
    emptyHalf: 'نصف رمل فارغ — يمكن إضافة مبنى نصف مكعب آخر هنا.',
    cycleLabel: 'دورة الإنتاج',
    secondsRemaining: (s: number) => `${s} ثانية متبقية`,
    outputPerCycle: (amount: number, resourceName: string) =>
      `ينتج ${amount} ${resourceName} في كل دورة`,
    shopOutputPerCycle: (gold: number) => `يحوّل 1 طعام فائض إلى ${gold} ذهب`,
    houseCapacityLabel: (cap: number) => `يؤوي ${cap} من السكان`,
    seaAdjacencyBonus: (pct: number, neighbors: number) =>
      neighbors > 0
        ? `مكافأة تجاور البحار: +${pct}% (${neighbors} مجاور)`
        : 'ضع بحراً مجاوراً لزيادة إنتاج السمك +25% لكل بحر.',
    seaEntertainmentNote: 'يمنح +40 ترفيهاً عند مجاورته لبيت.',
    unstaffedBadge: 'لا يوجد عمال',
    unstaffedDetail: 'الإنتاج متوقف لعدم توفر عدد كافٍ من السكان للعمل.',
    shortages: {
      no_water: 'الإنتاج 0 — لا توجد مياه كافية في المستودع.',
      no_crops: 'الإنتاج 0 — لا توجد محاصيل كافية في المستودع.',
      no_surplus_food: 'متوقف مؤقتاً — لا يوجد فائض طعام فوق حاجة السكان.',
    } as Record<Exclude<ShortageReason, null>, string>,
    demolish: 'هدم (بدون استرداد)',
  },

  people: {
    summaryTitle: 'أحوال الشعب',
    housingRatio: (pop: number, cap: number) => `${pop} / ${cap} سكن`,
    workersRatio: (employed: number, needed: number) =>
      `العمال: ${employed} / ${needed}`,
    hungerWarning: 'تنبيه جوع اليوم: الرضا محدد بحد أقصى 30 حتى يتوفر الطعام.',
    needsFood: 'الطعام (45%)',
    needsWater: 'المياه (20%)',
    needsHousing: 'السكن (20%)',
    needsEntertainment: 'الترفيه (15%)',
    entertainmentSea: 'بحر مجاور لبيت (+40)',
    entertainmentShop: 'وجود محل (+30)',
    entertainmentVariety: 'تنوع الطعام: نوعان أو أكثر (+30)',
    growthHintHigh: 'الرضا مرتفع: ستصل عائلات جديدة عند توفر سكن فارغ.',
    growthHintLow: 'الرضا منخفض: قد تغادر عائلات مع بداية اليوم الجديد.',
    growthHintLevel1Floor: 'حماية المستوى 1: لا ينخفض السكان عن 5.',
    reputationHint: 'متوسط بطيء للرضا يعكس مكانة حكمك.',
    dayRolloverHint: (secondsLeft: number) =>
      `نهاية اليوم بعد ${formatClock(secondsLeft)}`,
  },

  objectives: {
    title: 'الأهداف',
    rewardTag: (gold: number) => `+${gold} ذهب`,
    completedLabel: 'مكتمل',
    items: {
      build_sea: 'ابنِ بحراً',
      build_farm: 'ابنِ مزرعة',
      hold_30_food: 'اجمع 30 وحدة طعام',
      reach_60_satisfaction: 'ارفع الرضا إلى 60',
      reach_25_pop: 'الوصول إلى 25 من السكان',
      own_15_cubes: 'امتلاك 15 مكعباً',
      hold_200_gold: 'امتلاك 200 ذهب في وقت واحد',
    } as Record<string, string>,
  },

  bourse: {
    title: 'البورصة',
    subtitle: 'تتغير الأسعار مرة كل يوم لعبة. سعر البيع يساوي 70% من سعر الشراء.',
    lockedHint: 'تُفتح البورصة عند الوصول إلى المستوى 2.',
    buyPrice: 'شراء',
    sellPrice: 'بيع',
    inStock: 'المخزون',
    buyAction: 'شراء',
    sellAction: 'بيع',
    maxLabel: 'الكل',
    defaultTicker:
      'البورصة: الأسواق مستقرة اليوم — تابع حركة الأسعار مع كل يوم جديد.',
    tickerUp: (resource: TradedResourceKey, pct: number) =>
      `البورصة: ارتفع سعر ${STRINGS.resources[resource]} بنسبة ${pct}% بسبب قلة المعروض`,
    tickerDown: (resource: TradedResourceKey, pct: number) =>
      `البورصة: انخفض سعر ${STRINGS.resources[resource]} بنسبة ${pct}% بسبب وفرة المعروض`,
    tickerFlat: (resource: TradedResourceKey) =>
      `البورصة: استقر سعر ${STRINGS.resources[resource]} دون تغير كبير اليوم`,
  },

  toasts: {
    newFamilies: 'وصلت عائلات جديدة',
    familiesLeft: 'غادرت عائلات بسبب سوء الأحوال',
    hungerOccurred: 'نفد الطعام في بداية اليوم — الشعب يعاني من الجوع',
    objectiveCompleted: (label: string, reward: number) =>
      reward > 0
        ? `تم إنجاز الهدف: ${label} (+${reward} ذهب)`
        : `تم إنجاز الهدف: ${label}`,
    cubePurchased: 'تم شراء مكعب جديد وتوسيع حدود المملكة',
    notEnoughGold: 'لا يوجد ذهب كافٍ لإتمام هذه العملية',
    invalidPlacement: 'لا يمكن وضع هذا المبنى على هذا المكعب',
  },

  modals: {
    close: 'إغلاق',
    continuePlay: 'متابعة الحكم',
    awayTitle: 'بينما كنت غائباً',
    awaySubtitle: (durationText: string) =>
      `استمرت مملكتك في العمل لمدة ${durationText}.`,
    awayCappedNote: '(الحد الأقصى لمحاكاة الغياب هو 8 ساعات)',
    awayShopGold: 'ذهب من المحلات',
    awayResources: 'الموارد المنتجة',
    awayNoResources: 'لم تُنتج موارد إضافية أثناء الغياب.',
    awayPopulationChange: 'تغير السكان',
    awayBiggestMove: 'أكبر حركة في البورصة',
    awayNoMove: 'لم تتغير الأسعار خلال فترة الغياب.',
    level2Title: 'تهانينا! وصلت إلى المستوى 2',
    level2Subtitle: 'أول مدينة',
    level2Body:
      'أثبتّ جدارتك في بناء الأساس! أصبحت الآن متاحة لك الغابة والمرعى والمحل وسوق البورصة لتنمية مدينتك.',
    level2Unlocks: [
      'الغابة (إنتاج الخشب)',
      'المرعى (إنتاج اللحوم)',
      'المحل (تحويل فائض الطعام إلى ذهب)',
      'البورصة (شراء وبيع الموارد بأسعار متغيرة)',
    ],
    level3Title: 'أنجزت أهداف المستوى 2!',
    level3Subtitle: 'المستوى 3 قريباً',
    level3Body:
      'لقد ازدهرت أول مدينة لك! في المرحلة القادمة سيظهر الحكام المنافسون ونظام الولاء والانشقاق. يمكنك الاستمرار في تطوير مملكتك الآن.',
    settingsTitle: 'الإعدادات',
    soundLabel: 'المؤثرات الصوتية',
    soundOn: 'مفعّلة',
    soundOff: 'مكتومة',
    newGameTitle: 'بدء لعبة جديدة',
    newGameDesc: 'سيؤدي هذا إلى حذف تقدمك المحفوظ والبدء من جديد بـ 500 ذهب.',
    newGameButton: 'لعبة جديدة',
    newGameConfirmPrompt: 'هل أنت متأكد؟ لا يمكن التراجع عن حذف المملكة الحالية.',
    newGameConfirmYes: 'نعم، ابدأ من جديد',
    newGameConfirmCancel: 'تراجع',
  },

  mobile: {
    inspectorButton: 'التفاصيل والأهداف',
    bourseButton: 'البورصة',
  },
};

export function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatDurationArabic(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  if (hours > 0 && minutes > 0) {
    return `${hours} ساعة و ${minutes} دقيقة`;
  }
  if (hours > 0) {
    return `${hours} ساعة`;
  }
  return `${Math.max(1, minutes)} دقيقة`;
}
