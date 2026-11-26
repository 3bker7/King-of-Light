import { ageYears, sumCitizenWealth } from './citizens';
import {
  formatTransferLabelAr,
  transferGold,
  type CitizenGoldShare,
  type GoldStateSlice,
} from './goldLedger';
import { getTotalFood } from './people';
import { computeStaffing, makeSlotKey } from './production';
import type {
  Citizen,
  Cube,
  FoodResourceKey,
  LastMonthStats,
  LedgerKind,
  PalaceOfPeople,
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
    taxWithheld: 0,
    grantsPaid: 0,
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
  palaceOfPeople?: PalaceOfPeople;
  staffedSlots?: Set<string>;
  rng?: () => number;
}

export interface CitizenSpendingResult {
  warehouse: Warehouse;
  gold: number;
  citizens: Citizen[];
  citizenWealth: number;
  palaceOfPeople: PalaceOfPeople;
  lastMonthStats: LastMonthStats;
  lastSpentMonth: number;
  ledgerItems: SpendingLedgerItem[];
  totalCitizenSpent: number;
  treasuryFoodGain: number;
  treasuryLeisureGain: number;
  privateOwnerGains: number;
  foodUnitsSold: number;
  usedImports: boolean;
  importedFoodUnits?: number;
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

function buildSequentialShares(
  payers: Citizen[],
  amount: number
): { shares: CitizenGoldShare[]; total: number } {
  let remaining = Math.max(0, Math.floor(amount));
  let total = 0;
  const shares: CitizenGoldShare[] = [];
  for (const p of payers) {
    if (remaining <= 0) break;
    const take = Math.min(Math.max(0, Math.floor(p.wealth)), remaining);
    if (take > 0) {
      shares.push({ citizenId: p.id, amount: take });
      total += take;
      remaining -= take;
    }
  }
  return { shares, total };
}

// Element 2: Monthly citizen spending engine (runs AFTER payroll inside monthlyProcessor).
// Strict conservation: totalCitizenSpent === treasuryGains + importSink + leisureSink + privateOwnerGains.
export function runCitizenSpending(
  input: CitizenSpendingInput
): CitizenSpendingResult {
  const rng = input.rng ?? Math.random;
  const currentMonth = Math.max(0, Math.trunc(input.totalMonths));

  const currentPalaceGold = Math.max(0, Math.floor(input.palaceOfPeople?.gold ?? 0));

  // Hardening 2: Idempotent per month — never double-charge the same month
  if (input.lastSpentMonth >= currentMonth) {
    return {
      warehouse: input.warehouse,
      gold: input.gold,
      citizens: input.citizens,
      citizenWealth: sumCitizenWealth(input.citizens),
      palaceOfPeople: { gold: currentPalaceGold },
      lastMonthStats: createZeroLastMonthStats(),
      lastSpentMonth: input.lastSpentMonth,
      ledgerItems: [],
      totalCitizenSpent: 0,
      treasuryFoodGain: 0,
      treasuryLeisureGain: 0,
      privateOwnerGains: 0,
      foodUnitsSold: 0,
      usedImports: false,
      importedFoodUnits: 0,
    };
  }

  const nextWarehouse: Warehouse = { ...input.warehouse };
  const initialCitizens: Citizen[] = input.citizens.map((c) => ({
    ...c,
    wealth: Math.max(0, Math.floor(c.wealth)),
    attrs: { ...c.attrs },
    parentIds: c.parentIds ? ([c.parentIds[0], c.parentIds[1]] as [number, number]) : null,
  }));

  let goldSlice: GoldStateSlice = {
    gold: Math.max(0, Math.floor(input.gold)),
    citizens: initialCitizens,
    citizenWealth: sumCitizenWealth(initialCitizens),
    palaceOfPeople: { gold: currentPalaceGold },
    peoplesBank: {
      gold: 0,
      portfolio: {},
      totalTrades: 0,
      lastTradeMonth: null,
      lastTradeAr: null,
    },
    ledger: [],
    day: 0,
  };

  const getCitizens = (): Citizen[] => goldSlice.citizens ?? [];
  const citizenIdSet = new Set<number>(initialCitizens.map((c) => c.id));
  const citizenById = {
    has: (id: number) => citizenIdSet.has(id),
  };

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
  let totalCitizenSpent = 0;
  let treasuryFoodGain = 0;
  let treasuryLeisureGain = 0;
  let privateOwnerGains = 0;
  let foodUnitsSold = 0;
  let importedFoodUnits = 0;

  // =========================================================================
  // 2.2 FOOD SPENDING (essentials BEFORE luxuries)
  // =========================================================================
  const unitCost = computeFoodUnitCost(input.inflationIndex);
  const domesticAvailable =
    hasStaffedFoodSeller && getTotalFood(nextWarehouse) >= input.population;
  const usedImports = !domesticAvailable;

  // Group citizen ids by household deterministically
  const householdIdsMap = new Map<number, number[]>();
  for (const c of getCitizens()) {
    const arr = householdIdsMap.get(c.householdId);
    if (arr) arr.push(c.id);
    else householdIdsMap.set(c.householdId, [c.id]);
  }
  const sortedHouseholds = Array.from(householdIdsMap.entries()).sort(
    (a, b) => a[0] - b[0]
  );

  for (const [, memberIds] of sortedHouseholds) {
    const memberSet = new Set(memberIds);
    const members = getCitizens().filter((c) => memberSet.has(c.id));
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
        const { shares, total } = buildSequentialShares(payers, due);
        let paid = 0;
        if (total > 0 && shares.length > 0) {
          const tx = transferGold(goldSlice, {
            from: 'citizens',
            to: 'treasury',
            amount: total,
            citizenShares: shares,
            kind: 'shop',
            labelAr: 'مبيعات غذاء للمواطنين',
          });
          if (tx.ok) {
            goldSlice = tx.state;
            paid = tx.moved;
          }
        }
        treasuryFoodGain += paid;
        stats.foodRevenue += paid;
        totalCitizenSpent += paid;
        foodUnitsSold += actuallyConsumed;
        stats.unmetFood += Math.max(0, householdSize - actuallyConsumed);
      } else {
        stats.unmetFood += householdSize;
      }
    } else {
      // Imports: cost * 1.5 rounded; routed from citizens -> palace via transferGold
      const fullHouseholdCost = Math.round(householdSize * unitCost * 1.5);
      if (totalPayerWealth >= fullHouseholdCost) {
        const { shares, total } = buildSequentialShares(payers, fullHouseholdCost);
        let paid = 0;
        if (total > 0 && shares.length > 0) {
          const tx = transferGold(goldSlice, {
            from: 'citizens',
            to: 'palace',
            amount: total,
            citizenShares: shares,
            kind: 'shop',
            labelAr: 'استيراد غذاء للمواطنين',
          });
          if (tx.ok) {
            goldSlice = tx.state;
            paid = tx.moved;
          }
        }
        stats.importSink += paid;
        totalCitizenSpent += paid;
        importedFoodUnits += householdSize;
      } else {
        const importUnitCost = Math.max(1, Math.round(unitCost * 1.5));
        const boughtUnits = Math.min(
          householdSize,
          Math.floor(totalPayerWealth / importUnitCost)
        );
        if (boughtUnits > 0) {
          const { shares, total } = buildSequentialShares(
            payers,
            boughtUnits * importUnitCost
          );
          let paid = 0;
          if (total > 0 && shares.length > 0) {
            const tx = transferGold(goldSlice, {
              from: 'citizens',
              to: 'palace',
              amount: total,
              citizenShares: shares,
              kind: 'shop',
              labelAr: 'استيراد غذاء للمواطنين',
            });
            if (tx.ok) {
              goldSlice = tx.state;
              paid = tx.moved;
            }
          }
          stats.importSink += paid;
          totalCitizenSpent += paid;
          importedFoodUnits += boughtUnits;
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
    citizenId: number,
    venue: StaffedVenueSlot,
    price: number
  ): boolean => {
    const citizen = getCitizens().find((c) => c.id === citizenId);
    if (!citizen) return false;
    const spend = Math.min(citizen.wealth, price);
    if (spend < price || spend <= 0) return false;

    const ownerShare = Math.floor(spend * 0.7);
    const sinkShare = spend - ownerShare;
    const ownerExists =
      venue.ownerId !== null && getCitizens().some((c) => c.id === venue.ownerId);

    // 1. Transfer 30% leisure sink: citizens -> palace via transferGold
    let nextSlice = goldSlice;
    if (sinkShare > 0) {
      const txSink = transferGold(nextSlice, {
        from: 'citizens',
        to: 'palace',
        citizenId,
        amount: sinkShare,
        kind: 'shop',
        labelAr: 'رسوم إنفاق ترفيهي',
        exact: true,
      });
      if (!txSink.ok) return false;
      nextSlice = txSink.state;
    }

    // 2. Transfer 70% venue revenue: intra-citizens (private owner) or citizens -> treasury (royal)
    if (ownerShare > 0) {
      if (ownerExists && venue.ownerId !== null) {
        if (venue.ownerId !== citizenId) {
          // Intra-account transfer within 'citizens' (total citizenWealth unchanged)
          nextSlice = {
            ...nextSlice,
            citizens: (nextSlice.citizens ?? []).map((c) => {
              if (c.id === citizenId) return { ...c, wealth: Math.max(0, c.wealth - ownerShare) };
              if (c.id === venue.ownerId) return { ...c, wealth: c.wealth + ownerShare };
              return c;
            }),
          };
        }
        privateOwnerGains += ownerShare;
      } else {
        const txRev = transferGold(nextSlice, {
          from: 'citizens',
          to: 'treasury',
          citizenId,
          amount: ownerShare,
          kind: 'shop',
          labelAr: 'إنفاق المواطنين: مطاعم وترفيه وفنادق',
          exact: true,
        });
        if (!txRev.ok) return false;
        nextSlice = txRev.state;
        treasuryLeisureGain += ownerShare;
        stats.leisureRevenue += ownerShare;
      }
    }

    goldSlice = nextSlice;
    venue.remainingCap -= 1;
    totalCitizenSpent += spend;
    stats.leisureSink += sinkShare;
    return true;
  };

  const sortedCitizenIds = getCitizens()
    .map((c) => c.id)
    .sort((a, b) => a - b);

  for (const cid of sortedCitizenIds) {
    const citizen = getCitizens().find((c) => c.id === cid);
    if (!citizen) continue;
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
          spent = applyLeisureSpend(citizen.id, rest, 6);
        } else {
          const cafe = pickAvailableVenue('cafe');
          if (cafe) {
            spent = applyLeisureSpend(citizen.id, cafe, 4);
          }
        }
      } else {
        const cafe = pickAvailableVenue('cafe');
        if (cafe) {
          spent = applyLeisureSpend(citizen.id, cafe, 4);
        }
      }
    }

