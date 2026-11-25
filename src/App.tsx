import { Award } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AdvisorOverlay, type AdvisorTab } from './components/AdvisorOverlay';
import { AwayReport } from './components/AwayReport';
import { BuildDock } from './components/BuildDock';
import type { CitizenInfo } from './components/CitizenCard';
import { Inspector } from './components/Inspector';
import {
  BourseModal,
  Level2CelebrationModal,
  Level3ComingSoonModal,
  SettingsModal,
} from './components/Modals';
import { Objectives, ObjectivesChip } from './components/Objectives';
import { BankOverlay } from './components/BankOverlay';
import {
  PalaceOfficesOverlay,
  type PalaceOfficeTab,
} from './components/PalaceOfficesOverlay';
import { ProvincePanel, ProvincePanelChip } from './components/ProvincePanel';
import { SharedWorldOverlay } from './components/SharedWorldOverlay';
import { Ticker } from './components/Ticker';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { WorldCanvas, type WorldCanvasHandle } from './components/WorldCanvas';
import { playAudioCue } from './game/audio';
import {
  MATERIAL_PRODUCER_THEME,
  SAVE_THROTTLE_MS,
  THEMES,
  TICK_MS,
} from './game/constants';
import {
  createFreshGameState,
  gameReducer,
  hydrateGameState,
} from './game/gameState';
import {
  checkMaterialCosts,
  computeStaffing,
  findPalaceCube,
  getManhattanDistanceToPalace,
  isPurchasableNeutralCube,
} from './game/production';
import {
  loadPersistedSave,
  saveGameToStorage,
  simulateOfflineProgress,
} from './game/save';
import { STRINGS } from './game/strings';
import {
  getEffectiveBuyPrice,
  getSellPrice,
} from './game/economy';
import type {
  AdvisorAction,
  AwayReportData,
  Cube,
  GameState,
  SlotIndex,
  ThemeCategory,
  ThemeId,
  ToastItem,
  TradedResourceKey,
} from './game/types';
import {
  CLOUD_SYNC_TOAST_AR,
  downloadCloudSaveIfNewer,
  uploadCloudSave,
} from './net/cloudSync';
import { isOnlineWorldEnabled } from './net/firebase';
import {
  registerOrLoadWorldKingdom,
  signInWithEmail,
  signInWithGoogle,
  signOutWorld,
  signUpWithEmail,
  subscribeAuthState,
  updateWorldKingdomRegistry,
} from './net/worldAuth';
import {
  ensureAndRollWorldBourse,
  fetchMyWorldBourseUsage,
  pushWorldBourseVolumeDeltas,
  subscribeWorldBourse,
} from './net/worldBourse';
import {
  ONLINE_BOURSE_DAILY_KINGDOM_CAP,
  type CloudSyncStatus,
  type OnlineWorldUser,
  type WorldBourse,
  type WorldKingdom,
} from './net/worldTypes';

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

