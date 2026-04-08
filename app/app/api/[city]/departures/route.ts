import { NextRequest, NextResponse } from 'next/server';
import { getCity }         from '@/lib/providers';
import { getToken }        from '@/lib/vasttrafik/token';
import { fetchDepartures } from '@/lib/vasttrafik/departures';
import { getSlDepartures } from '@/lib/sl/departures';
import type { NormalizedDeparture } from '@/types/transit';
import type { VTDeparture }         from '@/types/vasttrafik';

export const dynamic     = 'force-dynamic';
export const maxDuration = 15;

function normalizeVT(dep: VTDeparture): NormalizedDeparture {
  return {
    tripId:    dep.detailsReference,
    line: {
      name:          dep.serviceJourney.line.shortName || dep.serviceJourney.line.name,
      bgColor:       dep.serviceJourney.line.backgroundColor || '#374151',
      fgColor:       dep.serviceJourney.line.foregroundColor  || '#ffffff',
      transportMode: dep.serviceJourney.line.transportMode    || 'bus',
    },
    direction:                     dep.serviceJourney.direction,
    platform:                      dep.stopPoint?.platform,
    plannedTime:                   dep.plannedTime,
    estimatedTime:                 dep.estimatedTime,
    estimatedOtherwisePlannedTime: dep.estimatedOtherwisePlannedTime,
    isCancelled:                   dep.isCancelled,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ city: string }> },
) {
  const { city: cityId } = await params;
  const city = getCity(cityId);
  if (!city) {
    return NextResponse.json({ error: `Unknown city: ${cityId}` }, { status: 404 });
  }

  const gid = req.nextUrl.searchParams.get('gid');
  if (!gid) {
    return NextResponse.json({ error: 'gid is required' }, { status: 400 });
  }

  try {
    let departures: NormalizedDeparture[];

    if (cityId === 'stockholm') {
      departures = await getSlDepartures(gid);
    } else {
      // Göteborg via Västtrafik APR v4
      const token  = await getToken();
      const raw    = await fetchDepartures(token, gid, 20);
      raw.sort(
        (a, b) =>
          new Date(a.estimatedOtherwisePlannedTime).getTime() -
          new Date(b.estimatedOtherwisePlannedTime).getTime(),
      );
      departures = raw.map(normalizeVT);
    }

    return NextResponse.json({ departures, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
