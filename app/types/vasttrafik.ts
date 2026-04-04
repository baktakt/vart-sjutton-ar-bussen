// Raw types from Västtrafik APR v4 /positions
export interface VTVehicle {
  detailsReference: string;
  line: {
    name: string;
    backgroundColor: string;
    foregroundColor: string;
    borderColor: string;
    transportMode: 'bus' | 'tram' | 'train' | 'ferry' | 'unknown';
    transportSubMode: string;
    isRealtimeJourney: boolean;
  };
  notes: unknown[];
  name: string;
  direction: string;
  directionDetails: {
    fullDirection: string;
    shortDirection: string;
    via?: string;
    isFrontEntry?: boolean;
  };
  latitude: number;
  longitude: number;
}

// Raw departure from /stop-areas/{gid}/departures
export interface VTDeparture {
  detailsReference: string;
  serviceJourney: {
    gid: string;
    direction: string;
    line: {
      gid: string;
      name: string;
      shortName: string;
      designation: string;
      backgroundColor: string;
      foregroundColor: string;
      transportMode: string;
      isRealtimeJourney: boolean;
    };
  };
  stopPoint: {
    gid: string;
    name: string;
    platform?: string;
    latitude: number;
    longitude: number;
  };
  plannedTime: string;
  estimatedTime?: string;
  estimatedOtherwisePlannedTime: string;
  isCancelled: boolean;
  isPartCancelled: boolean;
}

// Raw stop area from /locations/by-coordinates
export interface VTStopArea {
  gid: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceInMeters?: number;
}

// Enriched vehicle returned by /api/vehicles
export interface EnrichedVehicle {
  id: string;
  lat: number;
  lng: number;
  lineName: string;
  bgColor: string;
  fgColor: string;
  transportMode: string;
  direction: string;
  delayMinutes: number | null;
  isCancelled: boolean;
  nextStopName: string | null;
}

export interface VehiclesResponse {
  vehicles: EnrichedVehicle[];
  fetchedAt: string;
  errors: string[];
}

// Traffic situation from /ts/v1/traffic-situations
export interface VTSituation {
  situationNumber: string;
  severity?: string;
  title?: string;
  description?: string;
  startTime: string;
  endTime?: string;
  affectedLines: Array<{ designation?: string; name?: string; gid: string }>;
  affectedStopPoints: Array<{ gid: string; name?: string }>;
  affectedJourneys: Array<{ gid: string }>;
}
