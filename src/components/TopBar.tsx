import {
  Compass,
  Frown,
  Globe,
  Handshake,
  Meh,
  Settings,
  ShoppingBag,
  Smile,
  Sparkles,
  Star,
  Store,
  Sun,
  Users,
} from 'lucide-react';
import { countUnreadFaxes } from '../game/advisor';
import { TICKS_PER_DAY, TRADED_RESOURCES } from '../game/constants';
import { STRINGS } from '../game/strings';
import type { GameState } from '../game/types';
import type { CloudSyncStatus } from '../net/worldTypes';
import { ResourceIcon } from './ResourceIcon';

interface TopBarProps {
  state: GameState;
  cloudSyncStatus: CloudSyncStatus;
  isOnlineWorld?: boolean;
  pendingEmbassyProposals?: number;
  onOpenSharedWorld: () => void;
  onOpenMarket?: () => void;
  onOpenEmbassies?: () => void;
  onOpenWorldMap?: () => void;
  onOpenAdvisor: () => void;
  onOpenBourse: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  state,
  cloudSyncStatus,
  isOnlineWorld = false,
  pendingEmbassyProposals = 0,
  onOpenSharedWorld,
  onOpenMarket,
  onOpenEmbassies,
  onOpenWorldMap,
  onOpenAdvisor,
  onOpenBourse,
  onOpenSettings,
}: TopBarProps) {
  const unreadFaxes = countUnreadFaxes(state.officeFaxes);
  const hasCriticalBrief = Boolean(
    state.advisorBriefing?.lines.some((l) => l.severity === 'critical')
  );
  const dayProgressPct = Math.min(
    100,
    Math.round((state.tickInDay / TICKS_PER_DAY) * 100)
  );
  const roundedRep = Math.round(state.reputation);
  const filledStars = Math.round((roundedRep / 100) * 5);

  const SatisfactionIcon =
    state.satisfaction >= 60 ? Smile : state.satisfaction >= 35 ? Meh : Frown;
  const satisfactionColor =
    state.satisfaction >= 60
      ? 'text-[#6FE387]'
      : state.satisfaction >= 35
        ? 'text-[#F5B954]'
        : 'text-[#F27A6E]';

  return (
    <header className="h-12 w-full bg-[#14524A] text-white border-b border-[#0D3C36] px-2.5 sm:px-3.5 flex items-center justify-between gap-2 shrink-0 shadow-sm">
      {/* Right side (RTL start): Compact Game Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-[#C9962E]/20 border border-[#C9962E]/50 flex items-center justify-center text-[#F2CA6B]">
          <Sun className="w-4 h-4" />
        </div>
        <h1 className="text-sm font-extrabold tracking-tight text-[#FBF3DF] whitespace-nowrap">
          {STRINGS.appName}
        </h1>
      </div>

      {/* Center: Horizontally scrollable resource chips */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto parchment-scroll py-0.5">
        {/* Gold chip */}
        <div
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#0E3A34]/80 text-[#F6D377] shrink-0"
          title={STRINGS.goldLabel}
        >
          <ResourceIcon resource="gold" className="w-3.5 h-3.5 text-[#E6B64B]" />
          <span className="text-xs font-extrabold tabular-nums-latin">
            {state.gold}
          </span>
        </div>

        {/* Population chip */}
        <div
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#0E3A34]/65 text-[#FBF3DF] shrink-0"
          title={STRINGS.populationLabel}
        >
          <Users className="w-3.5 h-3.5 text-[#F2CA6B]" />
          <span className="text-xs font-bold tabular-nums-latin">
            {state.population}
          </span>
        </div>

        {/* Scrollable traded warehouse resource chips */}
        {TRADED_RESOURCES.map((key) => (
          <div
            key={key}
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#0E3A34]/50 text-[#FBF3DF] shrink-0"
            title={STRINGS.resources[key]}
          >
            <ResourceIcon
              resource={key}
              className="w-3.5 h-3.5 text-[#A7D8CE] shrink-0"
            />
            <span className="text-xs font-bold tabular-nums-latin">
              {state.warehouse[key]}
            </span>
          </div>
        ))}
      </div>

      {/* Left side (RTL end): Day, Satisfaction, Reputation, Bourse (L2), Settings */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Day Counter */}
        <div className="flex flex-col items-center min-w-[48px] shrink-0">
          <span className="text-[11px] font-extrabold text-[#FBF3DF] whitespace-nowrap leading-none">
            {STRINGS.dayLabel(state.day)}
          </span>
          <div className="w-full h-1 bg-[#0B2E29] rounded-full overflow-hidden mt-1">
            <div
              className="h-full bg-[#C9962E] transition-[width] duration-300"
              style={{ width: `${dayProgressPct}%` }}
            />
          </div>
        </div>

        {/* Satisfaction Face Meter */}
        <div
          className="hidden sm:flex items-center gap-1 shrink-0"
          title={STRINGS.satisfactionLabel}
        >
          <SatisfactionIcon className={`w-4 h-4 ${satisfactionColor}`} />
          <span className="text-xs font-extrabold tabular-nums-latin text-[#FBF3DF]">
            {state.satisfaction}
          </span>
        </div>

        {/* Reputation Stars */}
        <div
          className="hidden xl:flex items-center gap-1 shrink-0"
          title={`${STRINGS.reputationLabel}: ${roundedRep}`}
        >
          <div className="flex items-center gap-0.5">
            {[0, 1, 2, 3, 4].map((idx) => (
              <Star
                key={idx}
                className={`w-3 h-3 ${
                  idx < filledStars
                    ? 'text-[#E6B64B] fill-[#E6B64B]'
                    : 'text-[#437870]'
                }`}
              />
            ))}
          </div>
          <span className="text-xs font-bold tabular-nums-latin text-[#C9E2DC]">
            {roundedRep}
          </span>
        </div>

        {/* Shared World Auth & Sync Chip */}
        <button
          type="button"
          onClick={onOpenSharedWorld}
          title="العالم المشترك"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0E3A34]/85 hover:bg-[#0B2E29] border border-[#2C7268] text-[#FBF3DF] text-xs font-extrabold transition-colors whitespace-nowrap shrink-0"
        >
          <Globe className="w-3.5 h-3.5 text-[#A7D8CE]" />
          <span className="hidden md:inline">العالم المشترك</span>
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              cloudSyncStatus === 'synced'
                ? 'bg-[#6FE387]'
                : cloudSyncStatus === 'pending'
                  ? 'bg-[#F5B954]'
                  : 'bg-[#8AA6A1]'
            }`}
          />
        </button>

        {/* Online-only Shared World Overlays: Market, Embassies, World Map (hidden in local mode) */}
        {isOnlineWorld && onOpenMarket && (
          <button
            type="button"
            onClick={onOpenMarket}
            title="السوق العالمي"
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#0E3A34]/85 hover:bg-[#0B2E29] border border-[#2C7268] text-[#FBF3DF] text-xs font-extrabold transition-colors whitespace-nowrap shrink-0"
          >
            <ShoppingBag className="w-3.5 h-3.5 text-[#F2CA6B]" />
            <span className="hidden xl:inline">السوق</span>
          </button>
        )}

        {isOnlineWorld && onOpenEmbassies && (
          <button
            type="button"
            onClick={onOpenEmbassies}
            title="السفارات"
            className="relative flex items-center gap-1 px-2 py-1 rounded-lg bg-[#0E3A34]/85 hover:bg-[#0B2E29] border border-[#2C7268] text-[#FBF3DF] text-xs font-extrabold transition-colors whitespace-nowrap shrink-0"
          >
            <Handshake className="w-3.5 h-3.5 text-[#A7D8CE]" />
            <span className="hidden xl:inline">السفارات</span>
            {pendingEmbassyProposals > 0 && (
              <span className="px-1.5 py-0.2 rounded-md bg-[#C9962E] text-[#2B2118] text-[10px] font-black tabular-nums-latin leading-tight">
                {pendingEmbassyProposals}
              </span>
            )}
          </button>
        )}

        {isOnlineWorld && onOpenWorldMap && (
          <button
            type="button"
            onClick={onOpenWorldMap}
            title="خريطة العالم"
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#0E3A34]/85 hover:bg-[#0B2E29] border border-[#2C7268] text-[#FBF3DF] text-xs font-extrabold transition-colors whitespace-nowrap shrink-0"
          >
            <Compass className="w-3.5 h-3.5 text-[#F2CA6B]" />
            <span className="hidden xl:inline">الخريطة</span>
          </button>
        )}

        {/* Royal Advisor Trigger */}
        <button
          type="button"
          onClick={onOpenAdvisor}
          title="المستشار الملكي"
          className="relative flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0E3A34]/85 hover:bg-[#0B2E29] border border-[#C9962E]/60 text-[#FBF3DF] text-xs font-extrabold transition-colors whitespace-nowrap shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#F2CA6B]" />
          <span className="hidden sm:inline">المستشار</span>
          {unreadFaxes > 0 && (
            <span className="px-1.5 py-0.2 rounded-md bg-[#C9962E] text-[#2B2118] text-[10px] font-black tabular-nums-latin leading-tight">
              {unreadFaxes}
            </span>
          )}
          {hasCriticalBrief && unreadFaxes === 0 && (
            <span className="w-2 h-2 rounded-full bg-[#F27A6E] shrink-0" />
          )}
        </button>

        {/* Level 2 Bourse Modal Trigger */}
        {state.level >= 2 && (
          <button
            type="button"
            onClick={onOpenBourse}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#C9962E] hover:bg-[#D6A43E] text-[#2B2118] text-xs font-extrabold transition-colors whitespace-nowrap shrink-0"
          >
            <Store className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{STRINGS.bourseButton}</span>
          </button>
        )}

        {/* Settings Trigger */}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={STRINGS.settingsButton}
          title={STRINGS.settingsButton}
          className="w-8 h-8 rounded-lg bg-[#0E3A34]/75 hover:bg-[#0B2E29] text-[#FBF3DF] flex items-center justify-center transition-colors shrink-0"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
