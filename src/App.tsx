import { Info, Store } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AwayReport } from './components/AwayReport';
import { BuildDock } from './components/BuildDock';
import { Inspector } from './components/Inspector';
import {
  BourseModal,
  Level2CelebrationModal,
  Level3ComingSoonModal,
  SettingsModal,
} from './components/Modals';
import { Ticker } from './components/Ticker';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { WorldCanvas } from './components/WorldCanvas';
import { playAudioCue } from './game/audio';
import { SAVE_THROTTLE_MS, THEMES, TICK_MS } from './game/constants';
import {
  createFreshGameState,
  gameReducer,
  hydrateGameState,
} from './game/gameState';
import { computeStaffing } from './game/production';
import {
  loadPersistedSave,
  saveGameToStorage,
  simulateOfflineProgress,
} from './game/save';
import { STRINGS } from './game/strings';
import type { AwayReportData, GameState, SlotIndex, ThemeId } from './game/types';

function initializeGame(): {
  initialState: GameState;
  initialAwayReport: AwayReportData | null;
} {
  const saved = loadPersistedSave();
  if (!saved) {
    return {
      initialState: createFreshGameState(Date.now()),
      initialAwayReport: null,
    };
  }
  const { restored, awayReport } = simulateOfflineProgress(saved, Date.now());
  return {
    initialState: hydrateGameState(restored),
    initialAwayReport: awayReport,
  };
}

