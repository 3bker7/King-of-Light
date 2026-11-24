import { ageYears, sumCitizenWealth } from './citizens';
import { getTotalFood } from './people';
import { computeStaffing, makeSlotKey } from './production';
import type {
  Citizen,
  Cube,
  FoodResourceKey,
  LastMonthStats,
  LedgerKind,
  SlotIndex,
  ThemeId,
  Warehouse,
} from './types';

export const LEISURE_VENUE_MONTHLY_CAP = 20;

const DOMESTIC_FOOD_PILES: readonly FoodResourceKey[] = [
  'fish',
  'crops',
  'wheat',
  'meat',
  'bread',
];

export function createZeroLastMonthStats(): LastMonthStats {
  return {
    foodRevenue: 0,
    leisureRevenue: 0,
    businessTax: 0,
    importSink: 0,
    leisureSink: 0,
    unmetFood: 0,
  };
}

export function computeFoodUnitCost(inflationIndex: number): number {
  const clamped = Math.max(80, Math.min(160, inflationIndex));
  return Math.round((2 * clamped) / 100);
}

export interface SpendingLedgerItem {
  kind: LedgerKind;
  amount: number;
  labelAr: string;
}

export interface CitizenSpendingInput {
  cubes: Cube[];
  warehouse: Warehouse;
  gold: number;
  population: number;
  inflationIndex: number;
  citizens: Citizen[];
  totalMonths: number;
  lastSpentMonth: number;
  staffedSlots?: Set<string>;
  rng?: () => number;
}

export interface CitizenSpendingResult {
  warehouse: Warehouse;
  gold: number;
  citizens: Citizen[];
  citizenWealth: number;
  lastMonthStats: LastMonthStats;
  lastSpentMonth: number;
  ledgerItems: SpendingLedgerItem[];
  totalCitizenSpent: number;
  treasuryFoodGain: number;
  treasuryLeisureGain: number;
  privateOwnerGains: number;
  foodUnitsSold: number;
  usedImports: boolean;
}

interface StaffedVenueSlot {
  cubeId: number;
  slot: SlotIndex;
  themeId: 'restaurant' | 'cafe' | 'theater' | 'hotel';
  ownerId: number | null;
  remainingCap: number;
}

function consumeDomesticFoodUnits(warehouse: Warehouse, units: number): number {
  let consumed = 0;
  for (let i = 0; i < units; i++) {
    let bestKey: FoodResourceKey | null = null;
    let bestAmt = 0;
    for (const key of DOMESTIC_FOOD_PILES) {
      const amt = warehouse[key] ?? 0;
      if (amt > bestAmt) {
        bestAmt = amt;
        bestKey = key;
      }
    }
    if (!bestKey && (warehouse.fruit ?? 0) > 0) {
      bestKey = 'fruit';
      bestAmt = warehouse.fruit;
    }
    if (!bestKey || bestAmt <= 0) break;
    warehouse[bestKey] = Math.max(0, warehouse[bestKey] - 1);
    consumed += 1;
  }
  return consumed;
}

function getOrderedHouseholdPayers(
  members: Citizen[],
  totalMonths: number
): Citizen[] {
  const adults = members.filter((c) => ageYears(c, totalMonths) >= 14);
  if (adults.length === 0) return [];

  // Head: oldest adult (preferring original/parent generation, tie-break lowest id)
  const sortedForHead = [...adults].sort((a, b) => {
    const aIsParent = a.parentIds === null ? 0 : 1;
    const bIsParent = b.parentIds === null ? 0 : 1;
    if (aIsParent !== bIsParent) return aIsParent - bIsParent;
    const ageDiff = ageYears(b, totalMonths) - ageYears(a, totalMonths);
    if (ageDiff !== 0) return ageDiff;
    return a.id - b.id;
  });

  const head = sortedForHead[0];
  const ordered: Citizen[] = [head];
  const seen = new Set<number>([head.id]);

  // Spouse second
  if (head.spouseId !== null) {
    const spouse = adults.find((c) => c.id === head.spouseId);
    if (spouse && !seen.has(spouse.id)) {
      ordered.push(spouse);
      seen.add(spouse.id);
    }
  }

  // Remaining adult members (adult children) sorted deterministically by id
  const rest = adults
    .filter((c) => !seen.has(c.id))
    .sort((a, b) => a.id - b.id);
  ordered.push(...rest);

  return ordered;
}