function findNearestCube(
  cubes: Cube[],
  predicate: (cube: Cube) => boolean
): Cube | null {
  let best: Cube | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < cubes.length; i++) {
    const c = cubes[i];
    if (!predicate(c)) continue;
    const dist = getManhattanDistanceToPalace(cubes, c);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

export default function App() {
  const initRef = useRef<{
    initialState: GameState;
    initialAwayReport: AwayReportData | null;
  } | null>(null);
  if (!initRef.current) {
    initRef.current = initializeGame();
  }

  const worldRef = useRef<WorldCanvasHandle | null>(null);

  const [state, dispatch] = useReducer(
    gameReducer,
    initRef.current.initialState
  );
  const [awayReport, setAwayReport] = useState<AwayReportData | null>(
    initRef.current.initialAwayReport
  );

  // Single coherent UI overlay state — ALL panels closed by default on load
  const [selectedCubeId, setSelectedCubeId] = useState<number | null>(null);
  const [selectedCitizenId, setSelectedCitizenId] = useState<number | null>(null);
  const [followCitizenId, setFollowCitizenId] = useState<number | null>(null);
  const [citizenInfo, setCitizenInfo] = useState<CitizenInfo | null>(null);
  const [kingdomCardOpen, setKingdomCardOpen] = useState(false);

  const [openBuildCategory, setOpenBuildCategory] =
    useState<ThemeCategory | null>(null);
  const [activeBuildTheme, setActiveBuildTheme] = useState<ThemeId | null>(null);
  const [inspectedShortTheme, setInspectedShortTheme] =
    useState<ThemeId | null>(null);
  const [pulsingTheme, setPulsingTheme] = useState<ThemeId | null>(null);
  const [objectivesOpen, setObjectivesOpen] = useState(false);
  const [provincesOpen, setProvincesOpen] = useState(false);

  const [inspectorTab, setInspectorTab] = useState<'info' | 'bourse'>('info');
  const [bourseModalOpen, setBourseModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [showLevel2Modal, setShowLevel2Modal] = useState(false);
  const [showLevel3Modal, setShowLevel3Modal] = useState(false);
  const [openOfficeTab, setOpenOfficeTab] = useState<PalaceOfficeTab | null>(
    null
  );
  const [bankOverlayOpen, setBankOverlayOpen] = useState(false);
  const [advisorOverlayOpen, setAdvisorOverlayOpen] = useState(false);
  const [advisorInitialTab, setAdvisorInitialTab] = useState<
    AdvisorTab | undefined
  >(undefined);
  const [sharedWorldOpen, setSharedWorldOpen] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  // Prompt 8 Shared World state (inert in local mode when firebaseConfig === null)
  const onlineConfigEnabled = isOnlineWorldEnabled();
  const [worldUser, setWorldUser] = useState<OnlineWorldUser | null>(null);
  const [myWorldKingdom, setMyWorldKingdom] = useState<WorldKingdom | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] =
    useState<CloudSyncStatus>('local-only');
  const [worldBourse, setWorldBourse] = useState<WorldBourse | null>(null);
  const [worldBourseUsedToday, setWorldBourseUsedToday] = useState<
    Partial<Record<TradedResourceKey, number>>
  >({});
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const isWorldBourseActive = Boolean(
    onlineConfigEnabled && worldUser && worldBourse
  );
  const isWorldBourseActiveRef = useRef(isWorldBourseActive);
  isWorldBourseActiveRef.current = isWorldBourseActive;

  const latestStateRef = useRef(state);
  latestStateRef.current = state;
  const lastSavedTimeRef = useRef<number>(0);
  const lastSyncedMonthRef = useRef<number>(state.totalMonths);
  const worldBourseDayRef = useRef<number | null>(null);

  // Single 1000ms real-time tick interval — NEVER pauses when panels or modals are open
  useEffect(() => {
    const timer = window.setInterval(() => {
      dispatch({
        type: 'TICK',
        skipLocalBourseRoll: isWorldBourseActiveRef.current,
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Element 1.1: Subscribe to Firebase Auth ONLY when firebaseConfig is non-null
  useEffect(() => {
    if (!onlineConfigEnabled) return;
    let active = true;
    let unsub: (() => void) | null = null;
    void subscribeAuthState((u) => {
      if (!active) return;
      setWorldUser(u);
      if (!u) {
        setMyWorldKingdom(null);
        setWorldBourse(null);
        setWorldBourseUsedToday({});
        setCloudSyncStatus('local-only');
        worldBourseDayRef.current = null;
      }
    }).then((fn) => {
      if (active) unsub = fn;
      else fn();
    });
    return () => {
      active = false;
      if (unsub) unsub();
    };
  }, [onlineConfigEnabled]);

  // Elements 1.2, 2.1, 3.1-3.2: On sign-in -> cloud download check, kingdom register/BFS spawn, world bourse subscribe
  useEffect(() => {
    if (!onlineConfigEnabled || !worldUser) return;
    let active = true;
    let unsubBourse: (() => void) | null = null;

    const bootstrapOnlineSession = async () => {
      setCloudSyncStatus('pending');
      let workingState = latestStateRef.current;

      // Element 2.1: Download cloud save ONLY if cloud.totalMonths > local.totalMonths
      const cloudDownload = await downloadCloudSaveIfNewer(
        worldUser.uid,
        workingState.totalMonths
      );
      if (!active) return;
      if (cloudDownload) {
        const hydrated = hydrateGameState(cloudDownload.save);
        workingState = hydrated;
        lastSyncedMonthRef.current = hydrated.totalMonths;
        dispatch({
          type: 'APPLY_CLOUD_SAVE',
          save: cloudDownload.save,
          toastMessage: CLOUD_SYNC_TOAST_AR,
        });
        saveGameToStorage(hydrated);
      }

      // Element 1.2: Register or refresh worldKingdoms/{uid} with deterministic BFS spawn
      try {
        const { kingdom } = await registerOrLoadWorldKingdom(
          worldUser,
          workingState
        );
        if (!active) return;
        setMyWorldKingdom(kingdom);
        dispatch({
          type: 'SET_WORLD_PROFILE',
          myWorldPos: { wx: kingdom.wx, wy: kingdom.wy },
          kingdomNameAr: kingdom.nameAr,
          rulerName: kingdom.rulerName,
        });
      } catch (err) {
        if (active) {
          setAuthError(
            err instanceof Error ? err.message : 'تعذر تسجيل المملكة في العالم المشترك'
          );
        }
      }

      // Element 3.1 & 3.2: Ensure/roll World Bourse and subscribe to live world prices
      const initialBourse = await ensureAndRollWorldBourse(Date.now());
      if (!active) return;
      if (initialBourse) {
        setWorldBourse(initialBourse);
        worldBourseDayRef.current = initialBourse.day;
        dispatch({
          type: 'SYNC_WORLD_BOURSE',
          prices: initialBourse.prices,
          previousPrices: initialBourse.previousPrices,
          inflationIndex: initialBourse.inflationIndex,
        });
        const usage = await fetchMyWorldBourseUsage(
          worldUser.uid,
          initialBourse.day
        );
        if (active) setWorldBourseUsedToday(usage);
      }

      unsubBourse = await subscribeWorldBourse((nextBourse) => {
        if (!active) return;
        const prevDay = worldBourseDayRef.current;
        setWorldBourse(nextBourse);
        worldBourseDayRef.current = nextBourse.day;
        dispatch({
          type: 'SYNC_WORLD_BOURSE',
          prices: nextBourse.prices,
          previousPrices: nextBourse.previousPrices,
          inflationIndex: nextBourse.inflationIndex,
        });
        if (prevDay !== null && prevDay !== nextBourse.day) {
          setWorldBourseUsedToday({});
        }
      });

      if (active) {
        setCloudSyncStatus('synced');
      }
    };

    void bootstrapOnlineSession();
    return () => {
      active = false;
      if (unsubBourse) unsubBourse();
    };
  }, [onlineConfigEnabled, worldUser]);

  // Elements 1.3, 2.1, 3.3: Throttled month-boundary cloud save upload, registry refresh & People's Bank volume push
  useEffect(() => {
    if (!onlineConfigEnabled || !worldUser) {
      lastSyncedMonthRef.current = state.totalMonths;
      return;
    }
    if (state.totalMonths <= lastSyncedMonthRef.current) return;
    lastSyncedMonthRef.current = state.totalMonths;

    let cancelled = false;
    setCloudSyncStatus('pending');

    const snapshot = state;
    const pos = myWorldKingdom
      ? { wx: myWorldKingdom.wx, wy: myWorldKingdom.wy }
      : snapshot.myWorldPos ?? null;

    const runMonthSync = async () => {
      // 1. Fire-and-forget cloud save backup
      const up = await uploadCloudSave(worldUser.uid, snapshot);

      // 2. Refresh worldKingdoms/{uid} stats (goldBand only, never exact gold)
      if (pos) {
        try {
          const updatedKingdom = await updateWorldKingdomRegistry(
            worldUser.uid,
            snapshot,
            pos,
            worldUser.displayName
          );
          if (!cancelled && updatedKingdom) {
            setMyWorldKingdom(updatedKingdom);
          }
        } catch {
          // Non-fatal: keep local play uninterrupted
        }
      }

      // 3. Push People's Bank monthly bourse volumes to worldBourse/current (Element 3.3)
      const hasBankVol =
        Object.values(snapshot.dailyBought).some((v) => v > 0) ||
        Object.values(snapshot.dailySold).some((v) => v > 0);
      if (hasBankVol) {
        const nextCounts = await pushWorldBourseVolumeDeltas(worldUser.uid, {
          bought: snapshot.dailyBought,
          sold: snapshot.dailySold,
        });
        if (!cancelled && nextCounts) {
          setWorldBourseUsedToday(nextCounts);
        }
      }

      if (!cancelled) {
        setCloudSyncStatus(up.ok ? 'synced' : 'local-only');
      }
    };

    void runMonthSync();
    return () => {
      cancelled = true;
    };
  }, [onlineConfigEnabled, worldUser, myWorldKingdom, state]);

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

  // Auto-dismiss toasts after 5s
  useEffect(() => {
    if (state.toasts.length === 0) return;
    const oldest = state.toasts[0];
    const timeout = window.setTimeout(() => {
      dispatch({ type: 'DISMISS_TOAST', id: oldest.id });
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [state.toasts]);

  // Live refresh of selected citizen's destination & mood while citizen card is open
  useEffect(() => {
    if (selectedCitizenId === null) {
      setCitizenInfo(null);
      return;
    }
    const refresh = () => {
      const info = worldRef.current?.getCitizenInfo(selectedCitizenId) ?? null;
      if (!info) {
        setSelectedCitizenId(null);
        setFollowCitizenId(null);
        setCitizenInfo(null);
      } else {
        setCitizenInfo(info);
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 350);
    return () => window.clearInterval(timer);
  }, [selectedCitizenId]);

  // Element 6.1 & 9: Escape closes in strict stack order
  // (advisor -> bank -> palace offices overlay -> citizen card -> cube/kingdom card -> build panel/placement -> objectives -> modals)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (sharedWorldOpen) {
        setSharedWorldOpen(false);
      } else if (advisorOverlayOpen) {
        setAdvisorOverlayOpen(false);
      } else if (bankOverlayOpen) {
        setBankOverlayOpen(false);
      } else if (openOfficeTab !== null) {
        setOpenOfficeTab(null);
      } else if (selectedCitizenId !== null) {
        setSelectedCitizenId(null);
        setFollowCitizenId(null);
        setCitizenInfo(null);
      } else if (selectedCubeId !== null || kingdomCardOpen) {
        setSelectedCubeId(null);
        setKingdomCardOpen(false);
      } else if (
        activeBuildTheme !== null ||
        openBuildCategory !== null ||
        inspectedShortTheme !== null
      ) {
        setActiveBuildTheme(null);
        setInspectedShortTheme(null);
        setOpenBuildCategory(null);
        setPulsingTheme(null);
      } else if (provincesOpen) {
        setProvincesOpen(false);
      } else if (objectivesOpen) {
        setObjectivesOpen(false);
      } else if (showLevel2Modal) {
        setShowLevel2Modal(false);
        dispatch({ type: 'CLEAR_LEVEL2_NOTICE' });
      } else if (showLevel3Modal) {
        setShowLevel3Modal(false);
        dispatch({ type: 'CLEAR_LEVEL2_COMPLETED_NOTICE' });
      } else if (bourseModalOpen) {
        setBourseModalOpen(false);
      } else if (settingsModalOpen) {
        setSettingsModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    sharedWorldOpen,
    advisorOverlayOpen,
    bankOverlayOpen,
    openOfficeTab,
    selectedCitizenId,
    selectedCubeId,
    kingdomCardOpen,
    activeBuildTheme,
    inspectedShortTheme,
    openBuildCategory,
    provincesOpen,
    objectivesOpen,
    showLevel2Modal,
    showLevel3Modal,
    bourseModalOpen,
    settingsModalOpen,
  ]);

  // Cancel active build theme if gold or materials (Level 2+) drop below its cost
  useEffect(() => {
    if (
      activeBuildTheme &&
      (state.gold < THEMES[activeBuildTheme].cost ||
        !checkMaterialCosts(state.warehouse, activeBuildTheme, state.level).ok)
    ) {
      setActiveBuildTheme(null);
      setPulsingTheme(null);
    }
  }, [activeBuildTheme, state.gold, state.warehouse, state.level]);

  const staffing = useMemo(
    () => computeStaffing(state.cubes, state.population, state.citizens),
    [state.cubes, state.population, state.citizens]
  );

  const selectedCube =
    selectedCubeId !== null ? state.cubes[selectedCubeId] ?? null : null;

  const hasOverlayCard = Boolean(
    citizenInfo || selectedCube || kingdomCardOpen
  );

  const handleCubeClick = (cubeId: number) => {
    if (activeBuildTheme) {
      dispatch({ type: 'PLACE_THEME', cubeId, themeId: activeBuildTheme });
      setPulsingTheme(null);
      setOpenBuildCategory(null);
      return;
    }
    setSelectedCitizenId(null);
    setFollowCitizenId(null);
    setCitizenInfo(null);
    setKingdomCardOpen(false);
    setOpenBuildCategory(null);
    setPulsingTheme(null);
    setSelectedCubeId(cubeId);
  };

  const handleCitizenClick = (agentId: number) => {
    // Placement mode cancels citizen selection and vice versa
    setActiveBuildTheme(null);
    setInspectedShortTheme(null);
    setPulsingTheme(null);
    setOpenBuildCategory(null);
    setSelectedCubeId(null);
    setKingdomCardOpen(false);
    setFollowCitizenId(null);
    setSelectedCitizenId(agentId);
    const info = worldRef.current?.getCitizenInfo(agentId) ?? null;
    setCitizenInfo(info);
  };

  const handleSelectBuildTheme = (
    themeId: ThemeId | null,
    closePanel = true
  ) => {
    setActiveBuildTheme(themeId);
    setPulsingTheme(null);
    if (themeId !== null) {
      setSelectedCubeId(null);
      setSelectedCitizenId(null);
      setFollowCitizenId(null);
      setCitizenInfo(null);
      setKingdomCardOpen(false);
    }
    if (closePanel) {
      setOpenBuildCategory(null);
    }
  };

  const handleToggleCategory = (cat: ThemeCategory | null) => {
    setOpenBuildCategory(cat);
    setInspectedShortTheme(null);
    setPulsingTheme(null);
  };

  const handleToggleKingdom = () => {
    if (kingdomCardOpen) {
      setKingdomCardOpen(false);
    } else {
      setSelectedCubeId(null);
      setSelectedCitizenId(null);
      setFollowCitizenId(null);
      setCitizenInfo(null);
      setActiveBuildTheme(null);
      setInspectedShortTheme(null);
      setPulsingTheme(null);
      setOpenBuildCategory(null);
      setObjectivesOpen(false);
      setInspectorTab('info');
      setKingdomCardOpen(true);
    }
  };

  const handleCloseOverlayCard = () => {
    setSelectedCubeId(null);
    setSelectedCitizenId(null);
    setFollowCitizenId(null);
    setCitizenInfo(null);
    setKingdomCardOpen(false);
  };

  const handleToggleFollowCitizen = () => {
    if (selectedCitizenId === null) return;
    setFollowCitizenId((prev) =>
      prev === selectedCitizenId ? null : selectedCitizenId
    );
  };

  // Element 5.2: Objectives smart navigation
  const handleSelectObjective = (objectiveId: string) => {
    setObjectivesOpen(false);

    if (objectiveId === 'build_sea' || objectiveId === 'build_farm') {
      const targetTheme: ThemeId = objectiveId === 'build_sea' ? 'sea' : 'farm';
      setSelectedCubeId(null);
      setSelectedCitizenId(null);
      setFollowCitizenId(null);
      setCitizenInfo(null);
      setKingdomCardOpen(false);
      setOpenBuildCategory('food');
      setActiveBuildTheme(targetTheme);
      setPulsingTheme(targetTheme);

      const emptyOwned = findNearestCube(
        state.cubes,
        (c) => c.owner === 'player' && !c.themeId && !c.secondThemeId
      );
      if (emptyOwned) {
        worldRef.current?.focusOnCube(emptyOwned.id);
      }
      return;
    }

    if (
      objectiveId === 'hold_30_food' ||
      objectiveId === 'reach_60_satisfaction'
    ) {
      setSelectedCubeId(null);
      setSelectedCitizenId(null);
      setFollowCitizenId(null);
      setCitizenInfo(null);
      setActiveBuildTheme(null);
      setPulsingTheme(null);
      setOpenBuildCategory(null);
      setInspectorTab('info');
      setKingdomCardOpen(true);
      return;
    }

    if (
      objectiveId === 'reach_25_pop' ||
      objectiveId === 'own_15_cubes' ||
      objectiveId === 'hold_200_gold'
    ) {
      const palace = findPalaceCube(state.cubes);
      if (palace) {
        setSelectedCitizenId(null);
        setFollowCitizenId(null);
        setCitizenInfo(null);
        setKingdomCardOpen(false);
        setActiveBuildTheme(null);
        setPulsingTheme(null);
        setOpenBuildCategory(null);
        setSelectedCubeId(palace.id);
        worldRef.current?.focusOnCube(palace.id);
      }
    }
  };

  // Element 5.3: Clickable toasts carrying focusCubeId
  const handleFocusToast = (toast: ToastItem) => {
    if (typeof toast.focusCubeId !== 'number') return;
    setActiveBuildTheme(null);
    setPulsingTheme(null);
    setOpenBuildCategory(null);
    setObjectivesOpen(false);
    setSelectedCitizenId(null);
    setFollowCitizenId(null);
    setCitizenInfo(null);
    setKingdomCardOpen(false);
    setSelectedCubeId(toast.focusCubeId);
    worldRef.current?.focusOnCube(toast.focusCubeId);
    dispatch({ type: 'DISMISS_TOAST', id: toast.id });
  };

  // Element 5.4: Inspector shortage fix button -> arm producer & fly to rocky cell for mines
  const handleFixHint = (producerTheme: ThemeId) => {
    const def = THEMES[producerTheme];
    setSelectedCubeId(null);
    setSelectedCitizenId(null);
    setFollowCitizenId(null);
    setCitizenInfo(null);
    setKingdomCardOpen(false);
    setOpenBuildCategory(def.category);
    const canArm =
      state.gold >= def.cost &&
      checkMaterialCosts(state.warehouse, producerTheme, state.level).ok;
    setActiveBuildTheme(canArm ? producerTheme : null);
    setInspectedShortTheme(canArm ? null : producerTheme);
    setPulsingTheme(producerTheme);

    if (def.rockyOnly || producerTheme === 'quarry') {
      const ownedRocky = findNearestCube(
        state.cubes,
        (c) => c.owner === 'player' && c.isRocky && !c.themeId && !c.secondThemeId
      );
      if (ownedRocky) {
        worldRef.current?.focusOnCube(ownedRocky.id);
        return;
      }
      const purchasableRocky = findNearestCube(
        state.cubes,
        (c) => isPurchasableNeutralCube(state.cubes, c) && c.isRocky
      );
      if (purchasableRocky) {
        worldRef.current?.focusOnCube(purchasableRocky.id);
        return;
      }
    }

    const emptyOwned = findNearestCube(
      state.cubes,
      (c) => c.owner === 'player' && !c.themeId && !c.secondThemeId
    );
    if (emptyOwned) {
      worldRef.current?.focusOnCube(emptyOwned.id);
    }
  };

  // Element 2.4: Build missing material producer (wood -> forest, stone -> quarry, etc.)
  const handleBuildProducer = (resource: TradedResourceKey) => {
    const producerTheme = MATERIAL_PRODUCER_THEME[resource];
    if (!producerTheme) return;
    handleFixHint(producerTheme);
  };

  const handleBuyMaterials = (
    items: Partial<Record<TradedResourceKey, number>>
  ) => {
    dispatch({ type: 'BUY_MATERIALS', items });
  };

  const handleDemolish = (cubeId: number, slot: SlotIndex) => {
    dispatch({ type: 'DEMOLISH_THEME', cubeId, slot });
  };

  // Element 7 & 9: Housing fax "ابنِ بيتاً" CTA -> close overlay, arm house (or show material card), focus land
  const handleBuildHouseFromFax = () => {
    setOpenOfficeTab(null);
    setSelectedCubeId(null);
    setSelectedCitizenId(null);
    setFollowCitizenId(null);
    setCitizenInfo(null);
    setKingdomCardOpen(false);

    const houseDef = THEMES.house;
    setOpenBuildCategory(houseDef.category);
    const canArm =
      state.gold >= houseDef.cost &&
      checkMaterialCosts(state.warehouse, 'house', state.level).ok;
    setActiveBuildTheme(canArm ? 'house' : null);
    setInspectedShortTheme(canArm ? null : 'house');
    setPulsingTheme('house');

    const emptyOwned = findNearestCube(
      state.cubes,
      (c) =>
        c.owner === 'player' &&
        (!c.themeId || (c.themeId === 'house' && !c.secondThemeId))
    );
    const target = emptyOwned ?? findPalaceCube(state.cubes);
    if (target) {
      worldRef.current?.focusOnCube(target.id);
    }
  };

  const handleOpenAdvisor = (tab?: AdvisorTab) => {
    setAdvisorInitialTab(tab);
    setAdvisorOverlayOpen(true);
  };

  const handleExecuteAdvisorAction = (
    action: AdvisorAction,
    meta: { labelAr: string; projectedAr: string; faxId?: string }
  ) => {
    setAdvisorOverlayOpen(false);
    dispatch({
      type: 'LOG_ADVISOR_ACTION',
      labelAr: meta.labelAr,
      projectedAr: meta.projectedAr,
      faxId: meta.faxId,
    });

    if (action.type === 'arm_theme') {
      if (action.themeId === 'house') {
        handleBuildHouseFromFax();
      } else {
        handleFixHint(action.themeId);
      }
    } else if (action.type === 'open_bourse') {
      if (state.level >= 2) {
        setBourseModalOpen(true);
      } else {
        setSelectedCubeId(null);
        setKingdomCardOpen(true);
      }
    } else if (action.type === 'open_bank') {
      setBankOverlayOpen(true);
    } else if (action.type === 'focus_cube') {
      setActiveBuildTheme(null);
      setInspectedShortTheme(null);
      setPulsingTheme(null);
      setOpenBuildCategory(null);
      setSelectedCitizenId(null);
      setFollowCitizenId(null);
      setCitizenInfo(null);
      setKingdomCardOpen(false);
      setSelectedCubeId(action.cubeId);
      worldRef.current?.focusOnCube(action.cubeId);
    }
  };

  // Prompt 8 Element 3.3 & Harden 3: Trade handler enforces 500/day cap when online and pushes volume delta to worldBourse/current
  const handleTradeResource = (
    resource: TradedResourceKey,
    side: 'buy' | 'sell',
    quantity: number | 'max'
  ) => {
    if (!isWorldBourseActive || !worldUser) {
      dispatch({ type: 'TRADE_RESOURCE', resource, side, quantity });
      return;
    }

    const usedToday = Math.max(
      0,
      Math.floor(worldBourseUsedToday[resource] ?? 0)
    );
    const remainingCap = Math.max(0, ONLINE_BOURSE_DAILY_KINGDOM_CAP - usedToday);
    if (remainingCap <= 0) return;

    // Mirror exact traded quantity so local optimistic count matches Firestore transaction
    const curState = latestStateRef.current;
    let expectedQty = 0;
    if (side === 'buy') {
      const unitBuy = getEffectiveBuyPrice(curState.prices[resource], curState.cubes);
      const maxAff = unitBuy > 0 ? Math.floor(curState.gold / unitBuy) : 0;
      const raw = quantity === 'max' ? maxAff : Math.max(0, Math.min(quantity, maxAff));
      expectedQty = Math.min(raw, remainingCap);
    } else {
      const unitSell = getSellPrice(curState.prices[resource], curState.cubes);
      const inStock = Math.max(0, curState.warehouse[resource] ?? 0);
      const raw = quantity === 'max' ? inStock : Math.max(0, Math.min(quantity, inStock));
      expectedQty = unitSell > 0 ? Math.min(raw, remainingCap) : 0;
    }

    dispatch({
      type: 'TRADE_RESOURCE',
      resource,
      side,
      quantity,
      maxQuantityCap: remainingCap,
    });

    if (expectedQty > 0) {
      setWorldBourseUsedToday((prev) => ({
        ...prev,
        [resource]: Math.min(
          ONLINE_BOURSE_DAILY_KINGDOM_CAP,
          (prev[resource] ?? 0) + expectedQty
        ),
      }));
      void ensureAndRollWorldBourse(Date.now()).then(() =>
        pushWorldBourseVolumeDeltas(
          worldUser.uid,
          side === 'buy'
            ? { bought: { [resource]: expectedQty } }
            : { sold: { [resource]: expectedQty } }
        ).then((serverCounts) => {
          if (serverCounts) setWorldBourseUsedToday(serverCounts);
        })
      );
    }
  };

  // Prompt 8 Element 1 & 2 Auth/Sync Handlers
  const handleSignInEmail = async (email: string, password: string) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithEmail(email, password);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'تعذر تسجيل الدخول');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignUpEmail = async (email: string, password: string) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signUpWithEmail(email, password);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'تعذر إنشاء الحساب');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignInGoogle = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'تعذر الدخول بحساب Google');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOutWorld = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      if (worldUser) {
        setCloudSyncStatus('pending');
        await uploadCloudSave(worldUser.uid, latestStateRef.current);
      }
      await signOutWorld();
      setCloudSyncStatus('local-only');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'تعذر تسجيل الخروج');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleUpdateWorldProfile = (kingdomNameAr: string, rulerName: string) => {
    dispatch({
      type: 'SET_WORLD_PROFILE',
      kingdomNameAr,
      rulerName,
    });
    if (onlineConfigEnabled && worldUser) {
      const pos = myWorldKingdom
        ? { wx: myWorldKingdom.wx, wy: myWorldKingdom.wy }
        : latestStateRef.current.myWorldPos ?? null;
      if (pos) {
        void updateWorldKingdomRegistry(
          worldUser.uid,
          { ...latestStateRef.current, kingdomNameAr, rulerName },
          pos,
          worldUser.displayName
        ).then((updated) => {
          if (updated) setMyWorldKingdom(updated);
        });
      }
    }
  };

  const handleSyncCloudNow = () => {
    if (!onlineConfigEnabled || !worldUser) return;
    setCloudSyncStatus('pending');
    void uploadCloudSave(worldUser.uid, latestStateRef.current).then((res) => {
      setCloudSyncStatus(res.ok ? 'synced' : 'local-only');
    });
  };

  const handleNewGame = () => {
    setActiveBuildTheme(null);
    setInspectedShortTheme(null);
    setPulsingTheme(null);
    setOpenBuildCategory(null);
    setObjectivesOpen(false);
    setProvincesOpen(false);
    setSelectedCubeId(null);
    setSelectedCitizenId(null);
    setFollowCitizenId(null);
    setCitizenInfo(null);
    setKingdomCardOpen(false);
    setInspectorTab('info');
    setBourseModalOpen(false);
    setShowLevel2Modal(false);
    setShowLevel3Modal(false);
    setOpenOfficeTab(null);
    setBankOverlayOpen(false);
    setAdvisorOverlayOpen(false);
    setSharedWorldOpen(false);
    setAwayReport(null);
    dispatch({ type: 'NEW_GAME' });
    setResetSignal((n) => n + 1);
  };

  const handleCloseLevel2Modal = () => {
    setShowLevel2Modal(false);
    dispatch({ type: 'CLEAR_LEVEL2_NOTICE' });
  };

  const handleCloseLevel3Modal = () => {
    setShowLevel3Modal(false);
    dispatch({ type: 'CLEAR_LEVEL2_COMPLETED_NOTICE' });
  };

  return (
    <div
      dir="rtl"
      className="h-dvh w-full flex flex-col bg-[#0E3A34] overflow-hidden"
    >
      {/* Slim Top Bar (48px) */}
      <TopBar
        state={state}
        cloudSyncStatus={cloudSyncStatus}
        onOpenSharedWorld={() => setSharedWorldOpen(true)}
        onOpenAdvisor={() => handleOpenAdvisor()}
        onOpenBourse={() => setBourseModalOpen(true)}
        onOpenSettings={() => setSettingsModalOpen(true)}
      />

      {/* Gold Bourse News Ticker */}
      <Ticker
        message={state.tickerMessage}
        level={state.level}
        onOpenBourse={() => setBourseModalOpen(true)}
      />

      {/* Explicit Clickable Milestone Notice Banners (never auto-opening modals) */}
      {(state.level2UnlockedNotice || state.level2CompletedNotice) && (
        <div className="w-full bg-[#11453E] border-b border-[#C9962E]/50 px-3 py-1 flex items-center justify-center gap-2 flex-wrap shrink-0">
          {state.level2UnlockedNotice && (
            <button
              type="button"
              onClick={() => setShowLevel2Modal(true)}
              className="flex items-center gap-1.5 px-3.5 py-1 rounded-lg bg-[#C9962E] hover:bg-[#D8A73F] text-[#2B2118] text-xs font-extrabold shadow-sm transition-colors"
            >
              <Award className="w-3.5 h-3.5" />
              <span>{STRINGS.level2ReadyBanner}</span>
            </button>
          )}
          {state.level2CompletedNotice && (
            <button
              type="button"
              onClick={() => setShowLevel3Modal(true)}
              className="flex items-center gap-1.5 px-3.5 py-1 rounded-lg bg-[#C9962E] hover:bg-[#D8A73F] text-[#2B2118] text-xs font-extrabold shadow-sm transition-colors"
            >
              <Award className="w-3.5 h-3.5" />
              <span>{STRINGS.level3ReadyBanner}</span>
            </button>
          )}
        </div>
      )}

      {/* Main Viewport: Desktop RTL Right=56px Icon Rail + Full-Bleed Map; Mobile Full-Bleed Map + 56px Bottom Icon Bar */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Desktop Icon Rail sits on the RIGHT in RTL; Mobile Icon Bar renders via flex order at bottom */}
        <div className="order-2 lg:order-1 flex shrink-0">
          <BuildDock
            gold={state.gold}
            level={state.level}
            warehouse={state.warehouse}
            prices={state.prices}
            cubes={state.cubes}
            activeBuildTheme={activeBuildTheme}
            inspectedShortTheme={inspectedShortTheme}
            openCategory={openBuildCategory}
            pulsingTheme={pulsingTheme}
            kingdomOpen={kingdomCardOpen}
            pendingLandRequests={state.landRequests.length}
            onToggleCategory={handleToggleCategory}
            onSelectTheme={handleSelectBuildTheme}
            onInspectShortTheme={setInspectedShortTheme}
            onBuyMaterials={handleBuyMaterials}
            onBuildProducer={handleBuildProducer}
            onToggleKingdom={handleToggleKingdom}
          />
        </div>

        {/* Full-Bleed 3D Isometric RTS World Canvas */}
        <div className="order-1 lg:order-2 flex-1 min-w-0 min-h-0 flex relative">
          <WorldCanvas
            ref={worldRef}
            cubes={state.cubes}
            level={state.level}
            population={state.population}
            satisfaction={state.satisfaction}
            selectedCubeId={selectedCubeId}
            selectedCitizenId={selectedCitizenId}
            followCitizenId={followCitizenId}
            activeBuildTheme={activeBuildTheme}
            staffedSlots={staffing.staffedSlots}
            provinces={state.provinces}
            camp={state.camp}
            citizens={state.citizens}
            lastJoinedVillageCubeId={state.lastJoinedVillageCubeId}
            lastJoinedVillageSeq={state.lastJoinedVillageSeq}
            lastDefectedCubeId={state.lastDefectedCubeId}
            lastDefectedSeq={state.lastDefectedSeq}
            resetSignal={resetSignal}
            onCubeClick={handleCubeClick}
            onCitizenClick={handleCitizenClick}
            onCancelBuild={() => {
              setActiveBuildTheme(null);
              setInspectedShortTheme(null);
              setPulsingTheme(null);
            }}
            onRecenter={() => setFollowCitizenId(null)}
          >
            {/* Top-left Map Chips: Objectives + Provinces (both closed by default, open ONLY on user click) */}
            <div className="absolute top-3 left-3 z-20 flex flex-col items-start max-w-[calc(100%-24px)]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <ObjectivesChip
                  state={state}
                  isOpen={objectivesOpen}
                  onToggle={() => {
                    setProvincesOpen(false);
                    setObjectivesOpen((prev) => !prev);
                  }}
                />
                <ProvincePanelChip
                  provinceCount={state.provinces.length}
                  pendingArrivals={state.pendingArrivals}
                  isOpen={provincesOpen}
                  onToggle={() => {
                    setObjectivesOpen(false);
                    setProvincesOpen((prev) => !prev);
                  }}
                />
              </div>

              <Objectives
                state={state}
                isOpen={objectivesOpen}
                onToggle={() => setObjectivesOpen((prev) => !prev)}
                onSelectObjective={handleSelectObjective}
                embedded
              />

              <ProvincePanel
                state={state}
                isOpen={provincesOpen}
                onToggle={() => setProvincesOpen((prev) => !prev)}
                onFlyToProvince={(centerCubeId) => {
                  setFollowCitizenId(null);
                  worldRef.current?.highlightProvinceCenter(centerCubeId);
                }}
                onFlyToCube={(cubeId) => {
                  setFollowCitizenId(null);
                  worldRef.current?.focusOnCube(cubeId);
                }}
              />
            </div>
          </WorldCanvas>
        </div>
      </div>

      {/* Element 1.3: Floating Overlay Inspector / Citizen / Kingdom Card (unmounts when nothing selected) */}
      <Inspector
        state={state}
        selectedCube={selectedCube}
        selectedCitizen={citizenInfo}
        isFollowingCitizen={
          selectedCitizenId !== null && followCitizenId === selectedCitizenId
        }
        kingdomOpen={kingdomCardOpen}
        staffing={staffing}
        activeTab={inspectorTab}
        activeBuildTheme={activeBuildTheme}
        inspectedShortTheme={inspectedShortTheme}
        onChangeTab={setInspectorTab}
        onClose={handleCloseOverlayCard}
        onToggleFollowCitizen={handleToggleFollowCitizen}
        onBuyCube={(cubeId) => dispatch({ type: 'BUY_CUBE', cubeId })}
        onDemolishTheme={handleDemolish}
        onFixHint={handleFixHint}
        onBuyMaterials={handleBuyMaterials}
        onBuildProducer={handleBuildProducer}
        onOpenOffice={(tab) => setOpenOfficeTab(tab)}
        onOpenBank={() => setBankOverlayOpen(true)}
        onOpenAdvisor={handleOpenAdvisor}
        onSetTaxPolicy={(mode, percent) =>
          dispatch({ type: 'SET_TAX_POLICY', mode, percent })
        }
        onBuybackCube={(cubeId) => dispatch({ type: 'BUYBACK_CUBE', cubeId })}
        onResolveLandRequest={(requestId, approve) =>
          dispatch({ type: 'RESOLVE_LAND_REQUEST', requestId, approve })
        }
        isWorldBourse={isWorldBourseActive}
        worldBourseDay={worldBourse?.day ?? null}
        worldBourseUsedToday={worldBourseUsedToday}
        onTrade={handleTradeResource}
      />

      {/* Element 7 & 9: Palace Offices Overlay (opens ONLY on explicit chip click, never auto-opens) */}
      {openOfficeTab !== null && (
        <PalaceOfficesOverlay
          state={state}
          activeTab={openOfficeTab}
          onChangeTab={setOpenOfficeTab}
          onBuildHouseFromFax={handleBuildHouseFromFax}
          onClose={() => setOpenOfficeTab(null)}
        />
      )}

      {/* Prompt 5 Element 4: Bank Overlay (opens ONLY on explicit chip click, never auto-opens) */}
      {bankOverlayOpen && (
        <BankOverlay
          state={state}
          onClose={() => setBankOverlayOpen(false)}
          onTakeLoan={(principal, termMonths, collateralCubeIds) =>
            dispatch({ type: 'TAKE_LOAN', principal, termMonths, collateralCubeIds })
          }
          onRepayLoanFull={() => dispatch({ type: 'REPAY_LOAN_FULL' })}
        />
      )}

      {/* Prompt 6 Element 4: Royal Advisor Overlay (opens ONLY on explicit click, never auto-opens) */}
      {advisorOverlayOpen && (
        <AdvisorOverlay
          state={state}
          initialTab={advisorInitialTab}
          onExecuteAction={handleExecuteAdvisorAction}
          onSetFaxStatus={(faxId, status) =>
            dispatch({ type: 'SET_FAX_STATUS', faxId, status })
          }
          onMarkAllFaxesRead={() => dispatch({ type: 'MARK_ALL_FAXES_READ' })}
          onClose={() => setAdvisorOverlayOpen(false)}
        />
      )}

      {/* Prompt 8 Element 1: Shared World Auth, Registry & Cloud Sync Overlay (never auto-opens) */}
      {sharedWorldOpen && (
        <SharedWorldOverlay
          state={state}
          onlineConfigEnabled={onlineConfigEnabled}
          user={worldUser}
          myKingdom={myWorldKingdom}
          syncStatus={cloudSyncStatus}
          worldBourseDay={worldBourse?.day ?? null}
          authBusy={authBusy}
          authError={authError}
          onSignInEmail={handleSignInEmail}
          onSignUpEmail={handleSignUpEmail}
          onSignInGoogle={handleSignInGoogle}
          onSignOut={handleSignOutWorld}
          onUpdateProfile={handleUpdateWorldProfile}
          onSyncNow={handleSyncCloudNow}
          onClose={() => setSharedWorldOpen(false)}
        />
      )}

      {/* Element 1.5 & 5.3: Bottom-left Toasts (with clickable focusCubeId navigation) */}
      <Toasts
        toasts={state.toasts}
        hasOverlayCard={hasOverlayCard}
        onDismiss={(id) => dispatch({ type: 'DISMISS_TOAST', id })}
        onFocusToast={handleFocusToast}
      />

      {/* Non-pausing Parchment Modals */}
      {awayReport && (
        <AwayReport report={awayReport} onClose={() => setAwayReport(null)} />
      )}

      {bourseModalOpen && state.level >= 2 && (
        <BourseModal
          state={state}
          isWorldBourse={isWorldBourseActive}
          worldBourseDay={worldBourse?.day ?? null}
          worldBourseUsedToday={worldBourseUsedToday}
          onTrade={handleTradeResource}
          onClose={() => setBourseModalOpen(false)}
        />
      )}

      {showLevel2Modal && (
        <Level2CelebrationModal onClose={handleCloseLevel2Modal} />
      )}

      {showLevel3Modal && (
        <Level3ComingSoonModal onClose={handleCloseLevel3Modal} />
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
