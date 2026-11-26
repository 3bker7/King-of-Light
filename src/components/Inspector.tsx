import {
  AlertTriangle,
  Briefcase,
  Check,
  Clock,
  Coins,
  Crown,
  Gauge,
  Hammer,
  Heart,
  Home,
  Landmark,
  MapPin,
  Mountain,
  Scale,
  Shield,
  Sparkles,
  Star,
  Store,
  Trash2,
  Users,
  UserX,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  computeMonthLedgerSummary,
  countUnreadFaxes,
} from '../game/advisor';
import { formatClock, minuteOfDayOf } from '../game/clock';
import {
  MATERIAL_PRODUCER_THEME,
  THEMES,
  TICKS_PER_DAY,
  VILLAGE_JOIN_MIN_REPUTATION,
  VILLAGE_JOIN_REQUIRED_DAYS,
} from '../game/constants';
import { ageYears } from '../game/citizens';
import { getBankCubeAskPrice } from '../game/bank';
import { getGrossPayrollBase } from '../game/decrees';
import { getHousingQueue } from '../game/housingOffice';
import { getActiveCVs } from '../game/laborOffice';
import {
  getEntertainmentBreakdown,
  getHouseCapacity,
} from '../game/people';
import {
  getCubePurchasePrice,
  getManhattanDistanceToPalace,
  getSeaFishOutput,
  isAdjacentToOwned,
  isPurchasableNeutralCube,
  makeSlotKey,
} from '../game/production';
import {
  getNextPrayer,
  getPrayerTimesForDay,
  PRAYER_NAMES_AR,
} from '../game/prayer';
import { STRINGS } from '../game/strings';
import {
  computeTaxMoodDelta,
  projectTaxPolicyMonthlyImpact,
  TAX_POLICY_MAX_PERCENT,
  TAX_POLICY_MIN_PERCENT,
  TAX_POLICY_STEP,
} from '../game/taxPolicy';
import type {
  Cube,
  GameState,
  ShortageReason,
  SlotIndex,
  StaffingStatus,
  TaxPolicyMode,
  ThemeId,
  TradedResourceKey,
} from '../game/types';
import type { AdvisorTab } from './AdvisorOverlay';
import { BoursePanel } from './BoursePanel';
import { CitizenCard, type CitizenInfo } from './CitizenCard';
import { MaterialRequirementsCard } from './MaterialRequirementsCard';
import type { PalaceOfficeTab } from './PalaceOfficesOverlay';
import { ThemeIcon } from './ResourceIcon';

interface InspectorProps {
  state: GameState;
  selectedCube: Cube | null;
  selectedCitizen: CitizenInfo | null;
  isFollowingCitizen: boolean;
  kingdomOpen: boolean;
  staffing: StaffingStatus;
  activeTab: 'info' | 'bourse';
  activeBuildTheme?: ThemeId | null;
  inspectedShortTheme?: ThemeId | null;
  onChangeTab: (tab: 'info' | 'bourse') => void;
  onClose: () => void;
  onToggleFollowCitizen: () => void;
  onBuyCube: (cubeId: number) => void;
  onDemolishTheme: (cubeId: number, slot: SlotIndex) => void;
  onFixHint?: (themeId: ThemeId) => void;
  onBuyMaterials?: (items: Partial<Record<TradedResourceKey, number>>) => void;
  onBuildProducer?: (resource: TradedResourceKey) => void;
  onOpenOffice?: (tab: PalaceOfficeTab) => void;
  onOpenBank?: () => void;
  onOpenAdvisor?: (tab?: AdvisorTab) => void;
  onSetTaxPolicy?: (mode: TaxPolicyMode, percent: number) => void;
  onBuybackCube?: (cubeId: number) => void;
  onResolveLandRequest?: (requestId: string, approve: boolean) => void;
  isWorldBourse?: boolean;
  worldBourseDay?: number | null;
  worldBourseUsedToday?: Partial<Record<TradedResourceKey, number>>;
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
  gameState?: GameState;
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
  gameState,
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
  const isCommercialVenue =
    themeId === 'shop' ||
    themeId === 'restaurant' ||
    themeId === 'cafe' ||
    themeId === 'hotel';

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

        {isCommercialVenue && (
          <div className="font-bold text-[#4F3F2B]">
            الدخل من مشتريات المواطنين
          </div>
        )}

