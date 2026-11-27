import type {
  AmbitionTrait,
  Citizen,
  CitizenMemory,
  CitizenMemoryKind,
  CitizenTraitAxis,
  CitizenTraits,
  GenerosityTrait,
  HonestyTrait,
  PietyTrait,
  SociabilityTrait,
} from './types';

export type {
  AmbitionTrait,
  CitizenMemory,
  CitizenMemoryKind,
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

// =============================================================================
// Element 2 — Citizen Memory (capped last 12, derived Arabic text, no free-text)
// =============================================================================

export const MAX_CITIZEN_MEMORIES = 12;

const VALID_MEMORY_KINDS: ReadonlySet<string> = new Set<CitizenMemoryKind>([
  'job_gained',
  'job_lost',
  'married',
  'child_born',
  'got_housing',
  'prayer_attended',
  'death_in_family',
  'land_bought',
  'land_denied',
]);

function isValidMemoryKind(kind: unknown): kind is CitizenMemoryKind {
  return typeof kind === 'string' && VALID_MEMORY_KINDS.has(kind);
}

function normalizeMemory(memory: CitizenMemory): CitizenMemory {
  return {
    month: Number.isFinite(memory.month) ? Math.max(0, Math.trunc(memory.month)) : 0,
    kind: memory.kind,
    cubeId:
      typeof memory.cubeId === 'number' && Number.isFinite(memory.cubeId)
        ? Math.trunc(memory.cubeId)
        : null,
    amount:
      typeof memory.amount === 'number' && Number.isFinite(memory.amount)
        ? Math.trunc(memory.amount)
        : null,
  };
}

/**
 * Pure helper: appends a personal memory to a citizen and keeps only the LAST 12 (oldest dropped).
 */
export function addCitizenMemory(
  citizen: Citizen,
  memory: CitizenMemory
): Citizen {
  if (!isValidMemoryKind(memory.kind)) {
    return citizen;
  }
  const existing = Array.isArray(citizen.memories) ? citizen.memories : [];
  const next = [...existing, normalizeMemory(memory)];
  const capped =
    next.length > MAX_CITIZEN_MEMORIES
      ? next.slice(next.length - MAX_CITIZEN_MEMORIES)
      : next;
  return {
    ...citizen,
    memories: capped,
  };
}

/**
 * Sanitizes saved memories on hydrate: drops invalid entries and enforces the last-12 cap.
 */
export function sanitizeMemoriesOnHydrate(
  raw: unknown,
  maxMonth?: number
): CitizenMemory[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const clean: CitizenMemory[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (!isValidMemoryKind(obj.kind)) continue;
    const rawMonth =
      typeof obj.month === 'number' && Number.isFinite(obj.month)
        ? Math.max(0, Math.trunc(obj.month))
        : 0;
    const month =
      typeof maxMonth === 'number' && Number.isFinite(maxMonth)
        ? Math.min(Math.max(0, Math.trunc(maxMonth)), rawMonth)
        : rawMonth;
    const cubeId =
      typeof obj.cubeId === 'number' && Number.isFinite(obj.cubeId)
        ? Math.trunc(obj.cubeId)
        : null;
    const amount =
      typeof obj.amount === 'number' && Number.isFinite(obj.amount)
        ? Math.trunc(obj.amount)
        : null;
    clean.push({ month, kind: obj.kind, cubeId, amount });
  }
  return clean.length > MAX_CITIZEN_MEMORIES
    ? clean.slice(clean.length - MAX_CITIZEN_MEMORIES)
    : clean;
}

/**
 * Derives truthful Arabic display text solely from a CitizenMemory's kind + structured fields.
 * No free-text field exists on CitizenMemory.
 */
export function memoryTextAr(memory: CitizenMemory): string {
  switch (memory.kind) {
    case 'job_gained':
      return 'حصل على وظيفة';
    case 'job_lost':
      return 'فقد وظيفته';
    case 'married':
      return 'تزوّج وبنى أسرة';
    case 'child_born':
      return 'رُزق بمولود جديد';
    case 'got_housing':
      return 'حصل على مسكن';
    case 'prayer_attended':
      return 'أدّى الصلاة في المسجد';
    case 'death_in_family':
      return 'فقد قريباً له';
    case 'land_bought':
      return memory.amount !== null && memory.amount > 0
        ? `اشترى أرضاً بـ ${memory.amount} ذهب`
        : 'اشترى أرضاً';
    case 'land_denied':
      return 'رُفض طلبه لشراء أرض';
  }
}

// =============================================================================
// Element 3 — Opinion of the King (-100..+100 integer, memory-driven drift)
// =============================================================================

export const OPINION_MIN = -100;
export const OPINION_MAX = 100;

/**
 * Clamps any numeric opinion value to an integer in [-100, 100].
 */
export function clampOpinion(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const truncated = Math.trunc(value);
  const clamped = Math.max(OPINION_MIN, Math.min(OPINION_MAX, truncated));
  return clamped === 0 ? 0 : clamped;
}

/**
 * Sanitizes saved opinionOfKing on hydrate (defaults to 0, integer in [-100, 100]).
 */
export function sanitizeOpinionOnHydrate(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return clampOpinion(raw);
}

/**
 * Maps an opinion score (-100..+100) to its Arabic loyalty band label.
 */
export function opinionBandAr(opinion: number): string {
  const val = clampOpinion(opinion);
  if (val >= 40) return 'مُوالٍ';
  if (val >= 10) return 'راضٍ';
  if (val > -10) return 'محايد';
  if (val > -40) return 'ساخط';
  return 'غاضب';
}

function memoryOpinionWeight(
  memory: CitizenMemory,
  traits: CitizenTraits | null | undefined
): number {
  switch (memory.kind) {
    case 'job_gained':
      return 6;
    case 'job_lost':
      return -8;
    case 'married':
      return 4;
    case 'child_born':
      return 3;
    case 'got_housing':
      return 6;
    case 'death_in_family':
      return -6;
    case 'prayer_attended':
      return traits?.piety === 'devout' ? 2 : 1;
    case 'land_bought':
      return 5;
    case 'land_denied':
      return -5;
  }
}

/**
 * Pure monthly opinion drift:
 * - If thisMonthMemories is non-empty: adds exact weight sum for those memories and clamps [-100, 100].
 * - If thisMonthMemories is empty: decays 10% toward 0, rounded toward zero, never crossing 0.
 */
export function computeOpinionDrift(
  citizen: Pick<Citizen, 'opinionOfKing' | 'traits'>,
  thisMonthMemories: readonly CitizenMemory[]
): number {
  const current = clampOpinion(citizen.opinionOfKing);
  if (thisMonthMemories.length > 0) {
    let delta = 0;
    for (let i = 0; i < thisMonthMemories.length; i++) {
      delta += memoryOpinionWeight(thisMonthMemories[i], citizen.traits);
    }
    return clampOpinion(current + delta);
  }
  if (current === 0) return 0;
  // Exact integer 10% decay toward 0 (round toward zero; identical to trunc(current * 0.9), never crosses 0)
  const step = Math.floor((Math.abs(current) + 9) / 10);
  return current > 0 ? Math.max(0, current - step) : Math.min(0, current + step);
}

// =============================================================================
// Element 6 — Citizen Card Personality/Memory/Opinion Display Helpers
// =============================================================================

export interface DistinctiveTraitBadge {
  axis: CitizenTraitAxis;
  labelAr: string;
}

export interface CitizenCardPersonalityView {
  distinctiveTraits: DistinctiveTraitBadge[];
  traitsFallbackAr: string;
  lastMemoryAr: string;
  opinionValue: number;
  opinionSignedText: string;
  opinionBandAr: string;
  opinionTone: 'positive' | 'neutral' | 'negative';
}

/**
 * Returns up to 2 non-balanced personality trait badges in deterministic axis order.
 * Returns [] if all 5 axes are 'balanced' (UI shows 'متوازن الطباع').
 */
export function getDistinctiveTraits(
  traits: CitizenTraits | null | undefined,
  maxCount = 2
): DistinctiveTraitBadge[] {
  if (!traits) return [];
  const cap = Math.max(0, Math.trunc(maxCount));
  const out: DistinctiveTraitBadge[] = [];
  for (let i = 0; i < TRAIT_AXES.length && out.length < cap; i++) {
    const axis = TRAIT_AXES[i];
    const value = traits[axis];
    if (value && value !== 'balanced') {
      const labelAr = (TRAIT_LABELS_AR[axis] as Record<string, string>)[value];
      if (labelAr) {
        out.push({ axis, labelAr });
      }
    }
  }
  return out;
}

/**
 * Pure derived view model for the CitizenCard personality, last memory, and opinion block.
 */
export function formatCitizenCardPersonality(
  citizen: Pick<Citizen, 'traits' | 'memories' | 'opinionOfKing'>
): CitizenCardPersonalityView {
  const distinctiveTraits = getDistinctiveTraits(citizen.traits, 2);
  const memories = Array.isArray(citizen.memories) ? citizen.memories : [];
  const lastMem = memories.length > 0 ? memories[memories.length - 1] : null;
  const opinionValue = clampOpinion(citizen.opinionOfKing);
  const opinionSignedText =
    opinionValue > 0 ? `+${opinionValue}` : `${opinionValue}`;
  const opinionTone: 'positive' | 'neutral' | 'negative' =
    opinionValue >= 10
      ? 'positive'
      : opinionValue <= -10
        ? 'negative'
        : 'neutral';

  return {
    distinctiveTraits,
    traitsFallbackAr: 'متوازن الطباع',
    lastMemoryAr: lastMem ? memoryTextAr(lastMem) : 'لا ذكريات مسجلة بعد',
    opinionValue,
    opinionSignedText,
    opinionBandAr: opinionBandAr(opinionValue),
    opinionTone,
  };
}


