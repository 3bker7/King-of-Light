import {
  AlertTriangle,
  Beef,
  Droplets,
  Fish,
  Plus,
  TreePine,
  UserX,
} from 'lucide-react';
import { READY_PULSE_WINDOW_SECONDS, THEMES } from '../game/constants';
import { makeSlotKey } from '../game/production';
import { STRINGS } from '../game/strings';
import type { Cube, ShortageReason, SlotIndex, ThemeId } from '../game/types';

interface CubeTileProps {
  cube: Cube;
  selected: boolean;
  canPlaceActiveTheme: boolean;
  hasActiveBuildTool: boolean;
  isPurchasableNeutral: boolean;
  staffedSlots: Set<string>;
  onClick: () => void;
}

function getProgressPercent(themeId: ThemeId | null, progress: number): number {
  if (!themeId) return 0;
  const cycle = THEMES[themeId].cycleSeconds;
  if (!cycle) return 0;
  return Math.min(100, Math.round((progress / cycle) * 100));
}

function isNearlyReady(themeId: ThemeId | null, progress: number): boolean {
  if (!themeId) return false;
  const cycle = THEMES[themeId].cycleSeconds;
  if (!cycle) return false;
  return cycle - progress <= READY_PULSE_WINDOW_SECONDS;
}

interface HalfCellProps {
  themeId: ThemeId | null;
  progress: number;
  shortage: ShortageReason;
  isStaffed: boolean;
}

