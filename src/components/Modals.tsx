import {
  Award,
  CheckCircle2,
  Crown,
  RotateCcw,
  Settings,
  Store,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { STRINGS } from '../game/strings';
import type { GameState, TradedResourceKey } from '../game/types';
import { BoursePanel } from './BoursePanel';

interface BourseModalProps {
  state: GameState;
  onTrade: (
    resource: TradedResourceKey,
    side: 'buy' | 'sell',
    quantity: number | 'max'
  ) => void;
  onClose: () => void;
}

export function BourseModal({ state, onTrade, onClose }: BourseModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[86vh] parchment-panel border-2 border-[#C9962E] p-5 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E3D3AC] pb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-[#14524A] text-[#F2CA6B] flex items-center justify-center">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-[#2B2118]">
                {STRINGS.bourse.title}
              </h2>
              <div className="text-xs font-bold text-[#8A5F12]">
                {STRINGS.goldLabel}:{' '}
                <span className="tabular-nums-latin">{state.gold}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={STRINGS.modals.close}
            className="w-8 h-8 rounded-xl bg-[#EFE2C2] hover:bg-[#E4D1A5] text-[#2B2118] flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto parchment-scroll pl-1">
          <BoursePanel state={state} onTrade={onTrade} />
        </div>
      </div>
    </div>
  );
}

interface Level2ModalProps {
  onClose: () => void;
}

export function Level2CelebrationModal({ onClose }: Level2ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55">
      <div className="w-full max-w-md parchment-panel border-2 border-[#C9962E] p-5 space-y-4">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-[#14524A] text-[#F2CA6B] flex items-center justify-center shadow">
            <Crown className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-extrabold text-[#2B2118]">
            {STRINGS.modals.level2Title}
          </h2>
          <div className="text-xs font-extrabold text-[#8A5F12]">
            {STRINGS.modals.level2Subtitle}
          </div>
          <p className="text-xs leading-relaxed text-[#4F3F2B]">
            {STRINGS.modals.level2Body}
          </p>
        </div>

        <ul className="space-y-1.5 p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC]">
          {STRINGS.modals.level2Unlocks.map((item) => (
            <li
              key={item}
              className="flex items-center gap-2 text-xs font-bold text-[#2B2118]"
            >
              <CheckCircle2 className="w-4 h-4 text-[#3E9B4F] shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 px-4 rounded-xl bg-[#14524A] hover:bg-[#1B685E] text-white text-sm font-extrabold transition-colors"
        >
          {STRINGS.modals.continuePlay}
        </button>
      </div>
    </div>
  );
}

interface Level3SoonModalProps {
  onClose: () => void;
}

export function Level3ComingSoonModal({ onClose }: Level3SoonModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55">
      <div className="w-full max-w-md parchment-panel border-2 border-[#C9962E] p-5 space-y-4 text-center">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-[#14524A] text-[#F2CA6B] flex items-center justify-center shadow">
          <Award className="w-6 h-6" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-extrabold text-[#2B2118]">
            {STRINGS.modals.level3Title}
          </h2>
          <div className="text-xs font-extrabold text-[#8A5F12]">
            {STRINGS.modals.level3Subtitle}
          </div>
          <p className="text-xs leading-relaxed text-[#4F3F2B]">
            {STRINGS.modals.level3Body}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 px-4 rounded-xl bg-[#14524A] hover:bg-[#1B685E] text-white text-sm font-extrabold transition-colors"
        >
          {STRINGS.modals.continuePlay}
        </button>
      </div>
    </div>
  );
}

interface SettingsModalProps {
  muted: boolean;
  onToggleMute: () => void;
  onNewGame: () => void;
  onClose: () => void;
}

export function SettingsModal({
  muted,
  onToggleMute,
  onNewGame,
  onClose,
}: SettingsModalProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm parchment-panel border-2 border-[#C9962E] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E3D3AC] pb-3">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#14524A]" />
            <h2 className="text-base font-extrabold text-[#2B2118]">
              {STRINGS.modals.settingsTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={STRINGS.modals.close}
            className="w-8 h-8 rounded-xl bg-[#EFE2C2] hover:bg-[#E4D1A5] text-[#2B2118] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sound Mute Toggle */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC]">
          <div className="flex items-center gap-2 text-xs font-extrabold text-[#2B2118]">
            {muted ? (
              <VolumeX className="w-4 h-4 text-[#8A7759]" />
            ) : (
              <Volume2 className="w-4 h-4 text-[#14524A]" />
            )}
            <span>{STRINGS.modals.soundLabel}</span>
          </div>
          <button
            type="button"
            onClick={onToggleMute}
            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-colors ${
              muted
                ? 'bg-[#E5D5B2] text-[#5D4C34]'
                : 'bg-[#14524A] text-white hover:bg-[#1B685E]'
            }`}
          >
            {muted ? STRINGS.modals.soundOff : STRINGS.modals.soundOn}
          </button>
        </div>

        {/* Explicit New Game with Confirmation Step */}
        <div className="p-3 rounded-xl bg-[#FDF8EC] border border-[#E3D3AC] space-y-2.5">
          <div className="text-xs font-extrabold text-[#2B2118]">
            {STRINGS.modals.newGameTitle}
          </div>
          <p className="text-[11px] leading-relaxed text-[#6F5C43]">
            {STRINGS.modals.newGameDesc}
          </p>

          {!confirmingReset ? (
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              className="w-full py-2 px-3 rounded-xl border border-[#DFB9B3] bg-[#FBF0EE] hover:bg-[#F5DDD9] text-[#A83629] text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{STRINGS.modals.newGameButton}</span>
            </button>
          ) : (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] font-extrabold text-[#A83629]">
                {STRINGS.modals.newGameConfirmPrompt}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onNewGame();
                    setConfirmingReset(false);
                    onClose();
                  }}
                  className="flex-1 py-2 px-3 rounded-xl bg-[#C44536] hover:bg-[#AA382B] text-white text-xs font-extrabold transition-colors"
                >
                  {STRINGS.modals.newGameConfirmYes}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  className="flex-1 py-2 px-3 rounded-xl bg-[#EFE2C2] hover:bg-[#E4D1A5] text-[#2B2118] text-xs font-extrabold transition-colors"
                >
                  {STRINGS.modals.newGameConfirmCancel}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
