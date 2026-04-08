/**
 * Shared normalized types used across all city providers.
 * Components and API routes use these — never the raw provider-specific types.
 */

export interface NormalizedDeparture {
  tripId: string;
  line: {
    name: string;
    bgColor: string;
    fgColor: string;
    transportMode: string;
  };
  direction: string;
  platform?: string;
  plannedTime: string;                    // ISO 8601
  estimatedTime?: string;                 // ISO 8601, present when delayed
  estimatedOtherwisePlannedTime: string;  // ISO 8601, always present
  isCancelled: boolean;
}

export interface DeparturesResponse {
  departures: NormalizedDeparture[];
  fetchedAt: string;
}
