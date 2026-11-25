import { CheckCircle2, ChevronDown, Circle, Coins, Target } from 'lucide-react';
import {
  LEVEL_1_FOOD_TARGET,
  LEVEL_1_SATISFACTION_TARGET,
  LEVEL_2_CUBES_TARGET,
  LEVEL_2_GOLD_TARGET,
  LEVEL_2_POPULATION_TARGET,
} from '../game/constants';
import { getTotalFood } from '../game/people';
import { STRINGS } from '../game/strings';
import type { GameState } from '../game/types';

interface ObjectivesProps {
  state: GameState;
  isOpen: boolean;
  onToggle: () => void;
  onSelectObjective: (objectiveId: string) => void;
  embedded?: boolean;
}

export function ObjectivesChip({
  state,
  isOpen,
  onToggle,
}: {
  state: GameState;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const currentObjectives = state.objectives.filter(
    (obj) => obj.level === state.level
  );
  const completedCount = currentObjectives.filter((o) => o.completed).length;

  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FBF3DF] hover:bg-[#F3E4BE] border border-[#C9962E] text-[#2B2118] text-xs font-extrabold shadow-md transition-colors whitespace-nowrap"
    >
      <Target className="w-3.5 h-3.5 text-[#14524A] shrink-0" />
      <span>{STRINGS.objectives.title}</span>
      <span className="tabular-nums-latin text-[#14524A]">
        {completedCount}/{currentObjectives.length}
      </span>
      <ChevronDown
        className={`w-3.5 h-3.5 text-[#6F5C43] transition-transform duration-150 ${
          isOpen ? 'rotate-180' : ''
        }`}
      />
    </button>
  );
}

function getObjectiveProgressText(state: GameState, id: string): string | null {
  switch (id) {
    case 'hold_30_food': {
      const food = getTotalFood(state.warehouse);
      return `${Math.min(food, LEVEL_1_FOOD_TARGET)} / ${LEVEL_1_FOOD_TARGET}`;
    }
    case 'reach_60_satisfaction':
      return `${Math.min(state.satisfaction, LEVEL_1_SATISFACTION_TARGET)} / ${LEVEL_1_SATISFACTION_TARGET}`;
    case 'reach_25_pop':
      return `${Math.min(state.population, LEVEL_2_POPULATION_TARGET)} / ${LEVEL_2_POPULATION_TARGET}`;
    case 'own_15_cubes': {
      const owned = state.cubes.filter((c) => c.owner === 'player').length;
      return `${Math.min(owned, LEVEL_2_CUBES_TARGET)} / ${LEVEL_2_CUBES_TARGET}`;
    }
    case 'hold_200_gold':
      return `${Math.min(state.gold, LEVEL_2_GOLD_TARGET)} / ${LEVEL_2_GOLD_TARGET}`;
    default:
      return null;
  }
}

export function Objectives({
  state,
  isOpen,
  onToggle,
  onSelectObjective,
  embedded = false,
}: ObjectivesProps) {
  const currentObjectives = state.objectives.filter(
    (obj) => obj.level === state.level
  );
  const completedCount = currentObjectives.filter((o) => o.completed).length;

  const card = isOpen ? (
    <section className="mt-1.5 w-[275px] max-w-[calc(100vw-24px)] parchment-panel border border-[#C9962E] shadow-2xl p-3 space-y-2">
      <div className="flex items-center justify-between pb-1.5 border-b border-[#E3D3AC]">
        <span className="text-xs font-extrabold text-[#2B2118]">
          {STRINGS.levelTitles[state.level]}
        </span>
        <span className="text-[11px] font-bold text-[#6F5C43] tabular-nums-latin">
          {completedCount} / {currentObjectives.length}
        </span>
      </div>

      <ul className="space-y-1.5">
        {currentObjectives.map((obj) => {
          const label = STRINGS.objectives.items[obj.id] ?? obj.id;
          const progressText = obj.completed
            ? null
            : getObjectiveProgressText(state, obj.id);

          return (
            <li key={obj.id}>
              <button
                type="button"
                onClick={() => onSelectObjective(obj.id)}
                className={`w-full text-right flex items-start justify-between gap-2 text-xs py-2 px-2.5 rounded-xl border transition-colors ${
                  obj.completed
                    ? 'bg-[#E9F3E4] border-[#C6DFBC] text-[#285E33] hover:bg-[#DFEDD8]'
                    : 'bg-[#FDF8EC] border-[#E8D9B5] text-[#2B2118] hover:border-[#C9962E] hover:bg-[#F7EBD0]'
                }`}
              >
                <div className="flex items-start gap-1.5 min-w-0">
                  {obj.completed ? (
                    <CheckCircle2 className="w-4 h-4 text-[#3E9B4F] shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-4 h-4 text-[#B89F72] shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div
                      className={`font-bold leading-snug ${
                        obj.completed ? 'line-through opacity-80' : ''
                      }`}
                    >
                      {label}
                    </div>
                    {progressText && (
                      <div className="text-[11px] text-[#6F5C43] tabular-nums-latin mt-0.5">
                        {progressText}
                      </div>
                    )}
                  </div>
                </div>

                {obj.rewardGold > 0 && (
                  <div className="flex items-center gap-0.5 text-[11px] font-extrabold text-[#8A5F12] shrink-0 mt-0.5">
                    <Coins className="w-3 h-3 text-[#C9962E]" />
                    <span className="tabular-nums-latin">
                      +{obj.rewardGold}
                    </span>
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  ) : null;

  if (embedded) {
    return card;
  }

  return (
    <div className="absolute top-3 left-3 z-20 flex flex-col items-start max-w-[calc(100%-24px)]">
      <ObjectivesChip state={state} isOpen={isOpen} onToggle={onToggle} />
      {card}
    </div>
  );
}
