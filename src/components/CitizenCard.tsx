import { Compass, Frown, Meh, Navigation, Smile, User, X } from 'lucide-react';
import type { ThemeId } from '../game/types';

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
  name: string;
  role: CitizenRoleId;
  roleLabelAr: string;
  destinationAr: string;
  moodAr: string;
  moodTone: 'good' | 'neutral' | 'low';
  workThemeId: ThemeId | null;
  x: number;
  z: number;
}

interface CitizenCardProps {
  citizen: CitizenInfo;
  isFollowing: boolean;
  onToggleFollow: () => void;
  onClose: () => void;
}

export function CitizenCard({
  citizen,
  isFollowing,
  onToggleFollow,
  onClose,
}: CitizenCardProps) {
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

        <div className="flex items-center gap-2 pt-1.5 border-t border-[#EFE3C5] text-xs font-bold">
          <MoodIcon className={`w-4 h-4 shrink-0 ${moodClass}`} />
          <span className={moodClass}>{citizen.moodAr}</span>
        </div>
      </div>

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
