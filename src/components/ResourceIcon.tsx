import {
  Apple,
  BedDouble,
  Beef,
  CircleDot,
  Coffee,
  Coins,
  Croissant,
  Crown,
  Drama,
  Droplets,
  Fish,
  Flower2,
  Fuel,
  Gem,
  GraduationCap,
  Hammer,
  HeartPulse,
  Home,
  MoonStar,
  Mountain,
  Package,
  Pickaxe,
  Scale,
  Sparkles,
  Store,
  TreePine,
  UtensilsCrossed,
  Warehouse,
  Waves,
  Wheat,
  Wrench,
} from 'lucide-react';
import type { ThemeId, TradedResourceKey } from '../game/types';

interface ResourceIconProps {
  resource: TradedResourceKey | 'gold';
  className?: string;
}

export function ResourceIcon({
  resource,
  className = 'w-4 h-4',
}: ResourceIconProps) {
  switch (resource) {
    case 'gold':
      return <Coins className={className} />;
    case 'fish':
      return <Fish className={className} />;
    case 'crops':
      return <Wheat className={className} />;
    case 'wheat':
      return <Wheat className={className} />;
    case 'fruit':
      return <Apple className={className} />;
    case 'meat':
      return <Beef className={className} />;
    case 'bread':
      return <Croissant className={className} />;
    case 'wood':
      return <TreePine className={className} />;
    case 'water':
      return <Droplets className={className} />;
    case 'stone':
      return <Mountain className={className} />;
    case 'iron':
      return <Pickaxe className={className} />;
    case 'copper':
      return <CircleDot className={className} />;
    case 'goldOre':
      return <Coins className={className} />;
    case 'gem':
      return <Gem className={className} />;
    case 'tools':
      return <Wrench className={className} />;
    case 'jewelry':
      return <Sparkles className={className} />;
    case 'oil':
      return <Fuel className={className} />;
    default:
      return <Package className={className} />;
  }
}

interface ThemeIconProps {
  themeId: ThemeId;
  className?: string;
}

export function ThemeIcon({ themeId, className = 'w-5 h-5' }: ThemeIconProps) {
  switch (themeId) {
    case 'palace':
      return <Crown className={className} />;
    case 'wheat_farm':
      return <Wheat className={className} />;
    case 'farm':
      return <Wheat className={className} />;
    case 'orchard':
      return <Apple className={className} />;
    case 'pasture':
      return <Beef className={className} />;
    case 'sea':
      return <Waves className={className} />;
    case 'well':
      return <Droplets className={className} />;
    case 'bakery':
      return <Croissant className={className} />;
    case 'restaurant':
      return <UtensilsCrossed className={className} />;
    case 'cafe':
      return <Coffee className={className} />;
    case 'forest':
      return <TreePine className={className} />;
    case 'quarry':
      return <Mountain className={className} />;
    case 'iron_mine':
      return <Pickaxe className={className} />;
    case 'copper_mine':
      return <Pickaxe className={className} />;
    case 'gold_mine':
      return <Coins className={className} />;
    case 'gem_mine':
      return <Gem className={className} />;
    case 'oil_well':
      return <Fuel className={className} />;
    case 'house':
      return <Home className={className} />;
    case 'warehouse_bldg':
      return <Warehouse className={className} />;
    case 'workshop':
      return <Hammer className={className} />;
    case 'jeweler':
      return <Sparkles className={className} />;
    case 'shop':
      return <Store className={className} />;
    case 'grand_market':
      return <Store className={className} />;
    case 'trade_office':
      return <Scale className={className} />;
    case 'hotel':
      return <BedDouble className={className} />;
    case 'mosque':
      return <MoonStar className={className} />;
    case 'theater':
      return <Drama className={className} />;
    case 'garden':
      return <Flower2 className={className} />;
    case 'clinic':
      return <HeartPulse className={className} />;
    case 'school':
      return <GraduationCap className={className} />;
    default:
      return <Package className={className} />;
  }
}

export const THEME_ICON_REGISTERED: ReadonlySet<ThemeId> = new Set<ThemeId>([
  'palace',
  'wheat_farm',
  'farm',
  'orchard',
  'pasture',
  'sea',
  'well',
  'bakery',
  'restaurant',
  'cafe',
  'forest',
  'quarry',
  'iron_mine',
  'copper_mine',
  'gold_mine',
  'gem_mine',
  'oil_well',
  'house',
  'warehouse_bldg',
  'workshop',
  'jeweler',
  'shop',
  'grand_market',
  'trade_office',
  'hotel',
  'mosque',
  'theater',
  'garden',
  'clinic',
  'school',
]);
