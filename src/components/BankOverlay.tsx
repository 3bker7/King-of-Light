import {
  AlertTriangle,
  Building,
  Check,
  Coins,
  CreditCard,
  Gauge,
  Landmark,
  MapPin,
  TrendingUp,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  BANK_PROFIT_RATE,
  computePeoplesBankNetWorth,
  computeRepayable,
  getBankCubeAskPrice,
  getMaxLoan,
  getScheduledInstallment,
  isEligibleCollateralCube,
  LOAN_TERMS,
  MIN_LOAN,
  type LoanTermMonths,
} from '../game/bank';
import { BASE_BUY_PRICES, TRADED_RESOURCES } from '../game/constants';
import { findPalaceCube, getCubePurchasePrice, getManhattanDistanceToPalace } from '../game/production';
import { STRINGS } from '../game/strings';
import type { Cube, GameState, TradedResourceKey } from '../game/types';

interface BankOverlayProps {
  state: GameState;
  onClose: () => void;
  onTakeLoan: (principal: number, termMonths: 3 | 6 | 12, collateralCubeIds: number[]) => void;
  onRepayLoanFull: () => void;
}

export function BankOverlay({
  state,
  onClose,
  onTakeLoan,
  onRepayLoanFull,
}: BankOverlayProps) {
  const maxLoanVal = getMaxLoan(state.bankTrust);
  const activeLoan = state.bankLoans.find((l) => l.status === 'active');

  const palace = findPalaceCube(state.cubes);
  const palaceCubeId = palace ? palace.id : null;

  // Financing Form state
  const [inputPrincipal, setInputPrincipal] = useState<number>(Math.min(500, maxLoanVal));
  const [selectedTerm, setSelectedTerm] = useState<LoanTermMonths>(6);
  const [selectedCollateral, setSelectedCollateral] = useState<number[]>([]);

  // Eligible collateral cubes
  const eligibleCubes = useMemo(() => {
    return state.cubes.filter((c) => isEligibleCollateralCube(state.cubes, c, palaceCubeId));
  }, [state.cubes, palaceCubeId]);

  const collateralTotalValue = useMemo(() => {
    let sum = 0;
    for (const cid of selectedCollateral) {
      const c = state.cubes[cid];
      if (c) sum += getCubePurchasePrice(state.cubes, c);
    }
    return sum;
  }, [selectedCollateral, state.cubes]);

  const effectivePrincipal = Math.max(MIN_LOAN, Math.min(maxLoanVal, inputPrincipal));
  const previewRepayable = computeRepayable(effectivePrincipal);
  const previewInstallment = Math.ceil(previewRepayable / selectedTerm);

  const canApply =
    !activeLoan &&
    effectivePrincipal >= MIN_LOAN &&
    effectivePrincipal <= maxLoanVal &&
    selectedCollateral.length > 0 &&
    collateralTotalValue >= effectivePrincipal &&
    state.palaceOfPeople.gold >= effectivePrincipal;

  const handleToggleCube = (cid: number) => {
    setSelectedCollateral((prev) =>
      prev.includes(cid) ? prev.filter((id) => id !== cid) : [...prev, cid]
    );
  };

  const handleApplyLoan = () => {
    if (!canApply) return;
    onTakeLoan(effectivePrincipal, selectedTerm, selectedCollateral);
    setSelectedCollateral([]);
  };

  // People's bank portfolio valuation
  const portfolioTotalVal = useMemo(() => {
    let sum = 0;
    for (const [res, count] of Object.entries(state.peoplesBank.portfolio)) {
      if (typeof count === 'number' && count > 0) {
        const price = state.prices[res as TradedResourceKey] ?? BASE_BUY_PRICES[res as TradedResourceKey] ?? 1;
        sum += count * price;
      }
    }
    return sum;
  }, [state.peoplesBank.portfolio, state.prices]);

  const bankCubes = useMemo(() => {
    return state.cubes.filter((c) => c.owner === 'bank');
  }, [state.cubes]);

  const bankLandsTotalAsk = useMemo(() => {
    let sum = 0;
    for (const c of bankCubes) {
      sum += getBankCubeAskPrice(state.cubes, c, state.totalMonths);
    }
    return sum;
  }, [bankCubes, state.cubes, state.totalMonths]);

  const bankNetWorth = useMemo(() => {
    return computePeoplesBankNetWorth(
      state.peoplesBank,
      state.cubes,
      state.prices,
      state.totalMonths
    );
  }, [state.peoplesBank, state.cubes, state.prices, state.totalMonths]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/60 backdrop-blur-xs">
      <div
        className="w-full max-w-2xl max-h-[92vh] flex flex-col parchment-panel border-2 border-[#C9962E] shadow-2xl rounded-2xl overflow-hidden"
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#E2BA64] bg-[#F7EED8]/80">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#14524A] text-[#F2CA6B] flex items-center justify-center shadow-xs">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[#2B2118]">
                البنك الشرعي وبنك الشعب
              </h3>
              <p className="text-xs text-[#6F5C43]">
                التمويل الإسلامي المنضبط برهن الأراضي وخزانة قصر الشعب
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#6F5C43] hover:text-[#2B2118] hover:bg-[#EFE3C5] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* SECTION 1: قصر الشعب */}
          <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#C9962E] space-y-1.5 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-extrabold text-[#2B2118] text-sm">
                <Building className="w-4 h-4 text-[#C9962E]" />
                <span>قصر الشعب (الخزانة العامة)</span>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-[#F3E6C6] border border-[#DFC996] text-[#8A5F12] font-black text-sm tabular-nums-latin">
                {state.palaceOfPeople.gold} ذهب
              </span>
            </div>
            <p className="text-[#6F5C43] font-bold text-[11px] leading-relaxed">
              سيولة قصر الشعب — مصدر التمويلات ومستقبِل رسوم العالم.
            </p>
          </div>

          {/* SECTION 2: تمويلك (البنك الشرعي) */}
          <div className="p-3.5 rounded-xl bg-[#FDF8EC] border border-[#DFC996] space-y-3">
            <div className="flex items-center justify-between border-b border-[#EFE3C5] pb-2">
              <div className="flex items-center gap-2 font-extrabold text-[#2B2118] text-sm">
                <CreditCard className="w-4 h-4 text-[#14524A]" />
                <span>تمويلك من البنك الشرعي</span>
              </div>
              {/* Trust Bar */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-extrabold text-[#6F5C43]">
                  ثقة البنك:
                </span>
                <span className="px-1.5 py-0.5 rounded-md bg-[#E3F3E6] border border-[#9CD0A7] text-[#2D6E3B] text-[11px] font-black tabular-nums-latin">
                  {state.bankTrust}%
                </span>
              </div>
            </div>

            {activeLoan ? (
              /* Active Loan Card */
              <div className="p-3 rounded-xl bg-[#F7EED8] border border-[#DFC996] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[#2B2118] text-xs">
                    تمويل قائم بموجب ربح معلوم ثابت
                  </span>
                  {/* Warning Pips for Missed Count */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-[#8E2A1F]">
                      الأقساط المتعثرة:
                    </span>
                    <div className="flex items-center gap-1">
                      {[0, 1, 2].map((idx) => (
                        <span
                          key={idx}
                          className={`w-2.5 h-2.5 rounded-full ${
                            idx < activeLoan.missedCount
                              ? 'bg-[#A83629]'
                              : 'bg-[#D2C39E]'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-2 rounded-lg bg-[#FDF8EC] border border-[#E3D3AC]">
                    <div className="text-[10px] text-[#6F5C43] font-bold">أصل التمويل</div>
                    <div className="font-black text-[#2B2118] tabular-nums-latin">
                      {activeLoan.principal} ذهب
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-[#FDF8EC] border border-[#E3D3AC]">
                    <div className="text-[10px] text-[#6F5C43] font-bold">إجمالي المستحق (10% ثابت)</div>
                    <div className="font-black text-[#8A5F12] tabular-nums-latin">
                      {activeLoan.repayable} ذهب
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-[#FDF8EC] border border-[#E3D3AC]">
                    <div className="text-[10px] text-[#6F5C43] font-bold">المدفوع حتى الآن</div>
                    <div className="font-black text-[#2D6E3B] tabular-nums-latin">
                      {activeLoan.paidSoFar} ذهب
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-[#FDF8EC] border border-[#E3D3AC]">
                    <div className="text-[10px] text-[#6F5C43] font-bold">القسط القادم</div>
                    <div className="font-black text-[#A83629] tabular-nums-latin">
                      {Math.min(
                        activeLoan.repayable - activeLoan.paidSoFar,
                        activeLoan.deferredDue +
                          getScheduledInstallment(
                            activeLoan.repayable,
                            activeLoan.termMonths as LoanTermMonths,
                            activeLoan.monthsElapsed,
                            activeLoan.paidSoFar
                          )
                      )}{' '}
                      ذهب
                    </div>
                  </div>
                </div>

                {/* Collateral cubes */}
                <div className="space-y-1">
                  <div className="text-[11px] font-bold text-[#6F5C43]">
                    الأراضي المرهونة لهذا التمويل ({activeLoan.collateralCubeIds.length} أراضٍ):
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeLoan.collateralCubeIds.map((cid) => {
                      const cube = state.cubes[cid];
                      const dist = cube ? getManhattanDistanceToPalace(state.cubes, cube) : 0;
                      return (
                        <span
                          key={cid}
                          className="px-2 py-0.5 rounded-md bg-[#EAE0C5] text-[10px] font-bold text-[#2B2118] tabular-nums-latin"
                        >
                          أرض #{cid + 1} (بعد {dist} عن القصر)
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Early Full Repay Button */}
                {(() => {
                  const rem = activeLoan.repayable - activeLoan.paidSoFar;
                  return (
                    <div className="pt-1">
                      <button
                        type="button"
                        disabled={state.gold < rem}
                        onClick={onRepayLoanFull}
                        className="w-full py-2 px-3 rounded-xl bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-45 text-white font-extrabold flex items-center justify-center gap-2 transition-colors"
                      >
                        <Check className="w-4 h-4 text-[#F2CA6B]" />
                        <span>سداد كامل مبكر ({rem} ذهب)</span>
                      </button>
                      {state.gold < rem && (
                        <p className="text-[10px] font-bold text-[#A83629] text-center mt-1">
                          الخزنة تحتاج {rem - state.gold} ذهب إضافي للسداد الكامل
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              /* Financing Application Form */
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Principal input */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-bold text-[#4F3F2B]">
                      <span>مبلغ التمويل المطلوب (ذهب)</span>
                      <span className="tabular-nums-latin text-[#8A5F12]">
                        الحد الأقصى: {maxLoanVal}
                      </span>
                    </div>
                    <input
                      type="number"
                      min={MIN_LOAN}
                      max={maxLoanVal}
                      step={50}
                      value={inputPrincipal}
                      onChange={(e) => setInputPrincipal(Number(e.target.value))}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#FAF4E4] border border-[#DFC996] font-black text-[#2B2118] text-sm tabular-nums-latin focus:outline-hidden focus:border-[#C9962E]"
                    />
                  </div>

                  {/* Term select */}
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold text-[#4F3F2B]">
                      مدة التمويل (أشهر)
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {LOAN_TERMS.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setSelectedTerm(t)}
                          className={`py-1.5 rounded-lg font-black text-xs transition-colors ${
                            selectedTerm === t
                              ? 'bg-[#14524A] text-white'
                              : 'bg-[#FAF4E4] border border-[#DFC996] text-[#2B2118] hover:bg-[#ECDDB8]'
                          }`}
                        >
                          {t} أشهر
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Collateral Picker */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-extrabold text-[#2B2118]">
                      اختيار الأراضي المرهونة كضمان:
                    </span>
                    <span
                      className={`font-black tabular-nums-latin ${
                        collateralTotalValue >= effectivePrincipal
                          ? 'text-[#2D6E3B]'
                          : 'text-[#A83629]'
                      }`}
                    >
                      المختار: {collateralTotalValue} / المطلوب: {effectivePrincipal} ذهب
                    </span>
                  </div>

                  {eligibleCubes.length === 0 ? (
                    <p className="text-[11px] text-[#8E2A1F] font-bold p-2 rounded-lg bg-[#FBE2DF] border border-[#E5ABA3]">
                      لا توجد أراضٍ شاغرة غير صخرية مؤهلة للرهن حالياً.
                    </p>
                  ) : (
                    <div className="max-h-32 overflow-y-auto p-1.5 rounded-lg bg-[#FAF4E4] border border-[#DFC996] grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {eligibleCubes.map((c) => {
                        const price = getCubePurchasePrice(state.cubes, c);
                        const isSelected = selectedCollateral.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => handleToggleCube(c.id)}
                            className={`p-1.5 rounded-md text-right flex items-center justify-between text-[11px] transition-colors ${
                              isSelected
                                ? 'bg-[#14524A] text-white font-extrabold'
                                : 'bg-[#F5ECD4] hover:bg-[#ECDDB8] border border-[#DFC996] text-[#2B2118]'
                            }`}
                          >
                            <span>أرض #{c.id + 1}</span>
                            <span className="tabular-nums-latin font-black">
                              {price} ذهب
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Live Preview */}
                <div className="p-2.5 rounded-lg bg-[#F5ECD4] border border-[#DFC996] flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[#6F5C43] font-bold">المسترد الإجمالي: </span>
                    <span className="font-black text-[#2B2118] tabular-nums-latin">
                      {previewRepayable} ذهب
                    </span>
                    <span className="text-[10px] text-[#8A5F12] mr-1">
                      (ربح معلوم ثابت 10%)
                    </span>
                  </div>
                  <div>
                    <span className="text-[#6F5C43] font-bold">القسط الشهري: </span>
                    <span className="font-black text-[#14524A] tabular-nums-latin">
                      ~{previewInstallment} ذهب
                    </span>
                  </div>
                </div>

                {/* Submit button */}
                <button
                  type="button"
                  disabled={!canApply}
                  onClick={handleApplyLoan}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-45 text-white font-extrabold text-xs transition-colors flex items-center justify-center gap-2"
                >
                  <CreditCard className="w-4 h-4 text-[#F2CA6B]" />
                  <span>طلب التمويل ({effectivePrincipal} ذهب)</span>
                </button>
              </div>
            )}
          </div>

          {/* SECTION 3: بنك الشعب (بوت البورصة والأراضي المحجوزة) */}
          <div className="p-3.5 rounded-xl bg-[#FDF8EC] border border-[#DFC996] space-y-2.5">
            <div className="flex items-center justify-between border-b border-[#EFE3C5] pb-2">
              <div className="flex items-center gap-2 font-extrabold text-[#2B2118] text-sm">
                <TrendingUp className="w-4 h-4 text-[#C9962E]" />
                <span>بنك الشعب (محفظة البورصة والأراضي)</span>
              </div>
              <div className="flex items-center gap-1.5 font-black text-xs text-[#14524A]">
                <span>صافي الثروة:</span>
                <span className="tabular-nums-latin">{bankNetWorth} ذهب</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="p-2 rounded-lg bg-[#FAF4E4] border border-[#DFC996]">
                <div className="text-[10px] text-[#6F5C43] font-bold">سيولة البنك</div>
                <div className="font-black text-[#2B2118] tabular-nums-latin">
                  {state.peoplesBank.gold} ذهب
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[#FAF4E4] border border-[#DFC996]">
                <div className="text-[10px] text-[#6F5C43] font-bold">قيمة السلع بالبورصة</div>
                <div className="font-black text-[#8A5F12] tabular-nums-latin">
                  {portfolioTotalVal} ذهب
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[#FAF4E4] border border-[#DFC996]">
                <div className="text-[10px] text-[#6F5C43] font-bold">أراضٍ محجوزة بحوزته</div>
                <div className="font-black text-[#14524A] tabular-nums-latin">
                  {bankCubes.length} أراضٍ ({bankLandsTotalAsk} ذهب)
                </div>
              </div>
            </div>

            {/* Last trade status line */}
            <div className="p-2 rounded-lg bg-[#FAF4E4] border border-[#DFC996] text-[11px] font-bold flex items-center justify-between">
              <span className="text-[#6F5C43]">آخر حركة تداول لبنك الشعب:</span>
              <span className="text-[#2B2118] font-black">
                {state.peoplesBank.lastTradeAr || 'لم يتداول هذا الشهر'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
