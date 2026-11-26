import type { PrayerBannerEvent } from '../game/types';

interface PrayerBannerProps {
  banner: PrayerBannerEvent | null;
}

export function PrayerBanner({ banner }: PrayerBannerProps) {
  if (!banner) return null;

  const showAttendanceLine =
    banner.hasStaffedMosque && banner.selectedCount > 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed top-[82px] inset-x-0 z-30 flex justify-center px-3"
    >
      <div className="pointer-events-none max-w-full sm:max-w-md px-3.5 py-2 rounded-xl bg-[#FBF3DF] border border-[#C9962E] text-[#2B2118] shadow-md flex items-center gap-2.5">
        {/* Inline SVG soft bell glyph (no emoji) */}
        <div className="w-7 h-7 rounded-lg bg-[#C9962E]/20 border border-[#C9962E]/60 text-[#8A5F12] flex items-center justify-center shrink-0">
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 3a4.5 4.5 0 0 0-4.5 4.5v2.7c0 .9-.35 1.75-1 2.4l-.65.65h12.3l-.65-.65c-.65-.65-1-1.5-1-2.4V7.5A4.5 4.5 0 0 0 10 3Z" />
            <path d="M8.3 15.6a1.8 1.8 0 0 0 3.4 0" />
          </svg>
        </div>

        <div className="min-w-0 leading-snug">
          <div className="text-xs font-extrabold text-[#2B2118] truncate">
            حان الآن وقت صلاة {banner.nameAr}
          </div>
          {showAttendanceLine && (
            <div className="text-[11px] font-bold text-[#14524A] truncate tabular-nums-latin">
              توجّه {banner.selectedCount} من المواطنين إلى المسجد
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
