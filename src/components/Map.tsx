import { X } from 'lucide-react';
import {
  canPlaceThemeOnCube,
  isPurchasableNeutralCube,
} from '../game/production';
import { STRINGS } from '../game/strings';
import type { Cube, ThemeId } from '../game/types';
import { CubeTile } from './CubeTile';

interface WorldMapProps {
  cubes: Cube[];
  level: 1 | 2;
  selectedCubeId: number | null;
  activeBuildTheme: ThemeId | null;
  staffedSlots: Set<string>;
  onCubeClick: (cubeId: number) => void;
  onCancelBuild: () => void;
}

export function WorldMap({
  cubes,
  level,
  selectedCubeId,
  activeBuildTheme,
  staffedSlots,
  onCubeClick,
  onCancelBuild,
}: WorldMapProps) {
  return (
    <main className="map-felt-bg flex-1 min-w-0 lg:min-w-[60%] flex flex-col items-center justify-center p-2 sm:p-3 lg:p-4 relative overflow-hidden">
      {/* Active build banner */}
      {activeBuildTheme && (
        <div className="mb-2 px-3 py-1.5 rounded-xl bg-[#FBF3DF] border border-[#C9962E] text-[#2B2118] text-xs font-extrabold flex items-center gap-2.5 shadow-md z-30">
          <span>
            {STRINGS.buildDock.activeHint(STRINGS.themes[activeBuildTheme].name)}
          </span>
          <button
            type="button"
            onClick={onCancelBuild}
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#14524A] text-white text-[11px] font-bold hover:bg-[#1B685E] transition-colors"
          >
            <X className="w-3 h-3" />
            <span>{STRINGS.buildDock.cancelBuild}</span>
          </button>
        </div>
      )}

      {/* 12x12 Square Cube Grid — dir="ltr" keeps bottom-right corner strictly at rows 9-11, cols 9-11 */}
      <div
        dir="ltr"
        className="grid grid-cols-12 gap-1 w-full aspect-square max-w-[min(94vw,54vh)] sm:max-w-[min(86vw,64vh)] lg:max-w-[min(58vw,calc(100vh-118px))] p-1.5 sm:p-2 rounded-2xl bg-[#0A2D28]/65 border border-[#1E5B52]/50 shadow-2xl"
      >
        {cubes.map((cube) => {
          const canPlace =
            activeBuildTheme !== null &&
            canPlaceThemeOnCube(cube, activeBuildTheme, level).valid;
          const purchasable = isPurchasableNeutralCube(cubes, cube);

          return (
            <CubeTile
              key={cube.id}
              cube={cube}
              selected={selectedCubeId === cube.id}
              canPlaceActiveTheme={canPlace}
              hasActiveBuildTool={activeBuildTheme !== null}
              isPurchasableNeutral={purchasable}
              staffedSlots={staffedSlots}
              onClick={() => onCubeClick(cube.id)}
            />
          );
        })}
      </div>
    </main>
  );
}