        {themeId === 'hotel' && (
          <div className="text-[11px] text-[#6F5C43] mt-0.5">
            نظام النزلاء الكامل قادم — الدخل حالياً من إقامات المواطنين الأثرياء فقط
          </div>
        )}
      </div>

      {/* V5 Prompt 2 Element 5: Mosque prayer schedule & last recorded attendance */}
      {themeId === 'mosque' && gameState && (() => {
        const prayerTimes = getPrayerTimesForDay(gameState);
        const nextPrayer = getNextPrayer(gameState);
        const lastPrayer =
          gameState.prayerLog.length > 0
            ? gameState.prayerLog[gameState.prayerLog.length - 1]
            : null;
        return (
          <div className="pt-2 border-t border-[#EFE3C5] space-y-1.5">
            <div className="text-[11px] font-extrabold text-[#4F3F2B]">
              مواقيت الصلاة اليوم
            </div>
            <div className="grid grid-cols-5 gap-1 text-center">
              {prayerTimes.map((p) => {
                const isNext = nextPrayer.key === p.key;
                return (
                  <div
                    key={p.key}
                    className={`px-1 py-1 rounded-lg border text-[10px] leading-tight ${
                      isNext
                        ? 'bg-[#F8E7C1] border-[#C9962E] text-[#8A5F12] font-extrabold'
                        : 'bg-[#F7EED8] border-[#E7D8B4] text-[#4F3F2B] font-bold'
                    }`}
                  >
                    <div>{p.nameAr}</div>
                    <div className="tabular-nums-latin mt-0.5">
                      {formatClock(p.minute)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-[11px] font-bold text-[#14524A] pt-1">
              {lastPrayer ? (
                <span className="tabular-nums-latin">
                  آخر صلاة: {PRAYER_NAMES_AR[lastPrayer.key]} — حضر{' '}
                  {lastPrayer.attendance}
                </span>
              ) : (
                <span className="text-[#7C684C]">لا صلوات مسجلة بعد</span>
              )}
            </div>
          </div>
        );
      })()}

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

      {/* Demolish button (hidden for non-demolishable landmarks and private property) */}
      {!def.nonDemolishable && typeof cube.privateOwnerId !== 'number' && (
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
  activeBuildTheme = null,
  inspectedShortTheme = null,
  onChangeTab,
  onClose,
  onToggleFollowCitizen,
  onBuyCube,
  onDemolishTheme,
  onFixHint,
  onBuyMaterials,
  onBuildProducer,
  onOpenOffice,
  onOpenBank,
  onOpenAdvisor,
  onSetTaxPolicy,
  onBuybackCube,
  onResolveLandRequest,
  isWorldBourse,
  worldBourseDay,
  worldBourseUsedToday,
  onTrade,
}: InspectorProps) {
  const [draftTaxMode, setDraftTaxMode] = useState<TaxPolicyMode>(
    state.taxPolicy.mode
  );
  const [draftTaxPercent, setDraftTaxPercent] = useState<number>(
    state.taxPolicy.percent
  );

  useEffect(() => {
    setDraftTaxMode(state.taxPolicy.mode);
    setDraftTaxPercent(state.taxPolicy.percent);
  }, [state.taxPolicy.mode, state.taxPolicy.percent]);

  // Memoized office chip counts (H7: skipped when palace is not open, never recomputed on unrelated ticks)
  const isPalaceSelected = selectedCube?.themeId === 'palace';
  const officeCounts = useMemo(() => {
    if (!isPalaceSelected) {
      return {
        cvs: 0,
        housingQueue: 0,
        marriagesThisMonth: 0,
        policeTotal: 0,
      };
    }
    const cvs = getActiveCVs(state.citizens, state.totalMonths).length;
    const housingQueue = getHousingQueue(
      state.citizens,
      state.totalMonths
    ).length;
    let marriagesThisMonth = 0;
    for (const r of state.policeRecords) {
      if (r.kind === 'marriage' && r.month === state.totalMonths) {
        marriagesThisMonth += 1;
      }
    }
    return {
      cvs,
      housingQueue,
      marriagesThisMonth,
      policeTotal: state.policeRecords.length,
    };
  }, [isPalaceSelected, state.citizens, state.totalMonths, state.policeRecords]);

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

    if (cube.owner === 'bank') {
      const askPrice = getBankCubeAskPrice(state.cubes, cube, state.totalMonths);
      const plainPrice = getCubePurchasePrice(state.cubes, cube);
      const seizedMonth = cube.bankSeizedMonth ?? state.totalMonths;
      const held = Math.max(0, state.totalMonths - seizedMonth);

      return (
        <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#A0AEC0] space-y-2.5">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#2D3748]">
              <Landmark className="w-4 h-4 text-[#718096] shrink-0" />
              <span>أرض لدى بنك الشعب</span>
            </div>
            <span className="px-2 py-0.5 rounded-md bg-[#EDF2F7] text-[10px] font-extrabold text-[#4A5568]">
              محجوزة ({held} شهر)
            </span>
          </div>

          <p className="text-[11px] text-[#4A5568] leading-relaxed">
            تم حجز هذه الأرض لتعثر سداد تمويل البنك الشرعي. يتناقص سعر الاسترداد تدريجياً على مدار 12 شهراً حتى السعر الأساسي.
          </p>

          <div className="p-2.5 rounded-lg bg-[#F7FAFC] border border-[#E2E8F0] space-y-1 text-xs">
            <div className="flex items-center justify-between font-bold">
              <span className="text-[#718096]">سعر الاسترداد الحالي:</span>
              <span className="text-sm font-extrabold text-[#2B6CB0] tabular-nums-latin">
                {askPrice} ذهب
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#718096]">
              <span>السعر الأساسي للأرض:</span>
              <span className="tabular-nums-latin">{plainPrice} ذهب</span>
            </div>
          </div>

          <button
            type="button"
            disabled={state.gold < askPrice}
            onClick={() => onBuybackCube?.(cube.id)}
            className="w-full py-2 px-3 rounded-xl bg-[#2B6CB0] hover:bg-[#2C5282] disabled:opacity-45 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors"
          >
            <Coins className="w-3.5 h-3.5 text-[#F6E05E]" />
            <span>استرداد الأرض ({askPrice} ذهب)</span>
          </button>
          {state.gold < askPrice && (
            <p className="text-[11px] font-bold text-[#A83629] text-center">
              {STRINGS.inspector.notEnoughGold}
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

  const renderPalacePanel = () => {
    // H4 Shared selector: exact same month window summary as AdvisorOverlay (موجز المملكة)
    const { monthStart, monthIn, monthOut, monthNet } =
      computeMonthLedgerSummary(state.ledger, state.day);
    const unreadFaxes = countUnreadFaxes(state.officeFaxes);
    const avgCitizenWealth = Math.floor(
      state.citizenWealth / Math.max(1, state.population)
    );
    const draftPolicy = {
      mode: draftTaxMode,
      percent: draftTaxMode === 'none' ? 0 : draftTaxPercent,
    };
    const grossPayrollBase = getGrossPayrollBase({
      lastPayroll: state.lastPayroll,
      cubes: state.cubes,
      population: state.population,
      privateAds: state.privateAds,
    });
    const previewTaxImpact = projectTaxPolicyMonthlyImpact(
      draftPolicy,
      grossPayrollBase
    );
    const previewMoodDelta = computeTaxMoodDelta(
      draftPolicy,
      state.citizenWealth,
      state.population
    );
    const taxDirty =
      draftPolicy.mode !== state.taxPolicy.mode ||
      draftPolicy.percent !== state.taxPolicy.percent;
    const recentLedger = state.ledger.slice(-8).reverse();
    const inflationTone =
      state.inflationIndex < 110
        ? 'bg-[#E3F3E6] border-[#9CD0A7] text-[#2D6E3B]'
        : state.inflationIndex <= 130
          ? 'bg-[#F8E7C1] border-[#E2BA64] text-[#8A5F12]'
          : 'bg-[#FBE2DF] border-[#E5ABA3] text-[#A83629]';

    return (
      <div className="space-y-2.5">
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
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#EFE3C5]">
              <span className="text-[#6F5C43] font-bold shrink-0">التوقيت</span>
              <span className="font-extrabold text-[#14524A] tabular-nums-latin text-left">
                {formatClock(minuteOfDayOf(state))} — الشروق 06:00 — الغروب 18:00
              </span>
            </div>
          </div>

          {/* V5 Prompt 2 Element 5: Today's 5 prayer times (read-only) */}
          {(() => {
            const prayerTimes = getPrayerTimesForDay(state);
            const nextPrayer = getNextPrayer(state);
            return (
              <div className="pt-2 border-t border-[#EFE3C5] space-y-1.5">
                <div className="text-[11px] font-extrabold text-[#4F3F2B]">
                  مواقيت الصلاة اليوم
                </div>
                <div className="grid grid-cols-5 gap-1 text-center">
                  {prayerTimes.map((p) => {
                    const isNext = nextPrayer.key === p.key;
                    return (
                      <div
                        key={p.key}
                        className={`px-1 py-1 rounded-lg border text-[10px] leading-tight ${
                          isNext
                            ? 'bg-[#F8E7C1] border-[#C9962E] text-[#8A5F12] font-extrabold'
                            : 'bg-[#F7EED8] border-[#E7D8B4] text-[#4F3F2B] font-bold'
                        }`}
                      >
                        <div>{p.nameAr}</div>
                        <div className="tabular-nums-latin mt-0.5">
                          {formatClock(p.minute)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <p className="text-[11px] font-bold text-[#8A5F12] pt-1.5 border-t border-[#EFE3C5]">
            {STRINGS.inspector.palaceNonDemolishable}
          </p>

          {/* Element 7.1: دواوين المملكة — compact 4-chip office row */}
          {onOpenOffice && (
            <div className="pt-2 border-t border-[#EFE3C5] space-y-1.5">
              <div className="text-[11px] font-extrabold text-[#4F3F2B]">
                دواوين المملكة
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpenOffice('labor')}
                  className="flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg bg-[#F5ECD4] hover:bg-[#ECDDB8] border border-[#DFC996] text-[11px] font-extrabold text-[#2B2118] transition-colors"
                >
                  <span className="flex items-center gap-1 min-w-0 truncate">
                    <Briefcase className="w-3.5 h-3.5 text-[#14524A] shrink-0" />
                    <span>العمل</span>
                  </span>
                  <span className="text-[#14524A] tabular-nums-latin">
                    {officeCounts.cvs}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenOffice('housing')}
                  className="flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg bg-[#F5ECD4] hover:bg-[#ECDDB8] border border-[#DFC996] text-[11px] font-extrabold text-[#2B2118] transition-colors"
                >
                  <span className="flex items-center gap-1 min-w-0 truncate">
                    <Home className="w-3.5 h-3.5 text-[#14524A] shrink-0" />
                    <span>الإسكان</span>
                  </span>
                  <span className="text-[#14524A] tabular-nums-latin">
                    {officeCounts.housingQueue}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenOffice('marriage')}
                  className="flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg bg-[#F5ECD4] hover:bg-[#ECDDB8] border border-[#DFC996] text-[11px] font-extrabold text-[#2B2118] transition-colors"
                >
                  <span className="flex items-center gap-1 min-w-0 truncate">
                    <Heart className="w-3.5 h-3.5 text-[#8A5F12] shrink-0" />
                    <span>الزواج</span>
                  </span>
                  <span className="text-[#8A5F12] tabular-nums-latin">
                    {officeCounts.marriagesThisMonth}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenOffice('police')}
                  className="flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg bg-[#F5ECD4] hover:bg-[#ECDDB8] border border-[#DFC996] text-[11px] font-extrabold text-[#2B2118] transition-colors"
                >
                  <span className="flex items-center gap-1 min-w-0 truncate">
                    <Shield className="w-3.5 h-3.5 text-[#14524A] shrink-0" />
                    <span>الشرطة</span>
                  </span>
                  <span className="text-[#14524A] tabular-nums-latin">
                    {officeCounts.policeTotal}
                  </span>
                </button>
                {onOpenBank && (
                  <button
                    type="button"
                    onClick={onOpenBank}
                    className="col-span-2 flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg bg-[#FAF2DC] hover:bg-[#F2E5C4] border border-[#C9962E] text-[11px] font-extrabold text-[#2B2118] transition-colors"
                  >
                    <span className="flex items-center gap-1.5 min-w-0 truncate">
                      <Landmark className="w-3.5 h-3.5 text-[#8A5F12] shrink-0" />
                      <span>البنك الشرعي وبنك الشعب</span>
                    </span>
                    <span className="text-[#8A5F12] text-[10px] font-extrabold">
                      {state.bankLoans.some((l) => l.status === 'active') ? 'تمويل قائم' : 'جاهز'}
                    </span>
                  </button>
                )}
                {onOpenAdvisor && (
                  <button
                    type="button"
                    onClick={() => onOpenAdvisor()}
                    className="col-span-2 flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg bg-[#14524A] hover:bg-[#1B685E] text-white text-[11px] font-extrabold transition-colors"
                  >
                    <span className="flex items-center gap-1.5 min-w-0 truncate">
                      <Sparkles className="w-3.5 h-3.5 text-[#F2CA6B] shrink-0" />
                      <span>المستشار الملكي وسجل القرارات</span>
                    </span>
                    <span className="px-1.5 py-0.2 rounded bg-[#C9962E] text-[#2B2118] text-[10px] font-black tabular-nums-latin">
                      {unreadFaxes > 0 ? `${unreadFaxes} جديد` : `${state.decrees.length} قرار`}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Prompt 6 Element 2.5: Salary Tax & Grant Policy (السياسة المالية للمرتبات) */}
        {onSetTaxPolicy && (
          <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#C9962E] space-y-2.5">
            <div className="flex items-center justify-between gap-2 border-b border-[#EFE3C5] pb-1.5">
              <div className="flex items-center gap-1.5 text-[#2B2118]">
                <Scale className="w-4 h-4 text-[#14524A] shrink-0" />
                <h4 className="text-xs font-extrabold">السياسة المالية للمرتبات</h4>
              </div>
              <span className="text-[10px] font-extrabold text-[#8A5F12] tabular-nums-latin">
                {state.taxPolicy.mode === 'take'
                  ? `ضريبة ${state.taxPolicy.percent}%`
                  : state.taxPolicy.mode === 'grant'
                    ? `منحة ${state.taxPolicy.percent}%`
                    : 'محايد 0%'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  { id: 'none' as const, label: 'بلا ضريبة' },
                  { id: 'grant' as const, label: 'منحة ملكية' },
                  { id: 'take' as const, label: 'ضريبة' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setDraftTaxMode(opt.id);
                    if (opt.id === 'none') {
                      setDraftTaxPercent(0);
                    } else if (draftTaxPercent === 0) {
                      setDraftTaxPercent(10);
                    }
                  }}
                  className={`py-1.5 px-1.5 rounded-lg text-[11px] font-extrabold transition-colors ${
                    draftTaxMode === opt.id
                      ? 'bg-[#14524A] text-white'
                      : 'bg-[#F5ECD4] hover:bg-[#ECDDB8] border border-[#DFC996] text-[#2B2118]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {draftTaxMode !== 'none' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-bold text-[#4F3F2B]">
                  <span>النسبة المئوية</span>
                  <span className="font-extrabold text-[#14524A] tabular-nums-latin">
                    {draftTaxPercent}%
                  </span>
                </div>
                <input
                  type="range"
                  min={TAX_POLICY_MIN_PERCENT}
                  max={TAX_POLICY_MAX_PERCENT}
                  step={TAX_POLICY_STEP}
                  value={draftTaxPercent}
                  onChange={(e) => setDraftTaxPercent(Number(e.target.value))}
                  className="w-full accent-[#14524A]"
                />
                <div className="flex items-center justify-between text-[10px] font-bold text-[#7C684C] tabular-nums-latin">
                  <span>0%</span>
                  <span>25%</span>
                  <span>50%</span>
                </div>
              </div>
            )}

            <div className="p-2 rounded-lg bg-[#F7EED8] border border-[#E7D8B4] space-y-1 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-[#6F5C43] font-bold">الأثر المتوقع على الخزنة</span>
                <span
                  className={`font-extrabold tabular-nums-latin ${
                    previewTaxImpact > 0
                      ? 'text-[#2D6E3B]'
                      : previewTaxImpact < 0
                        ? 'text-[#A83629]'
                        : 'text-[#4F3F2B]'
                  }`}
                >
                  {previewTaxImpact > 0
                    ? `+${previewTaxImpact}`
                    : previewTaxImpact}{' '}
                  ذهب/شهر
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#6F5C43] font-bold">أثر رضا الشعب</span>
                <span
                  className={`font-extrabold tabular-nums-latin ${
                    previewMoodDelta > 0
                      ? 'text-[#2D6E3B]'
                      : previewMoodDelta < 0
                        ? 'text-[#A83629]'
                        : 'text-[#4F3F2B]'
                  }`}
                >
                  {previewMoodDelta > 0
                    ? `+${previewMoodDelta}`
                    : previewMoodDelta}
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={!taxDirty}
              onClick={() =>
                onSetTaxPolicy(draftPolicy.mode, draftPolicy.percent)
              }
              className="w-full py-1.5 px-3 rounded-lg bg-[#C9962E] hover:bg-[#D8A73F] disabled:opacity-45 text-[#2B2118] text-xs font-extrabold transition-colors"
            >
              اعتماد السياسة المالية
            </button>
          </div>
        )}

        {/* Element 5.2: Private Land Purchase Requests (طلبات شراء أراضٍ) */}
        <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#C9962E] space-y-2">
          <div className="flex items-center justify-between gap-2 border-b border-[#EFE3C5] pb-1.5">
            <div className="flex items-center gap-1.5 text-[#2B2118]">
              <MapPin className="w-4 h-4 text-[#C9962E] shrink-0" />
              <h4 className="text-xs font-extrabold">طلبات شراء أراضٍ</h4>
            </div>
            <span className="px-1.5 py-0.5 rounded-md bg-[#F8E7C1] border border-[#E2BA64] text-[10px] font-extrabold text-[#8A5F12] tabular-nums-latin">
              {state.landRequests.length}
            </span>
          </div>

          {state.landRequests.length === 0 ? (
            <p className="text-[11px] text-[#8A7759]">
              لا توجد طلبات شراء أراضٍ معلّقة حالياً.
            </p>
          ) : (
            <div className="space-y-2">
              {state.landRequests.map((req) => {
                const applicant = state.citizens.find(
                  (c) => c.id === req.citizenId
                );
                const targetCube = state.cubes[req.cubeId];
                const dist = targetCube
                  ? getManhattanDistanceToPalace(state.cubes, targetCube)
                  : 0;
                const applicantAge = applicant
                  ? ageYears(applicant, state.totalMonths)
                  : 0;
                const jobLabel = applicant?.jobThemeId
                  ? STRINGS.themes[applicant.jobThemeId].name
                  : 'باحث عن عمل';
                return (
                  <div
                    key={req.id}
                    className="p-2.5 rounded-lg bg-[#F7EED8] border border-[#DFC996] space-y-1.5 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-extrabold text-[#2B2118] truncate">
                        {applicant?.name ?? 'مواطن'}{' '}
                        <span className="font-bold text-[#6F5C43] tabular-nums-latin">
                          ({applicantAge} سنة)
                        </span>
                      </span>
                      <span className="font-extrabold text-[#8A5F12] shrink-0 tabular-nums-latin">
                        {req.price} ذهب
                      </span>
                    </div>
                    <div className="text-[10px] font-bold text-[#4F3F2B] space-y-0.5">
                      <div>
                        العمل: {jobLabel} · الثروة:{' '}
                        <span className="tabular-nums-latin">
                          {applicant?.wealth ?? 0} ذهب
                        </span>{' '}
                        · الذكاء:{' '}
                        <span className="tabular-nums-latin">
                          {applicant?.attrs.intelligence ?? 0}
                        </span>
                      </div>
                      <div>
                        المشروع:{' '}
                        <span className="text-[#14524A]">
                          {STRINGS.themes[req.businessThemeId].name}
                        </span>{' '}
                        · البُعد عن القصر:{' '}
                        <span className="tabular-nums-latin">{dist}</span>
                      </div>
                      <div className="text-[#7C684C]">
                        إن تعذّر البناء 3 أشهر تعود الأرض للتاج.
                      </div>
                    </div>
                    {onResolveLandRequest && (
                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => onResolveLandRequest(req.id, true)}
                          className="py-1.5 px-2 rounded-lg bg-[#14524A] hover:bg-[#1B685E] text-white text-[11px] font-extrabold transition-colors"
                        >
                          موافقة
                        </button>
                        <button
                          type="button"
                          onClick={() => onResolveLandRequest(req.id, false)}
                          className="py-1.5 px-2 rounded-lg border border-[#DFB9B3] bg-[#FBF0EE] hover:bg-[#F5DDD9] text-[#A83629] text-[11px] font-extrabold transition-colors"
                        >
                          رفض
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Element 4.3: Kingdom Treasury Section (خزنة المملكة) */}
        <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2.5">
          <div className="flex items-center justify-between gap-2 border-b border-[#EFE3C5] pb-2">
            <div className="flex items-center gap-1.5 text-[#2B2118]">
              <Landmark className="w-4 h-4 text-[#14524A] shrink-0" />
              <h4 className="text-xs font-extrabold">خزنة المملكة</h4>
            </div>
            <span className="text-[10px] font-bold text-[#6F5C43] tabular-nums-latin">
              يوم {monthStart}–{state.day}
            </span>
          </div>

          {/* Current-month IN / OUT / NET */}
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className="p-1.5 rounded-lg bg-[#F5ECD4] border border-[#E6D6B0]">
              <div className="text-[10px] font-bold text-[#6F5C43]">الوارد</div>
              <div className="text-xs font-extrabold text-[#2D6E3B] tabular-nums-latin">
                +{monthIn}
              </div>
            </div>
            <div className="p-1.5 rounded-lg bg-[#F5ECD4] border border-[#E6D6B0]">
              <div className="text-[10px] font-bold text-[#6F5C43]">المنصرف</div>
              <div className="text-xs font-extrabold text-[#A83629] tabular-nums-latin">
                -{monthOut}
              </div>
            </div>
            <div className="p-1.5 rounded-lg bg-[#F5ECD4] border border-[#E6D6B0]">
              <div className="text-[10px] font-bold text-[#6F5C43]">الصافي</div>
              <div
                className={`text-xs font-extrabold tabular-nums-latin ${
                  monthNet >= 0 ? 'text-[#2D6E3B]' : 'text-[#A83629]'
                }`}
              >
                {monthNet >= 0 ? `+${monthNet}` : monthNet}
              </div>
            </div>
          </div>

          {/* Last payroll, citizen wealth, inflation index */}
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#6F5C43] font-bold">آخر رواتب</span>
              {state.lastPayroll ? (
                <span className="font-extrabold text-[#2B2118] tabular-nums-latin">
                  {state.lastPayroll.workers} عامل · {state.lastPayroll.paid}/
                  {state.lastPayroll.due} ذهب
                </span>
              ) : (
                <span className="font-bold text-[#8A7759]">
                  لا توجد رواتب بعد
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[#6F5C43] font-bold">
                متوسط ثروة المواطن
              </span>
              <span className="font-extrabold text-[#2B2118] tabular-nums-latin">
                {avgCitizenWealth} ذهب
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[#6F5C43] font-bold">
                إيراد غذاء وترفيه المواطنين
              </span>
              <span className="font-extrabold text-[#2D6E3B] tabular-nums-latin">
                {state.lastMonthStats.foodRevenue +
                  state.lastMonthStats.leisureRevenue}{' '}
                ذهب
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[#6F5C43] font-bold">
                ضرائب الأعمال الخاصة
              </span>
              <span className="font-extrabold text-[#2D6E3B] tabular-nums-latin">
                {state.lastMonthStats.businessTax} ذهب
              </span>
            </div>

            {(state.lastMonthStats.taxWithheld > 0 ||
              state.lastMonthStats.grantsPaid > 0) && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#6F5C43] font-bold">
                  {state.lastMonthStats.taxWithheld > 0
                    ? 'ضرائب المرتبات (الشهر الماضي)'
                    : 'منح المرتبات (الشهر الماضي)'}
                </span>
                <span
                  className={`font-extrabold tabular-nums-latin ${
                    state.lastMonthStats.taxWithheld > 0
                      ? 'text-[#2D6E3B]'
                      : 'text-[#A83629]'
                  }`}
                >
                  {state.lastMonthStats.taxWithheld > 0
                    ? `+${state.lastMonthStats.taxWithheld}`
                    : `-${state.lastMonthStats.grantsPaid}`}{' '}
                  ذهب
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <span className="text-[#6F5C43] font-bold">مؤشر الغلاء</span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-extrabold tabular-nums-latin ${inflationTone}`}
              >
                <Gauge className="w-3 h-3" />
                <span>{state.inflationIndex}</span>
              </span>
            </div>
          </div>

          {/* Red arrears warning when arrears > 0 */}
          {state.arrears > 0 && (
            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-[#FBE2DF] border border-[#E5ABA3] text-[11px] font-extrabold text-[#8E2A1F]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                متأخرات رواتب: {state.arrears} ذهب (سقف الرضا 50% حتى السداد)
              </span>
            </div>
          )}

          {/* Last 8 ledger rows */}
          <div className="pt-2 border-t border-[#EFE3C5] space-y-1">
            <div className="text-[11px] font-extrabold text-[#4F3F2B]">
              سجل الخزنة (آخر الحركات)
            </div>
            {recentLedger.length === 0 ? (
              <p className="text-[11px] text-[#8A7759]">
                لا توجد حركات مسجلة بعد.
              </p>
            ) : (
              <div className="space-y-1">
                {recentLedger.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-2 py-1 px-2 rounded-lg bg-[#F7EED8] text-[11px]"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[10px] font-bold text-[#7C684C] shrink-0 tabular-nums-latin">
                        {entry.day === 0 ? 'تأسيس' : `ي${entry.day}`}
                      </span>
                      <span className="font-bold text-[#2B2118] truncate">
                        {entry.labelAr}
                      </span>
                    </div>
                    <span
                      className={`font-extrabold shrink-0 tabular-nums-latin ${
                        entry.amount > 0
                          ? 'text-[#2D6E3B]'
                          : entry.amount < 0
                            ? 'text-[#A83629]'
                            : 'text-[#6F5C43]'
                      }`}
                    >
                      {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

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
        <BoursePanel
          state={state}
          compact
          isWorldBourse={isWorldBourse}
          worldBourseDay={worldBourseDay}
          worldBourseUsedToday={worldBourseUsedToday}
          onTrade={onTrade}
        />
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
          state={state}
          staffedSlots={staffing.staffedSlots}
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
          ) : typeof selectedCube.privateOwnerId === 'number' ? (
            (() => {
              const owner = state.citizens.find(
                (c) => c.id === selectedCube.privateOwnerId
              );
              const intendedName = selectedCube.privateIntendedTheme
                ? STRINGS.themes[selectedCube.privateIntendedTheme].name
                : 'مشروع خاص';
              return (
                <div className="space-y-2.5">
                  {/* Element 5.2 & H5: Private property banner — shows owner name, never owner wealth */}
                  <div className="p-2.5 rounded-xl bg-[#F8E7C1] border border-[#C9962E] space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-extrabold text-[#6D4707]">
                        <Landmark className="w-3.5 h-3.5 shrink-0" />
                        <span>ملكية خاصة</span>
                      </span>
                      <span className="text-[11px] font-extrabold text-[#2B2118] truncate">
                        المالك: {owner?.name ?? 'مواطن'}
                      </span>
                    </div>
                    {!selectedCube.themeId && (
                      <div className="text-[11px] font-bold text-[#4F3F2B]">
                        المشروع المخطط: {intendedName} — يبدأ البناء في الشهر القادم
                        {(selectedCube.privateBuildRetries ?? 0) > 0 && (
                          <span className="text-[#8A5F12] tabular-nums-latin">
                            {' '}
                            (محاولة {selectedCube.privateBuildRetries}/3)
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {selectedCube.themeId && (
                    <SlotCard
                      cube={selectedCube}
                      allCubes={state.cubes}
                      gameState={state}
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
                  )}
                </div>
              );
            })()
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
              {state.level >= 2 && (activeBuildTheme || inspectedShortTheme) && (
                <div className="pt-2 border-t border-[#EFE3C5] space-y-1.5">
                  <div className="text-[11px] font-extrabold text-[#2B2118]">
                    متطلبات بناء{' '}
                    {
                      STRINGS.themes[
                        (activeBuildTheme ?? inspectedShortTheme) as ThemeId
                      ].name
                    }
                  </div>
                  <MaterialRequirementsCard
                    themeId={
                      (activeBuildTheme ?? inspectedShortTheme) as ThemeId
                    }
                    level={state.level}
                    warehouse={state.warehouse}
                    gold={state.gold}
                    prices={state.prices}
                    cubes={state.cubes}
                    showActions
                    onBuyMaterials={onBuyMaterials}
                    onBuildProducer={onBuildProducer}
                  />
                </div>
              )}
            </div>
          ) : selectedCube.themeId === 'palace' ? (
            renderPalacePanel()
          ) : THEMES[selectedCube.themeId].footprint === 'full' ? (
            <SlotCard
              cube={selectedCube}
              allCubes={state.cubes}
              gameState={state}
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
                gameState={state}
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
                  gameState={state}
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
                <div className="p-2.5 rounded-xl bg-[#F5EAD0] border border-dashed border-[#D3BE8F] space-y-2 text-[11px] font-bold text-[#6F5C43]">
                  <div>{STRINGS.inspector.emptyHalf}</div>
                  {state.level >= 2 &&
                    (activeBuildTheme || inspectedShortTheme) && (
                      <MaterialRequirementsCard
                        themeId={
                          (activeBuildTheme ?? inspectedShortTheme) as ThemeId
                        }
                        level={state.level}
                        warehouse={state.warehouse}
                        gold={state.gold}
                        prices={state.prices}
                        cubes={state.cubes}
                        showActions
                        onBuyMaterials={onBuyMaterials}
                        onBuildProducer={onBuildProducer}
                      />
                    )}
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
