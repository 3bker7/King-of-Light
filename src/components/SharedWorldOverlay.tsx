import {
  Check,
  Cloud,
  CloudOff,
  Compass,
  Crown,
  Globe,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { GameState } from '../game/types';
import {
  computeGoldBand,
  MAX_KINGDOM_NAME_LENGTH,
  MAX_RULER_NAME_LENGTH,
  sanitizeDisplayText,
  type CloudSyncStatus,
  type GoldBand,
  type OnlineWorldUser,
  type WorldKingdom,
} from '../net/worldTypes';
import {
  DEFAULT_KINGDOM_NAME_AR,
  DEFAULT_RULER_NAME_AR,
} from '../net/worldAuth';

interface SharedWorldOverlayProps {
  state: GameState;
  onlineConfigEnabled: boolean;
  user: OnlineWorldUser | null;
  myKingdom: WorldKingdom | null;
  syncStatus: CloudSyncStatus;
  worldBourseDay: number | null;
  authBusy: boolean;
  authError: string | null;
  onSignInEmail: (email: string, password: string) => Promise<void>;
  onSignUpEmail: (email: string, password: string) => Promise<void>;
  onSignInGoogle: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onUpdateProfile: (kingdomNameAr: string, rulerName: string) => void;
  onSyncNow: () => void;
  onClose: () => void;
}

const GOLD_BAND_LABELS: Record<GoldBand, { labelAr: string; cls: string }> = {
  poor: {
    labelAr: 'خزنة ناشئة',
    cls: 'bg-[#FBE2DF] border-[#E5ABA3] text-[#8E2A1F]',
  },
  mid: {
    labelAr: 'خزنة مستقرة',
    cls: 'bg-[#F8E7C1] border-[#E2BA64] text-[#8A5F12]',
  },
  rich: {
    labelAr: 'خزنة مزدهرة',
    cls: 'bg-[#E3F3E6] border-[#9CD0A7] text-[#2D6E3B]',
  },
};

const SYNC_STATUS_META: Record<
  CloudSyncStatus,
  { labelAr: string; dotCls: string }
> = {
  synced: { labelAr: 'متزامن مع السحابة', dotCls: 'bg-[#3E9B4F]' },
  pending: { labelAr: 'جاري المزامنة...', dotCls: 'bg-[#E6B64B]' },
  'local-only': { labelAr: 'حفظ محلي فقط', dotCls: 'bg-[#9E8B70]' },
};

export function SharedWorldOverlay({
  state,
  onlineConfigEnabled,
  user,
  myKingdom,
  syncStatus,
  worldBourseDay,
  authBusy,
  authError,
  onSignInEmail,
  onSignUpEmail,
  onSignInGoogle,
  onSignOut,
  onUpdateProfile,
  onSyncNow,
  onClose,
}: SharedWorldOverlayProps) {
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [kingdomInput, setKingdomInput] = useState(
    state.kingdomNameAr ?? myKingdom?.nameAr ?? DEFAULT_KINGDOM_NAME_AR
  );
  const [rulerInput, setRulerInput] = useState(
    state.rulerName ?? myKingdom?.rulerName ?? user?.displayName ?? DEFAULT_RULER_NAME_AR
  );
  const [profileSaved, setProfileSaved] = useState(false);

  const goldBand = myKingdom?.goldBand ?? computeGoldBand(state.gold);
  const goldBandMeta = GOLD_BAND_LABELS[goldBand];
  const syncMeta = SYNC_STATUS_META[syncStatus];
  const activePos = myKingdom
    ? { wx: myKingdom.wx, wy: myKingdom.wy }
    : state.myWorldPos ?? null;

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (authBusy) return;
    if (!email.trim() || password.length < 6) return;
    if (authMode === 'signin') {
      await onSignInEmail(email, password);
    } else {
      await onSignUpEmail(email, password);
    }
  };

  const handleSaveProfile = (e: FormEvent) => {
    e.preventDefault();
    const cleanKingdom = sanitizeDisplayText(
      kingdomInput,
      DEFAULT_KINGDOM_NAME_AR,
      MAX_KINGDOM_NAME_LENGTH
    );
    const cleanRuler = sanitizeDisplayText(
      rulerInput,
      DEFAULT_RULER_NAME_AR,
      MAX_RULER_NAME_LENGTH
    );
    setKingdomInput(cleanKingdom);
    setRulerInput(cleanRuler);
    onUpdateProfile(cleanKingdom, cleanRuler);
    setProfileSaved(true);
    window.setTimeout(() => setProfileSaved(false), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[88vh] parchment-panel border-2 border-[#C9962E] p-5 flex flex-col gap-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E3D3AC] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#14524A] text-[#F2CA6B] flex items-center justify-center shrink-0">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-[#2B2118]">
                العالم المشترك
              </h2>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#6F5C43]">
                <span className={`w-2 h-2 rounded-full ${syncMeta.dotCls}`} />
                <span>{syncMeta.labelAr}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="w-8 h-8 rounded-xl bg-[#EFE2C2] hover:bg-[#E4D1A5] text-[#2B2118] flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto parchment-scroll space-y-3.5 pl-0.5 text-xs">
          {/* Local Mode Notice when firebaseConfig is null */}
          {!onlineConfigEnabled && (
            <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
              <div className="flex items-center gap-2 font-extrabold text-[#2B2118]">
                <CloudOff className="w-4 h-4 text-[#8A5F12] shrink-0" />
                <span>الوضع المحلي نشط</span>
              </div>
              <p className="text-[11px] leading-relaxed text-[#5D4C34]">
                تعمل المملكة حالياً بالوضع المحلي الكامل دون اتصال شبكي أو حساب،
                وجميع حفظك وإحصاءاتك محفوظة محلياً. لتفعيل العالم المشترك، أضف
                إعدادات Firebase في ملف{' '}
                <code className="px-1 py-0.5 rounded bg-[#EFE2C2] text-[#14524A] font-mono text-[10px]">
                  src/net/firebaseConfig.ts
                </code>{' '}
                وطبّق قواعد الأمان في{' '}
                <code className="px-1 py-0.5 rounded bg-[#EFE2C2] text-[#14524A] font-mono text-[10px]">
                  FIRESTORE_RULES.md
                </code>
                .
              </p>
            </div>
          )}

          {/* Signed-out Auth Controls (when Firebase config exists) */}
          {onlineConfigEnabled && !user && (
            <div className="p-3.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-[#2B2118]">
                  {authMode === 'signin' ? 'تسجيل الدخول للعالم' : 'إنشاء حساب جديد'}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setAuthMode((m) => (m === 'signin' ? 'signup' : 'signin'))
                  }
                  className="text-[11px] font-extrabold text-[#14524A] hover:underline"
                >
                  {authMode === 'signin' ? 'حساب جديد؟' : 'لديك حساب؟'}
                </button>
              </div>

              <form onSubmit={handleAuthSubmit} className="space-y-2">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="البريد الإلكتروني"
                  dir="ltr"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#D8C59B] text-xs text-[#2B2118] focus:outline-none focus:border-[#14524A]"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="كلمة المرور (6 أحرف على الأقل)"
                  dir="ltr"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#D8C59B] text-xs text-[#2B2118] focus:outline-none focus:border-[#14524A]"
                />
                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full py-2 px-3 rounded-xl bg-[#14524A] hover:bg-[#1B685E] disabled:opacity-50 text-white font-extrabold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>
                    {authBusy
                      ? 'جاري الاتصال...'
                      : authMode === 'signin'
                        ? 'دخول بالبريد'
                        : 'إنشاء حساب والانضمام'}
                  </span>
                </button>
              </form>

              <div className="flex items-center gap-2 text-[10px] text-[#8A7759]">
                <div className="flex-1 h-px bg-[#E3D3AC]" />
                <span>أو</span>
                <div className="flex-1 h-px bg-[#E3D3AC]" />
              </div>

              <button
                type="button"
                disabled={authBusy}
                onClick={() => void onSignInGoogle()}
                className="w-full py-2 px-3 rounded-xl bg-[#F3E6C6] hover:bg-[#E7D4A6] disabled:opacity-50 border border-[#D8C59B] text-[#2B2118] font-extrabold transition-colors"
              >
                الدخول بحساب Google
              </button>

              {authError && (
                <p className="text-[11px] font-bold text-[#A83629] bg-[#FBE2DF] border border-[#E5ABA3] rounded-lg px-2.5 py-1.5">
                  {authError}
                </p>
              )}

              <p className="text-[10px] text-[#6F5C43] leading-relaxed">
                اللعب المحلي لا يتطلب حساباً. عند الانضمام تُسجَّل مملكتك بجوار
                الممالك القائمة وتنضم إلى بورصة العالم المشتركة.
              </p>
            </div>
          )}

          {/* Signed-in Account Card */}
          {onlineConfigEnabled && user && (
            <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-[#14524A]/15 text-[#14524A] flex items-center justify-center shrink-0">
                    <User className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-extrabold text-[#2B2118] truncate">
                      {myKingdom?.rulerName ??
                        state.rulerName ??
                        user.displayName ??
                        DEFAULT_RULER_NAME_AR}
                    </div>
                    {user.email && (
                      <div
                        className="text-[10px] text-[#6F5C43] truncate"
                        dir="ltr"
                      >
                        {user.email}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={onSyncNow}
                    disabled={syncStatus === 'pending'}
                    title="مزامنة الآن"
                    className="p-1.5 rounded-lg bg-[#EFE2C2] hover:bg-[#E4D1A5] disabled:opacity-50 text-[#14524A] transition-colors"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${
                        syncStatus === 'pending' ? 'animate-spin' : ''
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={() => void onSignOut()}
                    className="px-2.5 py-1.5 rounded-lg bg-[#FBE2DF] hover:bg-[#F5D0CB] text-[#A83629] text-[11px] font-extrabold flex items-center gap-1 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>خروج</span>
                  </button>
                </div>
              </div>

              {authError && (
                <p className="text-[11px] font-bold text-[#A83629] bg-[#FBE2DF] border border-[#E5ABA3] rounded-lg px-2.5 py-1.5">
                  {authError}
                </p>
              )}
            </div>
          )}

          {/* Kingdom World Status Summary */}
          <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-extrabold text-[#2B2118]">
                <Crown className="w-4 h-4 text-[#C9962E]" />
                <span>بطاقة المملكة في العالم</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded-md border text-[10px] font-extrabold ${goldBandMeta.cls}`}
              >
                {goldBandMeta.labelAr}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded-lg bg-[#F5E9CE] flex items-center justify-between">
                <span className="text-[#6F5C43] flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-[#14524A]" />
                  الموقع
                </span>
                <span className="font-extrabold text-[#2B2118] tabular-nums-latin" dir="ltr">
                  {activePos ? `(${activePos.wx}, ${activePos.wy})` : 'محلي'}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-[#F5E9CE] flex items-center justify-between">
                <span className="text-[#6F5C43] flex items-center gap-1">
                  <Compass className="w-3 h-3 text-[#14524A]" />
                  الولايات
                </span>
                <span className="font-extrabold text-[#2B2118] tabular-nums-latin">
                  {state.provinces.length}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-[#F5E9CE] flex items-center justify-between">
                <span className="text-[#6F5C43]">السكان</span>
                <span className="font-extrabold text-[#2B2118] tabular-nums-latin">
                  {state.population}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-[#F5E9CE] flex items-center justify-between">
                <span className="text-[#6F5C43]">السمعة</span>
                <span className="font-extrabold text-[#2B2118] tabular-nums-latin">
                  {Math.round(state.reputation)}
                </span>
              </div>
            </div>

            {worldBourseDay !== null && (
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#E6F2EF] border border-[#B5D9D1] text-[11px] font-bold text-[#14524A]">
                <span className="flex items-center gap-1.5">
                  <Cloud className="w-3.5 h-3.5" />
                  بورصة العالم نشطة
                </span>
                <span className="tabular-nums-latin">يوم العالم {worldBourseDay}</span>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-[10px] text-[#6F5C43]">
              <ShieldCheck className="w-3.5 h-3.5 text-[#14524A] shrink-0" />
              <span>
                الخصوصية محفوظة: يظهر للآخرين تصنيف الخزنة فقط دون رصيدك الدقيق.
              </span>
            </div>
          </div>

          {/* Kingdom & Ruler Name Editor (local profile, sanitized & length-capped) */}
          <form
            onSubmit={handleSaveProfile}
            className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2"
          >
            <div className="font-extrabold text-[#2B2118]">
              هوية المملكة والحاكم
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-[#6F5C43]">
                اسم المملكة (حد {MAX_KINGDOM_NAME_LENGTH} حرفاً)
              </label>
              <input
                type="text"
                maxLength={MAX_KINGDOM_NAME_LENGTH}
                value={kingdomInput}
                onChange={(e) => setKingdomInput(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-[#D8C59B] text-xs text-[#2B2118] focus:outline-none focus:border-[#14524A]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-[#6F5C43]">
                اسم الحاكم (حد {MAX_RULER_NAME_LENGTH} حرفاً)
              </label>
              <input
                type="text"
                maxLength={MAX_RULER_NAME_LENGTH}
                value={rulerInput}
                onChange={(e) => setRulerInput(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-[#D8C59B] text-xs text-[#2B2118] focus:outline-none focus:border-[#14524A]"
              />
            </div>
            <button
              type="submit"
              className="w-full py-1.5 px-3 rounded-lg bg-[#EFE2C2] hover:bg-[#E4D1A5] text-[#2B2118] font-extrabold flex items-center justify-center gap-1.5 transition-colors"
            >
              {profileSaved ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#2D6E3B]" />
                  <span>تم الحفظ</span>
                </>
              ) : (
                <span>حفظ الهوية</span>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
