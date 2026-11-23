import {
  Beef,
  Coins,
  Droplets,
  Fish,
  Home,
  Store,
  TreePine,
  Waves,
  Wheat,
} from 'lucide-react';
import type { ThemeId, TradedResourceKey } from '../game/types';

interface ResourceIconProps {
  resource: TradedResourceKey | 'gold';
  className?: string;
}

export function ResourceIcon({ resource, className = 'w-4 h-4' }: ResourceIconProps) {
  switch (resource) {
    case 'gold':
      return <Coins className={className} />;
    case 'fish':
      return <Fish className={className} />;
    case 'crops':
      return <Wheat className={className} />;
    case 'meat':
      return <Beef className={className} />;
    case 'wood':
      return <TreePine className={className} />;
    case 'water':
      return <Droplets className={className} />;
  }
}

interface ThemeIconProps {
  themeId: ThemeId;
  className?: string;
}

export function ThemeIcon({ themeId, className = 'w-5 h-5' }: ThemeIconProps) {
  switch (themeId) {
    case 'sea':
      return <Waves className={className} />;
    case 'well':
      return <Droplets className={className} />;
    case 'farm':
      return <Wheat className={className} />;
    case 'forest':
      return <TreePine className={className} />;
    case 'pasture':
      return <Beef className={className} />;
    case 'house':
      return <Home className={className} />;
    case 'shop':
      return <Store className={className} />;
  }
}
