'use client';

import type { EnrichedVehicle } from '@/types/vasttrafik';

export type FilterMode = 'all' | 'tram' | 'bus' | 'train' | 'metro' | 'boat';

export interface FilterState {
  mode: FilterMode;
  onlyLate: boolean;
}

export const DEFAULT_FILTER: FilterState = { mode: 'all', onlyLate: false };

const MODES: { key: FilterMode; label: string; types: string[] }[] = [
  { key: 'all',   label: 'Alla',        types: [] },
  { key: 'metro', label: 'Tunnelbana',  types: ['metro'] },
  { key: 'tram',  label: 'Spårvagn',   types: ['tram'] },
  { key: 'bus',   label: 'Buss',        types: ['bus'] },
  { key: 'train', label: 'Tåg',         types: ['train'] },
  { key: 'boat',  label: 'Båt',         types: ['ferry'] },
];

export function applyFilter(vehicles: EnrichedVehicle[], filter: FilterState): EnrichedVehicle[] {
  let result = vehicles;
  if (filter.mode !== 'all') {
    const types = MODES.find(m => m.key === filter.mode)?.types ?? [];
    result = result.filter(v => types.includes(v.transportMode));
  }
  if (filter.onlyLate) {
    result = result.filter(v => (v.delayMinutes ?? 0) > 1 && !v.isCancelled);
  }
  return result;
}

interface Props {
  vehicles: EnrichedVehicle[];   // all vehicles (unfiltered) — for counts
  filter: FilterState;
  onChange: (f: FilterState) => void;
}

export default function FilterBar({ vehicles, filter, onChange }: Props) {
  const counts = Object.fromEntries(
    MODES.map(m => [
      m.key,
      m.types.length === 0
        ? vehicles.length
        : vehicles.filter(v => m.types.includes(v.transportMode)).length,
    ])
  ) as Record<FilterMode, number>;

  const lateCount = vehicles.filter(v => (v.delayMinutes ?? 0) > 1 && !v.isCancelled).length;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {MODES.filter(m => m.key === 'all' || counts[m.key] > 0).map(m => (
        <button
          key={m.key}
          onClick={() => onChange({ ...filter, mode: m.key })}
          className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
            filter.mode === m.key
              ? 'bg-white text-slate-900'
              : 'bg-slate-700/60 text-slate-300 hover:bg-slate-600'
          }`}
        >
          {m.label}{' '}
          <span className={filter.mode === m.key ? 'opacity-50' : 'opacity-60'}>
            {counts[m.key]}
          </span>
        </button>
      ))}

      <div className="w-px h-4 bg-slate-600 mx-0.5" />

      <button
        onClick={() => onChange({ ...filter, onlyLate: !filter.onlyLate })}
        className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
          filter.onlyLate
            ? 'bg-red-500 text-white'
            : 'bg-slate-700/60 text-slate-300 hover:bg-slate-600'
        }`}
      >
        Bara sena{' '}
        <span className={filter.onlyLate ? 'opacity-70' : 'opacity-60'}>{lateCount}</span>
      </button>
    </div>
  );
}
