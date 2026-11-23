import {
  AlertTriangle,
  Check,
  Clock,
  Coins,
  MapPin,
  Star,
  Store,
  Trash2,
  Users,
  UserX,
  X,
} from 'lucide-react';
import {
  CUBE_PURCHASE_COST,
  THEMES,
  TICKS_PER_DAY,
} from '../game/constants';
import {
  getEntertainmentBreakdown,
  getHouseCapacity,
} from '../game/people';
import {
  getSeaFishOutput,
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
import { Objectives } from './Objectives';
import { ThemeIcon } from './ResourceIcon';

interface InspectorProps {
  state: GameState;
  selectedCube: Cube | null;
  staffing: StaffingStatus;
  activeTab: 'info' | 'bourse';
  onChangeTab: (tab: 'info' | 'bourse') => void;
  onClearSelection: () => void;
  onBuyCube: (cubeId: number) => void;
  onDemolishTheme: (cubeId: number, slot: SlotIndex) => void;
  onTrade: (
    resource: TradedResourceKey,
    side: 'buy' | 'sell',
    quantity: number | 'max'
  ) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function getBarColorClass(value: number): string {
  if (value >= 60) return 'bg-[#3E9B4F]';
  if (value >= 35) return 'bg-[#E8A33D]';
  return 'bg-[#C44536]';
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

        {themeId === 'shop' && def.shopGoldPerCycle && (
          <div>{STRINGS.inspector.shopOutputPerCycle(def.shopGoldPerCycle)}</div>
        )}
      </div>

      {/* Unstaffed warning */}
      {unstaffed && (
        <div className="flex items-start gap-1.5 p-2 rounded-lg bg-[#F8E7C1] border border-[#E2BA64] text-[11px] font-bold text-[#6D4707]">
          <UserX className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{STRINGS.inspector.unstaffedDetail}</span>
        </div>
      )}

      {/* Missing input shortage diagnostic */}
      {!unstaffed && shortage && (
        <div className="flex items-start gap-1.5 p-2 rounded-lg bg-[#FBE2DF] border border-[#E5ABA3] text-[11px] font-bold text-[#8E2A1F]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{STRINGS.inspector.shortages[shortage]}</span>
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

      {/* Demolish button */}
      <button
        type="button"
        onClick={onDemolish}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl border border-[#DFB9B3] bg-[#FBF0EE] hover:bg-[#F5DDD9] text-[#A83629] text-xs font-extrabold transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>{STRINGS.inspector.demolish}</span>
      </button>
    </div>
  );
}

export function Inspector({
  state,
  selectedCube,
  staffing,
  activeTab,
  onChangeTab,
  onClearSelection,
  onBuyCube,
  onDemolishTheme,
  onTrade,
  mobileOpen,
  onCloseMobile,
}: InspectorProps) {
  const capacity = getHouseCapacity(state.cubes);
  const ent = getEntertainmentBreakdown(state.cubes, state.warehouse);
  const secondsLeftInDay = Math.max(0, TICKS_PER_DAY - state.tickInDay);

  const renderContent = () => (
    <div className="flex-1 overflow-y-auto parchment-scroll space-y-3.5 pl-0.5">
      {/* Level 2 switchable tab bar (Kingdom Info vs Bourse) */}
      {state.level >= 2 && (
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#EFE2C2] border border-[#E3D3AC]">
          <button
            type="button"
            onClick={() => onChangeTab('info')}
            className={`py-1.5 text-xs font-extrabold rounded-lg transition-colors ${
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
            className={`py-1.5 text-xs font-extrabold rounded-lg transition-colors flex items-center justify-center gap-1 ${
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

      {/* Bourse Tab Content */}
      {state.level >= 2 && activeTab === 'bourse' ? (
        <BoursePanel state={state} compact onTrade={onTrade} />
      ) : selectedCube ? (
        /* Selected Cube View */
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
              onClick={onClearSelection}
              className="text-[11px] font-bold text-[#14524A] hover:underline flex items-center gap-0.5"
            >
              <X className="w-3 h-3" />
              <span>{STRINGS.inspector.closeSelection}</span>
            </button>
          </div>

          {selectedCube.owner === 'neutral' ? (
            <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2.5">
              <div className="text-sm font-extrabold text-[#2B2118]">
                {STRINGS.inspector.neutralSand}
              </div>
              {isPurchasableNeutralCube(state.cubes, selectedCube) ? (
                <>
                  <p className="text-xs text-[#6F5C43] leading-relaxed">
                    {STRINGS.inspector.neutralAdjacentHint}
                  </p>
                  <button
                    type="button"
                    disabled={state.gold < CUBE_PURCHASE_COST}
                    onClick={() => onBuyCube(selectedCube.id)}
                    className="w-full py-2 px-3 rounded-xl bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-45 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Coins className="w-3.5 h-3.5 text-[#F2CA6B]" />
                    <span>
                      {STRINGS.inspector.buyCubeAction(CUBE_PURCHASE_COST)}
                    </span>
                  </button>
                  {state.gold < CUBE_PURCHASE_COST && (
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
          ) : !selectedCube.themeId ? (
            <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-1.5">
              <div className="text-sm font-extrabold text-[#2B2118]">
                {STRINGS.inspector.ownedSand}
              </div>
              <p className="text-xs text-[#6F5C43] leading-relaxed">
                {STRINGS.inspector.ownedSandHint}
              </p>
            </div>
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
                />
              ) : (
                <div className="p-2.5 rounded-xl bg-[#F5EAD0] border border-dashed border-[#D3BE8F] text-[11px] font-bold text-[#6F5C43]">
                  {STRINGS.inspector.emptyHalf}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Default Unselected View: Objectives + People Summary */
        <>
          <Objectives state={state} />

          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-[#14524A]" />
                <h3 className="text-sm font-extrabold text-[#2B2118]">
                  {STRINGS.people.summaryTitle}
                </h3>
              </div>
              <span className="text-[11px] font-bold text-[#6F5C43] tabular-nums-latin">
                {STRINGS.people.housingRatio(state.population, capacity)}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px] font-bold text-[#6F5C43]">
              <span>
                {STRINGS.people.workersRatio(
                  staffing.totalWorkersEmployed,
                  staffing.totalWorkersNeeded
                )}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-[#C9962E]" />
                <span>{STRINGS.people.dayRolloverHint(secondsLeftInDay)}</span>
              </span>
            </div>

            {state.hungerFlag && (
              <div className="p-2 rounded-xl bg-[#FBE2DF] border border-[#E5ABA3] text-[11px] font-bold text-[#8E2A1F] flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{STRINGS.people.hungerWarning}</span>
              </div>
            )}

            {/* Main Satisfaction Bar */}
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

              {/* Entertainment breakdown */}
              <div className="pt-1.5 border-t border-[#EFE3C5] space-y-1 text-[11px] text-[#6F5C43]">
                <div className="flex items-center gap-1.5">
                  <Check
                    className={`w-3 h-3 ${
                      ent.seaAdjacent ? 'text-[#3E9B4F]' : 'text-[#CBBBA0]'
                    }`}
                  />
                  <span className={ent.seaAdjacent ? 'text-[#2B2118] font-bold' : ''}>
                    {STRINGS.people.entertainmentSea}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Check
                    className={`w-3 h-3 ${
                      ent.shopExists ? 'text-[#3E9B4F]' : 'text-[#CBBBA0]'
                    }`}
                  />
                  <span className={ent.shopExists ? 'text-[#2B2118] font-bold' : ''}>
                    {STRINGS.people.entertainmentShop}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Check
                    className={`w-3 h-3 ${
                      ent.foodVariety ? 'text-[#3E9B4F]' : 'text-[#CBBBA0]'
                    }`}
                  />
                  <span className={ent.foodVariety ? 'text-[#2B2118] font-bold' : ''}>
                    {STRINGS.people.entertainmentVariety}
                  </span>
                </div>
              </div>
            </div>

            {/* Reputation summary */}
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

            {/* Growth & Level 1 safety note */}
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
        </>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop Left Panel (260px) */}
      <aside className="hidden lg:flex flex-col w-[260px] shrink-0 p-2.5 bg-[#0C332D] border-r border-[#1A5047]">
        <div className="parchment-panel flex-1 flex flex-col overflow-hidden p-3">
          {renderContent()}
        </div>
      </aside>

      {/* Mobile Slide-Up Inspector Drawer */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex items-end bg-black/45"
          onClick={onCloseMobile}
        >
          <div
            className="w-full max-h-[78vh] bg-[#FBF3DF] border-t-2 border-[#C9962E] rounded-t-2xl p-4 flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-[#E3D3AC]">
              <span className="text-sm font-extrabold text-[#2B2118]">
                {selectedCube
                  ? STRINGS.inspector.cubeTitle(selectedCube.row, selectedCube.col)
                  : STRINGS.mobile.inspectorButton}
              </span>
              <button
                type="button"
                onClick={onCloseMobile}
                className="w-8 h-8 rounded-xl bg-[#EFE2C2] text-[#2B2118] flex items-center justify-center"
                aria-label={STRINGS.modals.close}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {renderContent()}
          </div>
        </div>
      )}
    </>
  );
}
