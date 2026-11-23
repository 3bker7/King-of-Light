import { AlertTriangle, Compass, Minus, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { STRINGS } from '../game/strings';
import type { Cube, ThemeId } from '../game/types';
import { WorldEngine } from '../world3d/WorldEngine';

interface WorldCanvasProps {
  cubes: Cube[];
  level: 1 | 2;
  selectedCubeId: number | null;
  activeBuildTheme: ThemeId | null;
  staffedSlots: Set<string>;
  resetSignal: number;
  onCubeClick: (cubeId: number) => void;
  onCancelBuild: () => void;
}

export function WorldCanvas({
  cubes,
  level,
  selectedCubeId,
  activeBuildTheme,
  staffedSlots,
  resetSignal,
  onCubeClick,
  onCancelBuild,
}: WorldCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<WorldEngine | null>(null);
  const onCubeClickRef = useRef(onCubeClick);
  onCubeClickRef.current = onCubeClick;

  const initialPayloadRef = useRef({
    cubes,
    level,
    selectedCubeId,
    activeBuildTheme,
    staffedSlots,
  });

  const [webglError, setWebglError] = useState(false);

  // Mount Three.js engine once in isolated container so React UI updates never tear down WebGL
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    try {
      const engine = new WorldEngine(
        container,
        initialPayloadRef.current,
        (cubeId) => onCubeClickRef.current(cubeId)
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
      selectedCubeId,
      activeBuildTheme,
      staffedSlots,
    });
  }, [cubes, level, selectedCubeId, activeBuildTheme, staffedSlots]);

  // Reframe on explicit New Game reset
  const prevResetRef = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal !== prevResetRef.current) {
      prevResetRef.current = resetSignal;
      engineRef.current?.frameOwnedTerritory(cubes, false);
    }
  }, [resetSignal, cubes]);

  return (
    <main className="flex-1 min-w-0 lg:min-w-[60%] relative overflow-hidden bg-[#D9C293]">
      {/* Isolated WebGL canvas container */}
      <div ref={mountRef} className="w-full h-full" />

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

      {/* Active build banner floating cleanly at top center */}
      {activeBuildTheme && !webglError && (
        <div className="pointer-events-none absolute top-3 inset-x-0 flex justify-center z-20 px-3">
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
            onClick={() => engineRef.current?.frameOwnedTerritory(cubes, false)}
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
