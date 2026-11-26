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
import { EmbassyOverlay } from './components/EmbassyOverlay';
import { MarketOverlay } from './components/MarketOverlay';
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
import { WorldMapOverlay } from './components/WorldMapOverlay';
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
  applyVisaDepartureLocally,
  pickVisaApplicants,
} from './game/visas';
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
  getWorldEpochDay,
  pushWorldBourseVolumeDeltas,
  subscribeWorldBourse,
} from './net/worldBourse';
import {
  approveEmbassyProposal,
  collectEmbassyPayments,
  fetchMyEmbassyAgreements,
  fetchMyEmbassyPayment,
  getActiveAlliedUids,
  processEmbassyMonthlyFees,
  proposeEmbassy,
  reconcileEmbassyPlots,
  rejectEmbassyProposal,
  requestDissolveEmbassy,
  settleEmbassyPricesDue,
} from './net/worldEmbassies';
import { fetchWorldKingdomsNearest } from './net/worldMap';
import {
  buyListing,
  cancelListing,
  checkMarketReturnsDue,
  collectClaims,
  executeOnlineCitizenFoodImport,
  fetchActiveMarketListings,
  fetchMyMarketClaim,
  fetchMyMarketListings,
  listResource,
} from './net/worldMarket';
import {
  buildLocalFromWorldLines,
  fetchOrCreateDailyWorldNewsletter,
} from './net/worldNewsletter';
import {
  grantVisaTransaction,
  receiveGrantedVisas,
} from './net/worldVisas';
import {
  ONLINE_BOURSE_DAILY_KINGDOM_CAP,
  type CloudSyncStatus,
  type EmbassyAgreement,
  type MarketListing,
  type OnlineWorldUser,
  type WorldBourse,
  type WorldKingdom,
  type WorldNewsletter,
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
  const [marketOverlayOpen, setMarketOverlayOpen] = useState(false);
  const [marketFilterSellerUid, setMarketFilterSellerUid] = useState<string | null>(null);
  const [embassyOverlayOpen, setEmbassyOverlayOpen] = useState(false);
  const [embassyTargetHostUid, setEmbassyTargetHostUid] = useState<string | null>(null);
  const [worldMapOpen, setWorldMapOpen] = useState(false);
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
  const [worldKingdoms, setWorldKingdoms] = useState<WorldKingdom[]>([]);
  const [marketListings, setMarketListings] = useState<MarketListing[]>([]);
  const [myMarketListings, setMyMarketListings] = useState<MarketListing[]>([]);
  const [pendingMarketClaimGold, setPendingMarketClaimGold] = useState(0);
  const [embassyAgreements, setEmbassyAgreements] = useState<EmbassyAgreement[]>([]);
  const [pendingEmbassyPaymentGold, setPendingEmbassyPaymentGold] = useState(0);
  const [worldNewsletter, setWorldNewsletter] = useState<WorldNewsletter | null>(null);
  const [worldPanelBusy, setWorldPanelBusy] = useState(false);
  const [worldPanelError, setWorldPanelError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const isOnlineSession = Boolean(onlineConfigEnabled && worldUser);
  const isWorldBourseActive = Boolean(
    onlineConfigEnabled && worldUser && worldBourse
  );
  const isWorldBourseActiveRef = useRef(isWorldBourseActive);
  isWorldBourseActiveRef.current = isWorldBourseActive;

  const latestStateRef = useRef(state);
  latestStateRef.current = state;
  const worldBourseRef = useRef(worldBourse);
  worldBourseRef.current = worldBourse;
  const worldKingdomsRef = useRef(worldKingdoms);
  worldKingdomsRef.current = worldKingdoms;
  const embassyAgreementsRef = useRef(embassyAgreements);
  embassyAgreementsRef.current = embassyAgreements;
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
        setWorldKingdoms([]);
        setMarketListings([]);
        setMyMarketListings([]);
        setPendingMarketClaimGold(0);
        setEmbassyAgreements([]);
        setPendingEmbassyPaymentGold(0);
        setWorldNewsletter(null);
        setWorldPanelError(null);
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
        // Hydrate Shared World directory, market, embassies, visas & daily newsletter
        const myPosNow = workingState.myWorldPos ?? { wx: 0, wy: 0 };
        const epochDay = getWorldEpochDay(Date.now());
        const [
          nearestKingdoms,
          agreements,
          activeListings,
          mineListings,
          claimGold,
          embassyPayGold,
        ] = await Promise.all([
          fetchWorldKingdomsNearest(myPosNow, 200),
          fetchMyEmbassyAgreements(worldUser.uid),
          fetchActiveMarketListings(epochDay),
          fetchMyMarketListings(worldUser.uid),
          fetchMyMarketClaim(worldUser.uid),
          fetchMyEmbassyPayment(worldUser.uid),
        ]);
        if (!active) return;

        setWorldKingdoms(nearestKingdoms);
        setEmbassyAgreements(agreements);
        setMarketListings(activeListings);
        setMyMarketListings(mineListings);
        setPendingMarketClaimGold(claimGold);
        setPendingEmbassyPaymentGold(embassyPayGold);

        const reconciledPlots = reconcileEmbassyPlots(
          workingState.embassyPlots,
          agreements,
          worldUser.uid,
          workingState.cubes,
          workingState.camp.cubeId
        );
        dispatch({ type: 'SET_EMBASSY_PLOTS', plots: reconciledPlots });

        const awayWorldLines: string[] = [];

        // Return any expired market listings
        const expiredReturns = await checkMarketReturnsDue(worldUser.uid, epochDay);
        if (!active) return;
        let returnedUnitsTotal = 0;
        for (const [resKey, qty] of Object.entries(
          expiredReturns.returned
        ) as Array<[TradedResourceKey, number | undefined]>) {
          if (!qty || qty <= 0) continue;
          returnedUnitsTotal += qty;
          dispatch({
            type: 'RETURN_MARKET_STOCK',
            resource: resKey,
            qty,
            toastMessage: `استرداد ${qty} ${STRINGS.resources[resKey]} بعد انتهاء العرض`,
          });
          awayWorldLines.push(
            `عادت ${qty} وحدة ${STRINGS.resources[resKey]} من عرض منتهي في السوق العالمي`
          );
        }

        // Receive pending granted visas (atomic granted -> received)
        const arrivedVisas = await receiveGrantedVisas(worldUser.uid);
        if (!active) return;
        if (arrivedVisas.length > 0) {
          dispatch({ type: 'APPLY_VISA_ARRIVALS', arrivals: arrivedVisas });
          awayWorldLines.push(
            `وصل ${arrivedVisas.length} مسافر بتأشيرة من الممالك المجاورة`
          );
        }

        if (claimGold > 0) {
          awayWorldLines.push(`لديك ${claimGold} ذهب مستحقات مبيعات السوق العالمي بانتظار التحصيل`);
        }
        if (embassyPayGold > 0) {
          awayWorldLines.push(`لديك ${embassyPayGold} ذهب عائد استضافة سفارات بانتظار التحصيل`);
        }

        if (awayWorldLines.length > 0) {
          setAwayReport((prev) =>
            prev
              ? {
                  ...prev,
                  worldSummary: {
                    feesPaid: prev.worldSummary?.feesPaid ?? 0,
                    arrearsAdded: prev.worldSummary?.arrearsAdded ?? 0,
                    settlementsPaid: prev.worldSummary?.settlementsPaid ?? 0,
                    settlementsCollected: prev.worldSummary?.settlementsCollected ?? 0,
                    visasDeparted: prev.worldSummary?.visasDeparted ?? 0,
                    visasArrived:
                      (prev.worldSummary?.visasArrived ?? 0) + arrivedVisas.length,
                    marketReturnsUnits:
                      (prev.worldSummary?.marketReturnsUnits ?? 0) + returnedUnitsTotal,
                    lines: [
                      ...(prev.worldSummary?.lines ?? []),
                      ...awayWorldLines,
                    ],
                  },
                }
              : prev
          );
        }

        const activeEmbCount = agreements.filter((a) => a.status === 'active').length;
        const nl = await fetchOrCreateDailyWorldNewsletter({
          epochDay,
          localState: workingState,
          worldBourse: initialBourse,
          kingdoms: nearestKingdoms,
          activeEmbassiesCount: activeEmbCount,
        });
        if (active && nl) {
          setWorldNewsletter(nl);
        }

        setCloudSyncStatus('synced');
      }
    };

    void bootstrapOnlineSession();
    return () => {
      active = false;
      if (unsubBourse) unsubBourse();
    };
  }, [onlineConfigEnabled, worldUser]);

  // Element N5.1: Online-only monthly append order AFTER local monthly processor completes
  // 1. Citizen living-demand market import (M1.4)
  // 2. Embassy monthly fees (N1.4)
  // 3. Embassy land-price settlements due (N1.2)
  // 4. Visa grants (N3.3)
  // 5. Visa arrivals intake (N3.4)
  // 6. Market returns-due (M1.2)
  // 7. Cloud sync + registry update + People's Bank volume push (Part 1) + newsletter refresh
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
      : snapshot.myWorldPos ?? { wx: 0, wy: 0 };

    const runMonthSync = async () => {
      const epochDay = getWorldEpochDay(Date.now());
      let workingGold = snapshot.gold;

      // (1) Citizen living-demand online market import (M1.4)
      if (
        (snapshot.lastImportedFoodUnits ?? 0) > 0 &&
        snapshot.lastMonthStats.importSink > 0
      ) {
        const importRes = await executeOnlineCitizenFoodImport({
          buyerUid: worldUser.uid,
          myReputation: snapshot.reputation,
          neededUnits: snapshot.lastImportedFoodUnits ?? 0,
          availableCitizenImportGold: snapshot.lastMonthStats.importSink,
          currentWorldDay: epochDay,
        });
        if (!cancelled && importRes.boughtQty > 0 && importRes.buyerPays > 0) {
          dispatch({
            type: 'SETTLE_CITIZEN_MARKET_IMPORT',
            buyerPays: importRes.buyerPays,
            boughtQty: importRes.boughtQty,
          });
        }
      }

      // Refresh agreements before embassy fee/settlement steps
      let liveAgreements = await fetchMyEmbassyAgreements(worldUser.uid);
      if (cancelled) return;

      // (2) Embassy monthly fees (N1.4) — uses held worldInflationIndex, never guesses
      const feeRes = await processEmbassyMonthlyFees({
        guestUid: worldUser.uid,
        totalMonths: snapshot.totalMonths,
        worldInflationIndex: worldBourseRef.current?.inflationIndex ?? null,
        availableGold: workingGold,
        agreements: liveAgreements,
      });
      if (!cancelled && feeRes.totalFeesPaid > 0) {
        workingGold = Math.max(0, workingGold - feeRes.totalFeesPaid);
        dispatch({
          type: 'APPLY_EMBASSY_FEE_PAYMENT',
          amount: feeRes.totalFeesPaid,
        });
      }

      // (3) Embassy land-price settlements due (N1.2)
      const latestAgreementsAfterFee =
        feeRes.updatedAgreements.length > 0
          ? await fetchMyEmbassyAgreements(worldUser.uid)
          : liveAgreements;
      if (cancelled) return;
      liveAgreements = latestAgreementsAfterFee;

      const settleRes = await settleEmbassyPricesDue({
        guestUid: worldUser.uid,
        agreements: liveAgreements,
        availableGold: workingGold,
      });
      if (!cancelled && settleRes.totalSettledGold > 0) {
        workingGold = Math.max(0, workingGold - settleRes.totalSettledGold);
        dispatch({
          type: 'APPLY_EMBASSY_PRICE_SETTLEMENT',
          amount: settleRes.totalSettledGold,
        });
      }

      if (settleRes.settledAgreements.length > 0) {
        liveAgreements = await fetchMyEmbassyAgreements(worldUser.uid);
        if (cancelled) return;
      }
      setEmbassyAgreements(liveAgreements);
      const nextPlots = reconcileEmbassyPlots(
        latestStateRef.current.embassyPlots,
        liveAgreements,
        worldUser.uid,
        latestStateRef.current.cubes,
        latestStateRef.current.camp.cubeId
      );
      dispatch({ type: 'SET_EMBASSY_PLOTS', plots: nextPlots });

      // (4) Visa grants (N3.3) — only when borderOpen
      if (snapshot.borderOpen) {
        const applicants = pickVisaApplicants(
          snapshot,
          worldKingdomsRef.current,
          pos,
          worldUser.uid
        );
        for (const app of applicants) {
          if (cancelled) return;
          const preview = applyVisaDepartureLocally(
            latestStateRef.current,
            app.citizenId,
            snapshot.totalMonths
          );
          if (!preview) continue; // Wealth < 20 -> lapses silently, no debt, no departure
          const gRes = await grantVisaTransaction({
            fromUid: worldUser.uid,
            fromKingdomNameAr: snapshot.kingdomNameAr ?? STRINGS.appName,
            toUid: app.toUid,
            snapshot: preview.snapshot,
            month: snapshot.totalMonths,
            citizenId: app.citizenId,
          });
          if (!cancelled && gRes.ok && gRes.visaId) {
            dispatch({
              type: 'APPLY_VISA_DEPARTURE',
              citizenId: app.citizenId,
              toUid: app.toUid,
              toKingdomNameAr: app.toKingdomNameAr,
              visaId: gRes.visaId,
            });
          }
        }
      }

      // (5) Visa arrivals intake (N3.4)
      const arrivedVisas = await receiveGrantedVisas(worldUser.uid);
      if (!cancelled && arrivedVisas.length > 0) {
        dispatch({ type: 'APPLY_VISA_ARRIVALS', arrivals: arrivedVisas });
      }

      // (6) Market returns-due (M1.2)
      const returns = await checkMarketReturnsDue(worldUser.uid, epochDay);
      if (!cancelled) {
        for (const [resKey, qty] of Object.entries(
          returns.returned
        ) as Array<[TradedResourceKey, number | undefined]>) {
          if (!qty || qty <= 0) continue;
          dispatch({
            type: 'RETURN_MARKET_STOCK',
            resource: resKey,
            qty,
            toastMessage: `عادت ${qty} ${STRINGS.resources[resKey]} بعد انتهاء مدة العرض`,
          });
        }
      }

      // (7) Cloud save backup + registry update + People's Bank volume push + newsletter check
      const finalSnap = latestStateRef.current;
      const up = await uploadCloudSave(worldUser.uid, finalSnap);

      try {
        const updatedKingdom = await updateWorldKingdomRegistry(
          worldUser.uid,
          finalSnap,
          pos,
          worldUser.displayName
        );
        if (!cancelled && updatedKingdom) {
          setMyWorldKingdom(updatedKingdom);
        }
      } catch {
        // Non-fatal
      }

      const hasBankVol =
        Object.values(finalSnap.dailyBought).some((v) => v > 0) ||
        Object.values(finalSnap.dailySold).some((v) => v > 0);
      if (hasBankVol) {
        const nextCounts = await pushWorldBourseVolumeDeltas(worldUser.uid, {
          bought: finalSnap.dailyBought,
          sold: finalSnap.dailySold,
        });
        if (!cancelled && nextCounts) {
          setWorldBourseUsedToday(nextCounts);
        }
      }

      const [claimGold, embassyPayGold, nl] = await Promise.all([
        fetchMyMarketClaim(worldUser.uid),
        fetchMyEmbassyPayment(worldUser.uid),
        fetchOrCreateDailyWorldNewsletter({
          epochDay,
          localState: finalSnap,
          worldBourse: worldBourseRef.current,
          kingdoms: worldKingdomsRef.current,
          activeEmbassiesCount: liveAgreements.filter((a) => a.status === 'active').length,
        }),
      ]);
      if (!cancelled) {
        setPendingMarketClaimGold(claimGold);
        setPendingEmbassyPaymentGold(embassyPayGold);
        if (nl) setWorldNewsletter(nl);
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
      if (worldMapOpen) {
        setWorldMapOpen(false);
      } else if (embassyOverlayOpen) {
        setEmbassyOverlayOpen(false);
      } else if (marketOverlayOpen) {
        setMarketOverlayOpen(false);
      } else if (sharedWorldOpen) {
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
    worldMapOpen,
    embassyOverlayOpen,
    marketOverlayOpen,
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

  // Prompt 8 Part 2 & 3 interactive Shared World handlers (Market, Embassies, World Map)
  const alliedUids = useMemo(
    () => getActiveAlliedUids(embassyAgreements, worldUser?.uid ?? null),
    [embassyAgreements, worldUser]
  );

  const kingdomsByUid = useMemo(() => {
    const map = new Map<string, WorldKingdom>();
    for (const k of worldKingdoms) map.set(k.uid, k);
    return map;
  }, [worldKingdoms]);

  const pendingIncomingEmbassyCount = useMemo(() => {
    if (!worldUser) return 0;
    return embassyAgreements.filter(
      (a) => a.hostUid === worldUser.uid && a.status === 'pending'
    ).length;
  }, [embassyAgreements, worldUser]);

  const worldFromLocalLines = useMemo(() => {
    if (!isWorldBourseActive || !worldBourse) return [];
    return buildLocalFromWorldLines(worldBourse, state.inflationIndex);
  }, [isWorldBourseActive, worldBourse, state.inflationIndex]);

  const refreshMarketState = async () => {
    if (!onlineConfigEnabled || !worldUser) return;
    setWorldPanelBusy(true);
    setWorldPanelError(null);
    try {
      const epochDay = getWorldEpochDay(Date.now());
      const [activeL, mineL, claimGold] = await Promise.all([
        fetchActiveMarketListings(epochDay),
        fetchMyMarketListings(worldUser.uid),
        fetchMyMarketClaim(worldUser.uid),
      ]);
      setMarketListings(activeL);
      setMyMarketListings(mineL);
      setPendingMarketClaimGold(claimGold);
    } catch {
      setWorldPanelError('تعذر تحديث بيانات السوق العالمي');
    } finally {
      setWorldPanelBusy(false);
    }
  };

  const refreshEmbassyAndMapState = async () => {
    if (!onlineConfigEnabled || !worldUser) return;
    setWorldPanelBusy(true);
    setWorldPanelError(null);
    try {
      const myPos = myWorldKingdom
        ? { wx: myWorldKingdom.wx, wy: myWorldKingdom.wy }
        : latestStateRef.current.myWorldPos ?? { wx: 0, wy: 0 };
      const [kingdoms, agreements, payGold] = await Promise.all([
        fetchWorldKingdomsNearest(myPos, 200),
        fetchMyEmbassyAgreements(worldUser.uid),
        fetchMyEmbassyPayment(worldUser.uid),
      ]);
      setWorldKingdoms(kingdoms);
      setEmbassyAgreements(agreements);
      setPendingEmbassyPaymentGold(payGold);
      const nextPlots = reconcileEmbassyPlots(
        latestStateRef.current.embassyPlots,
        agreements,
        worldUser.uid,
        latestStateRef.current.cubes,
        latestStateRef.current.camp.cubeId
      );
      dispatch({ type: 'SET_EMBASSY_PLOTS', plots: nextPlots });
    } catch {
      setWorldPanelError('تعذر تحديث بيانات السفارات والخريطة');
    } finally {
      setWorldPanelBusy(false);
    }
  };

  const handleListMarketResource = async (
    resource: TradedResourceKey,
    qty: number,
    unitPrice: number,
    embassyOnly: boolean
  ) => {
    if (!onlineConfigEnabled || !worldUser) return;
    setWorldPanelBusy(true);
    setWorldPanelError(null);
    try {
      const cur = latestStateRef.current;
      const res = await listResource({
        uid: worldUser.uid,
        sellerNameAr: cur.kingdomNameAr ?? STRINGS.appName,
        sellerReputation: cur.reputation,
        resource,
        qty,
        unitPrice,
        embassyOnly,
        localWarehouseStock: cur.warehouse[resource] ?? 0,
      });
      if (!res.ok) {
        setWorldPanelError(res.errorAr ?? 'تعذر نشر العرض');
      } else {
        dispatch({ type: 'RESERVE_MARKET_LISTING', resource, qty });
        await refreshMarketState();
      }
    } finally {
      setWorldPanelBusy(false);
    }
  };

  const handleCancelMarketListing = async (listingId: string) => {
    if (!onlineConfigEnabled || !worldUser) return;
    setWorldPanelBusy(true);
    setWorldPanelError(null);
    try {
      const res = await cancelListing(worldUser.uid, listingId);
      if (!res.ok) {
        setWorldPanelError(res.errorAr ?? 'تعذر إلغاء العرض');
      } else {
        if (res.resource && res.returnedQty && res.returnedQty > 0) {
          dispatch({
            type: 'RETURN_MARKET_STOCK',
            resource: res.resource,
            qty: res.returnedQty,
            toastMessage: `تم إلغاء العرض واسترداد ${res.returnedQty} ${STRINGS.resources[res.resource]}`,
          });
        }
        await refreshMarketState();
      }
    } finally {
      setWorldPanelBusy(false);
    }
  };

  const handleBuyMarketListing = async (listingId: string, qty: number) => {
    if (!onlineConfigEnabled || !worldUser) return;
    setWorldPanelBusy(true);
    setWorldPanelError(null);
    try {
      const cur = latestStateRef.current;
      const res = await buyListing({
        buyerUid: worldUser.uid,
        listingId,
        qty,
        availableGold: cur.gold,
      });
      if (!res.ok || !res.resource || !res.boughtQty || res.buyerPays === undefined) {
        setWorldPanelError(res.errorAr ?? 'تعذر إتمام الشراء');
      } else {
        dispatch({
          type: 'APPLY_MARKET_PURCHASE',
          resource: res.resource,
          qty: res.boughtQty,
          buyerPays: res.buyerPays,
          sellerNameAr: res.sellerNameAr ?? 'مملكة',
        });
        await refreshMarketState();
      }
    } finally {
      setWorldPanelBusy(false);
    }
  };

  const handleCollectMarketClaims = async () => {
    if (!onlineConfigEnabled || !worldUser) return;
    setWorldPanelBusy(true);
    setWorldPanelError(null);
    try {
      const res = await collectClaims(worldUser.uid);
      if (!res.ok) {
        setWorldPanelError(res.errorAr ?? 'تعذر تحصيل المستحقات');
      } else if (res.collectedGold > 0) {
        dispatch({
          type: 'COLLECT_MARKET_CLAIMS',
          collectedGold: res.collectedGold,
          claimUpdatedAt: res.claimUpdatedAt,
        });
        setPendingMarketClaimGold(0);
      }
    } finally {
      setWorldPanelBusy(false);
    }
  };

  const handleProposeEmbassy = async (hostUid: string, priceAgreed: number) => {
    if (!onlineConfigEnabled || !worldUser) return;
    setWorldPanelBusy(true);
    setWorldPanelError(null);
    try {
      const cur = latestStateRef.current;
      const host = kingdomsByUid.get(hostUid);
      const res = await proposeEmbassy({
        guestUid: worldUser.uid,
        guestNameAr: cur.kingdomNameAr ?? STRINGS.appName,
        hostUid,
        hostNameAr: host?.nameAr ?? 'مملكة مضيفة',
        priceAgreed,
        createdMonth: cur.totalMonths,
      });
      if (!res.ok) {
        setWorldPanelError(res.errorAr ?? 'تعذر إرسال طلب السفارة');
      } else {
        await refreshEmbassyAndMapState();
      }
    } finally {
      setWorldPanelBusy(false);
    }
  };

  const handleApproveEmbassy = async (agreementId: string) => {
    if (!onlineConfigEnabled || !worldUser) return;
    setWorldPanelBusy(true);
    setWorldPanelError(null);
    try {
      const res = await approveEmbassyProposal({
        hostUid: worldUser.uid,
        agreementId,
        cubes: latestStateRef.current.cubes,
        campCubeId: latestStateRef.current.camp.cubeId,
        existingPlots: latestStateRef.current.embassyPlots,
      });
      if (!res.ok) {
        setWorldPanelError(res.errorAr ?? 'تعذر قبول السفارة');
      } else {
        await refreshEmbassyAndMapState();
      }
    } finally {
      setWorldPanelBusy(false);
    }
  };

  const handleRejectEmbassy = async (agreementId: string) => {
    if (!onlineConfigEnabled || !worldUser) return;
    setWorldPanelBusy(true);
    setWorldPanelError(null);
    try {
      const res = await rejectEmbassyProposal(worldUser.uid, agreementId);
      if (!res.ok) {
        setWorldPanelError(res.errorAr ?? 'تعذر رفض الطلب');
      } else {
        await refreshEmbassyAndMapState();
      }
    } finally {
      setWorldPanelBusy(false);
    }
  };

  const handleDissolveEmbassy = async (agreementId: string) => {
    if (!onlineConfigEnabled || !worldUser) return;
    setWorldPanelBusy(true);
    setWorldPanelError(null);
    try {
      const res = await requestDissolveEmbassy({
        actorUid: worldUser.uid,
        agreementId,
        currentTotalMonths: latestStateRef.current.totalMonths,
      });
      if (!res.ok) {
        setWorldPanelError(res.errorAr ?? 'تعذر طلب حل السفارة');
      } else {
        await refreshEmbassyAndMapState();
      }
    } finally {
      setWorldPanelBusy(false);
    }
  };

  const handleCollectEmbassyPayments = async () => {
    if (!onlineConfigEnabled || !worldUser) return;
    setWorldPanelBusy(true);
    setWorldPanelError(null);
    try {
      const res = await collectEmbassyPayments(worldUser.uid);
      if (!res.ok) {
        setWorldPanelError(res.errorAr ?? 'تعذر تحصيل عائد السفارات');
      } else if (res.collectedGold > 0) {
        dispatch({
          type: 'COLLECT_EMBASSY_PAYMENTS',
          collectedGold: res.collectedGold,
          claimUpdatedAt: res.claimUpdatedAt,
        });
        setPendingEmbassyPaymentGold(0);
      }
    } finally {
      setWorldPanelBusy(false);
    }
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
    setMarketOverlayOpen(false);
    setEmbassyOverlayOpen(false);
    setWorldMapOpen(false);
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
        isOnlineWorld={isOnlineSession}
        pendingEmbassyProposals={pendingIncomingEmbassyCount}
        onOpenSharedWorld={() => setSharedWorldOpen(true)}
        onOpenMarket={() => {
          setMarketFilterSellerUid(null);
          setMarketOverlayOpen(true);
          void refreshMarketState();
        }}
        onOpenEmbassies={() => {
          setEmbassyTargetHostUid(null);
          setEmbassyOverlayOpen(true);
          void refreshEmbassyAndMapState();
        }}
        onOpenWorldMap={() => {
          setWorldMapOpen(true);
          void refreshEmbassyAndMapState();
        }}
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
            embassyPlots={state.embassyPlots}
            clockSecondsOfDay={state.clock.secondsOfDay}
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
          isOnlineWorld={isOnlineSession}
          myUid={worldUser?.uid ?? null}
          myWorldPos={
            myWorldKingdom
              ? { wx: myWorldKingdom.wx, wy: myWorldKingdom.wy }
              : state.myWorldPos ?? null
          }
          worldKingdoms={worldKingdoms}
          onToggleBorderOpen={(open) => dispatch({ type: 'SET_BORDER_OPEN', open })}
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

      {/* Prompt 8 Part 2 & 3 Overlays (ALL closed by default, never auto-open) */}
      {marketOverlayOpen && (
        <MarketOverlay
          state={state}
          isOnline={isOnlineSession}
          myUid={worldUser?.uid ?? null}
          listings={marketListings}
          myListings={myMarketListings}
          pendingClaimGold={pendingMarketClaimGold}
          alliedUids={alliedUids}
          kingdomsByUid={kingdomsByUid}
          filterSellerUid={marketFilterSellerUid}
          busy={worldPanelBusy}
          errorMessage={worldPanelError}
          onClearSellerFilter={() => setMarketFilterSellerUid(null)}
          onRefresh={() => void refreshMarketState()}
          onListResource={(r, q, p, e) => void handleListMarketResource(r, q, p, e)}
          onCancelListing={(id) => void handleCancelMarketListing(id)}
          onBuyListing={(id, q) => void handleBuyMarketListing(id, q)}
          onCollectClaims={() => void handleCollectMarketClaims()}
          onClose={() => setMarketOverlayOpen(false)}
        />
      )}

      {embassyOverlayOpen && (
        <EmbassyOverlay
          isOnline={isOnlineSession}
          myUid={worldUser?.uid ?? null}
          worldInflationIndex={worldBourse?.inflationIndex ?? null}
          agreements={embassyAgreements}
          embassyPlots={state.embassyPlots}
          kingdoms={worldKingdoms}
          pendingEmbassyPaymentGold={pendingEmbassyPaymentGold}
          initialTargetHostUid={embassyTargetHostUid}
          busy={worldPanelBusy}
          errorMessage={worldPanelError}
          onRefresh={() => void refreshEmbassyAndMapState()}
          onPropose={(hostUid, priceAgreed) =>
            void handleProposeEmbassy(hostUid, priceAgreed)
          }
          onApprove={(id) => void handleApproveEmbassy(id)}
          onReject={(id) => void handleRejectEmbassy(id)}
          onDissolve={(id) => void handleDissolveEmbassy(id)}
          onCollectPayments={() => void handleCollectEmbassyPayments()}
          onClose={() => setEmbassyOverlayOpen(false)}
        />
      )}

      {worldMapOpen && (
        <WorldMapOverlay
          myUid={worldUser?.uid ?? null}
          myPos={
            myWorldKingdom
              ? { wx: myWorldKingdom.wx, wy: myWorldKingdom.wy }
              : state.myWorldPos ?? { wx: 0, wy: 0 }
          }
          kingdoms={worldKingdoms}
          agreements={embassyAgreements}
          loading={worldPanelBusy}
          onRefresh={() => void refreshEmbassyAndMapState()}
          onProposeEmbassy={(hostUid) => {
            setWorldMapOpen(false);
            setEmbassyTargetHostUid(hostUid);
            setEmbassyOverlayOpen(true);
            void refreshEmbassyAndMapState();
          }}
          onOpenSellerMarket={(sellerUid) => {
            setWorldMapOpen(false);
            setMarketFilterSellerUid(sellerUid);
            setMarketOverlayOpen(true);
            void refreshMarketState();
          }}
          onClose={() => setWorldMapOpen(false)}
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
          worldNewsletter={worldNewsletter}
          worldFromLocalLines={worldFromLocalLines}
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