export default function App() {
  const initRef = useRef<{
    initialState: GameState;
    initialAwayReport: AwayReportData | null;
  } | null>(null);
  if (!initRef.current) {
    initRef.current = initializeGame();
  }

  const [state, dispatch] = useReducer(
    gameReducer,
    initRef.current.initialState
  );
  const [awayReport, setAwayReport] = useState<AwayReportData | null>(
    initRef.current.initialAwayReport
  );
  const [selectedCubeId, setSelectedCubeId] = useState<number | null>(null);
  const [activeBuildTheme, setActiveBuildTheme] = useState<ThemeId | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'info' | 'bourse'>('info');
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [bourseModalOpen, setBourseModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  const latestStateRef = useRef(state);
  latestStateRef.current = state;
  const lastSavedTimeRef = useRef<number>(0);

  // Single 1000ms real-time tick interval — NEVER pauses when panels or modals are open
  useEffect(() => {
    const timer = window.setInterval(() => {
      dispatch({ type: 'TICK' });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Throttled localStorage persistence (at most once per 2s)
  useEffect(() => {
    const now = Date.now();
    if (now - lastSavedTimeRef.current >= SAVE_THROTTLE_MS) {
      saveGameToStorage(state);
      lastSavedTimeRef.current = now;
    }
  }, [state]);

  // Immediate flush on visibilitychange and beforeunload
  useEffect(() => {
    const flushSave = () => {
      saveGameToStorage(latestStateRef.current);
      lastSavedTimeRef.current = Date.now();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushSave();
      }
    };
    window.addEventListener('beforeunload', flushSave);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('beforeunload', flushSave);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Audio cue trigger
  const lastAudioIdRef = useRef<number>(0);
  useEffect(() => {
    if (
      state.pendingAudioCue &&
      state.pendingAudioCue.id !== lastAudioIdRef.current
    ) {
      lastAudioIdRef.current = state.pendingAudioCue.id;
      playAudioCue(state.pendingAudioCue.cue, state.muted);
    }
  }, [state.pendingAudioCue, state.muted]);

  // Auto-dismiss toasts after 4.5s
  useEffect(() => {
    if (state.toasts.length === 0) return;
    const oldest = state.toasts[0];
    const timeout = window.setTimeout(() => {
      dispatch({ type: 'DISMISS_TOAST', id: oldest.id });
    }, 4500);
    return () => window.clearTimeout(timeout);
  }, [state.toasts]);

  // Escape key cancels build mode or closes modals
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (activeBuildTheme) {
        setActiveBuildTheme(null);
      } else if (bourseModalOpen) {
        setBourseModalOpen(false);
      } else if (settingsModalOpen) {
        setSettingsModalOpen(false);
      } else if (mobileInspectorOpen) {
        setMobileInspectorOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeBuildTheme, bourseModalOpen, settingsModalOpen, mobileInspectorOpen]);

  // Auto-cancel active build theme if gold drops below its cost
  useEffect(() => {
    if (activeBuildTheme && state.gold < THEMES[activeBuildTheme].cost) {
      setActiveBuildTheme(null);
    }
  }, [activeBuildTheme, state.gold]);

  const staffing = useMemo(
    () => computeStaffing(state.cubes, state.population),
    [state.cubes, state.population]
  );

  const selectedCube =
    selectedCubeId !== null ? state.cubes[selectedCubeId] ?? null : null;

  const handleCubeClick = (cubeId: number) => {
    if (activeBuildTheme) {
      dispatch({ type: 'PLACE_THEME', cubeId, themeId: activeBuildTheme });
      return;
    }
    setSelectedCubeId(cubeId);
    setInspectorTab('info');
    setMobileInspectorOpen(true);
  };

  const handleSelectBuildTheme = (themeId: ThemeId | null) => {
    setActiveBuildTheme(themeId);
    if (themeId !== null) {
      setSelectedCubeId(null);
    }
  };

  const handleDemolish = (cubeId: number, slot: SlotIndex) => {
    dispatch({ type: 'DEMOLISH_THEME', cubeId, slot });
  };

  const handleNewGame = () => {
    setActiveBuildTheme(null);
    setSelectedCubeId(null);
    setInspectorTab('info');
    setBourseModalOpen(false);
    setMobileInspectorOpen(false);
    setAwayReport(null);
    dispatch({ type: 'NEW_GAME' });
    setResetSignal((n) => n + 1);
  };

  return (
    <div
      dir="rtl"
      className="h-dvh w-full flex flex-col bg-[#0E3A34] overflow-hidden"
    >
      {/* Top Bar (56px, deep teal #14524A) */}
      <TopBar
        state={state}
        onOpenBourse={() => setBourseModalOpen(true)}
        onOpenSettings={() => setSettingsModalOpen(true)}
      />

      {/* Gold Bourse News Ticker */}
      <Ticker
        message={state.tickerMessage}
        level={state.level}
        onOpenBourse={() => setBourseModalOpen(true)}
      />

      {/* Main Row: RTL Right=BuildDock (210px), Center=Map (>=60%), Left=Inspector (260px) */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Desktop BuildDock is rendered first in RTL so it sits on the RIGHT side */}
        <div className="hidden lg:flex">
          <BuildDock
            variant="desktop"
            gold={state.gold}
            level={state.level}
            activeBuildTheme={activeBuildTheme}
            onSelectTheme={handleSelectBuildTheme}
          />
        </div>

        {/* Center 3D Isometric RTS World Canvas */}
        <WorldCanvas
          cubes={state.cubes}
          level={state.level}
          selectedCubeId={selectedCubeId}
          activeBuildTheme={activeBuildTheme}
          staffedSlots={staffing.staffedSlots}
          resetSignal={resetSignal}
          onCubeClick={handleCubeClick}
          onCancelBuild={() => setActiveBuildTheme(null)}
        />

        {/* Mobile Quick Action Bar (Inspector / Objectives & Level 2 Bourse) + Horizontal Build Strip */}
        <div className="lg:hidden flex flex-col shrink-0">
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-[#11453E] border-t border-[#1D5F56]">
            <button
              type="button"
              onClick={() => {
                setSelectedCubeId(null);
                setInspectorTab('info');
                setMobileInspectorOpen(true);
              }}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl bg-[#FBF3DF] text-[#2B2118] text-xs font-extrabold"
            >
              <Info className="w-3.5 h-3.5 text-[#14524A]" />
              <span>{STRINGS.mobile.inspectorButton}</span>
            </button>
            {state.level >= 2 && (
              <button
                type="button"
                onClick={() => setBourseModalOpen(true)}
                className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl bg-[#C9962E] text-[#2B2118] text-xs font-extrabold"
              >
                <Store className="w-3.5 h-3.5" />
                <span>{STRINGS.mobile.bourseButton}</span>
              </button>
            )}
          </div>
          <BuildDock
            variant="mobile"
            gold={state.gold}
            level={state.level}
            activeBuildTheme={activeBuildTheme}
            onSelectTheme={handleSelectBuildTheme}
          />
        </div>

        {/* Left Inspector Panel (Desktop 260px) & Mobile Slide-up Drawer */}
        <Inspector
          state={state}
          selectedCube={selectedCube}
          staffing={staffing}
          activeTab={inspectorTab}
          onChangeTab={setInspectorTab}
          onClearSelection={() => setSelectedCubeId(null)}
          onBuyCube={(cubeId) => dispatch({ type: 'BUY_CUBE', cubeId })}
          onDemolishTheme={handleDemolish}
          onTrade={(resource, side, quantity) =>
            dispatch({ type: 'TRADE_RESOURCE', resource, side, quantity })
          }
          mobileOpen={mobileInspectorOpen}
          onCloseMobile={() => setMobileInspectorOpen(false)}
        />
      </div>

      {/* Bottom-left Toasts */}
      <Toasts
        toasts={state.toasts}
        onDismiss={(id) => dispatch({ type: 'DISMISS_TOAST', id })}
      />

      {/* Non-pausing Parchment Modals */}
      {awayReport && (
        <AwayReport report={awayReport} onClose={() => setAwayReport(null)} />
      )}

      {bourseModalOpen && state.level >= 2 && (
        <BourseModal
          state={state}
          onTrade={(resource, side, quantity) =>
            dispatch({ type: 'TRADE_RESOURCE', resource, side, quantity })
          }
          onClose={() => setBourseModalOpen(false)}
        />
      )}

      {state.level2ModalOpen && (
        <Level2CelebrationModal
          onClose={() => dispatch({ type: 'CLOSE_LEVEL2_MODAL' })}
        />
      )}

      {state.level2CompletedModalOpen && (
        <Level3ComingSoonModal
          onClose={() => dispatch({ type: 'CLOSE_LEVEL2_COMPLETED_MODAL' })}
        />
      )}

      {settingsModalOpen && (
        <SettingsModal
          muted={state.muted}
          onToggleMute={() => dispatch({ type: 'TOGGLE_MUTE' })}
          onNewGame={handleNewGame}
          onClose={() => setSettingsModalOpen(false)}
        />
      )}
    </div>
  );
}