function deductSequentially(payers: Citizen[], amount: number): number {
  let remaining = Math.max(0, Math.floor(amount));
  let deducted = 0;
  for (const p of payers) {
    if (remaining <= 0) break;
    const take = Math.min(Math.max(0, Math.floor(p.wealth)), remaining);
    if (take > 0) {
      p.wealth = Math.max(0, p.wealth - take);
      deducted += take;
      remaining -= take;
    }
  }
  return deducted;
}

// Element 2: Monthly citizen spending engine (runs AFTER payroll inside monthlyProcessor).
// Strict conservation: totalCitizenSpent === treasuryGains + importSink + leisureSink + privateOwnerGains.
export function runCitizenSpending(
  input: CitizenSpendingInput
): CitizenSpendingResult {
  const rng = input.rng ?? Math.random;
  const currentMonth = Math.max(0, Math.trunc(input.totalMonths));

  // Hardening 2: Idempotent per month — never double-charge the same month
  if (input.lastSpentMonth >= currentMonth) {
    return {
      warehouse: input.warehouse,
      gold: input.gold,
      citizens: input.citizens,
      citizenWealth: sumCitizenWealth(input.citizens),
      lastMonthStats: createZeroLastMonthStats(),
      lastSpentMonth: input.lastSpentMonth,
      ledgerItems: [],
      totalCitizenSpent: 0,
      treasuryFoodGain: 0,
      treasuryLeisureGain: 0,
      privateOwnerGains: 0,
      foodUnitsSold: 0,
      usedImports: false,
    };
  }

  const nextWarehouse: Warehouse = { ...input.warehouse };
  const nextCitizens: Citizen[] = input.citizens.map((c) => ({
    ...c,
    wealth: Math.max(0, Math.floor(c.wealth)),
    attrs: { ...c.attrs },
    parentIds: c.parentIds ? ([c.parentIds[0], c.parentIds[1]] as [number, number]) : null,
  }));

  const citizenById = new Map<number, Citizen>();
  for (const c of nextCitizens) {
    citizenById.set(c.id, c);
  }

  const staffedSlots =
    input.staffedSlots ?? computeStaffing(input.cubes, input.population).staffedSlots;

  // Identify private plot owners (used for Element 2.4 smart-saver check)
  const privateOwnerSet = new Set<number>();
  for (const cube of input.cubes) {
    if (
      cube.owner === 'player' &&
      typeof cube.privateOwnerId === 'number' &&
      citizenById.has(cube.privateOwnerId)
    ) {
      privateOwnerSet.add(cube.privateOwnerId);
    }
  }

  // Check staffed food retail (shop or grand_market) and collect staffed leisure venues
  let hasStaffedFoodSeller = false;
  const venuesByTheme: Record<
    'restaurant' | 'cafe' | 'theater' | 'hotel',
    StaffedVenueSlot[]
  > = {
    restaurant: [],
    cafe: [],
    theater: [],
    hotel: [],
  };

  for (const cube of input.cubes) {
    if (cube.owner !== 'player') continue;
    const ownerId =
      typeof cube.privateOwnerId === 'number' && citizenById.has(cube.privateOwnerId)
        ? cube.privateOwnerId
        : null;
    const slots: Array<{ slot: SlotIndex; themeId: ThemeId | null }> = [
      { slot: 0, themeId: cube.themeId },
      { slot: 1, themeId: cube.secondThemeId },
    ];
    for (const s of slots) {
      if (!s.themeId) continue;
      if (!staffedSlots.has(makeSlotKey(cube.id, s.slot))) continue;
      if (s.themeId === 'shop' || s.themeId === 'grand_market') {
        hasStaffedFoodSeller = true;
      }
      if (
        s.themeId === 'restaurant' ||
        s.themeId === 'cafe' ||
        s.themeId === 'theater' ||
        s.themeId === 'hotel'
      ) {
        venuesByTheme[s.themeId].push({
          cubeId: cube.id,
          slot: s.slot,
          themeId: s.themeId,
          ownerId,
          remainingCap: LEISURE_VENUE_MONTHLY_CAP,
        });
      }
    }
  }

  for (const list of Object.values(venuesByTheme)) {
    list.sort((a, b) =>
      a.cubeId !== b.cubeId ? a.cubeId - b.cubeId : a.slot - b.slot
    );
  }

  const stats = createZeroLastMonthStats();
  let nextGold = Math.max(0, Math.floor(input.gold));
  let totalCitizenSpent = 0;
  let treasuryFoodGain = 0;
  let treasuryLeisureGain = 0;
  let privateOwnerGains = 0;
  let foodUnitsSold = 0;

  // =========================================================================
  // 2.2 FOOD SPENDING (essentials BEFORE luxuries)
  // =========================================================================
  const unitCost = computeFoodUnitCost(input.inflationIndex);
  const domesticAvailable =
    hasStaffedFoodSeller && getTotalFood(nextWarehouse) >= input.population;
  const usedImports = !domesticAvailable;

  // Group citizens by household deterministically
  const households = new Map<number, Citizen[]>();
  for (const c of nextCitizens) {
    const arr = households.get(c.householdId);
    if (arr) arr.push(c);
    else households.set(c.householdId, [c]);
  }
  const sortedHouseholds = Array.from(households.entries()).sort(
    (a, b) => a[0] - b[0]
  );

  for (const [, members] of sortedHouseholds) {
    const householdSize = members.length;
    if (householdSize <= 0) continue;

    const payers = getOrderedHouseholdPayers(members, currentMonth);
    const totalPayerWealth = payers.reduce((s, p) => s + p.wealth, 0);

    if (domesticAvailable) {
      const availWarehouseFood = getTotalFood(nextWarehouse);
      const maxAffordableUnits =
        unitCost > 0 ? Math.floor(totalPayerWealth / unitCost) : householdSize;
      const boughtUnits = Math.min(
        householdSize,
        availWarehouseFood,
        maxAffordableUnits
      );

      if (boughtUnits > 0) {
        const actuallyConsumed = consumeDomesticFoodUnits(nextWarehouse, boughtUnits);
        const due = actuallyConsumed * unitCost;
        const paid = deductSequentially(payers, due);
        nextGold += paid;
        treasuryFoodGain += paid;
        stats.foodRevenue += paid;
        totalCitizenSpent += paid;
        foodUnitsSold += actuallyConsumed;
        stats.unmetFood += Math.max(0, householdSize - actuallyConsumed);
      } else {
        stats.unmetFood += householdSize;
      }
    } else {
      // Imports: cost * 1.5 rounded; gold leaves kingdom (importSink); no warehouse/treasury change
      const fullHouseholdCost = Math.round(householdSize * unitCost * 1.5);
      if (totalPayerWealth >= fullHouseholdCost) {
        const paid = deductSequentially(payers, fullHouseholdCost);
        stats.importSink += paid;
        totalCitizenSpent += paid;
      } else {
        const importUnitCost = Math.max(1, Math.round(unitCost * 1.5));
        const boughtUnits = Math.min(
          householdSize,
          Math.floor(totalPayerWealth / importUnitCost)
        );
        if (boughtUnits > 0) {
          const paid = deductSequentially(payers, boughtUnits * importUnitCost);
          stats.importSink += paid;
          totalCitizenSpent += paid;
        }
        stats.unmetFood += Math.max(0, householdSize - boughtUnits);
      }
    }
  }

  // =========================================================================
  // 2.3 & 2.4 LEISURE SPENDING (aged 15+, max 1 spend/month, venue cap 20/month)
  // =========================================================================
  const pickAvailableVenue = (
    theme: 'restaurant' | 'cafe' | 'theater' | 'hotel'
  ): StaffedVenueSlot | null => {
    const list = venuesByTheme[theme];
    for (const v of list) {
      if (v.remainingCap > 0) return v;
    }
    return null;
  };

  const applyLeisureSpend = (
    citizen: Citizen,
    venue: StaffedVenueSlot,
    price: number
  ): boolean => {
    const spend = Math.min(citizen.wealth, price);
    if (spend < price || spend <= 0) return false;

    citizen.wealth = Math.max(0, citizen.wealth - spend);
    venue.remainingCap -= 1;
    totalCitizenSpent += spend;

    const ownerShare = Math.floor(spend * 0.7);
    const sinkShare = spend - ownerShare;
    stats.leisureSink += sinkShare;

    if (venue.ownerId !== null) {
      const owner = citizenById.get(venue.ownerId);
      if (owner) {
        owner.wealth += ownerShare;
        privateOwnerGains += ownerShare;
      } else {
        nextGold += ownerShare;
        treasuryLeisureGain += ownerShare;
        stats.leisureRevenue += ownerShare;
      }
    } else {
      nextGold += ownerShare;
      treasuryLeisureGain += ownerShare;
      stats.leisureRevenue += ownerShare;
    }
    return true;
  };

  const sortedCitizens = [...nextCitizens].sort((a, b) => a.id - b.id);
  for (const citizen of sortedCitizens) {
    if (ageYears(citizen, currentMonth) < 15) continue;

    // Element 2.4: intelligence >= 65 skips luxury (theater/hotel) while saving toward land
    const isSmartSaver =
      citizen.attrs.intelligence >= 65 && !privateOwnerSet.has(citizen.id);
    // Element 2.4: intelligence < 35 takes probabilistic leisure chances twice
    const leisureAttempts = citizen.attrs.intelligence < 35 ? 2 : 1;

    let spent = false;

    // 1. Dining: wealth >= 30 & social >= 40 -> restaurant (6), else cafe (4)
    if (citizen.wealth >= 30) {
      if (citizen.attrs.social >= 40) {
        const rest = pickAvailableVenue('restaurant');
        if (rest) {
          spent = applyLeisureSpend(citizen, rest, 6);
        } else {
          const cafe = pickAvailableVenue('cafe');
          if (cafe) {
            spent = applyLeisureSpend(citizen, cafe, 4);
          }
        }
      } else {
        const cafe = pickAvailableVenue('cafe');
        if (cafe) {
          spent = applyLeisureSpend(citizen, cafe, 4);
        }
      }
    }

    // 2. Theater: wealth >= 20 -> spend 3 (only if no dining happened and not smart-saver)
    if (!spent && !isSmartSaver && citizen.wealth >= 20) {
      const theater = pickAvailableVenue('theater');
      if (theater) {
        spent = applyLeisureSpend(citizen, theater, 3);
      }
    }

    // 3. Hotel stay: wealth >= 200 -> 5% monthly chance, spend 15 (not smart-saver; 2 rolls if intel < 35)
    if (!spent && !isSmartSaver && citizen.wealth >= 200) {
      const hotel = pickAvailableVenue('hotel');
      if (hotel) {
        for (let attempt = 0; attempt < leisureAttempts; attempt++) {
          if (rng() < 0.05) {
            spent = applyLeisureSpend(citizen, hotel, 15);
            if (spent) break;
          }
        }
      }
    }
  }

  // Aggregated ledger entries (royal revenue only; private owner shares are citizen-to-citizen)
  const ledgerItems: SpendingLedgerItem[] = [];
  if (treasuryFoodGain > 0) {
    ledgerItems.push({
      kind: 'shop',
      amount: treasuryFoodGain,
      labelAr: 'مبيعات غذاء للمواطنين',
    });
  }
  if (treasuryLeisureGain > 0) {
    ledgerItems.push({
      kind: 'shop',
      amount: treasuryLeisureGain,
      labelAr: 'إنفاق المواطنين: مطاعم وترفيه وفنادق',
    });
  }

  return {
    warehouse: nextWarehouse,
    gold: nextGold,
    citizens: nextCitizens,
    citizenWealth: sumCitizenWealth(nextCitizens),
    lastMonthStats: stats,
    lastSpentMonth: currentMonth,
    ledgerItems,
    totalCitizenSpent,
    treasuryFoodGain,
    treasuryLeisureGain,
    privateOwnerGains,
    foodUnitsSold,
    usedImports,
  };
}
