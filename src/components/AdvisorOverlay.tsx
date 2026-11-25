import {
  AlertOctagon,
  AlertTriangle,
  ArrowUpLeft,
  Check,
  CheckCheck,
  CheckCircle2,
  Compass,
  FileText,
  Info,
  Landmark,
  Mail,
  ScrollText,
  Sparkles,
  Store,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  adviseFax,
  computeMonthLedgerSummary,
  countUnreadFaxes,
} from '../game/advisor';
import { STRINGS } from '../game/strings';
import { computeTaxMoodDelta } from '../game/taxPolicy';
import type {
  AdvisorAction,
  BriefSeverity,
  DecreeKind,
  GameState,
  OfficeFax,
  OfficeFaxStatus,
} from '../game/types';

export type AdvisorTab = 'briefing' | 'faxes' | 'decrees';

interface AdvisorOverlayProps {
  state: GameState;
  initialTab?: AdvisorTab;
  onExecuteAction: (
    action: AdvisorAction,
    meta: { labelAr: string; projectedAr: string; faxId?: string }
  ) => void;
  onSetFaxStatus: (faxId: string, status: OfficeFaxStatus) => void;
  onMarkAllFaxesRead: () => void;
  onClose: () => void;
}

const SEVERITY_META: Record<
  BriefSeverity,
  { label: string; badgeCls: string; cardCls: string; icon: typeof AlertTriangle }
> = {
  critical: {
    label: 'حرج',
    badgeCls: 'bg-[#A83629] text-white',
    cardCls: 'bg-[#FBE2DF] border-[#E5ABA3]',
    icon: AlertOctagon,
  },
  high: {
    label: 'مرتفع',
    badgeCls: 'bg-[#C96B1C] text-white',
    cardCls: 'bg-[#FCEBD9] border-[#E8BE96]',
    icon: AlertTriangle,
  },
  medium: {
    label: 'متوسط',
    badgeCls: 'bg-[#C9962E] text-[#2B2118]',
    cardCls: 'bg-[#F8E7C1] border-[#E2BA64]',
    icon: Info,
  },
  positive: {
    label: 'إيجابي',
    badgeCls: 'bg-[#2D6E3B] text-white',
    cardCls: 'bg-[#E3F3E6] border-[#9CD0A7]',
    icon: CheckCircle2,
  },
  info: {
    label: 'معلومة',
    badgeCls: 'bg-[#14524A] text-white',
    cardCls: 'bg-[#E5F1EF] border-[#9BC5BF]',
    icon: Info,
  },
};

const OFFICE_LABELS: Record<OfficeFax['office'], string> = {
  housing: 'مكتب الإسكان',
  labor: 'مكتب العمل',
  bank: 'البنك الشرعي',
};

const FAX_STATUS_META: Record<OfficeFaxStatus, { label: string; cls: string }> = {
  unread: {
    label: 'جديد',
    cls: 'bg-[#C9962E] text-[#2B2118]',
  },
  read: {
    label: 'مقروء',
    cls: 'bg-[#EFE2C2] text-[#6F5C43]',
  },
  acted: {
    label: 'تم التنفيذ',
    cls: 'bg-[#E3F3E6] text-[#2D6E3B] border border-[#9CD0A7]',
  },
  dismissed: {
    label: 'مغلق',
    cls: 'bg-[#E8DEC8] text-[#8A7759]',
  },
};

const DECREE_KIND_META: Record<DecreeKind, { label: string; cls: string }> = {
  tax_policy: {
    label: 'سياسة ضريبية',
    cls: 'bg-[#F8E7C1] border-[#E2BA64] text-[#8A5F12]',
  },
  land_sale: {
    label: 'بيع أرض',
    cls: 'bg-[#E3F3E6] border-[#9CD0A7] text-[#2D6E3B]',
  },
  land_reject: {
    label: 'رفض أرض',
    cls: 'bg-[#FBE2DF] border-[#E5ABA3] text-[#A83629]',
  },
  loan_taken: {
    label: 'تمويل',
    cls: 'bg-[#E0EFEF] border-[#8EC5C0] text-[#14524A]',
  },
  loan_repaid: {
    label: 'سداد تمويل',
    cls: 'bg-[#E3F3E6] border-[#9CD0A7] text-[#2D6E3B]',
  },
  advisor_action: {
    label: 'توصية المستشار',
    cls: 'bg-[#EFE2C2] border-[#C9962E] text-[#4F3F2B]',
  },
};

