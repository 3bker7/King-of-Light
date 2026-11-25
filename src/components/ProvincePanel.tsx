import {
  Briefcase,
  ChevronDown,
  Compass,
  Flag,
  Home,
  Landmark,
  MapPin,
  ScrollText,
  Tent,
  Users,
} from 'lucide-react';
import { findPalaceCube } from '../game/production';
import {
  chebyshevDistance,
  formatProvinceTitle,
  getProvinceHousedShare,
  PALACE_PROVINCE_NAME,
} from '../game/provinces';
import type { GameState, Province, ProvinceEventKind } from '../game/types';

interface ProvincePanelProps {
  state: GameState;
  isOpen: boolean;
  onToggle: () => void;
  onFlyToProvince: (centerCubeId: number) => void;
  onFlyToCube: (cubeId: number) => void;
}

const PROVINCE_DOT_CLASS: Record<string, string> = {
  '#14524A': 'bg-[#14524A]',
  '#C9962E': 'bg-[#C9962E]',
  '#6B7D3B': 'bg-[#6B7D3B]',
  '#C27C72': 'bg-[#C27C72]',
  '#4A6B8A': 'bg-[#4A6B8A]',
  '#B85D3B': 'bg-[#B85D3B]',
};

const EVENT_TONE_CLASS: Record<ProvinceEventKind, string> = {
  village_joined: 'bg-[#E9F3E4] border-[#C6DFBC] text-[#285E33]',
  village_defected: 'bg-[#FBEAE8] border-[#E7B6B0] text-[#9E2E22]',
  province_formed: 'bg-[#E8F2F0] border-[#BBD7D2] text-[#14524A]',
  province_dissolved: 'bg-[#F8EFE0] border-[#E3CFA8] text-[#8A5F12]',
  camp_full: 'bg-[#FDF3DF] border-[#E6C37A] text-[#8A5F12]',
};

/**
 * Pure read-only sort helper for Element 4.1 & H4:
 * Sorts provinces by population DESC (ties -> cube count DESC, then centerCubeId ASC).
 */
export function sortProvincesByPopulation(provinces: Province[]): Province[] {
  return [...provinces].sort((a, b) => {
    if (b.population !== a.population) return b.population - a.population;
    if (b.cubeIds.length !== a.cubeIds.length) {
      return b.cubeIds.length - a.cubeIds.length;
    }
    return a.centerCubeId - b.centerCubeId;
  });
}

export function ProvincePanelChip({
  provinceCount,
  pendingArrivals,
  isOpen,
  onToggle,
}: {
  provinceCount: number;
  pendingArrivals: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FBF3DF] hover:bg-[#F3E4BE] border border-[#C9962E] text-[#2B2118] text-xs font-extrabold shadow-md transition-colors whitespace-nowrap"
    >
      <Flag className="w-3.5 h-3.5 text-[#14524A] shrink-0" />
      <span>الولايات</span>
      <span className="tabular-nums-latin text-[#14524A]">
        {provinceCount}
      </span>
      {pendingArrivals > 0 && (
        <span className="px-1.5 py-0.5 rounded-md bg-[#C9962E] text-[#2B2118] text-[10px] font-extrabold tabular-nums-latin">
          +{pendingArrivals}
        </span>
      )}
      <ChevronDown
        className={`w-3.5 h-3.5 text-[#6F5C43] transition-transform duration-150 ${
          isOpen ? 'rotate-180' : ''
        }`}
      />
    </button>
  );
}

