import {
  BookOpen,
  Briefcase,
  FileText,
  Hammer,
  Heart,
  Home,
  Plane,
  ScrollText,
  Shield,
  Users,
  X,
} from 'lucide-react';
import { useMemo } from 'react';
import { ageYears } from '../game/citizens';
import { getHousingQueue } from '../game/housingOffice';
import { getActiveCVs } from '../game/laborOffice';
import { countMarriageEligibleSingles } from '../game/marriageOffice';
import {
  DEATH_CAUSE_LABELS_AR,
  ETERNAL_RECORD_EMPTY_AR,
  formatEstateHeldLineAr,
  formatGameMonthAr,
  getVisibleEternalRecord,
  MAX_ETERNAL_DISPLAY_ROWS,
  resolveDeceasedFamilyForCitizen,
} from '../game/mortality';
import { STRINGS } from '../game/strings';
import type {
  CitizenAttrKey,
  DeceasedRecord,
  GameState,
  PoliceRecordKind,
  ThemeId,
} from '../game/types';
import { pickVisaApplicants, VISA_FEE_GOLD } from '../game/visas';
import type { WorldKingdom, WorldPos } from '../net/worldTypes';

export type PalaceOfficeTab =
  | 'labor'
  | 'housing'
  | 'marriage'
  | 'police'
  | 'travel'
  | 'citizens'
  | 'eternal';

interface PalaceOfficesOverlayProps {
  state: GameState;
  activeTab: PalaceOfficeTab;
  onChangeTab: (tab: PalaceOfficeTab) => void;
  onBuildHouseFromFax: () => void;
  onClose: () => void;
  isOnlineWorld?: boolean;
  myUid?: string | null;
  myWorldPos?: WorldPos | null;
  worldKingdoms?: WorldKingdom[];
  onToggleBorderOpen?: (open: boolean) => void;
}

const ATTR_LABELS_AR: Record<CitizenAttrKey, string> = {
  physical: 'القوة البدنية',
  professional: 'المهارة المهنية',
  social: 'الاجتماعية',
  health: 'الصحة',
  intelligence: 'الذكاء',
};

const POLICE_KIND_LABELS: Record<PoliceRecordKind, { label: string; cls: string }> = {
  birth: {
    label: 'ولادة',
    cls: 'bg-[#E3F3E6] border-[#9CD0A7] text-[#2D6E3B]',
  },
  marriage: {
    label: 'زواج',
    cls: 'bg-[#F8E7C1] border-[#E2BA64] text-[#8A5F12]',
  },
  housing: {
    label: 'إسكان',
    cls: 'bg-[#E0EFEF] border-[#8EC5C0] text-[#14524A]',
  },
  dissolution: {
    label: 'انفصال',
    cls: 'bg-[#FBE2DF] border-[#E5ABA3] text-[#A83629]',
  },
  land_sale: {
    label: 'بيع أرض',
    cls: 'bg-[#FBF0D2] border-[#C9962E] text-[#7D530D]',
  },
  death: {
    label: 'وفاة',
    cls: 'bg-[#ECE7DD] border-[#B9AE9A] text-[#4F4336]',
  },
};

const MAX_CITIZEN_ROWS = 50;

