import goteborg  from './goteborg';
import stockholm from './stockholm';
import type { CityConfig } from './types';

export type { CityConfig };
export type { BBox } from './types';

const CITIES: Record<string, CityConfig> = {
  goteborg,
  stockholm,
};

export function getCity(id: string): CityConfig | null {
  return CITIES[id] ?? null;
}

export function allCities(): CityConfig[] {
  return Object.values(CITIES);
}
