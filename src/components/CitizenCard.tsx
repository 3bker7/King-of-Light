import { BookOpen, Clock, Compass, Crown, Frown, Meh, Navigation, Smile, Sparkles, User, X } from 'lucide-react';
import { minuteOfDayOf } from '../game/clock';
import {
  formatCitizenCardPersonality,
  generateTraits,
} from '../game/personality';
import {
  formatCitizenScheduleLineAr,
  SCHEDULE_CONSTANTS,
} from '../game/schedules';
import type { Citizen, GameState, ThemeId } from '../game/types';

export type CitizenRoleId =
  | 'farmer'
  | 'fisher'
  | 'miner'
  | 'woodcutter'
  | 'baker'
  | 'shopkeeper'
  | 'manager'
  | 'man'
  | 'woman'
  | 'child'
  | 'elder'
  | 'police';

export interface CitizenInfo {
  id: number;
  citizenId?: number | null;
  name: string;
  role: CitizenRoleId;
  roleLabelAr: string;
  destinationAr: string;
  moodAr: string;
  moodTone: 'good' | 'neutral' | 'low';
  workThemeId: ThemeId | null;
  prayerStatus?: 'to_prayer' | 'praying' | 'returning' | null;
  x: number;
  z: number;
}

interface CitizenCardProps {
  citizen: CitizenInfo;
  state?: GameState;
  staffedSlots?: Set<string>;
  isFollowing: boolean;
  onToggleFollow: () => void;
  onClose: () => void;
}

