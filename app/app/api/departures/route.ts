import { NextRequest, NextResponse } from 'next/server';
import { getToken }        from '@/lib/vasttrafik/token';
import { fetchDepartures } from '@/lib/vasttrafik/departures';

export const dynamic    = 'force-dynamic';
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const gid = req.nextUrl.searchParams.get('gid');
  if (!gid) {
    return NextResponse.json({ error: 'gid is required' }, { status: 400 });
  }

  try {
    const token      = await getToken();
    const departures = await fetchDepartures(token, gid, 20);

    // Sort by actual departure time
    departures.sort(
      (a, b) =>
        new Date(a.estimatedOtherwisePlannedTime).getTime() -
        new Date(b.estimatedOtherwisePlannedTime).getTime(),
    );

    return NextResponse.json({ departures, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
