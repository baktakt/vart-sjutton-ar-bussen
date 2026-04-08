/**
 * Fetches and caches GTFS-RT feeds for SL (Storstockholms Lokaltrafik).
 *
 * Requires env var: TRAFIKLAB_RT_KEY  (Trafiklab "GTFS Regional Realtime" product key)
 *
 * Both feeds are cached for CACHE_TTL_MS to avoid hammering the API on every request.
 */

import { transit_realtime } from 'gtfs-realtime-bindings';

const BASE = 'https://opendata.samtrafiken.se/gtfs-rt/sl';
const CACHE_TTL_MS = 15_000;

type Feed = transit_realtime.IFeedMessage;

interface Cached { data: Feed; fetchedAt: number; }

let vehicleCache: Cached | null = null;
let tripCache:    Cached | null = null;

function key(): string {
  const k = process.env.TRAFIKLAB_RT_KEY;
  if (!k) throw new Error('TRAFIKLAB_RT_KEY not configured');
  return k;
}

async function fetchFeed(url: string): Promise<Feed> {
  const res = await fetch(`${url}?key=${key()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GTFS-RT fetch failed (${res.status}): ${url}`);
  const buf = await res.arrayBuffer();
  return transit_realtime.FeedMessage.decode(new Uint8Array(buf));
}

export async function getVehicleFeed(): Promise<Feed> {
  if (vehicleCache && Date.now() - vehicleCache.fetchedAt < CACHE_TTL_MS) {
    return vehicleCache.data;
  }
  const data = await fetchFeed(`${BASE}/VehiclePositions.pb`);
  vehicleCache = { data, fetchedAt: Date.now() };
  return data;
}

export async function getTripUpdateFeed(): Promise<Feed> {
  if (tripCache && Date.now() - tripCache.fetchedAt < CACHE_TTL_MS) {
    return tripCache.data;
  }
  const data = await fetchFeed(`${BASE}/TripUpdates.pb`);
  tripCache = { data, fetchedAt: Date.now() };
  return data;
}