export function ProvincePanel({
  state,
  isOpen,
  onFlyToProvince,
  onFlyToCube,
}: ProvincePanelProps) {
  if (!isOpen) return null;

  const sortedProvinces = sortProvincesByPopulation(state.provinces);
  const palaceCube = findPalaceCube(state.cubes);
  const newestEvents = [...state.provinceEvents].reverse();
  const hasCampActivity =
    state.camp.residentIds.length > 0 || state.pendingArrivals > 0;

  return (
    <section
      dir="rtl"
      className="mt-1.5 w-[332px] max-w-[calc(100vw-24px)] max-h-[calc(100dvh-160px)] overflow-y-auto parchment-panel border border-[#C9962E] shadow-2xl p-3 space-y-2.5"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-1.5 border-b border-[#E3D3AC]">
        <div className="flex items-center gap-1.5">
          <Flag className="w-4 h-4 text-[#14524A]" />
          <h2 className="text-xs font-extrabold text-[#2B2118]">
            الولايات والقرى
          </h2>
        </div>
        <span className="text-[11px] font-bold text-[#6F5C43] tabular-nums-latin">
          {sortedProvinces.length} ولاية
        </span>
      </div>

      {/* Arrival Camp status strip when active */}
      {hasCampActivity && (
        <div className="rounded-xl bg-[#FDF3DF] border border-[#DFB968] p-2.5 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#2B2118]">
              <Tent className="w-3.5 h-3.5 text-[#B85D3B]" />
              <span>مخيم الوصول</span>
            </div>
            <span className="text-[11px] font-extrabold text-[#8A5F12] tabular-nums-latin">
              {state.camp.residentIds.length} / 6
            </span>
          </div>
          {state.pendingArrivals > 0 && (
            <div className="text-[11px] font-bold text-[#9E2E22]">
              {state.pendingArrivals} قادم في الطريق
            </div>
          )}
          {state.camp.cubeId !== null && (
            <button
              type="button"
              onClick={() => onFlyToCube(state.camp.cubeId!)}
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-extrabold text-[#14524A] hover:underline"
            >
              <Compass className="w-3 h-3" />
              <span>انتقال إلى المخيم</span>
            </button>
          )}
        </div>
      )}

      {/* Provinces list sorted by population DESC */}
      <ul className="space-y-1.5">
        {sortedProvinces.map((prov) => {
          const centerCube = state.cubes[prov.centerCubeId];
          const isPalace = prov.nameAr === PALACE_PROVINCE_NAME;
          const distFromPalace =
            palaceCube && centerCube
              ? chebyshevDistance(centerCube, palaceCube)
              : 0;
          const housedShare = getProvinceHousedShare(
            prov,
            state.cubes,
            state.citizens
          );
          const housedPct =
            housedShare.total > 0
              ? Math.round(housedShare.ratio * 100)
              : prov.houseCount > 0
                ? 100
                : 0;
          const dotClass = PROVINCE_DOT_CLASS[prov.color] ?? 'bg-[#14524A]';

          return (
            <li key={prov.id}>
              <button
                type="button"
                onClick={() => onFlyToProvince(prov.centerCubeId)}
                className="w-full text-right rounded-xl bg-[#FDF8EC] hover:bg-[#F7EBD0] border border-[#E8D9B5] hover:border-[#C9962E] p-2.5 transition-colors space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 border border-black/20 ${dotClass}`}
                    />
                    <span className="text-xs font-extrabold text-[#2B2118] truncate">
                      {formatProvinceTitle(prov.nameAr)}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-[#6F5C43] shrink-0">
                    {isPalace
                      ? 'مركز القصر'
                      : `على بُعد ${distFromPalace} مكعب من القصر`}
                  </span>
                </div>

                {centerCube?.villageName && (
                  <div className="flex items-center gap-1 text-[11px] font-bold text-[#14524A]">
                    <MapPin className="w-3 h-3 shrink-0" />
                    <span>قرية المركز: {centerCube.villageName}</span>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-1.5 pt-0.5 text-[11px] text-[#4E3E2C]">
                  <div className="flex items-center gap-1">
                    <Landmark className="w-3 h-3 text-[#8A5F12] shrink-0" />
                    <span className="tabular-nums-latin font-bold">
                      {prov.cubeIds.length}
                    </span>
                    <span className="text-[10px] text-[#6F5C43]">أرض</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Home className="w-3 h-3 text-[#14524A] shrink-0" />
                    <span className="tabular-nums-latin font-bold">
                      {prov.houseCount}
                    </span>
                    <span className="text-[10px] text-[#6F5C43]">بيت</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Users className="w-3 h-3 text-[#14524A] shrink-0" />
                    <span className="tabular-nums-latin font-bold">
                      {prov.population}
                    </span>
                    <span className="text-[10px] text-[#6F5C43]">مواطن</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-[#6F5C43]">السكن</span>
                    <span className="tabular-nums-latin font-bold text-[#14524A]">
                      {housedPct}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Briefcase className="w-3 h-3 text-[#6F5C43] shrink-0" />
                    <span className="tabular-nums-latin font-bold">
                      {prov.staffedWorkplaces}
                    </span>
                    <span className="text-[10px] text-[#6F5C43]">عمل</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-[#6F5C43]">خاص</span>
                    <span className="tabular-nums-latin font-bold text-[#8A5F12]">
                      {prov.privatePlots}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Province events feed */}
      <div className="pt-1.5 border-t border-[#E3D3AC] space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-[#2B2118]">
            <ScrollText className="w-3.5 h-3.5 text-[#14524A]" />
            <span>أحداث الولايات</span>
          </div>
          <span className="text-[10px] font-bold text-[#6F5C43] tabular-nums-latin">
            {newestEvents.length}
          </span>
        </div>

        {newestEvents.length === 0 ? (
          <p className="text-[11px] text-[#6F5C43] py-1">
            لا توجد أحداث ولايات مسجّلة بعد.
          </p>
        ) : (
          <ul className="space-y-1 max-h-36 overflow-y-auto">
            {newestEvents.map((ev) => {
              const toneClass =
                EVENT_TONE_CLASS[ev.kind] ??
                'bg-[#FDF8EC] border-[#E8D9B5] text-[#2B2118]';
              const targetExists =
                ev.centerCubeId >= 0 && ev.centerCubeId < state.cubes.length;

              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    disabled={!targetExists}
                    onClick={() => {
                      if (targetExists) onFlyToCube(ev.centerCubeId);
                    }}
                    className={`w-full text-right rounded-lg border px-2 py-1.5 text-[11px] leading-snug transition-opacity ${toneClass} ${
                      targetExists ? 'hover:opacity-90' : 'opacity-75 cursor-default'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-bold">{ev.labelAr}</span>
                      <span className="text-[10px] font-extrabold shrink-0 opacity-80 tabular-nums-latin">
                        ش {ev.month}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
