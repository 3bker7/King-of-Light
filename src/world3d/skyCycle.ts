import { CLOCK_CONSTANTS } from '../game/clock';

export interface SkySample {
  secondsOfDay: number;
  darkness: number; // 0 by full day (06:30..17:30), 1 by full night (19:00..05:00)
  lampGlow: number; // Same curve as darkness: ramps up 17:30->19:00, down 05:00->06:30
  sunIntensity: number; // 0.35 (night moonlight) .. 2.30 (noon anchor)
  sunColorHex: number; // 0xffd9a0 at 12:00, 0x8fb4ff at night
  sunOffset: { x: number; y: number; z: number }; // (+70, 78, +40) at 12:00
  hemiSkyHex: number; // 0xcfe8ef at 12:00
  hemiGroundHex: number; // 0xcaa96a at 12:00
  hemiIntensity: number; // 0.75 at 12:00
  fogColorHex: number; // 0xe8d9b0 at 12:00
  skyColorHex: number;
  exposure: number; // 1.12 at 12:00, floor >= 0.85 (0.88 at night)
  envIntensity: number; // 1.0 at 12:00, 0.32 at night
  starOpacity: number; // 0 by day, 0.92 at night
  moonOpacity: number; // 0 by day, 0.95 at night
  moonProgress: number; // 0 at 18:00, 0.5 at 00:00, 1 at 06:00
  isNight: boolean;
}

const DAWN_START_S = 5 * 3_600; // 05:00 (18,000)
const DAWN_END_S = 6.5 * 3_600; // 06:30 (23,400)
const NOON_S = 12 * 3_600; // 12:00 (43,200)
const DUSK_START_S = 17.5 * 3_600; // 17:30 (63,000)
const DUSK_END_S = 19 * 3_600; // 19:00 (68,400)

// Verified Prompt-1-v4 noon anchor colors
const NOON_SUN_HEX = 0xffd9a0;
const NOON_HEMI_SKY_HEX = 0xcfe8ef;
const NOON_HEMI_GROUND_HEX = 0xcaa96a;
const NOON_FOG_HEX = 0xe8d9b0;
const NOON_SKY_HEX = 0xdbe6dc;

// Warm golden dawn/dusk tint colors
const GOLDEN_SUN_HEX = 0xff9442;
const GOLDEN_HEMI_SKY_HEX = 0xf4b684;
const GOLDEN_HEMI_GROUND_HEX = 0xb57c4b;
const GOLDEN_FOG_HEX = 0xd99b6c;
const GOLDEN_SKY_HEX = 0xd88c5c;

// Cool nocturnal palette (distinct color temperature, never a dimmed day scene)
const NIGHT_MOON_HEX = 0x8fb4ff;
const NIGHT_HEMI_SKY_HEX = 0x1b2d52;
const NIGHT_HEMI_GROUND_HEX = 0x162033;
const NIGHT_FOG_HEX = 0x121c33;
const NIGHT_SKY_HEX = 0x0b1326;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

