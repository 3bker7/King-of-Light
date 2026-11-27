import type {
  AmbitionTrait,
  Citizen,
  CitizenTraitAxis,
  CitizenTraits,
  GenerosityTrait,
  HonestyTrait,
  PietyTrait,
  SociabilityTrait,
} from './types';

export type {
  AmbitionTrait,
  CitizenTraitAxis,
  CitizenTraits,
  GenerosityTrait,
  HonestyTrait,
  PietyTrait,
  SociabilityTrait,
};

export const TRAIT_AXES: readonly CitizenTraitAxis[] = [
  'generosity',
  'sociability',
  'ambition',
  'honesty',
  'piety',
] as const;

const AXIS_POLES: {
  generosity: readonly [GenerosityTrait, 'balanced', GenerosityTrait];
  sociability: readonly [SociabilityTrait, 'balanced', SociabilityTrait];
  ambition: readonly [AmbitionTrait, 'balanced', AmbitionTrait];
  honesty: readonly [HonestyTrait, 'balanced', HonestyTrait];
  piety: readonly [PietyTrait, 'balanced', PietyTrait];
} = {
  generosity: ['generous', 'balanced', 'stingy'],
  sociability: ['social', 'balanced', 'loner'],
  ambition: ['ambitious', 'balanced', 'content'],
  honesty: ['honest', 'balanced', 'sly'],
  piety: ['devout', 'balanced', 'lax'],
};

export const TRAIT_LABELS_AR: {
  generosity: Record<GenerosityTrait, string>;
  sociability: Record<SociabilityTrait, string>;
  ambition: Record<AmbitionTrait, string>;
  honesty: Record<HonestyTrait, string>;
  piety: Record<PietyTrait, string>;
} = {
  generosity: {
    generous: 'كريم',
    balanced: 'معتدل الكرم',
    stingy: 'شحيح',
  },
  sociability: {
    social: 'اجتماعي',
    balanced: 'معتدل المعشر',
    loner: 'منعزل',
  },
  ambition: {
    ambitious: 'طموح',
    balanced: 'معتدل الطموح',
    content: 'قنوع',
  },
  honesty: {
    honest: 'صادق',
    balanced: 'معتدل الأمانة',
    sly: 'ماكر',
  },
  piety: {
    devout: 'تقيّ',
    balanced: 'معتدل التديّن',
    lax: 'مقصّر',
  },
};

/**
 * Deterministic 32-bit unsigned integer avalanche hash (machine-independent).
 */
function hashInt32(seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function pickPole<P extends string, N extends string>(
  hashVal: number,
  poles: readonly [P, 'balanced', N]
): P | 'balanced' | N {
  const bucket = (hashVal >>> 0) % 4;
  if (bucket === 0) return poles[0];
  if (bucket === 3) return poles[2];
  return 'balanced';
}

/**
 * Fully deterministic hash-based trait generator per axis.
 * Uses (citizenId * 31 + birthMonth * 7 + axisIndex) mixed with a 32-bit integer hash:
 * bucket 0 -> positive pole (~25%), 1|2 -> balanced (~50%), 3 -> negative pole (~25%).
 */
export function generateTraits(
  citizenId: number,
  birthMonth: number
): CitizenTraits {
  const safeId = Number.isFinite(citizenId) ? Math.trunc(citizenId) : 0;
  const safeBirth = Number.isFinite(birthMonth) ? Math.trunc(birthMonth) : 0;
  const base = Math.imul(safeId, 31) + Math.imul(safeBirth, 7);

  return {
    generosity: pickPole(hashInt32(base + 0), AXIS_POLES.generosity),
    sociability: pickPole(hashInt32(base + 1), AXIS_POLES.sociability),
    ambition: pickPole(hashInt32(base + 2), AXIS_POLES.ambition),
    honesty: pickPole(hashInt32(base + 3), AXIS_POLES.honesty),
    piety: pickPole(hashInt32(base + 4), AXIS_POLES.piety),
  };
}

type TraitParentInput =
  | Pick<Citizen, 'traits'>
  | CitizenTraits
  | null
  | undefined;

function extractValidTraits(parent: TraitParentInput): CitizenTraits | null {
  if (!parent || typeof parent !== 'object') return null;
  const candidate =
    'traits' in parent && parent.traits && typeof parent.traits === 'object'
      ? (parent.traits as Partial<CitizenTraits>)
      : (parent as Partial<CitizenTraits>);
  if (
    isValidTraitValue('generosity', candidate.generosity) &&
    isValidTraitValue('sociability', candidate.sociability) &&
    isValidTraitValue('ambition', candidate.ambition) &&
    isValidTraitValue('honesty', candidate.honesty) &&
    isValidTraitValue('piety', candidate.piety)
  ) {
    return {
      generosity: candidate.generosity,
      sociability: candidate.sociability,
      ambition: candidate.ambition,
      honesty: candidate.honesty,
      piety: candidate.piety,
    };
  }
  return null;
}

function isValidTraitValue<K extends CitizenTraitAxis>(
  axis: K,
  value: unknown
): value is CitizenTraits[K] {
  if (typeof value !== 'string') return false;
  return (AXIS_POLES[axis] as readonly string[]).includes(value);
}

/**
 * Deterministic trait inheritance per axis:
 * - Both parents known: hash(childId + axisIndex) coin picks mother's or father's value.
 * - One parent known: takes that parent's value.
 * - Neither parent known: falls back to generateTraits(childId, birthMonth).
 */
export function inheritTraits(
  childId: number,
  birthMonth: number,
  mother: TraitParentInput,
  father: TraitParentInput
): CitizenTraits {
  const mTraits = extractValidTraits(mother);
  const fTraits = extractValidTraits(father);

  if (!mTraits && !fTraits) {
    return generateTraits(childId, birthMonth);
  }
  if (mTraits && !fTraits) {
    return { ...mTraits };
  }
  if (!mTraits && fTraits) {
    return { ...fTraits };
  }

  const m = mTraits!;
  const f = fTraits!;
  const safeId = Number.isFinite(childId) ? Math.trunc(childId) : 0;
  const pickFromMother = (axisIndex: number): boolean =>
    (hashInt32(Math.imul(safeId, 31) + axisIndex) & 1) === 0;

  return {
    generosity: pickFromMother(0) ? m.generosity : f.generosity,
    sociability: pickFromMother(1) ? m.sociability : f.sociability,
    ambition: pickFromMother(2) ? m.ambition : f.ambition,
    honesty: pickFromMother(3) ? m.honesty : f.honesty,
    piety: pickFromMother(4) ? m.piety : f.piety,
  };
}

/**
 * Sanitizes saved traits on hydrate: valid axes stay byte-identical; missing/invalid axes
 * are filled deterministically via generateTraits(citizenId, birthMonth).
 */
export function sanitizeTraitsOnHydrate(
  raw: Partial<CitizenTraits> | null | undefined,
  citizenId: number,
  birthMonth: number
): CitizenTraits {
  const fallback = generateTraits(citizenId, birthMonth);
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }
  return {
    generosity: isValidTraitValue('generosity', raw.generosity)
      ? raw.generosity
      : fallback.generosity,
    sociability: isValidTraitValue('sociability', raw.sociability)
      ? raw.sociability
      : fallback.sociability,
    ambition: isValidTraitValue('ambition', raw.ambition)
      ? raw.ambition
      : fallback.ambition,
    honesty: isValidTraitValue('honesty', raw.honesty)
      ? raw.honesty
      : fallback.honesty,
    piety: isValidTraitValue('piety', raw.piety) ? raw.piety : fallback.piety,
  };
}
