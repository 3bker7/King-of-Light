import {
  AlertTriangle,
  Check,
  Clock,
  Coins,
  Crown,
  Hammer,
  Home,
  MapPin,
  Mountain,
  Star,
  Store,
  Trash2,
  Users,
  UserX,
  X,
} from 'lucide-react';
import {
  MATERIAL_PRODUCER_THEME,
  THEMES,
  TICKS_PER_DAY,
  VILLAGE_JOIN_MIN_REPUTATION,
  VILLAGE_JOIN_REQUIRED_DAYS,
} from '../game/constants';
import {
  getEntertainmentBreakdown,
  getHouseCapacity,
} from '../game/people';
import {
  getCubePurchasePrice,
  getGoldServiceAuraBonus,
  getManhattanDistanceToPalace,
  getSeaFishOutput,
  isAdjacentToOwned,
  isPurchasableNeutralCube,
  makeSlotKey,
} from '../game/production';
import { STRINGS } from '../game/strings';
import type {
  Cube,
  GameState,
  ShortageReason,
  SlotIndex,
  StaffingStatus,
  ThemeId,
  TradedResourceKey,
} from '../game/types';
import { BoursePanel } from './BoursePanel';
import { CitizenCard, type CitizenInfo } from './CitizenCard';
import { ThemeIcon } from './ResourceIcon';

interface InspectorProps {
  state: GameState;
  selectedCube: Cube | null;
  selectedCitizen: CitizenInfo | null;
  isFollowingCitizen: boolean;
  kingdomOpen: boolean;
  staffing: StaffingStatus;
  activeTab: 'info' | 'bourse';
  onChangeTab: (tab: 'info' | 'bourse') => void;
  onClose: () => void;
  onToggleFollowCitizen: () => void;
  onBuyCube: (cubeId: number) => void;
  onDemolishTheme: (cubeId: number, slot: SlotIndex) => void;
  onFixHint?: (themeId: ThemeId) => void;
  onTrade: (
    resource: TradedResourceKey,
    side: 'buy' | 'sell',
    quantity: number | 'max'
  ) => void;
}

function getBarColorClass(value: number): string {
  if (value >= 60) return 'bg-[#3E9B4F]';
  if (value >= 35) return 'bg-[#E8A33D]';
  return 'bg-[#C44536]';
}

function getShortageResource(
  shortage: Exclude<ShortageReason, null>
): TradedResourceKey | null {
  switch (shortage) {
    case 'no_water':
      return 'water';
    case 'no_crops':
      return 'crops';
    case 'no_wheat':
      return 'wheat';
    case 'no_bread_meat':
      return 'bread';
    case 'no_iron_wood':
      return 'iron';
    case 'no_gold_gem':
      return 'goldOre';
    case 'no_surplus_food':
      return 'crops';
  }
}

function MeterBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] font-bold">
        <span className="text-[#4F3F2B]">{label}</span>
        <span className="tabular-nums-latin text-[#2B2118]">{clamped}%</span>
      </div>
      <div className="w-full h-2 rounded-full bg-[#E5D5B2] overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${getBarColorClass(
            clamped
          )}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

interface SlotCardProps {
  cube: Cube;
  allCubes: Cube[];
  slot: SlotIndex;
  slotTitle?: string;
  themeId: ThemeId;
  progress: number;
  shortage: ShortageReason;
  isStaffed: boolean;
  onDemolish: () => void;
  onFixHint?: (themeId: ThemeId) => void;
}