function HalfCell({ themeId, progress, shortage, isStaffed }: HalfCellProps) {
  if (!themeId) {
    return <div className="w-full h-full tile-sand-owned" />;
  }

  const def = THEMES[themeId];
  const produces = def.cycleSeconds !== null;
  const pct = getProgressPercent(themeId, progress);
  const nearlyReady = produces && isStaffed && isNearlyReady(themeId, progress);
  const unstaffed = def.workers > 0 && !isStaffed;

  return (
    <div
      className={`relative w-full h-full flex flex-col items-center justify-center overflow-hidden ${
        unstaffed ? 'theme-unstaffed' : ''
      } ${nearlyReady ? 'tile-ready-pulse' : ''}`}
    >
      {themeId === 'house' && (
        <div className="w-full h-full flex flex-col tile-sand-owned p-[2px]">
          <div className="w-full h-[46%] house-roof shrink-0" />
          <div className="w-[82%] mx-auto flex-1 house-walls rounded-b-[3px] border border-[#C6AC88] flex items-center justify-center">
            <div className="w-[34%] h-[42%] rounded-[1px] bg-[#6D4C3D]/70" />
          </div>
        </div>
      )}

      {themeId === 'well' && (
        <div className="w-full h-full tile-sand-owned flex items-center justify-center p-1">
          <div className="w-[78%] aspect-square rounded-full well-stone flex items-center justify-center shadow-inner">
            <Droplets className="w-[56%] h-[56%] text-[#2E86AB]" />
          </div>
        </div>
      )}

      {themeId === 'shop' && (
        <div className="w-full h-full bg-[#F3E2C7] flex flex-col overflow-hidden">
          <div className="w-full h-[38%] shop-awning border-b border-[#9E5233]/40 shrink-0" />
          <div className="flex-1 flex items-center justify-center">
            <div className="w-[55%] h-[50%] rounded-t-[3px] bg-[#7D563B]/80 border border-[#5D3D27]/50" />
          </div>
        </div>
      )}

      {/* Unstaffed badge */}
      {unstaffed && (
        <div
          className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-[#E8A33D] text-[#2B2118] flex items-center justify-center shadow-sm"
          title={STRINGS.inspector.unstaffedBadge}
        >
          <UserX className="w-2.5 h-2.5" />
        </div>
      )}

      {/* Shortage indicator */}
      {!unstaffed && shortage && (
        <div
          className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-[#C44536] text-white flex items-center justify-center shadow-sm"
          title={STRINGS.inspector.shortages[shortage]}
        >
          <AlertTriangle className="w-2.5 h-2.5" />
        </div>
      )}

      {/* Mandatory bottom gold progress bar for producing half-theme */}
      {produces && (
        <div className="absolute bottom-0 inset-x-0 h-[3px] bg-black/30">
          <div
            className="h-full bg-[#E8B84B] transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function CubeTile({
  cube,
  selected,
  canPlaceActiveTheme,
  hasActiveBuildTool,
  isPurchasableNeutral,
  staffedSlots,
  onClick,
}: CubeTileProps) {
  const isNeutral = cube.owner === 'neutral';
  const primaryTheme = cube.themeId;
  const secondaryTheme = cube.secondThemeId;
  const isFullTheme =
    primaryTheme !== null && THEMES[primaryTheme].footprint === 'full';
  const isHalfLayout =
    primaryTheme !== null && THEMES[primaryTheme].footprint === 'half';

  const slot0Staffed = staffedSlots.has(makeSlotKey(cube.id, 0 as SlotIndex));
  const slot1Staffed = staffedSlots.has(makeSlotKey(cube.id, 1 as SlotIndex));

  const primaryDef = primaryTheme ? THEMES[primaryTheme] : null;
  const fullProduces = isFullTheme && primaryDef?.cycleSeconds !== null;
  const fullPct = isFullTheme ? getProgressPercent(primaryTheme, cube.progress) : 0;
  const fullUnstaffed =
    isFullTheme && (primaryDef?.workers ?? 0) > 0 && !slot0Staffed;
  const fullNearlyReady =
    fullProduces && slot0Staffed && isNearlyReady(primaryTheme, cube.progress);

  const hoverable =
    (hasActiveBuildTool && canPlaceActiveTheme) ||
    (!hasActiveBuildTool && (!isNeutral || isPurchasableNeutral));

  const ariaLabel = isNeutral
    ? `${STRINGS.inspector.cubeTitle(cube.row, cube.col)} — ${STRINGS.inspector.neutralSand}`
    : primaryTheme
      ? `${STRINGS.inspector.cubeTitle(cube.row, cube.col)} — ${STRINGS.themes[primaryTheme].name}${
          secondaryTheme ? ` / ${STRINGS.themes[secondaryTheme].name}` : ''
        }`
      : `${STRINGS.inspector.cubeTitle(cube.row, cube.col)} — ${STRINGS.inspector.ownedSand}`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`cube-tile w-full focus-visible:outline-2 focus-visible:outline-[#F2CA6B] ${
        hoverable ? 'cube-tile-buildable' : ''
      } ${selected ? 'cube-tile-selected' : ''} ${
        hasActiveBuildTool && canPlaceActiveTheme
          ? 'ring-2 ring-[#F2CA6B]/85'
          : ''
      } ${
        !hasActiveBuildTool && isPurchasableNeutral && !selected
          ? 'ring-1 ring-[#C9962E]/55'
          : ''
      }`}
    >
      {/* Neutral sand */}
      {isNeutral && (
        <div className="w-full h-full tile-sand-neutral flex items-center justify-center">
          {isPurchasableNeutral && (
            <Plus className="w-3 h-3 text-[#FBF3DF]/65" />
          )}
        </div>
      )}

      {/* Owned empty sand */}
      {!isNeutral && !primaryTheme && (
        <div className="w-full h-full tile-sand-owned" />
      )}

      {/* Full-cube themes */}
      {!isNeutral && isFullTheme && primaryTheme && (
        <div
          className={`relative w-full h-full flex items-center justify-center ${
            primaryTheme === 'sea'
              ? 'tile-sea'
              : primaryTheme === 'farm'
                ? 'tile-farm'
                : primaryTheme === 'forest'
                  ? 'tile-forest'
                  : 'tile-pasture'
          } ${fullUnstaffed ? 'theme-unstaffed' : ''} ${
            fullNearlyReady ? 'tile-ready-pulse' : ''
          }`}
        >
          {primaryTheme === 'sea' && (
            <Fish className="w-[46%] h-[46%] text-white/25 pointer-events-none" />
          )}

          {primaryTheme === 'forest' && (
            <div className="relative w-full h-full pointer-events-none">
              <TreePine className="w-[38%] h-[38%] text-[#1D4D2B] fill-[#2C643C] absolute top-[14%] left-[16%]" />
              <TreePine className="w-[42%] h-[42%] text-[#1A4527] fill-[#255934] absolute bottom-[18%] right-[14%]" />
              <TreePine className="w-[34%] h-[34%] text-[#215732] fill-[#317042] absolute top-[34%] left-[44%]" />
            </div>
          )}

          {primaryTheme === 'pasture' && (
            <div className="w-[82%] h-[78%] rounded-[6px] border border-dashed border-[#5B7D2B]/80 flex items-center justify-center pointer-events-none">
              <Beef className="w-[48%] h-[48%] text-[#3F5C1A]/50" />
            </div>
          )}

          {/* Unstaffed amber badge */}
          {fullUnstaffed && (
            <div
              className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[#E8A33D] text-[#2B2118] flex items-center justify-center shadow"
              title={STRINGS.inspector.unstaffedBadge}
            >
              <UserX className="w-2.5 h-2.5" />
            </div>
          )}

          {/* Missing input shortage indicator */}
          {!fullUnstaffed && cube.shortage && (
            <div
              className="absolute top-1 left-1 w-4 h-4 rounded-full bg-[#C44536] text-white flex items-center justify-center shadow"
              title={STRINGS.inspector.shortages[cube.shortage]}
            >
              <AlertTriangle className="w-2.5 h-2.5" />
            </div>
          )}

          {/* Mandatory bottom gold cycle progress bar */}
          {fullProduces && (
            <div className="absolute bottom-0 inset-x-0 h-[3.5px] bg-black/30">
              <div
                className="h-full bg-[#E8B84B] transition-[width] duration-300"
                style={{ width: `${fullPct}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Half-size side-by-side layout */}
      {!isNeutral && isHalfLayout && (
        <div className="w-full h-full grid grid-cols-2 gap-[2px] bg-[#A58958]/75">
          <HalfCell
            themeId={primaryTheme}
            progress={cube.progress}
            shortage={cube.shortage}
            isStaffed={slot0Staffed}
          />
          <HalfCell
            themeId={secondaryTheme}
            progress={cube.secondProgress}
            shortage={cube.secondShortage}
            isStaffed={slot1Staffed}
          />
        </div>
      )}
    </button>
  );
}
