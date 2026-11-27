import { AlertTriangle, Compass, Minus, Plus, X } from 'lucide-react';
import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { STRINGS } from '../game/strings';
import type {
  ActivePrayerSession,
  ArrivalCamp,
  Citizen,
  Cube,
  EmbassyPlotMarker,
  Province,
  ThemeId,
} from '../game/types';
import type { CitizenInfo } from './CitizenCard';
import { WorldEngine } from '../world3d/WorldEngine';

export interface WorldCanvasHandle {
  focusOnCube: (cubeId: number) => void;
  highlightProvinceCenter: (cubeId: number) => void;
  getCitizenInfo: (agentId: number) => CitizenInfo | null;
}

interface WorldCanvasProps {
  cubes: Cube[];
  level: 1 | 2;
  population: number;
  satisfaction: number;
  selectedCubeId: number | null;
  bulkSelectedCubeIds?: number[];
  selectedCitizenId: number | null;
  followCitizenId: number | null;
  activeBuildTheme: ThemeId | null;
  staffedSlots: Set<string>;
  provinces: Province[];
  camp: ArrivalCamp;
  citizens: Citizen[];
  lastJoinedVillageCubeId: number | null;
  lastJoinedVillageSeq: number;
  lastDefectedCubeId: number | null;
  lastDefectedSeq: number;
  embassyPlots?: EmbassyPlotMarker[];
  clockSecondsOfDay?: number;
  totalMonths?: number;
  activePrayer?: ActivePrayerSession | null;
  gameDay?: number;
  resetSignal: number;
  onCubeClick: (cubeId: number) => void;
  onCitizenClick: (agentId: number) => void;
  onPrayerCitizenCompleted?: (sessionId: number, citizenId: number) => void;
  onCancelBuild: () => void;
  onRecenter?: () => void;
  children?: ReactNode;
}