function getActionButtonLabel(action: AdvisorAction): string {
  switch (action.type) {
    case 'arm_theme': {
      const name = STRINGS.themes[action.themeId]?.name ?? action.themeId;
      return `ابنِ ${name}`;
    }
    case 'open_bourse':
      return 'افتح البورصة';
    case 'open_bank':
      return 'افتح لوحة البنك';
    case 'focus_cube':
      return `انتقل إلى الأرض #${action.cubeId + 1}`;
    case 'none':
      return '';
  }
}

export function AdvisorOverlay({
  state,
  initialTab,
  onExecuteAction,
  onSetFaxStatus,
  onMarkAllFaxesRead,
  onClose,
}: AdvisorOverlayProps) {
  const unreadCount = useMemo(
    () => countUnreadFaxes(state.officeFaxes),
    [state.officeFaxes]
  );

  const [activeTab, setActiveTab] = useState<AdvisorTab>(
    initialTab ?? (unreadCount > 0 ? 'faxes' : 'briefing')
  );

  // H4 Shared selector: identical month window summary to Inspector's خزنة المملكة
  const monthSummary = useMemo(
    () => computeMonthLedgerSummary(state.ledger, state.day),
    [state.ledger, state.day]
  );

  const taxMoodDelta = useMemo(
    () =>
      computeTaxMoodDelta(
        state.taxPolicy,
        state.citizenWealth,
        state.population
      ),
    [state.taxPolicy, state.citizenWealth, state.population]
  );

  const reversedFaxes = useMemo(
    () => [...state.officeFaxes].reverse(),
    [state.officeFaxes]
  );

  const reversedDecrees = useMemo(
    () => [...state.decrees].reverse(),
    [state.decrees]
  );

  const taxPolicyLabel =
    state.taxPolicy.mode === 'take'
      ? `ضريبة ${state.taxPolicy.percent}%`
      : state.taxPolicy.mode === 'grant'
        ? `منحة ${state.taxPolicy.percent}%`
        : 'بلا ضريبة أو منحة';

  const tabs: Array<{
    id: AdvisorTab;
    label: string;
    icon: typeof Compass;
    badge?: number;
  }> = [
    { id: 'briefing', label: 'موجز المملكة', icon: Compass },
    {
      id: 'faxes',
      label: 'البريد والبرقيات',
      icon: Mail,
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
    {
      id: 'decrees',
      label: 'سجل القرارات',
      icon: ScrollText,
      badge: state.decrees.length > 0 ? state.decrees.length : undefined,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/55 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="المستشار الملكي"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[580px] max-h-[86dvh] parchment-panel border-2 border-[#C9962E] shadow-2xl rounded-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#F4E7C8] border-b border-[#E3D3AC] shrink-0">
          <div className="flex items-center gap-2.5 text-[#2B2118]">
            <div className="w-9 h-9 rounded-xl bg-[#14524A] text-[#F2CA6B] flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold">المستشار الملكي</h2>
              <p className="text-[11px] font-bold text-[#6F5C43] tabular-nums-latin">
                الشهر {state.totalMonths} · يوم {state.day} · الخزنة {state.gold} ذهب
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

        {/* Tabs */}
        <div className="px-3 pt-2.5 pb-2 bg-[#F8EED6] border-b border-[#E3D3AC] flex items-center gap-1.5 overflow-x-auto shrink-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-[#14524A] text-white shadow-sm'
                    : 'bg-[#EFE2C2] text-[#4F3F2B] hover:bg-[#E5D3A8]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span
                    className={`px-1.5 py-0.2 rounded-md text-[10px] font-black tabular-nums-latin ${
                      isActive
                        ? 'bg-[#C9962E] text-[#2B2118]'
                        : 'bg-[#14524A]/15 text-[#14524A]'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto parchment-scroll p-3.5 space-y-3 text-xs">
          {activeTab === 'briefing' && (
            <>
              {/* Shared Monthly Treasury Summary (H4 single source of truth with Inspector) */}
              <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2.5">
                <div className="flex items-center justify-between border-b border-[#EFE3C5] pb-1.5">
                  <div className="flex items-center gap-1.5 font-extrabold text-[#2B2118]">
                    <Landmark className="w-4 h-4 text-[#14524A]" />
                    <span>ميزان الخزنة هذا الشهر</span>
                  </div>
                  <span className="text-[10px] font-bold text-[#6F5C43] tabular-nums-latin">
                    يوم {monthSummary.monthStart}–{state.day}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-[#F5ECD4] border border-[#E6D6B0]">
                    <div className="text-[10px] font-bold text-[#6F5C43]">الوارد</div>
                    <div className="text-xs font-extrabold text-[#2D6E3B] tabular-nums-latin">
                      +{monthSummary.monthIn}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-[#F5ECD4] border border-[#E6D6B0]">
                    <div className="text-[10px] font-bold text-[#6F5C43]">المنصرف</div>
                    <div className="text-xs font-extrabold text-[#A83629] tabular-nums-latin">
                      -{monthSummary.monthOut}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-[#F5ECD4] border border-[#E6D6B0]">
                    <div className="text-[10px] font-bold text-[#6F5C43]">الصافي</div>
                    <div
                      className={`text-xs font-extrabold tabular-nums-latin ${
                        monthSummary.monthNet >= 0
                          ? 'text-[#2D6E3B]'
                          : 'text-[#A83629]'
                      }`}
                    >
                      {monthSummary.monthNet >= 0
                        ? `+${monthSummary.monthNet}`
                        : monthSummary.monthNet}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#F7EED8] border border-[#E7D8B4]">
                    <span className="font-bold text-[#6F5C43]">السياسة المالية</span>
                    <span className="font-extrabold text-[#2B2118]">
                      {taxPolicyLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#F7EED8] border border-[#E7D8B4]">
                    <span className="font-bold text-[#6F5C43]">أثر المزاج</span>
                    <span
                      className={`font-extrabold tabular-nums-latin ${
                        taxMoodDelta > 0
                          ? 'text-[#2D6E3B]'
                          : taxMoodDelta < 0
                            ? 'text-[#A83629]'
                            : 'text-[#4F3F2B]'
                      }`}
                    >
                      {taxMoodDelta > 0 ? `+${taxMoodDelta}` : taxMoodDelta}
                    </span>
                  </div>
                </div>
              </div>

              {/* Monthly Advisor Briefing */}
              <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#C9962E] space-y-2.5">
                <div className="flex items-center justify-between border-b border-[#EFE3C5] pb-1.5">
                  <span className="font-extrabold text-[#2B2118]">
                    التقرير الشهري للمستشار
                  </span>
                  {state.advisorBriefing && (
                    <span className="text-[10px] font-extrabold text-[#8A5F12] tabular-nums-latin">
                      تحديث شهر {state.advisorBriefing.month}
                    </span>
                  )}
                </div>

                {!state.advisorBriefing ? (
                  <div className="p-3 rounded-lg bg-[#F7EED8] border border-[#E7D8B4] text-[#4F3F2B] font-bold leading-relaxed">
                    يُعدّ المستشار الملكي موجز المملكة تلقائياً في مطلع كل شهر (كل 30 يوماً) لتحليل الخزنة والرواتب والغلاء والإسكان وبنك الشعب.
                  </div>
                ) : state.advisorBriefing.lines.length === 0 ? (
                  <div className="p-3 rounded-lg bg-[#E3F3E6] border border-[#9CD0A7] text-[#2D6E3B] font-extrabold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>الأوضاع مستقرة حالياً — لا توجد تنبيهات عاجلة في المملكة.</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {state.advisorBriefing.lines.map((line, idx) => {
                      const meta = SEVERITY_META[line.severity];
                      const Icon = meta.icon;
                      const actionLabel = getActionButtonLabel(line.action);
                      return (
                        <div
                          key={`${line.severity}-${idx}`}
                          className={`p-2.5 rounded-xl border space-y-2 ${meta.cardCls}`}
                        >
                          <div className="flex items-start gap-2">
                            <Icon className="w-4 h-4 shrink-0 mt-0.5 text-[#2B2118]" />
                            <div className="flex-1 min-w-0 space-y-1">
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-extrabold ${meta.badgeCls}`}
                              >
                                {meta.label}
                              </span>
                              <p className="text-xs font-extrabold text-[#2B2118] leading-relaxed">
                                {line.textAr}
                              </p>
                            </div>
                          </div>
                          {line.action.type !== 'none' && actionLabel && (
                            <button
                              type="button"
                              onClick={() =>
                                onExecuteAction(line.action, {
                                  labelAr: `تنفيذ توصية الموجز: ${actionLabel}`,
                                  projectedAr: line.textAr,
                                })
                              }
                              className="w-full py-1.5 px-3 rounded-lg bg-[#14524A] hover:bg-[#1B685E] text-white text-[11px] font-extrabold flex items-center justify-center gap-1.5 transition-colors"
                            >
                              {line.action.type === 'open_bourse' ? (
                                <Store className="w-3.5 h-3.5 text-[#F2CA6B]" />
                              ) : (
                                <ArrowUpLeft className="w-3.5 h-3.5 text-[#F2CA6B]" />
                              )}
                              <span>{actionLabel}</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'faxes' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-[#2B2118]">
                  برقيات الدواوين وتحليل المستشار ({state.officeFaxes.length})
                </span>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllFaxesRead}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#EFE2C2] hover:bg-[#E5D3A8] text-[#2B2118] text-[11px] font-extrabold transition-colors"
                  >
                    <CheckCheck className="w-3.5 h-3.5 text-[#14524A]" />
                    <span>تحديد الكل كمقروء</span>
                  </button>
                )}
              </div>

              {reversedFaxes.length === 0 ? (
                <div className="p-4 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] text-center text-[#8A7759] font-bold">
                  لا توجد برقيات واردة من الدواوين أو البنك حتى الآن.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {reversedFaxes.map((fax) => {
                    const advice = adviseFax(fax, state);
                    const statusMeta = FAX_STATUS_META[fax.status];
                    const actionLabel = getActionButtonLabel(advice.action);

                    return (
                      <div
                        key={fax.id}
                        className={`p-3 rounded-xl border space-y-2 ${
                          fax.status === 'unread'
                            ? 'bg-[#FDF6E2] border-[#C9962E]'
                            : 'bg-[#FDF8EC] border-[#E3D3AC]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <FileText className="w-3.5 h-3.5 text-[#14524A]" />
                            <span className="font-extrabold text-[#2B2118]">
                              {OFFICE_LABELS[fax.office]}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${statusMeta.cls}`}
                            >
                              {statusMeta.label}
                            </span>
                          </div>
                          <span className="text-[10px] font-bold text-[#6F5C43] tabular-nums-latin shrink-0">
                            شهر {fax.month}
                          </span>
                        </div>

                        <p className="text-xs font-bold text-[#2B2118] leading-relaxed">
                          {fax.textAr}
                        </p>

                        {/* Live Advisor Enrichment */}
                        <div className="p-2 rounded-lg bg-[#F5ECD4] border border-[#E2D0A4] space-y-1 text-[11px]">
                          <div className="font-bold text-[#4F3F2B]">
                            <span className="text-[#14524A] font-extrabold">
                              البيانات الحالية:{' '}
                            </span>
                            {advice.dataAr}
                          </div>
                          <div
                            className={`font-extrabold ${
                              advice.resolved ? 'text-[#2D6E3B]' : 'text-[#8A5F12]'
                            }`}
                          >
                            <span>رأي المستشار: </span>
                            {advice.recommendationAr}
                          </div>
                        </div>

                        {/* Actions row */}
                        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                          {!advice.resolved &&
                            advice.action.type !== 'none' &&
                            actionLabel && (
                              <button
                                type="button"
                                onClick={() =>
                                  onExecuteAction(advice.action, {
                                    labelAr: `استجابة لبرقية ${OFFICE_LABELS[fax.office]}: ${actionLabel}`,
                                    projectedAr: advice.recommendationAr,
                                    faxId: fax.id,
                                  })
                                }
                                className="flex-1 py-1.5 px-3 rounded-lg bg-[#14524A] hover:bg-[#1B685E] text-white text-[11px] font-extrabold flex items-center justify-center gap-1.5 transition-colors"
                              >
                                <ArrowUpLeft className="w-3.5 h-3.5 text-[#F2CA6B]" />
                                <span>{actionLabel}</span>
                              </button>
                            )}

                          {advice.resolved && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#E3F3E6] border border-[#9CD0A7] text-[#2D6E3B] text-[10px] font-extrabold">
                              <Check className="w-3 h-3" />
                              <span>تمت المعالجة</span>
                            </span>
                          )}

                          {fax.status === 'unread' && (
                            <button
                              type="button"
                              onClick={() => onSetFaxStatus(fax.id, 'read')}
                              className="px-2.5 py-1.5 rounded-lg bg-[#EFE2C2] hover:bg-[#E5D3A8] text-[#4F3F2B] text-[10px] font-extrabold transition-colors"
                            >
                              تحديد كمقروء
                            </button>
                          )}

                          {fax.status !== 'dismissed' && fax.status !== 'acted' && (
                            <button
                              type="button"
                              onClick={() => onSetFaxStatus(fax.id, 'dismissed')}
                              className="px-2.5 py-1.5 rounded-lg bg-[#F5ECD4] hover:bg-[#E7D8B4] text-[#6F5C43] text-[10px] font-extrabold transition-colors"
                            >
                              إغلاق
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'decrees' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-[#2B2118]">
                  سجل القرارات الملكية (المتوقع مقابل الفعلي)
                </span>
                <span className="text-[11px] font-extrabold text-[#14524A] tabular-nums-latin">
                  {state.decrees.length} قرار
                </span>
              </div>

              {reversedDecrees.length === 0 ? (
                <div className="p-4 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] text-center text-[#8A7759] font-bold">
                  لم تصدر قرارات ملكية بعد — تُسجَّل هنا قرارات الضرائب والمنح وبيع الأراضي والتمويل وتوصيات المستشار وتُقاس نتائجها عند نهاية الشهر.
                </div>
              ) : (
                <div className="space-y-2">
                  {reversedDecrees.map((dec) => {
                    const meta = DECREE_KIND_META[dec.kind];
                    return (
                      <div
                        key={dec.id}
                        className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-extrabold ${meta.cls}`}
                          >
                            {meta.label}
                          </span>
                          <span className="text-[10px] font-bold text-[#6F5C43] tabular-nums-latin">
                            شهر {dec.month}
                          </span>
                        </div>

                        <div className="text-xs font-extrabold text-[#2B2118]">
                          {dec.labelAr}
                        </div>

                        <div className="p-2 rounded-lg bg-[#F7EED8] border border-[#E7D8B4] space-y-1 text-[11px]">
                          <div className="text-[#4F3F2B] font-bold">
                            <span className="text-[#8A5F12] font-extrabold">
                              المتوقع عند القرار:{' '}
                            </span>
                            {dec.projectedAr}
                          </div>
                          <div
                            className={`font-extrabold ${
                              dec.actualAr !== null
                                ? 'text-[#14524A]'
                                : 'text-[#8A7759]'
                            }`}
                          >
                            <span>النتيجة الفعلية: </span>
                            {dec.actualAr ?? 'بانتظار قياس نهاية الشهر'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
