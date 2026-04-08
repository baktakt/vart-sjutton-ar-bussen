import goteborg from './goteborg';
import type { CityConfig } from './types';

export type { CityConfig };
export type { BBox } from './types';

const CITIES: Record<string, CityConfig> = {
  goteborg,
  // stockholm: stockholm,  ← add here when ready
};

export function getCity(id: string): CityConfig | null {
  return CITIES[id] ?? null;
}

export function allCities(): CityConfig[] {
  return Object.values(CITIES);
}
