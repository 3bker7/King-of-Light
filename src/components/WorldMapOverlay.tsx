import {
  Compass,
  Landmark,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  ShoppingBag,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { GOLD_BAND_LABELS_AR, selectNearestKingdoms } from '../net/worldMap';
import { chebyshevWorldDistance } from '../net/worldSpawn';
import type {
  EmbassyAgreement,
  WorldKingdom,
  WorldPos,
} from '../net/worldTypes';

interface WorldMapOverlayProps {
  myUid: string | null;
  myPos: WorldPos;
  kingdoms: WorldKingdom[];
  agreements: EmbassyAgreement[];
  loading: boolean;
  onRefresh: () => void;
  onProposeEmbassy: (hostUid: string) => void;
  onOpenSellerMarket: (sellerUid: string) => void;
  onClose: () => void;
}

const CELL_SPACING = 76;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.4;

function populationRadius(population: number): number {
  if (population >= 100) return 13;
  if (population >= 50) return 10.5;
  if (population >= 20) return 8.5;
  return 6.5;
}

function reputationColor(reputation: number): string {
  if (reputation >= 75) return '#14524A';
  if (reputation >= 50) return '#2E7D32';
  if (reputation >= 30) return '#B7791F';
  return '#A83629';
}

function agreementStatusAr(status: EmbassyAgreement['status']): string {
  switch (status) {
    case 'active':
      return 'سفارة نشطة';
    case 'suspended':
      return 'سفارة معلّقة';
    case 'pending':
      return 'طلب قيد الانتظار';
    case 'dissolved':
      return 'سفارة منحلّة';
  }
}

export function WorldMapOverlay({
  myUid,
  myPos,
  kingdoms,
  agreements,
  loading,
  onRefresh,
  onProposeEmbassy,
  onOpenSellerMarket,
  onClose,
}: WorldMapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({
    w: 560,
    h: 360,
  });

  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    origPanX: number;
    origPanY: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    origPanX: 0,
    origPanY: 0,
  });

  // Strictly enforce 200-kingdom cap nearest to myPos
  const visibleKingdoms = useMemo(
    () => selectNearestKingdoms(kingdoms, myPos, 200),
    [kingdoms, myPos]
  );

  const kingdomByUid = useMemo(() => {
    const map = new Map<string, WorldKingdom>();
    for (const k of visibleKingdoms) map.set(k.uid, k);
    return map;
  }, [visibleKingdoms]);

  // Only agreements involving myUid render roads (active = solid black, suspended = dark gray dashed)
  const myRoadAgreements = useMemo(() => {
    if (!myUid) return [];
    return agreements.filter(
      (a) =>
        (a.hostUid === myUid || a.guestUid === myUid) &&
        (a.status === 'active' || a.status === 'suspended')
    );
  }, [agreements, myUid]);

  const selectedKingdom = selectedUid ? kingdomByUid.get(selectedUid) ?? null : null;

  const selectedAgreements = useMemo(() => {
    if (!myUid || !selectedKingdom || selectedKingdom.uid === myUid) return [];
    return agreements.filter(
      (a) =>
        (a.hostUid === myUid && a.guestUid === selectedKingdom.uid) ||
        (a.guestUid === myUid && a.hostUid === selectedKingdom.uid)
    );
  }, [agreements, myUid, selectedKingdom]);

  const worldToScreen = useCallback(
    (wx: number, wy: number) => {
      const cx = canvasSize.w / 2 + pan.x;
      const cy = canvasSize.h / 2 + pan.y;
      return {
        x: cx + (wx - myPos.wx) * CELL_SPACING * zoom,
        y: cy + (wy - myPos.wy) * CELL_SPACING * zoom,
      };
    },
    [canvasSize.h, canvasSize.w, myPos.wx, myPos.wy, pan.x, pan.y, zoom]
  );

  // Measure container on mount & resize (state-driven, no rAF loop)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setCanvasSize({
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Redraw strictly on state changes (NO requestAnimationFrame loop)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvasSize.w;
    const height = canvasSize.h;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Warm parchment background (gridless)
    const grad = ctx.createRadialGradient(
      width / 2,
      height / 2,
      20,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.72
    );
    grad.addColorStop(0, '#FBF3DE');
    grad.addColorStop(1, '#EAD7AE');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Subtle concentric distance rings around my kingdom (Chebyshev/visual cue only)
    const myScreen = worldToScreen(myPos.wx, myPos.wy);
    ctx.save();
    ctx.strokeStyle = 'rgba(138, 95, 18, 0.14)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    for (const ringCells of [3, 6]) {
      const r = ringCells * CELL_SPACING * zoom;
      ctx.beginPath();
      ctx.arc(myScreen.x, myScreen.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // 1. Roads for MY active / suspended embassy agreements
    for (const ag of myRoadAgreements) {
      const host = kingdomByUid.get(ag.hostUid);
      const guest = kingdomByUid.get(ag.guestUid);
      if (!host || !guest) continue;
      const p1 = worldToScreen(host.wx, host.wy);
      const p2 = worldToScreen(guest.wx, guest.wy);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      if (ag.status === 'active') {
        ctx.strokeStyle = '#1C1917';
        ctx.lineWidth = Math.max(2.5, 3.2 * Math.min(zoom, 1.3));
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = '#57534E';
        ctx.lineWidth = Math.max(2, 2.4 * Math.min(zoom, 1.3));
        ctx.setLineDash([7, 5]);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 2. Palace dots + RTL name labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const fontSize = Math.max(10, Math.min(13, Math.round(11 * Math.sqrt(zoom))));
    ctx.font = `700 ${fontSize}px Cairo, sans-serif`;

    for (const k of visibleKingdoms) {
      const pt = worldToScreen(k.wx, k.wy);
      if (
        pt.x < -60 ||
        pt.x > width + 60 ||
        pt.y < -60 ||
        pt.y > height + 60
      ) {
        continue;
      }

      const r = populationRadius(k.population) * Math.max(0.75, Math.min(1.25, zoom));
      const isMine = myUid !== null && k.uid === myUid;
      const isSelected = selectedUid === k.uid;

      if (isMine) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#D4AF37';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }

      if (isSelected) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r + (isMine ? 9 : 4.5), 0, Math.PI * 2);
        ctx.strokeStyle = '#2B2118';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // Main palace dot colored by reputation band
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = reputationColor(k.reputation);
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = '#FFFDF5';
      ctx.stroke();

      // Tiny gold crown pip inside dot
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, Math.max(2, r * 0.28), 0, Math.PI * 2);
      ctx.fillStyle = '#F7DA82';
      ctx.fill();

      // Label pill backdrop for legibility
      const label = k.nameAr;
      const metrics = ctx.measureText(label);
      const padX = 5;
      const boxW = metrics.width + padX * 2;
      const boxH = fontSize + 4;
      const labelY = pt.y + r + 5;

      ctx.fillStyle = isMine ? 'rgba(20, 82, 74, 0.88)' : 'rgba(253, 248, 236, 0.86)';
      ctx.fillRect(pt.x - boxW / 2, labelY, boxW, boxH);
      ctx.fillStyle = isMine ? '#FFFDF5' : '#2B2118';
      ctx.fillText(label, pt.x, labelY + 2);
    }
  }, [
    canvasSize.h,
    canvasSize.w,
    kingdomByUid,
    myPos.wx,
    myPos.wy,
    myRoadAgreements,
    myUid,
    pan.x,
    pan.y,
    selectedUid,
    visibleKingdoms,
    worldToScreen,
    zoom,
  ]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
    };
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.hypot(dx, dy) > 5) {
      d.moved = true;
    }
    if (d.moved) {
      setPan({ x: d.origPanX + dx, y: d.origPanY + dy });
    }
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    d.active = false;
    if (!d.moved) {
      // Hit-test clicked kingdom
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      let hit: WorldKingdom | null = null;
      let bestDist = Infinity;

      for (const k of visibleKingdoms) {
        const pt = worldToScreen(k.wx, k.wy);
        const r = populationRadius(k.population) * Math.max(0.75, Math.min(1.25, zoom)) + 8;
        const dist = Math.hypot(clickX - pt.x, clickY - pt.y);
        if (dist <= r && dist < bestDist) {
          bestDist = dist;
          hit = k;
        }
      }
      setSelectedUid(hit ? hit.uid : null);
    }
  };

  const handleWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number((z * factor).toFixed(3)))));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="خريطة العالم"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[700px] max-h-[88dvh] parchment-panel border-2 border-[#C9962E] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#F4E7C8] border-b border-[#E3D3AC] shrink-0">
          <div className="flex items-center gap-2 text-[#2B2118]">
            <Compass className="w-5 h-5 text-[#14524A]" />
            <div>
              <h2 className="text-sm font-extrabold">خريطة العالم</h2>
              <p className="text-[11px] font-bold text-[#6F5C43] tabular-nums-latin">
                أقرب {visibleKingdoms.length} مملكة (بحد أقصى 200) · موقعك ({myPos.wx}, {myPos.wy})
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              title="تحديث الخريطة"
              className="w-8 h-8 rounded-lg hover:bg-[#E7D5AE] text-[#14524A] flex items-center justify-center transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="w-8 h-8 rounded-lg hover:bg-[#E7D5AE] text-[#4F3F2B] flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Canvas Viewport */}
        <div
          ref={containerRef}
          className="relative w-full h-[340px] sm:h-[380px] bg-[#EFE0BC] border-b border-[#E3D3AC] overflow-hidden select-none"
        >
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              dragRef.current.active = false;
            }}
            onWheel={handleWheel}
            className="block w-full h-full cursor-grab active:cursor-grabbing touch-none"
          />

          {/* Zoom & Recenter Controls */}
          <div className="absolute top-3 left-3 flex flex-col gap-1">
            <button
              type="button"
              onClick={() =>
                setZoom((z) => Math.min(MAX_ZOOM, Number((z * 1.2).toFixed(2))))
              }
              aria-label="تكبير"
              className="w-8 h-8 rounded-lg bg-[#FDF8EC]/95 border border-[#C9962E] text-[#2B2118] hover:bg-[#F4E7C8] flex items-center justify-center shadow-sm"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                setZoom((z) => Math.max(MIN_ZOOM, Number((z * 0.84).toFixed(2))))
              }
              aria-label="تصغير"
              className="w-8 h-8 rounded-lg bg-[#FDF8EC]/95 border border-[#C9962E] text-[#2B2118] hover:bg-[#F4E7C8] flex items-center justify-center shadow-sm"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setPan({ x: 0, y: 0 });
                setZoom(1);
              }}
              title="العودة لمملكتي"
              aria-label="العودة لمملكتي"
              className="w-8 h-8 rounded-lg bg-[#14524A] text-white hover:bg-[#1B685E] flex items-center justify-center shadow-sm"
            >
              <MapPin className="w-4 h-4 text-[#F2CA6B]" />
            </button>
          </div>

          {/* Compact Legend */}
          <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1.5 rounded-lg bg-[#FDF8EC]/92 border border-[#E3D3AC] text-[10px] font-bold text-[#4F3F2B] flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#14524A] ring-2 ring-[#D4AF37]" />
              مملكتك
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 h-0.5 bg-[#1C1917]" />
              سفارة نشطة
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 h-0 border-t-2 border-dashed border-[#57534E]" />
              سفارة معلّقة
            </span>
          </div>
        </div>

        {/* Selected Kingdom Card / Prompt */}
        <div className="p-3.5 bg-[#FDF8EC] text-xs shrink-0">
          {selectedKingdom ? (
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-extrabold text-[#2B2118] flex items-center gap-1.5">
                    <span>{selectedKingdom.nameAr}</span>
                    {selectedKingdom.uid === myUid && (
                      <span className="px-1.5 py-0.5 rounded bg-[#14524A] text-white text-[10px] font-extrabold">
                        مملكتك
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-bold text-[#6F5C43]">
                    الحاكم: {selectedKingdom.rulerName} · المسافة:{' '}
                    <span className="tabular-nums-latin">
                      {chebyshevWorldDistance(selectedKingdom, myPos)}
                    </span>{' '}
                    خطوات
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-[#F4E7C8] border border-[#E3D3AC] text-[11px] font-extrabold text-[#8A5F12]">
                  {GOLD_BAND_LABELS_AR[selectedKingdom.goldBand]}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-lg bg-[#F7EED8] border border-[#E7D8B4]">
                  <div className="text-[10px] font-bold text-[#6F5C43]">السمعة</div>
                  <div className="text-xs font-extrabold text-[#14524A] tabular-nums-latin">
                    {selectedKingdom.reputation}/100
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-[#F7EED8] border border-[#E7D8B4]">
                  <div className="text-[10px] font-bold text-[#6F5C43]">السكان</div>
                  <div className="text-xs font-extrabold text-[#2B2118] tabular-nums-latin">
                    {selectedKingdom.population}
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-[#F7EED8] border border-[#E7D8B4]">
                  <div className="text-[10px] font-bold text-[#6F5C43]">الأقاليم</div>
                  <div className="text-xs font-extrabold text-[#2B2118] tabular-nums-latin">
                    {selectedKingdom.provincesCount}
                  </div>
                </div>
              </div>

              {selectedAgreements.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedAgreements.map((ag) => (
                    <span
                      key={ag.id}
                      className="px-2 py-0.5 rounded-md bg-[#EFE2C2] border border-[#D8C18A] text-[10px] font-extrabold text-[#4F3F2B]"
                    >
                      {ag.hostUid === myUid ? 'ضيف لديك' : 'مضيف لك'}:{' '}
                      {agreementStatusAr(ag.status)}
                    </span>
                  ))}
                </div>
              )}

              {selectedKingdom.uid !== myUid && (
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => onProposeEmbassy(selectedKingdom.uid)}
                    className="flex-1 py-2 px-3 rounded-lg bg-[#14524A] hover:bg-[#1B685E] text-white font-extrabold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Landmark className="w-3.5 h-3.5 text-[#F2CA6B]" />
                    <span>اقترح سفارة</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenSellerMarket(selectedKingdom.uid)}
                    className="flex-1 py-2 px-3 rounded-lg bg-[#C9962E] hover:bg-[#B28323] text-white font-extrabold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <ShoppingBag className="w-3.5 h-3.5" />
                    <span>عروضه في السوق</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11px] font-bold text-[#6F5C43]">
              <span>
                اضغط على أي مملكة لعرض بطاقتها الدبلوماسية واقتراح سفارة أو تصفح عروضها في السوق.
              </span>
              <span className="shrink-0 text-[10px] text-[#8A5F12]">
                السحب للتحريك · العجلة للتكبير
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
