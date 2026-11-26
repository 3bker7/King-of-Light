import { AlertTriangle, Clock, Coins, Flag, Globe, Landmark, ScrollText, TrendingUp, Users, Wallet } from 'lucide-react';
import { TRADED_RESOURCES } from '../game/constants';
import { formatDurationArabic, STRINGS } from '../game/strings';
import type { AwayReportData } from '../game/types';
import { ResourceIcon } from './ResourceIcon';

interface AwayReportProps {
  report: AwayReportData;
  onClose: () => void;
}

export function AwayReport({ report, onClose }: AwayReportProps) {
  const producedEntries = TRADED_RESOURCES.filter(
    (key) => (report.resourcesProduced[key] ?? 0) > 0
  );
  // Honesty rule (S3): true ONLY when raw real absence strictly exceeded 90 game days (never on an exact 90-day absence)
  const wasCapped = report.wasCapped === true;
  const kingdomDaysLineAr =
    report.daysElapsed > 0
      ? `غبتَ ${report.daysElapsed} من أيام المملكة`
      : 'غبتَ أقل من يوم من أيام المملكة';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-md parchment-panel border-2 border-[#C9962E] p-5 space-y-4">
        <div className="flex items-center gap-2.5 border-b border-[#E3D3AC] pb-3">
          <div className="w-10 h-10 rounded-xl bg-[#14524A] text-[#F2CA6B] flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div className="space-y-0.5">
            <h2 className="text-lg font-extrabold text-[#2B2118]">
              {STRINGS.modals.awayTitle}
            </h2>
            <p className="text-xs text-[#6F5C43]">
              {STRINGS.modals.awaySubtitle(
                formatDurationArabic(report.elapsedSeconds)
              )}
            </p>
            <p className="text-xs font-extrabold text-[#14524A] tabular-nums-latin">
              {kingdomDaysLineAr}
            </p>
            {wasCapped && (
              <p className="text-[11px] font-bold text-[#8A5F12]">
                مرّ وقت أطول، لكن المملكة انتظرتك 90 يوماً كحد أقصى
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 text-xs">
          {/* Gold earned by shops */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC]">
            <div className="flex items-center gap-2 font-bold text-[#2B2118]">
              <Coins className="w-4 h-4 text-[#C9962E]" />
              <span>{STRINGS.modals.awayShopGold}</span>
            </div>
            <span className="text-sm font-extrabold text-[#8A5F12] tabular-nums-latin">
              +{report.goldEarnedByShops}
            </span>
          </div>

          {/* Offline monthly payrolls paid */}
          {report.payrollPaid > 0 && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC]">
              <div className="flex items-center gap-2 font-bold text-[#2B2118]">
                <Wallet className="w-4 h-4 text-[#14524A]" />
                <span>رواتب دُفعت أثناء غيابك: {report.payrollPaid}</span>
              </div>
              <span className="text-sm font-extrabold text-[#A83629] tabular-nums-latin">
                -{report.payrollPaid}
              </span>
            </div>
          )}

          {/* Offline arrears warning if treasury ran short */}
          {report.arrearsAdded > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FBE2DF] border border-[#E5ABA3] font-bold text-[#8E2A1F]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                متأخرات رواتب أثناء غيابك: {report.arrearsAdded} ذهب
              </span>
            </div>
          )}

          {/* Resources produced */}
          <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
            <div className="font-extrabold text-[#2B2118]">
              {STRINGS.modals.awayResources}
            </div>
            {producedEntries.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {producedEntries.map((key) => (
                  <div
                    key={key}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F3E6C6] text-[#2B2118] font-bold"
                  >
                    <ResourceIcon
                      resource={key}
                      className="w-3.5 h-3.5 text-[#14524A]"
                    />
                    <span>{STRINGS.resources[key]}</span>
                    <span className="tabular-nums-latin text-[#14524A]">
                      +{report.resourcesProduced[key]}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[#6F5C43]">{STRINGS.modals.awayNoResources}</p>
            )}
          </div>

          {/* Population change */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC]">
            <div className="flex items-center gap-2 font-bold text-[#2B2118]">
              <Users className="w-4 h-4 text-[#14524A]" />
              <span>{STRINGS.modals.awayPopulationChange}</span>
            </div>
            <span
              className={`text-sm font-extrabold tabular-nums-latin ${
                report.populationDelta > 0
                  ? 'text-[#3E9B4F]'
                  : report.populationDelta < 0
                    ? 'text-[#C44536]'
                    : 'text-[#6F5C43]'
              }`}
            >
              {report.populationDelta > 0
                ? `+${report.populationDelta}`
                : report.populationDelta}
            </span>
          </div>

          {/* Element 8.2: Lifecycle summary when any count is non-zero */}
          {((report.births ?? 0) +
            (report.cvsFiled ?? 0) +
            (report.marriages ?? 0) +
            (report.housingGranted ?? 0) +
            (report.faxesSent ?? 0)) > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] font-bold text-[#2B2118]">
              <ScrollText className="w-4 h-4 text-[#14524A] shrink-0" />
              <span className="tabular-nums-latin">
                أثناء غيابك: {report.births ?? 0} مولود، {report.marriages ?? 0}{' '}
                زواج، {report.housingGranted ?? 0} أسرة سكنت
              </span>
            </div>
          )}

          {/* Element 6.3: Private sector & citizen spending offline summary */}
          {((report.citizenSpentTotal ?? 0) > 0 ||
            (report.businessTaxTotal ?? 0) > 0) && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] font-bold text-[#2B2118]">
              <Coins className="w-4 h-4 text-[#C9962E] shrink-0" />
              <span className="tabular-nums-latin">
                أثناء غيابك: المواطنون أنفقوا {report.citizenSpentTotal ?? 0} ذهب،
                وضرائب الأعمال {report.businessTaxTotal ?? 0}
              </span>
            </div>
          )}

          {/* Prompt 5 Element 6.1: Bank offline installments & trades */}
          {(report.loanInstallmentsPaid ?? 0) > 0 && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC]">
              <div className="flex items-center gap-2 font-bold text-[#2B2118]">
                <Landmark className="w-4 h-4 text-[#14524A]" />
                <span>أقساط تمويل دُفعت أثناء غيابك</span>
              </div>
              <span className="text-sm font-extrabold text-[#A83629] tabular-nums-latin">
                -{report.loanInstallmentsPaid}
              </span>
            </div>
          )}

          {(report.loanDeferredAdded ?? 0) > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FBE2DF] border border-[#E5ABA3] font-bold text-[#8E2A1F]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                أقساط تمويل مؤجلة أثناء غيابك: {report.loanDeferredAdded} ذهب
              </span>
            </div>
          )}

          {(report.bankTradesCount ?? 0) > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] font-bold text-[#2B2118]">
              <TrendingUp className="w-4 h-4 text-[#C9962E] shrink-0" />
              <span className="tabular-nums-latin">
                صفقات بنك الشعب أثناء غيابك: {report.bankTradesCount} صفقة
              </span>
            </div>
          )}

          {/* Prompt 7 Element 5.3: Province events during away period (one concise line per event, no animation replay) */}
          {report.provinceEvents && report.provinceEvents.length > 0 && (
            <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-1.5">
              <div className="flex items-center gap-1.5 font-extrabold text-[#2B2118]">
                <Flag className="w-4 h-4 text-[#14524A] shrink-0" />
                <span>أحداث الولايات أثناء غيابك</span>
              </div>
              <ul className="space-y-1 max-h-28 overflow-y-auto pr-0.5">
                {report.provinceEvents.map((ev) => (
                  <li
                    key={ev.id}
                    className="flex items-center justify-between gap-2 text-[11px] font-bold text-[#4F3F2B]"
                  >
                    <span className="truncate">{ev.labelAr}</span>
                    <span className="shrink-0 text-[10px] text-[#7A674D] tabular-nums-latin">
                      شهر {ev.month}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Prompt 8 Element N5.2: Shared World settlement summary (shown ONLY when online world events occurred) */}
          {report.worldSummary && report.worldSummary.lines.length > 0 && (
            <div className="p-2.5 rounded-xl bg-[#E6F2EF] border border-[#8CC3B8] space-y-1.5">
              <div className="flex items-center gap-1.5 font-extrabold text-[#14524A]">
                <Globe className="w-4 h-4 shrink-0" />
                <span>أحداث العالم المشترك أثناء غيابك</span>
              </div>
              <ul className="space-y-1 max-h-28 overflow-y-auto pr-0.5 text-[11px] font-bold text-[#1E4B44]">
                {report.worldSummary.lines.map((line, idx) => (
                  <li key={`ws-${idx}`}>• {line}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Biggest market move */}
          <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-1">
            <div className="flex items-center gap-1.5 font-extrabold text-[#2B2118]">
              <TrendingUp className="w-4 h-4 text-[#C9962E]" />
              <span>{STRINGS.modals.awayBiggestMove}</span>
            </div>
            {report.biggestPriceMove ? (
              <p className="text-[#4F3F2B] font-bold">
                {STRINGS.resources[report.biggestPriceMove.resource]}:{' '}
                <span className="tabular-nums-latin">
                  {report.biggestPriceMove.previousPrice} ←{' '}
                  {report.biggestPriceMove.newPrice}
                </span>{' '}
                (
                <span className="tabular-nums-latin">
                  {report.biggestPriceMove.percentChange >= 0 ? '+' : ''}
                  {Math.round(report.biggestPriceMove.percentChange)}%
                </span>
                )
              </p>
            ) : (
              <p className="text-[#6F5C43]">{STRINGS.modals.awayNoMove}</p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 px-4 rounded-xl bg-[#14524A] hover:bg-[#1B685E] text-white text-sm font-extrabold transition-colors"
        >
          {STRINGS.modals.continuePlay}
        </button>
      </div>
    </div>
  );
}
