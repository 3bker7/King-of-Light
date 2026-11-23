import { Clock, Coins, TrendingUp, Users } from 'lucide-react';
import { MAX_OFFLINE_SECONDS, TRADED_RESOURCES } from '../game/constants';
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
  const wasCapped = report.elapsedSeconds >= MAX_OFFLINE_SECONDS;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-md parchment-panel border-2 border-[#C9962E] p-5 space-y-4">
        <div className="flex items-center gap-2.5 border-b border-[#E3D3AC] pb-3">
          <div className="w-10 h-10 rounded-xl bg-[#14524A] text-[#F2CA6B] flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-[#2B2118]">
              {STRINGS.modals.awayTitle}
            </h2>
            <p className="text-xs text-[#6F5C43]">
              {STRINGS.modals.awaySubtitle(
                formatDurationArabic(report.elapsedSeconds)
              )}{' '}
              {wasCapped ? STRINGS.modals.awayCappedNote : ''}
            </p>
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
