import type {
  ResourceKey,
  ShortageReason,
  ThemeCategory,
  ThemeId,
  TradedResourceKey,
} from './types';

export const STRINGS = {
  appName: 'نور الشعب',
  dayLabel: (day: number) => `اليوم ${day}`,
  goldLabel: 'الذهب',
  foodTotalLabel: 'إجمالي الطعام',
  populationLabel: 'السكان',
  satisfactionLabel: 'الرضا',
  reputationLabel: 'السمعة',
  bourseButton: 'البورصة',
  settingsButton: 'الإعدادات',
  level2ReadyBanner: 'ترقية للمستوى 2',
  level3ReadyBanner: 'إنجاز المستوى 2',
  levelTitles: {
    1: 'المستوى 1: البداية',
    2: 'المستوى 2: أول مدينة',
  } as Record<1 | 2, string>,

  categories: {
    food: 'الغذاء والزراعة',
    mines: 'المناجم والموارد',
    industry: 'البناء والصناعة',
    trade: 'الاستثمار والتجارة',
    welfare: 'الرفاهية والمجتمع',
  } as Record<ThemeCategory, string>,

  resources: {
    fish: 'السمك',
    crops: 'الخضروات',
    wheat: 'القمح',
    fruit: 'الفواكه',
    meat: 'اللحوم',
    bread: 'الخبز',
    wood: 'الخشب',
    water: 'المياه',
    stone: 'الحجر',
    iron: 'الحديد',
    copper: 'النحاس',
    goldOre: 'خام الذهب',
    gem: 'الأحجار الكريمة',
    tools: 'الأدوات',
    jewelry: 'المجوهرات',
    oil: 'البترول',
    cotton: 'القطن',
    clothes: 'الملابس',
  } as Record<ResourceKey, string>,

  themes: {
    palace: {
      name: 'قصر الحاكم',
      summary: 'قلب المملكة ومقر الحكم ومنطلق الحراس. لا يمكن هدمه.',
    },
    wheat_farm: {
      name: 'مزرعة قمح',
      summary: 'تنتج 3 قمح كل 90 ثانية وتستهلك 1 مياه.',
    },
    farm: {
      name: 'مزرعة خضروات',
      summary: 'تنتج 3 خضروات كل 90 ثانية وتستهلك 1 مياه.',
    },
    orchard: {
      name: 'بستان فواكه',
      summary: 'ينتج 3 فواكه كل 150 ثانية ويزيد تنوع الطعام.',
    },
    pasture: {
      name: 'مرعى',
      summary: 'ينتج 2 لحوم كل 120 ثانية ويستهلك 1 خضروات.',
    },
    sea: {
      name: 'بحر صيد',
      summary: 'ينتج 2 سمك كل 60 ثانية ويمنح ترفيهاً للبيوت المجاورة.',
    },
    well: {
      name: 'بئر ماء',
      summary: 'ينتج 3 مياه كل 45 ثانية دون الحاجة لعمال.',
    },
    bakery: {
      name: 'مخبز',
      summary: 'يحوّل 2 قمح إلى 2 خبز كل 60 ثانية (يُضاعف تنوع الطعام).',
    },
    restaurant: {
      name: 'مطعم',
      summary: 'يحوّل 1 خبز + 1 لحم إلى 14 ذهب كل 120 ثانية ويمنح ترفيهاً.',
    },
    cafe: {
      name: 'مقهى',
      summary: 'يحوّل 1 مياه إلى 6 ذهب كل 120 ثانية ويمنح ترفيهاً.',
    },
    forest: {
      name: 'غابة أخشاب',
      summary: 'تنتج 2 خشب كل 75 ثانية وتحتاج عاملاً واحداً.',
    },
    quarry: {
      name: 'محجر حجر',
      summary: 'ينتج 2 حجر كل 100 ثانية للبناء والصناعة.',
    },
    iron_mine: {
      name: 'منجم حديد',
      summary: 'ينتج 2 حديد كل 140 ثانية. يُبنى على الأرض الصخرية فقط.',
    },
    copper_mine: {
      name: 'منجم نحاس',
      summary: 'ينتج 2 نحاس كل 150 ثانية. يُبنى على الأرض الصخرية فقط.',
    },
    gold_mine: {
      name: 'منجم ذهب',
      summary: 'ينتج 1 خام ذهب كل 200 ثانية. يُبنى على الأرض الصخرية فقط.',
    },
    gem_mine: {
      name: 'منجم أحجار كريمة',
      summary: 'ينتج 1 أحجار كريمة كل 260 ثانية. يُبنى على الأرض الصخرية فقط.',
    },
    oil_well: {
      name: 'بئر بترول',
      summary: 'ينتج 2 بترول كل 180 ثانية ويُباع بسعر مرتفع في البورصة.',
    },
    house: {
      name: 'بيت',
      summary: 'يؤوي 5 من السكان في نصف مكعب.',
    },
    warehouse_bldg: {
      name: 'مخزن',
      summary: 'يرفع دخل المحلات والمطاعم ضمن مسافة مكعبين بنسبة +25%.',
    },
    workshop: {
      name: 'ورشة',
      summary: 'تحوّل 1 حديد + 1 خشب إلى 2 أدوات كل 150 ثانية.',
    },
    jeweler: {
      name: 'صائغ مجوهرات',
      summary: 'يحوّل 1 خام ذهب + 1 حجر كريم إلى 1 مجوهرات كل 240 ثانية.',
    },
    shop: {
      name: 'محل تجاري',
      summary: 'يحوّل 1 وحدة طعام فائض إلى 4 ذهب كل 60 ثانية.',
    },
    grand_market: {
      name: 'سوق المدينة',
      summary: 'يرفع أسعار البيع +10% للمملكة ودخل المحلات ضمن 3 مكعبات +50%.',
    },
    trade_office: {
      name: 'مكتب تجارة',
      summary: 'يخفض أسعار الشراء في البورصة بنسبة 5%.',
    },
    hotel: {
      name: 'فندق',
      summary: 'يستقبل الضيوف وينتج 9 ذهب كل 90 ثانية ويحتاج 3 عمال.',
    },
    mosque: {
      name: 'مسجد',
      summary: 'يمنح +30 رفاهية وطمأنينة للمملكة ويزوره السكان يومياً.',
    },
    theater: {
      name: 'مسرح',
      summary: 'يمنح +30 ترفيهاً للمملكة ويحتاج عاملين.',
    },
    garden: {
      name: 'حديقة عامة',
      summary: 'متنفس هادئ يستريح فيه السكان والأطفال في يومهم.',
    },
    clinic: {
      name: 'عيادة',
      summary: 'تقلّص خسارة السكان إلى النصف عند تراجع الأحوال.',
    },
    school: {
      name: 'مدرسة',
      summary: 'تسرّع نمو السمعة بمقدار 1.5 ضعف ويزورها الأطفال.',
    },
  } as Record<ThemeId, { name: string; summary: string }>,

  footprint: {
    full: '1 مكعب',
    half: 'نصف مكعب',
  },

  buildDock: {
    title: 'قائمة البناء',
    cancelBuild: 'إلغاء البناء',
    activeHint: (themeName: string) => `انقر على أرضك لوضع: ${themeName}`,
    goldUnit: 'ذهب',
    workersNeeded: (n: number) => (n === 0 ? 'بدون عمال' : `${n} عمال`),
    rockyOnlyTag: 'أرض صخرية فقط',
    level2LockedCat: 'تُفتح في المستوى 2',
    flyToRocky: 'أقرب أرض صخرية',
    flyToProducer: (resName: string) => `اذهب لإنتاج ${resName}`,
    selectProducer: (themeName: string) => `ابنِ ${themeName}`,
    noRockyFound: 'لا توجد أرض صخرية قريبة حالياً',
  },

  inspector: {
    tabInfo: 'المملكة',
    tabBourse: 'البورصة',
    cubeTitle: (row: number, col: number) => `أرض (${row + 1} ، ${col + 1})`,
    closeSelection: 'العودة للملخص',
    ownedSand: 'أرض مملوكة',
    ownedSandHint: 'اختر مبنى من قائمة البناء لوضعه هنا.',
    rockyBadge: 'أرض صخرية — صالحة للمناجم',
    neutralSand: 'صحراء محايدة',
    neutralAdjacentHint: 'ملاصقة لأرضك ويمكنك شراؤها لتوسيع المملكة.',
    neutralFarHint: 'توسّع نحو الأراضي المجاورة أولاً للوصول إلى هذه المنطقة.',
    buyCubeAction: (cost: number) => `شراء الأرض (${cost} ذهب)`,
    distancePriceNote: (dist: number) =>
      `السعر يزداد مع البعد عن قصر الحاكم (المسافة: ${dist})`,
    notEnoughGold: 'الذهب غير كافٍ',
    villageTitle: (name: string) => `قرية مستقلة — ${name}`,
    villageDesc:
      'تنضم هذه القرية لمملكتك مجاناً وطوعاً عند مجاورتها لأرضك وبقاء السمعة 55 أو أكثر ليومين كاملين.',
    villageProgress: (days: number, required: number) =>
      `تقدم الانضمام الطوعي: ${days} / ${required} يوم`,
    villageNeedAdjacent: 'وسّع أرضك حتى تلامس هذه القرية لبدء كسب ولائها.',
    villageNeedRep: 'ارفع سمعتك إلى 55 على الأقل لكسب ولاء القرية.',
    palaceTitle: 'قصر الحاكم',
    palaceTerritory: 'مساحة المملكة',
    palaceCubesUnit: 'قطعة أرض',
    palaceVillagesJoined: 'القرى المنضمة طوعاً',
    palaceNonDemolishable: 'معلم دائم لا يمكن هدمه.',
    slotPrimary: 'النصف الأول',
    slotSecondary: 'النصف الثاني',
    emptyHalf: 'مساحة فارغة — يمكن إضافة مبنى نصف مكعب آخر بجانبه.',
    cycleLabel: 'دورة الإنتاج',
    secondsRemaining: (s: number) => `${s} ثانية متبقية`,
    outputPerCycle: (amount: number, resourceName: string) =>
      `ينتج ${amount} ${resourceName} في كل دورة`,
    goldOutputPerCycle: (gold: number) => `ينتج ${gold} ذهب في كل دورة`,
    shopOutputPerCycle: (gold: number) => `يحوّل 1 طعام فائض إلى ${gold} ذهب`,
    houseCapacityLabel: (cap: number) => `يؤوي ${cap} من السكان`,
    seaAdjacencyBonus: (pct: number, neighbors: number) =>
      neighbors > 0
        ? `مكافأة تجاور البحار: +${pct}% (${neighbors} مجاور)`
        : 'ضع بحراً مجاوراً لزيادة إنتاج السمك +25% لكل بحر.',
    seaEntertainmentNote: 'يمنح +25 ترفيهاً عند مجاورته لبيت.',
    logisticsBonusNote: (pct: number) => `مكافأة اللوجستيات/السوق: +${pct}% ذهب`,
    unstaffedBadge: 'لا يوجد عمال',
    unstaffedDetail: 'الإنتاج متوقف لعدم توفر عدد كافٍ من السكان للعمل.',
    shortages: {
      no_water: 'الإنتاج 0 — لا توجد مياه كافية في المستودع.',
      no_crops: 'الإنتاج 0 — لا توجد خضروات كافية في المستودع.',
      no_wheat: 'الإنتاج 0 — لا يوجد قمح كافٍ في المستودع.',
      no_bread_meat: 'الإنتاج 0 — يتطلب 1 خبز و 1 لحم في المستودع.',
      no_iron_wood: 'الإنتاج 0 — يتطلب 1 حديد و 1 خشب في المستودع.',
      no_gold_gem: 'الإنتاج 0 — يتطلب 1 خام ذهب و 1 أحجار كريمة.',
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
    needsEntertainment: 'الترفيه والرفاهية (15%)',
    entertainmentSea: 'بحر مجاور لبيت (+25)',
    entertainmentShop: 'محل أو سوق مدينة (+15)',
    entertainmentTheater: 'مسرح (+30)',
    entertainmentMosque: 'مسجد (+30)',
    entertainmentVariety: 'تنوع الطعام: نوعان أو أكثر (+15)',
    entertainmentCafe: 'مقهى (+10)',
    entertainmentRestaurant: 'مطعم (+15)',
    growthHintHigh: 'الرضا مرتفع: ستصل عائلات جديدة عند توفر سكن فارغ.',
    growthHintLow: 'الرضا منخفض: قد تغادر عائلات مع بداية اليوم الجديد.',
    growthHintLevel1Floor: 'حماية المستوى 1: لا ينخفض السكان عن 5.',
    reputationHint: 'متوسط بطيء للرضا يعكس مكانة حكمك.',
    schoolActiveHint: 'المدرسة تسرّع نمو السمعة بمقدار 1.5 ضعف.',
    clinicActiveHint: 'العيادة تقلّص خسارة السكان إلى النصف.',
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
      own_15_cubes: 'امتلاك 15 قطعة أرض',
      hold_200_gold: 'امتلاك 200 ذهب في وقت واحد',
    } as Record<string, string>,
  },

  bourse: {
    title: 'البورصة',
    subtitle: 'تتغير الأسعار مرة كل يوم لعبة. سعر البيع الأساسي 70% من الشراء.',
    lockedHint: 'تُفتح البورصة عند الوصول إلى المستوى 2.',
    grandMarketActive: 'سوق المدينة مفعّل: أسعار البيع +10%',
    tradeOfficeActive: 'مكتب التجارة مفعّل: أسعار الشراء -5%',
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
    tickerVillageJoined: (villageName: string) =>
      `انضمت قرية ${villageName} إلى مملكتك طوعاً وأصبح أهلها جزءاً من شعبك`,
  },

  toasts: {
    newFamilies: 'وصلت عائلات جديدة',
    familiesLeft: 'غادرت عائلات بسبب سوء الأحوال',
    hungerOccurred: 'نفد الطعام في بداية اليوم — الشعب يعاني من الجوع',
    objectiveCompleted: (label: string, reward: number) =>
      reward > 0
        ? `تم إنجاز الهدف: ${label} (+${reward} ذهب)`
        : `تم إنجاز الهدف: ${label}`,
    villageJoined: (name: string) =>
      `انضمت قرية ${name} إلى مملكتك طوعاً! (+2 بيت مجاناً)`,
    level2Unlocked: 'تهانينا! فُتح المستوى 2: أول مدينة — اضغط على الترقية للتفاصيل',
    level2Completed: 'أنجزت أهداف المستوى 2! اضغط على الإنجاز للتفاصيل',
    cubePurchased: 'تم شراء أرض جديدة وتوسيع حدود المملكة',
    notEnoughGold: 'لا يوجد ذهب كافٍ لإتمام هذه العملية',
    notEnoughMaterials: 'المواد المطلوبة للبناء غير كافية في المستودع',
    rockyRequired: 'هذا المنجم يُبنى على الأرض الصخرية فقط',
    invalidPlacement: 'لا يمكن وضع هذا المبنى في هذا الموقع',
  },

  modals: {
    close: 'إغلاق',
    continuePlay: 'متابعة الحكم',
    awayTitle: 'بينما كنت غائباً',
    awaySubtitle: (durationText: string) =>
      `استمرت مملكتك في العمل لمدة ${durationText}.`,
    awayCappedNote: '(الحد الأقصى لمحاكاة الغياب هو 8 ساعات)',
    awayShopGold: 'ذهب من المحلات والمطاعم',
    awayResources: 'الموارد المنتجة',
    awayNoResources: 'لم تُنتج موارد إضافية أثناء الغياب.',
    awayPopulationChange: 'تغير السكان',
    awayBiggestMove: 'أكبر حركة في البورصة',
    awayNoMove: 'لم تتغير الأسعار خلال فترة الغياب.',
    level2Title: 'تهانينا! وصلت إلى المستوى 2',
    level2Subtitle: 'أول مدينة',
    level2Body:
      'أثبتّ جدارتك في بناء الأساس! أصبحت الآن متاحة لك جميع فئات البناء: المناجم والصناعة والتجارة والرفاهية وسوق البورصة لتنمية مدينتك.',
    level2Unlocks: [
      'المناجم والمحاجر والغابات لإنتاج الخشب والحجر والمعادن',
      'المخابز والبساتين والمطاعم والمقاهي والورش',
      'المسجد والمسرح والمدرسة والعيادة والحديقة العامة',
      'البورصة وسوق المدينة ومكتب التجارة',
    ],
    level3Title: 'أنجزت أهداف المستوى 2!',
    level3Subtitle: 'المستوى 3 قريباً',
    level3Body:
      'لقد ازدهرت أول مدينة لك! في المرحلة القادمة سيظهر الحكام المنافسون ونظام الولاء الكامل. يمكنك الاستمرار في تطوير مملكتك وكسب القرى المستقلة الآن.',
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

  world3d: {
    recenterMap: 'العودة للمملكة',
    zoomIn: 'تقريب',
    zoomOut: 'تبعيد',
    webglFallbackTitle: 'تعذر تشغيل العرض ثلاثي الأبعاد',
    webglFallbackBody:
      'يبدو أن متصفحك لا يدعم WebGL حالياً. لا يزال بإمكانك متابعة حالة مملكتك والأهداف والبورصة من القوائم الجانبية.',
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