export function PalaceOfficesOverlay({
  state,
  activeTab,
  onChangeTab,
  onBuildHouseFromFax,
  onClose,
  isOnlineWorld = false,
  myUid = null,
  myWorldPos = null,
  worldKingdoms = [],
  onToggleBorderOpen,
}: PalaceOfficesOverlayProps) {
  const { citizens, totalMonths, policeRecords, officeFaxes, eternalRecord } =
    state;

  const citizenById = useMemo(() => {
    const map = new Map<number, (typeof citizens)[number]>();
    for (const c of citizens) map.set(c.id, c);
    return map;
  }, [citizens]);

  const eternalById = useMemo(() => {
    const map = new Map<number, DeceasedRecord>();
    for (const rec of eternalRecord) map.set(rec.citizenId, rec);
    return map;
  }, [eternalRecord]);

  const visibleEternal = useMemo(
    () => getVisibleEternalRecord(eternalRecord, MAX_ETERNAL_DISPLAY_ROWS),
    [eternalRecord]
  );
  const remainingEternalCount = Math.max(
    0,
    eternalRecord.length - MAX_ETERNAL_DISPLAY_ROWS
  );

  const activeCvs = useMemo(
    () => getActiveCVs(citizens, totalMonths),
    [citizens, totalMonths]
  );

  const holdersByTheme = useMemo(() => {
    const counts = new Map<ThemeId, number>();
    for (const c of citizens) {
      if (c.jobThemeId) {
        counts.set(c.jobThemeId, (counts.get(c.jobThemeId) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [citizens]);

  const housingQueue = useMemo(
    () => getHousingQueue(citizens, totalMonths),
    [citizens, totalMonths]
  );

  const latestHousingFax = useMemo(() => {
    for (let i = officeFaxes.length - 1; i >= 0; i--) {
      if (officeFaxes[i].office === 'housing') return officeFaxes[i];
    }
    return null;
  }, [officeFaxes]);

  const thisMonthMarriages = useMemo(
    () =>
      policeRecords
        .filter((r) => r.kind === 'marriage' && r.month === totalMonths)
        .reverse(),
    [policeRecords, totalMonths]
  );

  const eligibleSingles = useMemo(
    () => countMarriageEligibleSingles(citizens, totalMonths),
    [citizens, totalMonths]
  );

  const latestPoliceRecords = useMemo(
    () => policeRecords.slice(-20).reverse(),
    [policeRecords]
  );

  const visibleCitizens = useMemo(
    () => citizens.slice(0, MAX_CITIZEN_ROWS),
    [citizens]
  );
  const remainingCitizensCount = Math.max(0, citizens.length - MAX_CITIZEN_ROWS);

  const visaApplicants = useMemo(() => {
    if (!isOnlineWorld) return [];
    return pickVisaApplicants(
      state,
      worldKingdoms,
      myWorldPos ?? { wx: 0, wy: 0 },
      myUid
    );
  }, [isOnlineWorld, myUid, myWorldPos, state, worldKingdoms]);

  const visaHistory = useMemo(
    () => (state.visaHistory ?? []).slice(-20).reverse(),
    [state.visaHistory]
  );

  const tabs: Array<{
    id: PalaceOfficeTab;
    label: string;
    icon: typeof Briefcase;
  }> = [
    { id: 'labor', label: 'العمل', icon: Briefcase },
    { id: 'housing', label: 'الإسكان', icon: Home },
    { id: 'marriage', label: 'الزواج', icon: Heart },
    { id: 'police', label: 'الشرطة', icon: Shield },
    { id: 'travel', label: 'مكتب السفر', icon: Plane },
    { id: 'citizens', label: 'سجل المواطنين', icon: Users },
    { id: 'eternal', label: 'السجل الأبدي', icon: BookOpen },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="دواوين المملكة"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] max-h-[82dvh] parchment-panel border-2 border-[#C9962E] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#F4E7C8] border-b border-[#E3D3AC] shrink-0">
          <div className="flex items-center gap-2 text-[#2B2118]">
            <ScrollText className="w-5 h-5 text-[#14524A]" />
            <div>
              <h2 className="text-sm font-extrabold">دواوين المملكة</h2>
              <p className="text-[11px] font-bold text-[#6F5C43] tabular-nums-latin">
                الشهر {totalMonths} · {citizens.length} مواطن
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={STRINGS.modals.close}
            className="w-8 h-8 rounded-lg hover:bg-[#E7D5AE] text-[#4F3F2B] flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Five Office Tabs */}
        <div className="px-3 pt-2.5 pb-2 bg-[#F8EED6] border-b border-[#E3D3AC] flex items-center gap-1 overflow-x-auto shrink-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeTab(tab.id)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-[#14524A] text-white shadow-sm'
                    : 'bg-[#EFE2C2] text-[#4F3F2B] hover:bg-[#E5D3A8]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Scrollable Tab Body (Read-only state display) */}
        <div className="flex-1 overflow-y-auto parchment-scroll p-3.5 space-y-3 text-xs">
          {activeTab === 'labor' && (
            <>
              <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[#2B2118]">
                    السير الذاتية النشطة
                  </span>
                  <span className="text-[11px] font-extrabold text-[#14524A] tabular-nums-latin">
                    {activeCvs.length} باحث
                  </span>
                </div>
                {activeCvs.length === 0 ? (
                  <p className="text-[11px] text-[#8A7759]">
                    لا توجد سير ذاتية بانتظار التوظيف حالياً.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {activeCvs.slice(0, 30).map((cv) => {
                      const c = citizenById.get(cv.citizenId);
                      if (!c) return null;
                      const age = ageYears(c, totalMonths);
                      return (
                        <div
                          key={cv.citizenId}
                          className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#F7EED8] border border-[#E7D8B4]"
                        >
                          <div className="min-w-0">
                            <div className="font-extrabold text-[#2B2118] truncate">
                              {c.name}{' '}
                              <span className="text-[11px] font-bold text-[#6F5C43] tabular-nums-latin">
                                ({age} سنة)
                              </span>
                            </div>
                            <div className="text-[10px] font-bold text-[#6F5C43]">
                              الأبرز: {ATTR_LABELS_AR[cv.topAttribute]} (
                              {c.attrs[cv.topAttribute]})
                            </div>
                          </div>
                          <div className="text-left shrink-0">
                            <div className="text-[10px] font-extrabold text-[#8A5F12] tabular-nums-latin">
                              انتظار {cv.waitingMonths} شهر
                            </div>
                            <div className="text-[10px] font-bold text-[#14524A]">
                              يبحث عن عمل
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {activeCvs.length > 30 && (
                      <p className="text-[11px] font-bold text-[#6F5C43] text-center">
                        و {activeCvs.length - 30} آخرون
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
                <div className="font-extrabold text-[#2B2118]">
                  العاملون حسب المنشأة
                </div>
                {holdersByTheme.length === 0 ? (
                  <p className="text-[11px] text-[#8A7759]">
                    لم يُعيَّن عمال بعد — يجري التوزيع في مطلع كل شهر.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {holdersByTheme.map(([themeId, count]) => (
                      <div
                        key={themeId}
                        className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#F7EED8] border border-[#E7D8B4]"
                      >
                        <span className="font-bold text-[#2B2118] truncate">
                          {STRINGS.themes[themeId].name}
                        </span>
                        <span className="font-extrabold text-[#14524A] tabular-nums-latin">
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Element 5.1: Private sector job ads (إعلانات القطاع الخاص) */}
              <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[#2B2118]">
                    إعلانات القطاع الخاص
                  </span>
                  <span className="text-[11px] font-extrabold text-[#8A5F12] tabular-nums-latin">
                    {state.privateAds.length} إعلان
                  </span>
                </div>
                {state.privateAds.length === 0 ? (
                  <p className="text-[11px] text-[#8A7759]">
                    لا توجد إعلانات توظيف خاصة حالياً.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {state.privateAds.map((ad) => {
                      const owner = citizenById.get(ad.ownerId);
                      const worker =
                        ad.filledBy !== null
                          ? citizenById.get(ad.filledBy)
                          : null;
                      return (
                        <div
                          key={ad.id}
                          className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#F7EED8] border border-[#E7D8B4]"
                        >
                          <div className="min-w-0">
                            <div className="font-extrabold text-[#2B2118] truncate">
                              {STRINGS.themes[ad.themeId].name}
                            </div>
                            <div className="text-[10px] font-bold text-[#6F5C43] truncate">
                              المالك: {owner?.name ?? 'مواطن'} · الأجر:{' '}
                              <span className="tabular-nums-latin text-[#8A5F12]">
                                {ad.wage} ذهب
                              </span>
                            </div>
                          </div>
                          {worker ? (
                            <span className="px-2 py-0.5 rounded-md bg-[#E3F3E6] border border-[#9CD0A7] text-[#2D6E3B] text-[10px] font-extrabold shrink-0">
                              {worker.name}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-[#F8E7C1] border border-[#E2BA64] text-[#8A5F12] text-[10px] font-extrabold shrink-0">
                              شاغرة
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'housing' && (
            <>
              {latestHousingFax && (
                <div className="p-3 rounded-xl bg-[#F8E7C1] border border-[#C9962E] space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#6D4707]">
                      <FileText className="w-4 h-4 shrink-0" />
                      <span>برقية مكتب الإسكان</span>
                    </div>
                    <span className="text-[10px] font-bold text-[#8A5F12] tabular-nums-latin">
                      شهر {latestHousingFax.month}
                    </span>
                  </div>
                  <p className="text-[11px] font-bold text-[#2B2118] leading-relaxed">
                    {latestHousingFax.textAr}
                  </p>
                  <button
                    type="button"
                    onClick={onBuildHouseFromFax}
                    className="w-full py-1.5 px-3 rounded-lg bg-[#14524A] hover:bg-[#1B685E] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Hammer className="w-3.5 h-3.5 text-[#F2CA6B]" />
                    <span>ابنِ بيتاً</span>
                  </button>
                </div>
              )}

              <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[#2B2118]">
                    قائمة انتظار الإسكان
                  </span>
                  <span className="text-[11px] font-extrabold text-[#14524A] tabular-nums-latin">
                    {housingQueue.length} طلب
                  </span>
                </div>
                {housingQueue.length === 0 ? (
                  <p className="text-[11px] text-[#8A7759]">
                    لا توجد طلبات سكن معلّقة حالياً.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {housingQueue.slice(0, 30).map((item, idx) => (
                      <div
                        key={item.applicantId}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#F7EED8] border border-[#E7D8B4]"
                      >
                        <div className="min-w-0">
                          <div className="font-extrabold text-[#2B2118] truncate">
                            <span className="text-[#8A5F12] tabular-nums-latin">
                              #{idx + 1}
                            </span>{' '}
                            {item.spouseName
                              ? `${item.applicantName} و${item.spouseName}`
                              : item.applicantName}
                          </div>
                          <div className="text-[10px] font-bold text-[#6F5C43]">
                            انتظار {item.waitingMonths} شهر
                            {item.employed ? ' · يعمل' : ''}
                            {item.married ? ' · متزوج' : ''}
                            {item.children > 0
                              ? ` · ${item.children} أبناء`
                              : ''}
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded-md bg-[#14524A]/10 text-[#14524A] text-[11px] font-extrabold shrink-0 tabular-nums-latin">
                          أولوية {item.priority}
                        </span>
                      </div>
                    ))}
                    {housingQueue.length > 30 && (
                      <p className="text-[11px] font-bold text-[#6F5C43] text-center tabular-nums-latin">
                        و {housingQueue.length - 30} آخرون
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'marriage' && (
            <>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC]">
                <span className="font-extrabold text-[#2B2118]">
                  المؤهلون للزواج حالياً
                </span>
                <span className="text-sm font-extrabold text-[#14524A] tabular-nums-latin">
                  {eligibleSingles} أعزب/عزباء
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[#2B2118]">
                    عقود الزواج هذا الشهر
                  </span>
                  <span className="text-[11px] font-extrabold text-[#8A5F12] tabular-nums-latin">
                    {thisMonthMarriages.length} عقد
                  </span>
                </div>
                {thisMonthMarriages.length === 0 ? (
                  <p className="text-[11px] text-[#8A7759]">
                    لم تُسجَّل عقود زواج في هذا الشهر بعد.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {thisMonthMarriages.map((rec) => (
                      <div
                        key={rec.id}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#F7EED8] border border-[#E7D8B4]"
                      >
                        <span className="font-bold text-[#2B2118]">
                          {rec.textAr}
                        </span>
                        <span className="text-[10px] font-extrabold text-[#8A5F12] shrink-0 tabular-nums-latin">
                          شهر {rec.month}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'police' && (
            <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-[#2B2118]">
                  السجل المدني المختوم (آخر 20 قيداً)
                </span>
                <span className="text-[11px] font-extrabold text-[#14524A] tabular-nums-latin">
                  الإجمالي: {policeRecords.length}
                </span>
              </div>
              {latestPoliceRecords.length === 0 ? (
                <p className="text-[11px] text-[#8A7759]">
                  لا توجد قيود مسجلة في دفتر الشرطة بعد.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {latestPoliceRecords.map((rec) => {
                    const meta = POLICE_KIND_LABELS[rec.kind];
                    return (
                      <div
                        key={rec.id}
                        className="flex items-start justify-between gap-2 p-2 rounded-lg bg-[#F7EED8] border border-[#E7D8B4]"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-extrabold ${meta.cls}`}
                          >
                            {meta.label}
                          </span>
                          <div className="text-[11px] font-bold text-[#2B2118]">
                            {rec.textAr}
                          </div>
                        </div>
                        <span className="text-[10px] font-extrabold text-[#6F5C43] shrink-0 tabular-nums-latin">
                          شهر {rec.month}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'travel' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-extrabold text-[#2B2118]">
                      سياسة الحدود والسفر
                    </div>
                    <div className="text-[10px] font-bold text-[#6F5C43]">
                      رسوم التأشيرة {VISA_FEE_GOLD} ذهب يدفعها المسافر لقصر العالم (حتى 3 شهرياً)
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!onToggleBorderOpen}
                    onClick={() => onToggleBorderOpen?.(!state.borderOpen)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-extrabold transition-colors disabled:opacity-60 ${
                      state.borderOpen
                        ? 'bg-[#14524A] hover:bg-[#1B685E] text-white'
                        : 'bg-[#A83629] hover:bg-[#8E2B20] text-white'
                    }`}
                  >
                    {state.borderOpen ? 'الحدود مفتوحة' : 'الحدود مغلقة'}
                  </button>
                </div>
                {!state.borderOpen && (
                  <p className="text-[11px] font-bold text-[#8E2B20] bg-[#FBE2DF] border border-[#E5ABA3] rounded-lg px-2.5 py-1.5 leading-relaxed">
                    الحدود مغلقة حالياً: لا تُصدر تأشيرات سفر جديدة، ويبقى المواطنون المستاؤون داخل المملكة مع استمرار أثر الاستياء على الرضا العام.
                  </p>
                )}
              </div>

              <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[#2B2118]">
                    المتقدمون للسفر هذا الشهر
                  </span>
                  <span className="text-[11px] font-extrabold text-[#14524A] tabular-nums-latin">
                    {visaApplicants.length} / 3
                  </span>
                </div>
                {!isOnlineWorld ? (
                  <p className="text-[11px] text-[#8A7759]">
                    تُصدر تأشيرات السفر بين الممالك المجاورة عند الاتصال بالعالم المشترك فقط.
                  </p>
                ) : visaApplicants.length === 0 ? (
                  <p className="text-[11px] text-[#8A7759]">
                    لا يوجد مواطنون مؤهلون للسفر هذا الشهر أو لا توجد مملكة مجاورة بسمعة أعلى بـ 15 نقطة على الأقل ضمن مسافة 6 خطوات.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {visaApplicants.map((app) => {
                      const c = citizenById.get(app.citizenId);
                      return (
                        <div
                          key={app.citizenId}
                          className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#F7EED8] border border-[#E7D8B4]"
                        >
                          <div className="min-w-0">
                            <div className="font-extrabold text-[#2B2118] truncate">
                              {c?.name ?? `مواطن #${app.citizenId}`}
                            </div>
                            <div className="text-[10px] font-bold text-[#6F5C43]">
                              {app.reasonAr} · الثروة:{' '}
                              <span className="tabular-nums-latin">
                                {c?.wealth ?? 0}
                              </span>{' '}
                              ذهب
                            </div>
                          </div>
                          <span className="px-2 py-0.5 rounded-md bg-[#E0EFEF] border border-[#8EC5C0] text-[#14524A] text-[10px] font-extrabold shrink-0">
                            إلى {app.toKingdomNameAr}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[#2B2118]">
                    سجل التأشيرات (المغادرون والقادمون)
                  </span>
                  <span className="text-[11px] font-extrabold text-[#8A5F12] tabular-nums-latin">
                    {visaHistory.length} قيد
                  </span>
                </div>
                {visaHistory.length === 0 ? (
                  <p className="text-[11px] text-[#8A7759]">
                    لم تُسجَّل حركات سفر بتأشيرات بعد.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {visaHistory.map((rec) => (
                      <div
                        key={rec.id}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#F7EED8] border border-[#E7D8B4]"
                      >
                        <div className="min-w-0">
                          <div className="font-extrabold text-[#2B2118] truncate">
                            {rec.citizenName}
                          </div>
                          <div className="text-[10px] font-bold text-[#6F5C43]">
                            {rec.direction === 'out'
                              ? `غادر إلى ${rec.toKingdomNameAr ?? rec.toUid}`
                              : `وصل من ${rec.toKingdomNameAr ?? rec.toUid}`}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded border text-[10px] font-extrabold shrink-0 tabular-nums-latin ${
                            rec.direction === 'in'
                              ? 'bg-[#E3F3E6] border-[#9CD0A7] text-[#2D6E3B]'
                              : 'bg-[#F8E7C1] border-[#E2BA64] text-[#8A5F12]'
                          }`}
                        >
                          {rec.direction === 'in' ? 'قادم' : 'مغادر'} · شهر{' '}
                          {rec.month}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'citizens' && (
            <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-[#2B2118]">
                  سجل المواطنين
                </span>
                <span className="text-[11px] font-extrabold text-[#14524A] tabular-nums-latin">
                  {citizens.length} مواطن
                </span>
              </div>
              <div className="space-y-1">
                {visibleCitizens.map((c) => {
                  const age = ageYears(c, totalMonths);
                  const statusLabel = c.jobThemeId
                    ? `${STRINGS.themes[c.jobThemeId].name}${
                        c.employerId != null ? ' (خاص)' : ''
                      }`
                    : age < 14
                      ? 'طالب'
                      : age >= 60
                        ? 'متقاعد'
                        : 'يبحث عن عمل';
                  const { deceasedParents, deceasedSpouse } =
                    resolveDeceasedFamilyForCitizen(c, eternalById, eternalRecord);
                  const hasDeceasedFamily =
                    deceasedParents.length > 0 || deceasedSpouse !== null;
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-[#F7EED8] border border-[#E7D8B4] text-[11px]"
                    >
                      <div className="min-w-0">
                        <div className="font-extrabold text-[#2B2118] truncate">
                          {c.name}{' '}
                          <span className="font-bold text-[#6F5C43] tabular-nums-latin">
                            ({age} سنة)
                          </span>
                        </div>
                        <div className="text-[10px] font-bold text-[#6F5C43]">
                          {statusLabel} · أسرة #{c.householdId}
                          {c.homeCubeId === null ? ' (بلا سكن)' : ''}
                        </div>
                        {hasDeceasedFamily && (
                          <div className="text-[10px] font-bold text-[#7A6B58]">
                            {deceasedParents.length > 0 && (
                              <span>
                                الوالدان:{' '}
                                {deceasedParents
                                  .map((p) => `${p.name} (متوفى)`)
                                  .join('، ')}
                              </span>
                            )}
                            {deceasedParents.length > 0 && deceasedSpouse && ' · '}
                            {deceasedSpouse && (
                              <span>
                                زوج سابق: {deceasedSpouse.name} (متوفى)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <span className="font-extrabold text-[#8A5F12] shrink-0 tabular-nums-latin">
                        {c.wealth} ذهب
                      </span>
                    </div>
                  );
                })}
              </div>
              {remainingCitizensCount > 0 && (
                <p className="pt-1 text-center text-[11px] font-extrabold text-[#6F5C43] tabular-nums-latin">
                  و {remainingCitizensCount} آخرون
                </p>
              )}
            </div>
          )}

          {activeTab === 'eternal' && (
            <div className="space-y-2.5">
              {state.palaceOfPeople.heldEstates > 0 && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#F3ECE0] border border-[#C9BEA9] text-[#3F352A]">
                  <span className="font-extrabold text-[11px]">
                    أمانات التركات المحفوظة لدى قصر الشعب
                  </span>
                  <span className="font-extrabold text-xs text-[#6F5528] tabular-nums-latin">
                    {state.palaceOfPeople.heldEstates} ذهب
                  </span>
                </div>
              )}

              <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[#2B2118]">
                    السجل الأبدي
                  </span>
                  <span className="text-[11px] font-extrabold text-[#5E5142] tabular-nums-latin">
                    {eternalRecord.length} قيد
                  </span>
                </div>

                {visibleEternal.length === 0 ? (
                  <p className="py-4 text-center text-xs font-bold text-[#7A6B58]">
                    {ETERNAL_RECORD_EMPTY_AR}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {visibleEternal.map((rec) => {
                      const lastJobLabel =
                        rec.lastJobThemeId &&
                        STRINGS.themes[rec.lastJobThemeId as ThemeId]
                          ? STRINGS.themes[rec.lastJobThemeId as ThemeId].name
                          : null;
                      const estateLine = formatEstateHeldLineAr(rec.estateAmount);
                      return (
                        <div
                          key={`${rec.citizenId}-${rec.deathMonth}`}
                          className="p-2.5 rounded-lg bg-[#F5EFE2] border border-[#DBD0BC] space-y-1 text-[11px]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-extrabold text-[#2B2118] truncate">
                              {rec.name}{' '}
                              <span className="font-bold text-[#6F5C43] tabular-nums-latin">
                                ({rec.ageAtDeath} سنة)
                              </span>
                            </div>
                            <span className="px-2 py-0.5 rounded border bg-[#ECE7DD] border-[#B9AE9A] text-[#4F4336] text-[10px] font-extrabold shrink-0">
                              {DEATH_CAUSE_LABELS_AR[rec.cause]}
                            </span>
                          </div>
                          <div className="text-[10px] font-bold text-[#6F5C43] tabular-nums-latin">
                            الولادة: {formatGameMonthAr(rec.birthMonth)} · الوفاة:{' '}
                            {formatGameMonthAr(rec.deathMonth)}
                            {lastJobLabel ? ` · آخر عمل: ${lastJobLabel}` : ''}
                          </div>
                          {estateLine && (
                            <div className="text-[10px] font-extrabold text-[#7D5A1B] tabular-nums-latin">
                              {estateLine}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {remainingEternalCount > 0 && (
                  <p className="pt-1 text-center text-[11px] font-extrabold text-[#6F5C43] tabular-nums-latin">
                    و {remainingEternalCount} آخرون في السجل
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