function SlotCard({
  cube,
  allCubes,
  slotTitle,
  themeId,
  progress,
  shortage,
  isStaffed,
  onDemolish,
  onFixHint,
}: SlotCardProps) {
  const def = THEMES[themeId];
  const produces = def.cycleSeconds !== null;
  const pct =
    def.cycleSeconds !== null
      ? Math.min(100, Math.round((progress / def.cycleSeconds) * 100))
      : 0;
  const remaining =
    def.cycleSeconds !== null ? Math.max(0, def.cycleSeconds - progress) : 0;
  const unstaffed = def.workers > 0 && !isStaffed;

  const seaStats = themeId === 'sea' ? getSeaFishOutput(allCubes, cube) : null;
  const auraBonus =
    def.goldPerCycle !== undefined
      ? getGoldServiceAuraBonus(allCubes, cube, themeId)
      : 0;

  const missingRes = shortage ? getShortageResource(shortage) : null;
  const producerTheme = missingRes ? MATERIAL_PRODUCER_THEME[missingRes] : undefined;

  return (
    <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#14524A]/10 text-[#14524A] flex items-center justify-center">
            <ThemeIcon themeId={themeId} className="w-4 h-4" />
          </div>
          <div>
            {slotTitle && (
              <div className="text-[10px] font-bold text-[#7C684C]">
                {slotTitle}
              </div>
            )}
            <div className="text-sm font-extrabold text-[#2B2118]">
              {STRINGS.themes[themeId].name}
            </div>
          </div>
        </div>
        <span className="text-[11px] font-bold text-[#6F5C43]">
          {STRINGS.footprint[def.footprint]}
        </span>
      </div>

      {/* Production summary */}
      <div className="text-xs text-[#4F3F2B] leading-relaxed">
        {themeId === 'sea' && seaStats && (
          <>
            <div>
              {STRINGS.inspector.outputPerCycle(
                seaStats.amount,
                STRINGS.resources.fish
              )}
            </div>
            <div className="text-[11px] font-bold text-[#14524A] mt-0.5">
              {STRINGS.inspector.seaAdjacencyBonus(
                seaStats.bonusPercent,
                seaStats.adjacentSeas
              )}
            </div>
            <div className="text-[11px] text-[#6F5C43] mt-0.5">
              {STRINGS.inspector.seaEntertainmentNote}
            </div>
          </>
        )}

        {themeId !== 'sea' && def.outputResource && def.outputAmount && (
          <div>
            {STRINGS.inspector.outputPerCycle(
              def.outputAmount,
              STRINGS.resources[def.outputResource]
            )}
          </div>
        )}

        {themeId === 'house' && def.shelters && (
          <div>{STRINGS.inspector.houseCapacityLabel(def.shelters)}</div>
        )}

        {themeId === 'shop' && def.goldPerCycle && (
          <div>{STRINGS.inspector.shopOutputPerCycle(def.goldPerCycle)}</div>
        )}

        {themeId !== 'shop' && def.goldPerCycle && (
          <div>{STRINGS.inspector.goldOutputPerCycle(def.goldPerCycle)}</div>
        )}

        {auraBonus > 0 && (
          <div className="text-[11px] font-bold text-[#14524A] mt-0.5">
            {STRINGS.inspector.logisticsBonusNote(Math.round(auraBonus * 100))}
          </div>
        )}
      </div>

      {/* Unstaffed warning */}
      {unstaffed && (
        <div className="flex items-start gap-1.5 p-2 rounded-lg bg-[#F8E7C1] border border-[#E2BA64] text-[11px] font-bold text-[#6D4707]">
          <UserX className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{STRINGS.inspector.unstaffedDetail}</span>
        </div>
      )}

      {/* Missing input shortage diagnostic + smart producer navigation button */}
      {!unstaffed && shortage && (
        <div className="p-2 rounded-lg bg-[#FBE2DF] border border-[#E5ABA3] text-[11px] font-bold text-[#8E2A1F] space-y-1.5">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{STRINGS.inspector.shortages[shortage]}</span>
          </div>
          {producerTheme && onFixHint && (
            <button
              type="button"
              onClick={() => onFixHint(producerTheme)}
              className="w-full py-1.5 px-2 rounded-lg bg-[#14524A] hover:bg-[#1B685E] text-white text-[11px] font-extrabold flex items-center justify-center gap-1 transition-colors"
            >
              <Hammer className="w-3 h-3" />
              <span>
                {STRINGS.buildDock.selectProducer(
                  STRINGS.themes[producerTheme].name
                )}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Live cycle progress bar */}
      {produces && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] font-bold text-[#6F5C43]">
            <span>{STRINGS.inspector.cycleLabel}</span>
            <span className="tabular-nums-latin">
              {STRINGS.inspector.secondsRemaining(remaining)}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-[#E5D5B2] overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                unstaffed ? 'bg-[#A69B86]' : 'bg-[#C9962E]'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Demolish button (hidden for non-demolishable landmarks) */}
      {!def.nonDemolishable && (
        <button
          type="button"
          onClick={onDemolish}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl border border-[#DFB9B3] bg-[#FBF0EE] hover:bg-[#F5DDD9] text-[#A83629] text-xs font-extrabold transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{STRINGS.inspector.demolish}</span>
        </button>
      )}
    </div>
  );
}

export function Inspector({
  state,
  selectedCube,
  selectedCitizen,
  isFollowingCitizen,
  kingdomOpen,
  staffing,
  activeTab,
  onChangeTab,
  onClose,
  onToggleFollowCitizen,
  onBuyCube,
  onDemolishTheme,
  onFixHint,
  onTrade,
}: InspectorProps) {
  // Element 1.3: Unmount completely when nothing is selected — the map breathes
  if (!selectedCitizen && !selectedCube && !kingdomOpen) {
    return null;
  }

  const capacity = getHouseCapacity(state.cubes);
  const ent = getEntertainmentBreakdown(state.cubes, state.warehouse);
  const secondsLeftInDay = Math.max(0, TICKS_PER_DAY - state.tickInDay);
  const ownedCount = state.cubes.filter((c) => c.owner === 'player').length;

  const renderNeutralCube = (cube: Cube) => {
    if (cube.isVillage) {
      const adjacent = isAdjacentToOwned(state.cubes, cube);
      const repReady = state.reputation >= VILLAGE_JOIN_MIN_REPUTATION;
      const pct = Math.min(
        100,
        Math.round((cube.villageLoyaltyDays / VILLAGE_JOIN_REQUIRED_DAYS) * 100)
      );

      return (
        <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2.5">
          <div className="flex items-center gap-2 text-[#2B2118]">
            <div className="w-8 h-8 rounded-lg bg-[#C9962E]/20 text-[#8A5F12] flex items-center justify-center shrink-0">
              <Home className="w-4 h-4" />
            </div>
            <div className="text-sm font-extrabold">
              {STRINGS.inspector.villageTitle(cube.villageName ?? 'الواحة')}
            </div>
          </div>

          <p className="text-xs text-[#6F5C43] leading-relaxed">
            {STRINGS.inspector.villageDesc}
          </p>

          <div className="space-y-1">
            <div className="text-[11px] font-extrabold text-[#14524A]">
              {STRINGS.inspector.villageProgress(
                cube.villageLoyaltyDays,
                VILLAGE_JOIN_REQUIRED_DAYS
              )}
            </div>
            <div className="w-full h-2 rounded-full bg-[#E5D5B2] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#3E9B4F] transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {!adjacent && (
            <p className="text-[11px] font-bold text-[#8A5F12] bg-[#F8E7C1] border border-[#E2BA64] rounded-lg p-2">
              {STRINGS.inspector.villageNeedAdjacent}
            </p>
          )}
          {!repReady && (
            <p className="text-[11px] font-bold text-[#8A5F12] bg-[#F8E7C1] border border-[#E2BA64] rounded-lg p-2">
              {STRINGS.inspector.villageNeedRep}
            </p>
          )}
        </div>
      );
    }

    const purchasable = isPurchasableNeutralCube(state.cubes, cube);
    const cubePrice = getCubePurchasePrice(state.cubes, cube);
    const dist = getManhattanDistanceToPalace(state.cubes, cube);

    return (
      <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2.5">
        <div className="text-sm font-extrabold text-[#2B2118]">
          {STRINGS.inspector.neutralSand}
        </div>
        {cube.isRocky && (
          <div className="flex items-center gap-1.5 p-2 rounded-lg bg-[#EFE4CC] border border-[#D4C29A] text-[11px] font-extrabold text-[#4F3F2B]">
            <Mountain className="w-3.5 h-3.5 text-[#6F5C43] shrink-0" />
            <span>{STRINGS.inspector.rockyBadge}</span>
          </div>
        )}
        {purchasable ? (
          <>
            <p className="text-xs text-[#6F5C43] leading-relaxed">
              {STRINGS.inspector.neutralAdjacentHint}
            </p>
            <button
              type="button"
              disabled={state.gold < cubePrice}
              onClick={() => onBuyCube(cube.id)}
              className="w-full py-2 px-3 rounded-xl bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-45 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Coins className="w-3.5 h-3.5 text-[#F2CA6B]" />
              <span>{STRINGS.inspector.buyCubeAction(cubePrice)}</span>
            </button>
            <p className="text-[11px] text-[#6F5C43] leading-relaxed">
              {STRINGS.inspector.distancePriceNote(dist)}
            </p>
            {state.gold < cubePrice && (
              <p className="text-[11px] font-bold text-[#A83629] text-center">
                {STRINGS.inspector.notEnoughGold}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-[#6F5C43] leading-relaxed">
            {STRINGS.inspector.neutralFarHint}
          </p>
        )}
      </div>
    );
  };

  const renderPalacePanel = () => (
    <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#C9962E] space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-lg bg-[#C9962E]/20 text-[#8A5F12] flex items-center justify-center shrink-0">
          <Crown className="w-5 h-5" />
        </div>
        <div>
          <div className="text-sm font-extrabold text-[#2B2118]">
            {STRINGS.inspector.palaceTitle}
          </div>
          <div className="text-[11px] font-bold text-[#6F5C43]">
            {STRINGS.themes.palace.summary}
          </div>
        </div>
      </div>

      <div className="space-y-1.5 pt-2 border-t border-[#EFE3C5] text-xs">
        <div className="flex items-center justify-between">
          <span className="text-[#6F5C43] font-bold">
            {STRINGS.inspector.palaceTerritory}
          </span>
          <span className="font-extrabold text-[#2B2118] tabular-nums-latin">
            {ownedCount} {STRINGS.inspector.palaceCubesUnit}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[#6F5C43] font-bold">
            {STRINGS.populationLabel}
          </span>
          <span className="font-extrabold text-[#2B2118] tabular-nums-latin">
            {state.population}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[#6F5C43] font-bold">
            {STRINGS.reputationLabel}
          </span>
          <span className="font-extrabold text-[#2B2118] tabular-nums-latin">
            {Math.round(state.reputation)} / 100
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[#6F5C43] font-bold">
            {STRINGS.inspector.palaceVillagesJoined}
          </span>
          <span className="font-extrabold text-[#2B2118] tabular-nums-latin">
            {state.villagesJoined}
          </span>
        </div>
      </div>

      <p className="text-[11px] font-bold text-[#8A5F12] pt-1.5 border-t border-[#EFE3C5]">
        {STRINGS.inspector.palaceNonDemolishable}
      </p>
    </div>
  );

  const renderKingdomSummary = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-[#E3D3AC]">
        <div className="flex items-center gap-1.5 text-[#2B2118]">
          <Users className="w-4 h-4 text-[#14524A]" />
          <h3 className="text-sm font-extrabold">
            {STRINGS.people.summaryTitle}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={STRINGS.modals.close}
          className="w-7 h-7 rounded-lg hover:bg-[#EFE2C2] text-[#4F3F2B] flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {state.level >= 2 && (
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#EFE2C2] border border-[#E3D3AC]">
          <button
            type="button"
            onClick={() => onChangeTab('info')}
            className={`py-1 text-xs font-extrabold rounded-lg transition-colors ${
              activeTab === 'info'
                ? 'bg-[#14524A] text-white'
                : 'text-[#4F3F2B] hover:text-[#2B2118]'
            }`}
          >
            {STRINGS.inspector.tabInfo}
          </button>
          <button
            type="button"
            onClick={() => onChangeTab('bourse')}
            className={`py-1 text-xs font-extrabold rounded-lg transition-colors flex items-center justify-center gap-1 ${
              activeTab === 'bourse'
                ? 'bg-[#14524A] text-white'
                : 'text-[#4F3F2B] hover:text-[#2B2118]'
            }`}
          >
            <Store className="w-3.5 h-3.5" />
            <span>{STRINGS.inspector.tabBourse}</span>
          </button>
        </div>
      )}

      {state.level >= 2 && activeTab === 'bourse' ? (
        <BoursePanel state={state} compact onTrade={onTrade} />
      ) : (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between text-[11px] font-bold text-[#6F5C43]">
            <span className="tabular-nums-latin">
              {STRINGS.people.housingRatio(state.population, capacity)}
            </span>
            <span>
              {STRINGS.people.workersRatio(
                staffing.totalWorkersEmployed,
                staffing.totalWorkersNeeded
              )}
            </span>
          </div>

          <div className="flex items-center gap-1 text-[11px] font-bold text-[#6F5C43]">
            <Clock className="w-3 h-3 text-[#C9962E]" />
            <span>{STRINGS.people.dayRolloverHint(secondsLeftInDay)}</span>
          </div>

          {state.hungerFlag && (
            <div className="p-2 rounded-xl bg-[#FBE2DF] border border-[#E5ABA3] text-[11px] font-bold text-[#8E2A1F] flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{STRINGS.people.hungerWarning}</span>
            </div>
          )}

          {/* Main Satisfaction & Needs */}
          <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
            <MeterBar
              label={STRINGS.satisfactionLabel}
              value={state.satisfaction}
            />
            <div className="pt-1.5 border-t border-[#EFE3C5] space-y-1.5">
              <MeterBar
                label={STRINGS.people.needsFood}
                value={state.needs.food}
              />
              <MeterBar
                label={STRINGS.people.needsWater}
                value={state.needs.water}
              />
              <MeterBar
                label={STRINGS.people.needsHousing}
                value={state.needs.housing}
              />
              <MeterBar
                label={STRINGS.people.needsEntertainment}
                value={state.needs.entertainment}
              />
            </div>

            <div className="pt-1.5 border-t border-[#EFE3C5] space-y-1 text-[11px] text-[#6F5C43]">
              {[
                { active: ent.seaAdjacent, label: STRINGS.people.entertainmentSea },
                { active: ent.shopOrMarket, label: STRINGS.people.entertainmentShop },
                { active: ent.theater, label: STRINGS.people.entertainmentTheater },
                { active: ent.mosque, label: STRINGS.people.entertainmentMosque },
                { active: ent.foodVariety, label: STRINGS.people.entertainmentVariety },
                { active: ent.cafe, label: STRINGS.people.entertainmentCafe },
                { active: ent.restaurant, label: STRINGS.people.entertainmentRestaurant },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-1.5">
                  <Check
                    className={`w-3 h-3 shrink-0 ${
                      row.active ? 'text-[#3E9B4F]' : 'text-[#CBBBA0]'
                    }`}
                  />
                  <span className={row.active ? 'text-[#2B2118] font-bold' : ''}>
                    {row.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Reputation */}
          <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#2B2118]">
                <Star className="w-3.5 h-3.5 text-[#C9962E] fill-[#C9962E]" />
                <span>{STRINGS.reputationLabel}</span>
              </div>
              <span className="text-xs font-extrabold tabular-nums-latin text-[#2B2118]">
                {Math.round(state.reputation)} / 100
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-[#E5D5B2] overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${getBarColorClass(
                  state.reputation
                )}`}
                style={{ width: `${Math.round(state.reputation)}%` }}
              />
            </div>
            <p className="text-[11px] text-[#6F5C43]">
              {STRINGS.people.reputationHint}
            </p>
          </div>

          {state.satisfaction >= 60 ? (
            <p className="text-[11px] text-[#2D6E3B] font-bold leading-relaxed">
              {STRINGS.people.growthHintHigh}
            </p>
          ) : state.satisfaction < 35 ? (
            <p className="text-[11px] text-[#A83629] font-bold leading-relaxed">
              {STRINGS.people.growthHintLow}{' '}
              {state.level === 1 ? STRINGS.people.growthHintLevel1Floor : ''}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );

  const renderBody = () => {
    if (selectedCitizen) {
      return (
        <CitizenCard
          citizen={selectedCitizen}
          isFollowing={isFollowingCitizen}
          onToggleFollow={onToggleFollowCitizen}
          onClose={onClose}
        />
      );
    }

    if (selectedCube) {
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E3D3AC]">
            <div className="flex items-center gap-1.5 text-[#2B2118]">
              <MapPin className="w-4 h-4 text-[#14524A]" />
              <h3 className="text-sm font-extrabold">
                {STRINGS.inspector.cubeTitle(selectedCube.row, selectedCube.col)}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={STRINGS.modals.close}
              className="w-7 h-7 rounded-lg hover:bg-[#EFE2C2] text-[#4F3F2B] flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {selectedCube.owner === 'neutral' ? (
            renderNeutralCube(selectedCube)
          ) : !selectedCube.themeId ? (
            <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
              <div className="text-sm font-extrabold text-[#2B2118]">
                {STRINGS.inspector.ownedSand}
              </div>
              {selectedCube.isRocky && (
                <div className="flex items-center gap-1.5 p-2 rounded-lg bg-[#EFE4CC] border border-[#D4C29A] text-[11px] font-extrabold text-[#4F3F2B]">
                  <Mountain className="w-3.5 h-3.5 text-[#6F5C43] shrink-0" />
                  <span>{STRINGS.inspector.rockyBadge}</span>
                </div>
              )}
              <p className="text-xs text-[#6F5C43] leading-relaxed">
                {STRINGS.inspector.ownedSandHint}
              </p>
            </div>
          ) : selectedCube.themeId === 'palace' ? (
            renderPalacePanel()
          ) : THEMES[selectedCube.themeId].footprint === 'full' ? (
            <SlotCard
              cube={selectedCube}
              allCubes={state.cubes}
              slot={0}
              themeId={selectedCube.themeId}
              progress={selectedCube.progress}
              shortage={selectedCube.shortage}
              isStaffed={staffing.staffedSlots.has(
                makeSlotKey(selectedCube.id, 0)
              )}
              onDemolish={() => onDemolishTheme(selectedCube.id, 0)}
              onFixHint={onFixHint}
            />
          ) : (
            <div className="space-y-2.5">
              <SlotCard
                cube={selectedCube}
                allCubes={state.cubes}
                slot={0}
                slotTitle={STRINGS.inspector.slotPrimary}
                themeId={selectedCube.themeId}
                progress={selectedCube.progress}
                shortage={selectedCube.shortage}
                isStaffed={staffing.staffedSlots.has(
                  makeSlotKey(selectedCube.id, 0)
                )}
                onDemolish={() => onDemolishTheme(selectedCube.id, 0)}
                onFixHint={onFixHint}
              />
              {selectedCube.secondThemeId ? (
                <SlotCard
                  cube={selectedCube}
                  allCubes={state.cubes}
                  slot={1}
                  slotTitle={STRINGS.inspector.slotSecondary}
                  themeId={selectedCube.secondThemeId}
                  progress={selectedCube.secondProgress}
                  shortage={selectedCube.secondShortage}
                  isStaffed={staffing.staffedSlots.has(
                    makeSlotKey(selectedCube.id, 1)
                  )}
                  onDemolish={() => onDemolishTheme(selectedCube.id, 1)}
                  onFixHint={onFixHint}
                />
              ) : (
                <div className="p-2.5 rounded-xl bg-[#F5EAD0] border border-dashed border-[#D3BE8F] text-[11px] font-bold text-[#6F5C43]">
                  {STRINGS.inspector.emptyHalf}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    return renderKingdomSummary();
  };

  return (
    <aside
      aria-label={STRINGS.mobile.inspectorButton}
      className="fixed bottom-[62px] inset-x-2 lg:inset-x-auto lg:bottom-3 lg:left-3 lg:w-[300px] max-h-[55dvh] lg:max-h-[calc(100dvh-140px)] z-30 parchment-panel border-2 border-[#C9962E] shadow-2xl flex flex-col overflow-hidden"
    >
      <div className="flex-1 overflow-y-auto parchment-scroll p-3">
        {renderBody()}
      </div>
    </aside>
  );
}