export function CitizenCard({
  citizen,
  state,
  staffedSlots,
  isFollowing,
  onToggleFollow,
  onClose,
}: CitizenCardProps) {
  const registryCitizen: Citizen | undefined =
    state && typeof citizen.citizenId === 'number'
      ? state.citizens.find((c) => c.id === citizen.citizenId)
      : undefined;

  // Never render a card for a citizen who is no longer in the living registry (deceased/emigrated)
  if (state && typeof citizen.citizenId === 'number' && !registryCitizen) {
    return null;
  }

  const personalityView = registryCitizen
    ? formatCitizenCardPersonality(registryCitizen)
    : null;

  let scheduleLineAr: string | null = null;
  if (citizen.prayerStatus === 'to_prayer') {
    scheduleLineAr = 'في طريقه إلى المسجد للصلاة';
  } else if (citizen.prayerStatus === 'praying') {
    scheduleLineAr = 'يصلّي في المسجد';
  } else if (citizen.prayerStatus === 'returning') {
    scheduleLineAr = 'عائد من الصلاة';
  } else if (state) {
    if (registryCitizen) {
      scheduleLineAr = formatCitizenScheduleLineAr(
        registryCitizen,
        state,
        staffedSlots
      );
    } else if (citizen.role === 'police') {
      const minute = minuteOfDayOf(state.clock);
      const sleeping =
        minute >= SCHEDULE_CONSTANTS.SLEEP_START_MINUTE ||
        minute < SCHEDULE_CONSTANTS.SLEEP_END_MINUTE;
      scheduleLineAr = sleeping
        ? 'نائم في القصر — الحراسة 05:00–22:00'
        : 'حراسة يومية 05:00–22:00';
    } else {
      const synthAge =
        citizen.role === 'child' ? 9 : citizen.role === 'elder' ? 62 : 28;
      const synthJobCube =
        citizen.workThemeId !== null
          ? state.cubes.find(
              (c) =>
                c.owner === 'player' &&
                (c.themeId === citizen.workThemeId ||
                  c.secondThemeId === citizen.workThemeId)
            )?.id ?? null
          : null;
      const synthBirthMonth = state.totalMonths - synthAge;
      const synthetic: Citizen = {
        id: citizen.id,
        name: citizen.name,
        gender: citizen.role === 'woman' ? 'f' : 'm',
        birthMonth: synthBirthMonth,
        householdId: 0,
        homeCubeId: null,
        spouseId: null,
        parentIds: null,
        jobCubeId: citizen.role === 'child' ? null : synthJobCube,
        jobThemeId:
          citizen.role === 'child' || synthJobCube === null
            ? null
            : citizen.workThemeId,
        wealth: 0,
        attrs: {
          physical: 50,
          professional: 50,
          social: 50,
          health: 50,
          intelligence: 50,
        },
        traits: generateTraits(citizen.id, synthBirthMonth),
        memories: [],
        opinionOfKing: 0,
        cvFiled: false,
        housingRequestMonth: null,
      };
      scheduleLineAr = formatCitizenScheduleLineAr(
        synthetic,
        state,
        staffedSlots
      );
    }
  }
  const MoodIcon =
    citizen.moodTone === 'good'
      ? Smile
      : citizen.moodTone === 'neutral'
        ? Meh
        : Frown;

  const moodClass =
    citizen.moodTone === 'good'
      ? 'text-[#2D6E3B]'
      : citizen.moodTone === 'neutral'
        ? 'text-[#8A5F12]'
        : 'text-[#A83629]';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-[#E3D3AC]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#14524A]/12 text-[#14524A] flex items-center justify-center shrink-0">
            <User className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-[#2B2118] truncate">
              {citizen.name}
            </h3>
            <div className="text-[11px] font-bold text-[#6F5C43]">
              {citizen.roleLabelAr}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="w-7 h-7 rounded-lg hover:bg-[#EFE2C2] text-[#4F3F2B] flex items-center justify-center transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Live destination */}
      <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2">
        <div className="flex items-start gap-2 text-xs font-bold text-[#2B2118]">
          <Navigation className="w-3.5 h-3.5 text-[#14524A] shrink-0 mt-0.5" />
          <span className="leading-snug">{citizen.destinationAr}</span>
        </div>

        {scheduleLineAr && (
          <div className="flex items-start gap-2 pt-1.5 border-t border-[#EFE3C5] text-xs font-bold text-[#4F3F2B]">
            <Clock className="w-3.5 h-3.5 text-[#8A5F12] shrink-0 mt-0.5" />
            <span className="leading-snug">
              <span className="text-[#6F5C43]">جدوله اليوم: </span>
              <span className="tabular-nums-latin">{scheduleLineAr}</span>
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1.5 border-t border-[#EFE3C5] text-xs font-bold">
          <MoodIcon className={`w-4 h-4 shrink-0 ${moodClass}`} />
          <span className={moodClass}>{citizen.moodAr}</span>
        </div>
      </div>

      {/* Personality, last memory & opinion of the king (living registry citizens) */}
      {personalityView && (
        <div className="p-2.5 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-bold text-[#6F5C43] shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-[#8A5F12] shrink-0" />
              <span>الشخصية</span>
            </span>
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {personalityView.distinctiveTraits.length > 0 ? (
                personalityView.distinctiveTraits.map((t) => (
                  <span
                    key={t.axis}
                    className="px-2 py-0.5 rounded-md bg-[#F4E7C8] border border-[#DFC996] text-[11px] font-extrabold text-[#4F3F2B]"
                  >
                    {t.labelAr}
                  </span>
                ))
              ) : (
                <span className="text-[11px] font-bold text-[#6F5C43]">
                  {personalityView.traitsFallbackAr}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 pt-1.5 border-t border-[#EFE3C5] font-bold text-[#4F3F2B]">
            <BookOpen className="w-3.5 h-3.5 text-[#6F5C43] shrink-0 mt-0.5" />
            <span className="leading-snug">
              <span className="text-[#6F5C43]">آخر ذكرى: </span>
              <span>{personalityView.lastMemoryAr}</span>
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#EFE3C5] font-bold">
            <span className="flex items-center gap-1.5 text-[#6F5C43]">
              <Crown className="w-3.5 h-3.5 text-[#B58119] shrink-0" />
              <span>رأيه في الملك</span>
            </span>
            <span
              className={`font-extrabold tabular-nums-latin ${
                personalityView.opinionTone === 'positive'
                  ? 'text-[#B58119]'
                  : personalityView.opinionTone === 'negative'
                    ? 'text-[#A83629]'
                    : 'text-[#6F5C43]'
              }`}
            >
              {personalityView.opinionBandAr} ({personalityView.opinionSignedText})
            </span>
          </div>
        </div>
      )}

      {/* Follow toggle button */}
      <button
        type="button"
        onClick={onToggleFollow}
        className={`w-full py-2 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors border ${
          isFollowing
            ? 'bg-[#C9962E] hover:bg-[#D6A43E] border-[#A87A1F] text-[#2B2118]'
            : 'bg-[#14524A] hover:bg-[#1B685E] border-[#14524A] text-white'
        }`}
      >
        <Compass className="w-3.5 h-3.5" />
        <span>{isFollowing ? 'إيقاف التتبع' : 'تتبع'}</span>
      </button>
    </div>
  );
}