export const WorldCanvas = forwardRef<WorldCanvasHandle, WorldCanvasProps>(
  function WorldCanvas(
    {
      cubes,
      level,
      population,
      satisfaction,
      selectedCubeId,
      bulkSelectedCubeIds,
      selectedCitizenId,
      followCitizenId,
      activeBuildTheme,
      staffedSlots,
      provinces,
      camp,
      citizens,
      lastJoinedVillageCubeId,
      lastJoinedVillageSeq,
      lastDefectedCubeId,
      lastDefectedSeq,
      embassyPlots,
      clockSecondsOfDay,
      totalMonths,
      activePrayer,
      gameDay,
      resetSignal,
      onCubeClick,
      onCitizenClick,
      onPrayerCitizenCompleted,
      onCancelBuild,
      onRecenter,
      children,
    },
    ref
  ) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<WorldEngine | null>(null);

    const onCubeClickRef = useRef(onCubeClick);
    onCubeClickRef.current = onCubeClick;
    const onCitizenClickRef = useRef(onCitizenClick);
    onCitizenClickRef.current = onCitizenClick;
    const onPrayerCitizenCompletedRef = useRef(onPrayerCitizenCompleted);
    onPrayerCitizenCompletedRef.current = onPrayerCitizenCompleted;
    const latestCubesRef = useRef(cubes);
    latestCubesRef.current = cubes;

    const initialPayloadRef = useRef({
      cubes,
      level,
      population,
      satisfaction,
      selectedCubeId,
      selectedCitizenId,
      followCitizenId,
      activeBuildTheme,
      staffedSlots,
      provinces,
      camp,
      citizens,
      lastJoinedVillageCubeId,
      lastJoinedVillageSeq,
      lastDefectedCubeId,
      lastDefectedSeq,
      embassyPlots,
      clockSecondsOfDay,
      totalMonths,
      activePrayer,
      gameDay,
    });

    const [webglError, setWebglError] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        focusOnCube: (cubeId: number) => {
          engineRef.current?.focusOnCube(cubeId);
        },
        highlightProvinceCenter: (cubeId: number) => {
          engineRef.current?.highlightProvinceCenter(cubeId);
        },
        getCitizenInfo: (agentId: number) =>
          engineRef.current?.getCitizenInfo(agentId) ?? null,
      }),
      []
    );

    // Mount Three.js engine once in isolated container so React UI updates never tear down WebGL
    useEffect(() => {
      const container = mountRef.current;
      if (!container) return;

      try {
        const engine = new WorldEngine(
          container,
          initialPayloadRef.current,
          (cubeId) => onCubeClickRef.current(cubeId),
          (agentId) => onCitizenClickRef.current(agentId),
          (sessionId, citizenId) =>
            onPrayerCitizenCompletedRef.current?.(sessionId, citizenId)
        );
        engineRef.current = engine;
      } catch {
        setWebglError(true);
      }

      return () => {
        if (engineRef.current) {
          engineRef.current.dispose();
          engineRef.current = null;
        }
      };
    }, []);

    // Push game state changes into the Three.js scene without re-mounting
    useEffect(() => {
      engineRef.current?.syncState({
        cubes,
        level,
        population,
        satisfaction,
        selectedCubeId,
        bulkSelectedCubeIds,
        selectedCitizenId,
        followCitizenId,
        activeBuildTheme,
        staffedSlots,
        provinces,
        camp,
        citizens,
        lastJoinedVillageCubeId,
        lastJoinedVillageSeq,
        lastDefectedCubeId,
        lastDefectedSeq,
        embassyPlots,
        clockSecondsOfDay,
        totalMonths,
        activePrayer,
        gameDay,
      });
    }, [
      cubes,
      level,
      population,
      satisfaction,
      selectedCubeId,
      bulkSelectedCubeIds,
      selectedCitizenId,
      followCitizenId,
      activeBuildTheme,
      staffedSlots,
      provinces,
      camp,
      citizens,
      lastJoinedVillageCubeId,
      lastJoinedVillageSeq,
      lastDefectedCubeId,
      lastDefectedSeq,
      embassyPlots,
      clockSecondsOfDay,
      totalMonths,
      activePrayer,
      gameDay,
    ]);

    // Amendment B1(a): Camera stays completely still on land purchases (BUY_CUBE / BUY_CUBES_BULK).
    // Only refit on genuine village-join celebrations (lastJoinedVillageSeq increment) or explicit New Game reset.
    const prevJoinedVillageSeqRef = useRef(lastJoinedVillageSeq);
    useEffect(() => {
      if (lastJoinedVillageSeq > prevJoinedVillageSeqRef.current) {
        prevJoinedVillageSeqRef.current = lastJoinedVillageSeq;
        engineRef.current?.frameOwnedTerritory(latestCubesRef.current, false);
      } else if (lastJoinedVillageSeq < prevJoinedVillageSeqRef.current) {
        prevJoinedVillageSeqRef.current = lastJoinedVillageSeq;
      }
    }, [lastJoinedVillageSeq]);

    // Reframe on explicit New Game reset
    const prevResetRef = useRef(resetSignal);
    useEffect(() => {
      if (resetSignal !== prevResetRef.current) {
        prevResetRef.current = resetSignal;
        engineRef.current?.frameOwnedTerritory(latestCubesRef.current, false);
      }
    }, [resetSignal]);

    return (
      <main className="flex-1 min-w-0 relative overflow-hidden bg-[#D9C293]">
        {/* Isolated WebGL canvas container */}
        <div ref={mountRef} className="w-full h-full" />

        {/* Map-anchored HUD overlays (e.g. top-left collapsible Objectives chip) */}
        {children}

        {/* Graceful fallback if WebGL is unavailable — keeps DOM HUD fully usable */}
        {webglError && (
          <div className="absolute inset-0 flex items-center justify-center p-6 bg-[#0E3A34]">
            <div className="parchment-panel border-2 border-[#C9962E] max-w-md p-5 text-center space-y-2.5">
              <AlertTriangle className="w-8 h-8 text-[#C44536] mx-auto" />
              <h2 className="text-base font-extrabold text-[#2B2118]">
                {STRINGS.world3d.webglFallbackTitle}
              </h2>
              <p className="text-xs leading-relaxed text-[#6F5C43]">
                {STRINGS.world3d.webglFallbackBody}
              </p>
            </div>
          </div>
        )}

        {/* Active build banner floating cleanly at top center (below Objectives chip on mobile) */}
        {activeBuildTheme && !webglError && (
          <div className="pointer-events-none absolute top-12 sm:top-3 inset-x-0 flex justify-center z-20 px-3">
            <div className="pointer-events-auto px-3.5 py-1.5 rounded-xl bg-[#FBF3DF] border border-[#C9962E] text-[#2B2118] text-xs font-extrabold flex items-center gap-2.5 shadow-md">
              <span>
                {STRINGS.buildDock.activeHint(
                  STRINGS.themes[activeBuildTheme].name
                )}
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
          </div>
        )}

        {/* Compact solid parchment camera controls (zero backdrop-filter over WebGL) */}
        {!webglError && (
          <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onRecenter?.();
                engineRef.current?.frameOwnedTerritory(
                  latestCubesRef.current,
                  false
                );
              }}
              title={STRINGS.world3d.recenterMap}
              aria-label={STRINGS.world3d.recenterMap}
              className="h-9 px-2.5 rounded-xl bg-[#FBF3DF] hover:bg-[#F3E4BE] border border-[#C9962E] text-[#2B2118] text-xs font-extrabold flex items-center gap-1.5 shadow-md transition-colors"
            >
              <Compass className="w-4 h-4 text-[#14524A]" />
              <span className="hidden sm:inline">
                {STRINGS.world3d.recenterMap}
              </span>
            </button>

            <div className="flex items-center rounded-xl bg-[#FBF3DF] border border-[#C9962E] shadow-md overflow-hidden">
              <button
                type="button"
                onClick={() => engineRef.current?.zoomBy(0.84)}
                title={STRINGS.world3d.zoomIn}
                aria-label={STRINGS.world3d.zoomIn}
                className="w-9 h-9 flex items-center justify-center text-[#14524A] hover:bg-[#F3E4BE] transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
              <div className="w-px h-5 bg-[#E3D3AC]" />
              <button
                type="button"
                onClick={() => engineRef.current?.zoomBy(1.18)}
                title={STRINGS.world3d.zoomOut}
                aria-label={STRINGS.world3d.zoomOut}
                className="w-9 h-9 flex items-center justify-center text-[#14524A] hover:bg-[#F3E4BE] transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </main>
    );
  }
);