    // 2. Theater: wealth >= 20 -> spend 3 (only if no dining happened and not smart-saver)
    if (!spent && !isSmartSaver && citizen.wealth >= 20) {
      const theater = pickAvailableVenue('theater');
      if (theater) {
        spent = applyLeisureSpend(citizen.id, theater, 3);
      }
    }

    // 3. Hotel stay: wealth >= 200 -> 5% monthly chance, spend 15 (not smart-saver; 2 rolls if intel < 35)
    if (!spent && !isSmartSaver && citizen.wealth >= 200) {
      const hotel = pickAvailableVenue('hotel');
      if (hotel) {
        for (let attempt = 0; attempt < leisureAttempts; attempt++) {
          if (rng() < 0.05) {
            spent = applyLeisureSpend(citizen.id, hotel, 15);
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
      labelAr: formatTransferLabelAr('citizens', 'treasury', 'مبيعات غذاء للمواطنين'),
    });
  }
  if (treasuryLeisureGain > 0) {
    ledgerItems.push({
      kind: 'shop',
      amount: treasuryLeisureGain,
      labelAr: formatTransferLabelAr(
        'citizens',
        'treasury',
        'إنفاق المواطنين: مطاعم وترفيه وفنادق'
      ),
    });
  }

  return {
    warehouse: nextWarehouse,
    gold: goldSlice.gold,
    citizens: getCitizens(),
    citizenWealth: goldSlice.citizenWealth,
    palaceOfPeople: goldSlice.palaceOfPeople,
    lastMonthStats: stats,
    lastSpentMonth: currentMonth,
    ledgerItems,
    totalCitizenSpent,
    treasuryFoodGain,
    treasuryLeisureGain,
    privateOwnerGains,
    foodUnitsSold,
    usedImports,
    importedFoodUnits,
  };
}

/**
 * Element M1.4:
 * Pure settlement helper when online citizens purchase imported food from the Global Market.
 * Moves `buyerPays` (capped to the local palace's collected import gold) from the local Palace sink
 * to the remote Global Market sale (seller claim + World Palace); unmet remainder stays in local Palace.
 * Never called in local mode.
 */
export function settleOnlineCitizenImport(
  palaceOfPeople: PalaceOfPeople,
  buyerPays: number
): PalaceOfPeople {
  const safePaid = Math.max(0, Math.floor(buyerPays));
  return {
    ...palaceOfPeople,
    gold: Math.max(0, Math.floor(palaceOfPeople.gold) - safePaid),
  };
}