function lerpColorHex(a: number, b: number, t: number): number {
  const k = clamp01(t);
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Pure continuous sky/lighting evaluator driven strictly by secondsOfDay (0..86399).
 * - Exact Prompt-1-v4 golden grade at 12:00 noon (sun 0xffd9a0 @ 2.3, hemi 0.75, exposure 1.12, fog 0xe8d9b0)
 * - Strictly monotonic intensity rising through dawn (05:00 -> 12:00) and falling through dusk (12:00 -> 19:00)
 * - Cool silver-blue moonlight (0x8fb4ff @ 0.35) and indigo night temperature with exposure >= 0.85
 * - Zero discontinuities across midnight wrap (23:59 -> 00:00 -> 06:00)
 */
export function evaluateSkyState(rawSecondsOfDay: number): SkySample {
  const dayLen = CLOCK_CONSTANTS.GAME_SECONDS_PER_DAY;
  const secondsOfDay = Number.isFinite(rawSecondsOfDay)
    ? ((rawSecondsOfDay % dayLen) + dayLen) % dayLen
    : CLOCK_CONSTANTS.DEFAULT_START_SECONDS_OF_DAY;

  // Darkness curve: 0 during 06:30..17:30, smooth ramp up 17:30->19:00, 1 during 19:00..05:00, smooth ramp down 05:00->06:30
  let darkness = 0;
  if (secondsOfDay < DAWN_START_S || secondsOfDay >= DUSK_END_S) {
    darkness = 1;
  } else if (secondsOfDay < DAWN_END_S) {
    darkness = 1 - smoothstep(DAWN_START_S, DAWN_END_S, secondsOfDay);
  } else if (secondsOfDay >= DUSK_START_S) {
    darkness = smoothstep(DUSK_START_S, DUSK_END_S, secondsOfDay);
  }

  // Smooth elevation bell strictly increasing 05:00->12:00, strictly decreasing 12:00->19:00, 0 at night
  let dayElevation = 0;
  if (secondsOfDay > DAWN_START_S && secondsOfDay <= NOON_S) {
    const t = (secondsOfDay - DAWN_START_S) / (NOON_S - DAWN_START_S);
    dayElevation = Math.sin(t * Math.PI * 0.5);
  } else if (secondsOfDay > NOON_S && secondsOfDay < DUSK_END_S) {
    const t = (DUSK_END_S - secondsOfDay) / (DUSK_END_S - NOON_S);
    dayElevation = Math.sin(t * Math.PI * 0.5);
  }

  // Golden low-sun tint peaks during dawn & dusk, strictly 0 at noon (12:00) and full night
  const goldenFactor = Math.sin(dayElevation * Math.PI);

  // Directional light intensity: 0.35 moonlight floor -> 2.30 noon anchor
  const sunIntensity = lerp(0.35, 2.3, dayElevation);

  // Directional light color temperature: cool moon -> warm amber dawn/dusk -> noon white-gold
  const baseLightHex = lerpColorHex(
    NIGHT_MOON_HEX,
    NOON_SUN_HEX,
    Math.min(1, dayElevation * 1.45)
  );
  const sunColorHex = lerpColorHex(baseLightHex, GOLDEN_SUN_HEX, goldenFactor * 0.68);

  // Hemisphere sky/ground & intensity
  const hemiSkyBase = lerpColorHex(NIGHT_HEMI_SKY_HEX, NOON_HEMI_SKY_HEX, 1 - darkness);
  const hemiSkyHex = lerpColorHex(hemiSkyBase, GOLDEN_HEMI_SKY_HEX, goldenFactor * 0.5);

  const hemiGroundBase = lerpColorHex(
    NIGHT_HEMI_GROUND_HEX,
    NOON_HEMI_GROUND_HEX,
    1 - darkness
  );
  const hemiGroundHex = lerpColorHex(
    hemiGroundBase,
    GOLDEN_HEMI_GROUND_HEX,
    goldenFactor * 0.35
  );
  const hemiIntensity = lerp(0.32, 0.75, dayElevation);

  // Fog & sky color temperature
  const fogBase = lerpColorHex(NIGHT_FOG_HEX, NOON_FOG_HEX, 1 - darkness);
  const fogColorHex = lerpColorHex(fogBase, GOLDEN_FOG_HEX, goldenFactor * 0.52);

  const skyBase = lerpColorHex(NIGHT_SKY_HEX, NOON_SKY_HEX, 1 - darkness);
  const skyColorHex = lerpColorHex(skyBase, GOLDEN_SKY_HEX, goldenFactor * 0.5);

  // Exposure stays strictly >= 0.85 so night remains readable while 12:00 hits exact 1.12
  const exposure = lerp(0.88, 1.12, dayElevation);
  const envIntensity = lerp(0.32, 1.0, dayElevation);

  // Sun arc (06:00 -> 18:00): sweeps East -> Noon (+70, 78, +40) -> West
  const sunP = clamp01(
    (secondsOfDay - CLOCK_CONSTANTS.SUNRISE_SECONDS) /
      (CLOCK_CONSTANTS.SUNSET_SECONDS - CLOCK_CONSTANTS.SUNRISE_SECONDS)
  );
  const sunAngle = sunP * Math.PI;
  const sunArcX = Math.cos(sunAngle) * 95 + Math.sin(sunAngle) * 70;
  const sunArcY = 18 + Math.sin(sunAngle) * 60;
  const sunArcZ = 40;

  // Moon mirrored arc (18:00 -> 06:00)
  const nightSpan = dayLen - (CLOCK_CONSTANTS.SUNSET_SECONDS - CLOCK_CONSTANTS.SUNRISE_SECONDS);
  const nightElapsed =
    secondsOfDay >= CLOCK_CONSTANTS.SUNSET_SECONDS
      ? secondsOfDay - CLOCK_CONSTANTS.SUNSET_SECONDS
      : secondsOfDay + (dayLen - CLOCK_CONSTANTS.SUNSET_SECONDS);
  const moonProgress = clamp01(nightElapsed / nightSpan);
  const moonAngle = moonProgress * Math.PI;
  const moonArcX = -Math.cos(moonAngle) * 88 - Math.sin(moonAngle) * 55;
  const moonArcY = 20 + Math.sin(moonAngle) * 52;
  const moonArcZ = -35 + Math.sin(moonAngle) * 18;

  // Blend light offset smoothly across twilight so there is zero jump at 06:00 or 18:00
  const sunWeight = 1 - darkness;
  const sunOffset = {
    x: lerp(moonArcX, sunArcX, sunWeight),
    y: lerp(moonArcY, sunArcY, sunWeight),
    z: lerp(moonArcZ, sunArcZ, sunWeight),
  };

  const isNight =
    secondsOfDay < CLOCK_CONSTANTS.SUNRISE_SECONDS ||
    secondsOfDay >= CLOCK_CONSTANTS.SUNSET_SECONDS;

  return {
    secondsOfDay,
    darkness,
    lampGlow: darkness,
    sunIntensity,
    sunColorHex,
    sunOffset,
    hemiSkyHex,
    hemiGroundHex,
    hemiIntensity,
    fogColorHex,
    skyColorHex,
    exposure,
    envIntensity,
    starOpacity: darkness * 0.92,
    moonOpacity: darkness * 0.95,
    moonProgress,
    isNight,
  };
}
