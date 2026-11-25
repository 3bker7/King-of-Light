import {
  Coins,
  Handshake,
  Package,
  RefreshCw,
  ShoppingBag,
  Star,
  Store,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { BASE_BUY_PRICES, TRADED_RESOURCES } from '../game/constants';
import { STRINGS } from '../game/strings';
import type { GameState, TradedResourceKey } from '../game/types';
import { getWorldEpochDay } from '../net/worldBourse';
import {
  computeSaleSplit,
  getListingPriceBounds,
  MARKET_LISTING_TTL_DAYS,
} from '../net/worldMarket';
import {
  MAX_LISTINGS_PER_KINGDOM,
  type MarketListing,
  type WorldKingdom,
} from '../net/worldTypes';
import { ResourceIcon } from './ResourceIcon';

export type MarketOverlayTab = 'market' | 'my_listings' | 'claims';

interface MarketOverlayProps {
  state: GameState;
  isOnline: boolean;
  myUid: string | null;
  listings: MarketListing[];
  myListings: MarketListing[];
  pendingClaimGold: number;
  alliedUids: ReadonlySet<string>;
  kingdomsByUid: ReadonlyMap<string, WorldKingdom>;
  filterSellerUid: string | null;
  busy: boolean;
  errorMessage: string | null;
  onClearSellerFilter: () => void;
  onRefresh: () => void;
  onListResource: (
    resource: TradedResourceKey,
    qty: number,
    unitPrice: number,
    embassyOnly: boolean
  ) => void;
  onCancelListing: (listingId: string) => void;
  onBuyListing: (listingId: string, qty: number) => void;
  onCollectClaims: () => void;
  onClose: () => void;
}

export function MarketOverlay({
  state,
  isOnline,
  myUid,
  listings,
  myListings,
  pendingClaimGold,
  alliedUids,
  kingdomsByUid,
  filterSellerUid,
  busy,
  errorMessage,
  onClearSellerFilter,
  onRefresh,
  onListResource,
  onCancelListing,
  onBuyListing,
  onCollectClaims,
  onClose,
}: MarketOverlayProps) {
  const [tab, setTab] = useState<MarketOverlayTab>('market');
  const [resourceFilter, setResourceFilter] = useState<TradedResourceKey | 'all'>('all');
  const [formResource, setFormResource] = useState<TradedResourceKey>('wheat');
  const [formQty, setFormQty] = useState<number>(10);
  const [formPrice, setFormPrice] = useState<number>(BASE_BUY_PRICES.wheat);
  const [formEmbassyOnly, setFormEmbassyOnly] = useState<boolean>(false);

  const worldDay = getWorldEpochDay();
  const stockForForm = state.warehouse[formResource] ?? 0;
  const priceBounds = getListingPriceBounds(formResource);

  const filteredListings = useMemo(() => {
    return listings
      .filter((l) => {
        if (filterSellerUid && l.sellerUid !== filterSellerUid) return false;
        if (resourceFilter !== 'all' && l.resource !== resourceFilter) return false;
        return l.qty > 0;
      })
      .sort((a, b) =>
        a.unitPrice !== b.unitPrice
          ? a.unitPrice - b.unitPrice
          : a.id.localeCompare(b.id)
      );
  }, [listings, filterSellerUid, resourceFilter]);

  const filteredSellerName = filterSellerUid
    ? kingdomsByUid.get(filterSellerUid)?.nameAr ?? 'مملكة محددة'
    : null;

  const handleSelectFormResource = (r: TradedResourceKey) => {
    setFormResource(r);
    setFormPrice(BASE_BUY_PRICES[r]);
    const avail = state.warehouse[r] ?? 0;
    setFormQty(avail > 0 ? Math.min(10, avail) : 1);
  };

  const canSubmitListing =
    isOnline &&
    !busy &&
    myListings.length < MAX_LISTINGS_PER_KINGDOM &&
    formQty >= 1 &&
    formQty <= stockForForm &&
    formPrice >= priceBounds.min &&
    formPrice <= priceBounds.max;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="السوق العالمي"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[600px] max-h-[85dvh] parchment-panel border-2 border-[#C9962E] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#F4E7C8] border-b border-[#E3D3AC] shrink-0">
          <div className="flex items-center gap-2 text-[#2B2118]">
            <Store className="w-5 h-5 text-[#14524A]" />
            <div>
              <h2 className="text-sm font-extrabold">السوق العالمي</h2>
              <p className="text-[11px] font-bold text-[#6F5C43]">
                عروض حقيقية بين الممالك · 5% رسم قصر العالم (0% وخصم 20% لحلفاء السفارات)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isOnline && (
              <button
                type="button"
                disabled={busy}
                onClick={onRefresh}
                title="تحديث العروض"
                className="w-8 h-8 rounded-lg hover:bg-[#E7D5AE] text-[#14524A] flex items-center justify-center transition-colors disabled:opacity-40"
              >
                <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={STRINGS.modals.close}
              className="w-8 h-8 rounded-lg hover:bg-[#E7D5AE] text-[#4F3F2B] flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-3 py-2 bg-[#F8EED8] border-b border-[#E3D3AC] shrink-0">
          <button
            type="button"
            onClick={() => setTab('market')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-extrabold transition-colors ${
              tab === 'market'
                ? 'bg-[#14524A] text-white'
                : 'text-[#4F3F2B] hover:bg-[#EFE0BC]'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>السوق</span>
            <span className="text-[10px] opacity-80 tabular-nums-latin">
              ({filteredListings.length})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab('my_listings')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-extrabold transition-colors ${
              tab === 'my_listings'
                ? 'bg-[#14524A] text-white'
                : 'text-[#4F3F2B] hover:bg-[#EFE0BC]'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>عروضي</span>
            <span className="text-[10px] opacity-80 tabular-nums-latin">
              ({myListings.length}/{MAX_LISTINGS_PER_KINGDOM})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab('claims')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-extrabold transition-colors ${
              tab === 'claims'
                ? 'bg-[#14524A] text-white'
                : 'text-[#4F3F2B] hover:bg-[#EFE0BC]'
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            <span>مستحقاتي</span>
            {pendingClaimGold > 0 && (
              <span className="px-1.5 py-0.2 rounded-md bg-[#C9962E] text-[#2B2118] text-[10px] font-black tabular-nums-latin">
                {pendingClaimGold}
              </span>
            )}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto parchment-scroll p-3.5 space-y-3 text-xs">
          {!isOnline && (
            <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] text-center space-y-1">
              <p className="font-extrabold text-[#2B2118]">
                الوضع المحلي نشط
              </p>
              <p className="text-[11px] text-[#6F5C43]">
                سجّل الدخول عبر «العالم المشترك» لعرض بضائعك أو الشراء من الممالك الأخرى.
              </p>
            </div>
          )}

          {errorMessage && (
            <div className="p-2.5 rounded-xl bg-[#FBE2DF] border border-[#E5ABA3] text-[#8E2A1F] font-bold">
              {errorMessage}
            </div>
          )}

          {/* TAB 1: السوق */}
          {tab === 'market' && (
            <div className="space-y-2.5">
              {/* Filters */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <select
                    value={resourceFilter}
                    onChange={(e) =>
                      setResourceFilter(e.target.value as TradedResourceKey | 'all')
                    }
                    className="px-2.5 py-1 rounded-lg bg-[#FDF8EC] border border-[#D8C496] text-[#2B2118] text-xs font-bold"
                  >
                    <option value="all">كل الموارد</option>
                    {TRADED_RESOURCES.map((r) => (
                      <option key={r} value={r}>
                        {STRINGS.resources[r]}
                      </option>
                    ))}
                  </select>
                  {filteredSellerName && (
                    <button
                      type="button"
                      onClick={onClearSellerFilter}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#E6F2EF] border border-[#8CC3B8] text-[#14524A] text-[11px] font-extrabold"
                    >
                      <span>البائع: {filteredSellerName}</span>
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <span className="text-[11px] font-bold text-[#6F5C43] tabular-nums-latin">
                  خزينتك: {state.gold} ذهب
                </span>
              </div>

              {filteredListings.length === 0 ? (
                <div className="py-8 text-center text-[#6F5C43] font-bold">
                  لا توجد عروض نشطة مطابقة حالياً في السوق العالمي.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredListings.map((listing) => {
                    const isMine = myUid !== null && listing.sellerUid === myUid;
                    const isAllied =
                      !isMine && alliedUids.has(listing.sellerUid);
                    const sellerRep =
                      kingdomsByUid.get(listing.sellerUid)?.reputation ??
                      listing.sellerReputation ??
                      50;
                    const oneSplit = computeSaleSplit(listing.unitPrice, isAllied);
                    const tenQty = Math.min(10, listing.qty);
                    const tenSplit = computeSaleSplit(
                      listing.unitPrice * tenQty,
                      isAllied
                    );
                    const maxAffordableQty =
                      oneSplit.buyerPays > 0
                        ? Math.min(
                            listing.qty,
                            Math.floor(state.gold / oneSplit.buyerPays)
                          )
                        : 0;
                    const lockedByEmbassy =
                      listing.embassyOnly && !isAllied && !isMine;

                    return (
                      <div
                        key={listing.id}
                        className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-[#14524A]/10 text-[#14524A] flex items-center justify-center shrink-0">
                              <ResourceIcon
                                resource={listing.resource}
                                className="w-4 h-4"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-extrabold text-[#2B2118]">
                                  {STRINGS.resources[listing.resource]}
                                </span>
                                <span className="text-[11px] font-bold text-[#14524A] tabular-nums-latin">
                                  ×{listing.qty}
                                </span>
                                {isAllied && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#E3F3E6] border border-[#9CD0A7] text-[#2D6E3B] text-[10px] font-extrabold">
                                    <Handshake className="w-3 h-3" />
                                    <span>حليف -20%</span>
                                  </span>
                                )}
                                {listing.embassyOnly && (
                                  <span className="px-1.5 py-0.5 rounded bg-[#F8E7C1] border border-[#E2BA64] text-[#8A5F12] text-[10px] font-extrabold">
                                    للحلفاء فقط
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-[#6F5C43]">
                                <span className="truncate font-bold">
                                  {listing.sellerNameAr}
                                  {isMine ? ' (أنت)' : ''}
                                </span>
                                <span className="inline-flex items-center gap-0.5 tabular-nums-latin shrink-0">
                                  <Star className="w-3 h-3 text-[#C9962E] fill-[#C9962E]" />
                                  {Math.round(sellerRep)}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="text-left shrink-0">
                            <div className="font-extrabold text-[#8A5F12] tabular-nums-latin">
                              {listing.unitPrice} ذهب / وحدة
                            </div>
                            {isAllied && (
                              <div className="text-[10px] font-bold text-[#2D6E3B] tabular-nums-latin">
                                بعد خصم التحالف: {oneSplit.buyerPays}
                              </div>
                            )}
                          </div>
                        </div>

                        {isOnline && !isMine && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={
                                busy ||
                                lockedByEmbassy ||
                                state.gold < oneSplit.buyerPays
                              }
                              onClick={() => onBuyListing(listing.id, 1)}
                              className="flex-1 py-1.5 rounded-lg bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-40 text-white text-[11px] font-extrabold tabular-nums-latin transition-colors"
                            >
                              شراء 1 ({oneSplit.buyerPays})
                            </button>
                            {listing.qty >= 10 && (
                              <button
                                type="button"
                                disabled={
                                  busy ||
                                  lockedByEmbassy ||
                                  state.gold < tenSplit.buyerPays
                                }
                                onClick={() => onBuyListing(listing.id, 10)}
                                className="flex-1 py-1.5 rounded-lg bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-40 text-white text-[11px] font-extrabold tabular-nums-latin transition-colors"
                              >
                                شراء 10 ({tenSplit.buyerPays})
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={
                                busy || lockedByEmbassy || maxAffordableQty <= 0
                              }
                              onClick={() =>
                                onBuyListing(listing.id, maxAffordableQty)
                              }
                              className="flex-1 py-1.5 rounded-lg bg-[#C9962E] hover:bg-[#D6A43E] disabled:opacity-40 text-[#2B2118] text-[11px] font-extrabold tabular-nums-latin transition-colors"
                            >
                              الكل ({maxAffordableQty})
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: عروضي */}
          {tab === 'my_listings' && (
            <div className="space-y-3">
              {/* Create new listing form */}
              <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[#2B2118]">
                    عرض بضاعة جديدة
                  </span>
                  <span className="text-[11px] font-bold text-[#6F5C43] tabular-nums-latin">
                    المتاح لديك: {stockForForm} / المطلوب للعرض: {formQty}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-[#6F5C43] mb-1">
                      المورد
                    </label>
                    <select
                      value={formResource}
                      onChange={(e) =>
                        handleSelectFormResource(
                          e.target.value as TradedResourceKey
                        )
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-white border border-[#D8C496] text-[#2B2118] font-bold"
                    >
                      {TRADED_RESOURCES.map((r) => (
                        <option key={r} value={r}>
                          {STRINGS.resources[r]} ({state.warehouse[r] ?? 0})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-[#6F5C43] mb-1">
                      الكمية (1–{Math.max(1, stockForForm)})
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, stockForForm)}
                      value={formQty}
                      onChange={(e) =>
                        setFormQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-white border border-[#D8C496] text-[#2B2118] font-bold tabular-nums-latin"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-[#6F5C43] mb-1">
                      سعر الوحدة ({priceBounds.min}–{priceBounds.max})
                    </label>
                    <input
                      type="number"
                      min={priceBounds.min}
                      max={priceBounds.max}
                      value={formPrice}
                      onChange={(e) =>
                        setFormPrice(
                          Math.max(1, Math.floor(Number(e.target.value) || 1))
                        )
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-white border border-[#D8C496] text-[#2B2118] font-bold tabular-nums-latin"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#4F3F2B] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formEmbassyOnly}
                      onChange={(e) => setFormEmbassyOnly(e.target.checked)}
                      className="rounded border-[#C9962E]"
                    />
                    <span>لحلفاء السفارات فقط</span>
                  </label>
                  <button
                    type="button"
                    disabled={!canSubmitListing}
                    onClick={() =>
                      onListResource(
                        formResource,
                        formQty,
                        formPrice,
                        formEmbassyOnly
                      )
                    }
                    className="px-4 py-1.5 rounded-lg bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-40 text-white font-extrabold transition-colors"
                  >
                    نشر العرض (يُخصم من المخزن)
                  </button>
                </div>

                <p className="text-[10px] text-[#6F5C43] leading-relaxed">
                  البضاعة المعروضة تُحجز من مخزنك وتنتظر مشترياً حقيقياً لمدة{' '}
                  {MARKET_LISTING_TTL_DAYS} يوم عالم — لا بيع تلقائي، وإن انتهت المدة تعود لمخزنك كاملة.
                </p>
              </div>

              {/* My active listings */}
              {myListings.length === 0 ? (
                <div className="py-5 text-center text-[#6F5C43] font-bold">
                  ليس لديك عروض نشطة حالياً.
                </div>
              ) : (
                <div className="space-y-2">
                  {myListings.map((l) => {
                    const daysLeft = Math.max(0, l.expiresDay - worldDay);
                    return (
                      <div
                        key={l.id}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <ResourceIcon
                            resource={l.resource}
                            className="w-4 h-4 text-[#14524A] shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="font-extrabold text-[#2B2118] tabular-nums-latin">
                              {STRINGS.resources[l.resource]} ×{l.qty} ·{' '}
                              {l.unitPrice} ذهب
                            </div>
                            <div className="text-[10px] text-[#6F5C43] tabular-nums-latin">
                              متبقي {daysLeft} يوم عالم
                              {l.embassyOnly ? ' · للحلفاء فقط' : ''}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onCancelListing(l.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FBE2DF] hover:bg-[#F5CCC7] border border-[#E5ABA3] text-[#8E2A1F] text-[11px] font-extrabold transition-colors disabled:opacity-40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>إلغاء واسترجاع</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: مستحقاتي */}
          {tab === 'claims' && (
            <div className="p-4 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] text-center space-y-3">
              <div className="w-11 h-11 mx-auto rounded-xl bg-[#C9962E]/20 border border-[#C9962E]/50 text-[#8A5F12] flex items-center justify-center">
                <Coins className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-[#6F5C43]">
                  مستحقات مبيعات السوق العالمي الجاهزة للتحصيل
                </p>
                <p className="text-2xl font-black text-[#8A5F12] tabular-nums-latin mt-1">
                  {pendingClaimGold} ذهب
                </p>
              </div>
              <button
                type="button"
                disabled={!isOnline || busy || pendingClaimGold <= 0}
                onClick={onCollectClaims}
                className="w-full py-2.5 px-4 rounded-xl bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-40 text-white text-sm font-extrabold transition-colors"
              >
                تحصيل المستحقات إلى الخزينة
              </button>
              <p className="text-[10px] text-[#6F5C43]">
                يُصفَّر الرصيد داخل معاملة واحدة ويُقيَّد في دفتر المملكة تحت «مبيعات السوق العالمي».
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
