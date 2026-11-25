import {
  AlertTriangle,
  Check,
  Coins,
  Flag,
  Handshake,
  Info,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { STRINGS } from '../game/strings';
import type { EmbassyPlotMarker } from '../game/types';
import {
  computeEmbassyFee,
  EMBASSY_MIN_PRICE,
} from '../net/worldEmbassies';
import {
  MAX_EMBASSY_AGREEMENTS_PER_KINGDOM,
  type EmbassyAgreement,
  type WorldKingdom,
} from '../net/worldTypes';

interface EmbassyOverlayProps {
  isOnline: boolean;
  myUid: string | null;
  worldInflationIndex: number | null;
  agreements: EmbassyAgreement[];
  embassyPlots: EmbassyPlotMarker[];
  kingdoms: WorldKingdom[];
  pendingEmbassyPaymentGold: number;
  initialTargetHostUid: string | null;
  busy: boolean;
  errorMessage: string | null;
  onRefresh: () => void;
  onPropose: (hostUid: string, priceAgreed: number) => void;
  onApprove: (agreementId: string) => void;
  onReject: (agreementId: string) => void;
  onDissolve: (agreementId: string) => void;
  onCollectPayments: () => void;
  onClose: () => void;
}

export function EmbassyOverlay({
  isOnline,
  myUid,
  worldInflationIndex,
  agreements,
  embassyPlots,
  kingdoms,
  pendingEmbassyPaymentGold,
  initialTargetHostUid,
  busy,
  errorMessage,
  onRefresh,
  onPropose,
  onApprove,
  onReject,
  onDissolve,
  onCollectPayments,
  onClose,
}: EmbassyOverlayProps) {
  const otherKingdoms = kingdoms.filter((k) => k.uid !== myUid);
  const [targetHostUid, setTargetHostUid] = useState<string>(
    initialTargetHostUid ?? otherKingdoms[0]?.uid ?? ''
  );
  const [priceOffer, setPriceOffer] = useState<number>(300);

  const currentFee =
    worldInflationIndex !== null
      ? computeEmbassyFee(worldInflationIndex)
      : null;

  const incomingPending = agreements.filter(
    (a) => a.hostUid === myUid && a.status === 'pending'
  );
  const outgoingPending = agreements.filter(
    (a) => a.guestUid === myUid && a.status === 'pending'
  );
  const liveAgreements = agreements.filter(
    (a) => a.status === 'active' || a.status === 'suspended'
  );
  const nonDissolvedCount = agreements.filter(
    (a) => a.status !== 'dissolved'
  ).length;

  const plotByAgreementId = new Map<string, EmbassyPlotMarker>();
  for (const p of embassyPlots) {
    plotByAgreementId.set(p.agreementId, p);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="السفارات والتحالفات"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[580px] max-h-[85dvh] parchment-panel border-2 border-[#C9962E] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#F4E7C8] border-b border-[#E3D3AC] shrink-0">
          <div className="flex items-center gap-2 text-[#2B2118]">
            <Handshake className="w-5 h-5 text-[#14524A]" />
            <div>
              <h2 className="text-sm font-extrabold">السفارات والتحالفات</h2>
              <p className="text-[11px] font-bold text-[#6F5C43] tabular-nums-latin">
                السفارات النشطة والمعلّقة: {nonDissolvedCount}/
                {MAX_EMBASSY_AGREEMENTS_PER_KINGDOM}
                {currentFee !== null
                  ? ` · الرسم الشهري الحالي: ${currentFee} ذهب`
                  : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isOnline && (
              <button
                type="button"
                disabled={busy}
                onClick={onRefresh}
                title="تحديث السفارات"
                className="w-8 h-8 rounded-lg hover:bg-[#E7D5AE] text-[#14524A] flex items-center justify-center transition-colors disabled:opacity-40"
              >
                <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={STRINGS.modals.close}
              className="w-8 h-8 rounded-lg hover:bg-[#E7D5AE] text-[#4F3F2B] flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto parchment-scroll p-3.5 space-y-3 text-xs">
          {/* Honest N1.5 & Harden N1 rules notice */}
          <div className="p-2.5 rounded-xl bg-[#E6F2EF] border border-[#8CC3B8] text-[#14524A] space-y-1 text-[11px] leading-relaxed">
            <div className="flex items-center gap-1.5 font-extrabold">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>أثر التحالف وقواعد السفارات</span>
            </div>
            <p>
              التحالف النشط يمنح خصم 20% وإعفاء 5% في <strong>السوق العالمي</strong> فقط.
              البورصة مجهولة الهوية ولا يشملها خصم السفارات.
            </p>
            <p className="text-[10px] opacity-90">
              الرسوم الشهرية المدفوعة لقصر العالم غير قابلة للاسترداد. طلب حلّ السفارة يسري عند بداية الشهر التالي، فيستحق رسم الشهر الجاري.
            </p>
          </div>

          {!isOnline && (
            <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] text-center font-bold text-[#6F5C43]">
              سجّل الدخول عبر «العالم المشترك» لإدارة السفارات والتحالفات.
            </div>
          )}

          {errorMessage && (
            <div className="p-2.5 rounded-xl bg-[#FBE2DF] border border-[#E5ABA3] text-[#8E2A1F] font-bold">
              {errorMessage}
            </div>
          )}

          {/* Host pending embassy payments */}
          {isOnline && pendingEmbassyPaymentGold > 0 && (
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#FBF0D2] border border-[#C9962E]">
              <div className="flex items-center gap-2 font-extrabold text-[#7D530D]">
                <Coins className="w-4 h-4 shrink-0" />
                <span className="tabular-nums-latin">
                  مستحقات استضافة سفارات جاهزة: {pendingEmbassyPaymentGold} ذهب
                </span>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={onCollectPayments}
                className="px-3 py-1.5 rounded-lg bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-40 text-white text-[11px] font-extrabold transition-colors"
              >
                تحصيل
              </button>
            </div>
          )}

          {/* Incoming pending proposals (Host consent) */}
          {incomingPending.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-extrabold text-[#2B2118]">
                طلبات سفارة واردة ({incomingPending.length})
              </h3>
              {incomingPending.map((ag) => (
                <div
                  key={ag.id}
                  className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#C9962E] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-extrabold text-[#2B2118]">
                      طلب من {ag.guestNameAr ?? 'مملكة مجاورة'}
                    </div>
                    <span className="text-[11px] font-extrabold text-[#8A5F12] tabular-nums-latin">
                      ثمن الأرض المعروض: {ag.priceAgreed} ذهب
                    </span>
                  </div>
                  <p className="text-[10px] text-[#6F5C43]">
                    عند القبول تُخصّص أرض حدودية متاحة للسفارة (إن وُجدت)، ويسدّد الضيف الثمن في شهره التالي. الرفض نهائي لهذا الطلب.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onApprove(ag.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-40 text-white font-extrabold transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>قبول</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onReject(ag.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-[#FBE2DF] hover:bg-[#F5CCC7] border border-[#E5ABA3] disabled:opacity-40 text-[#8E2A1F] font-extrabold transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>رفض</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Active & Suspended embassies */}
          <div className="space-y-2">
            <h3 className="font-extrabold text-[#2B2118]">
              السفارات القائمة ({liveAgreements.length})
            </h3>
            {liveAgreements.length === 0 ? (
              <p className="text-[#6F5C43] py-2">
                لا توجد سفارات نشطة أو معلّقة حالياً.
              </p>
            ) : (
              liveAgreements.map((ag) => {
                const isHost = ag.hostUid === myUid;
                const partnerName = isHost
                  ? ag.guestNameAr ?? 'مملكة ضيفة'
                  : ag.hostNameAr ?? 'مملكة مضيفة';
                const plot = isHost ? plotByAgreementId.get(ag.id) : null;
                const isSuspended = ag.status === 'suspended';
                const hasDissolveScheduled = ag.dissolveEffectiveMonth != null;

                return (
                  <div
                    key={ag.id}
                    className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Flag
                          className="w-3.5 h-3.5 shrink-0"
                          style={{ color: ag.guestColor ?? '#14524A' }}
                        />
                        <span className="font-extrabold text-[#2B2118]">
                          {partnerName}
                        </span>
                        <span className="text-[10px] font-bold text-[#6F5C43]">
                          ({isHost ? 'أنت المضيف' : 'أنت الضيف'})
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                          isSuspended
                            ? 'bg-[#F8E7C1] text-[#8A5F12]'
                            : 'bg-[#E3F3E6] text-[#2D6E3B]'
                        }`}
                      >
                        {isSuspended ? 'معلّقة (الخصم متوقف)' : 'نشطة'}
                      </span>
                    </div>

                    <div className="text-[11px] text-[#4F3F2B] space-y-0.5 tabular-nums-latin">
                      <div>
                        ثمن الأرض: {ag.priceAgreed} ذهب (
                        {ag.priceSettled ? 'تمت التسوية' : 'مستحق الشهر القادم'})
                        {!isHost && currentFee !== null
                          ? ` · الرسم الشهري: ${currentFee} ذهب`
                          : ''}
                      </div>
                      {ag.feeArrearsMonths > 0 && (
                        <div className="text-[#A83629] font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>
                            متأخرات الرسوم: {ag.feeArrearsMonths} شهر (تنحلّ عند 3)
                          </span>
                        </div>
                      )}
                      {isHost && !plot && (
                        <div className="text-[#8A5F12] font-bold">
                          الاتفاقية نشطة بلا قطعة أرض مخصّصة حالياً لعدم توفر أرض حدودية فارغة.
                        </div>
                      )}
                      {hasDissolveScheduled && (
                        <div className="text-[#8E2A1F] font-bold">
                          تم طلب الحلّ — يسري عند الشهر {ag.dissolveEffectiveMonth} بعد استحقاق رسم الشهر الجاري.
                        </div>
                      )}
                    </div>

                    {isOnline && !hasDissolveScheduled && (
                      <div className="pt-1 flex justify-end">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onDissolve(ag.id)}
                          className="px-2.5 py-1 rounded-lg bg-[#FBE2DF] hover:bg-[#F5CCC7] border border-[#E5ABA3] text-[#8E2A1F] text-[11px] font-extrabold transition-colors disabled:opacity-40"
                        >
                          حلّ السفارة (عند الشهر التالي)
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Outgoing pending proposals */}
          {outgoingPending.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="font-extrabold text-[#2B2118]">
                طلبات مرسلة بانتظار موافقة المضيف ({outgoingPending.length})
              </h3>
              {outgoingPending.map((ag) => (
                <div
                  key={ag.id}
                  className="flex items-center justify-between p-2 rounded-xl bg-[#F8EED8] border border-[#E3D3AC] text-[11px]"
                >
                  <span className="font-bold text-[#2B2118]">
                    إلى {ag.hostNameAr ?? 'مملكة مضيفة'}
                  </span>
                  <span className="font-bold text-[#6F5C43] tabular-nums-latin">
                    عرض {ag.priceAgreed} ذهب · قيد الانتظار
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Propose new embassy form */}
          {isOnline && (
            <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2.5">
              <div className="font-extrabold text-[#2B2118]">
                اقتراح سفارة جديدة
              </div>
              {otherKingdoms.length === 0 ? (
                <p className="text-[11px] text-[#6F5C43]">
                  لا توجد ممالك أخرى مسجلة بعد في العالم المشترك.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-[#6F5C43] mb-1">
                      المملكة المضيفة
                    </label>
                    <select
                      value={targetHostUid}
                      onChange={(e) => setTargetHostUid(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg bg-white border border-[#D8C496] text-[#2B2118] font-bold"
                    >
                      {otherKingdoms.map((k) => (
                        <option key={k.uid} value={k.uid}>
                          {k.nameAr} ({k.wx}, {k.wy})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#6F5C43] mb-1">
                      ثمن الأرض المعروض (الحد الأدنى {EMBASSY_MIN_PRICE} ذهب)
                    </label>
                    <input
                      type="number"
                      min={EMBASSY_MIN_PRICE}
                      max={100000}
                      value={priceOffer}
                      onChange={(e) =>
                        setPriceOffer(
                          Math.max(
                            EMBASSY_MIN_PRICE,
                            Math.floor(Number(e.target.value) || EMBASSY_MIN_PRICE)
                          )
                        )
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-white border border-[#D8C496] text-[#2B2118] font-bold tabular-nums-latin"
                    />
                  </div>
                </div>
              )}
              <button
                type="button"
                disabled={
                  busy ||
                  !targetHostUid ||
                  otherKingdoms.length === 0 ||
                  nonDissolvedCount >= MAX_EMBASSY_AGREEMENTS_PER_KINGDOM ||
                  priceOffer < EMBASSY_MIN_PRICE
                }
                onClick={() => onPropose(targetHostUid, priceOffer)}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-40 text-white font-extrabold transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>إرسال اقتراح السفارة</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
