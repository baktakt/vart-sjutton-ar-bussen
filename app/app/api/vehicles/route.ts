import { NextRequest, NextResponse } from 'next/server';
import { getEnrichedVehicles } from '@/lib/pipeline';
import type { BBox } from '@/lib/vasttrafik/positions';

export const dynamic    = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  // Optional viewport bbox from the client: ?bounds=swLat,swLng,neLat,neLng
  let bbox: BBox | undefined;
  const b = req.nextUrl.searchParams.get('bounds');
  if (b) {
    const [swLat, swLng, neLat, neLng] = b.split(',').map(Number);
    if ([swLat, swLng, neLat, neLng].every(n => !isNaN(n))) {
      bbox = {
        lowerLeftLat:   swLat,
        lowerLeftLong:  swLng,
        upperRightLat:  neLat,
        upperRightLong: neLng,
      };
    }
  }

  try {
    const data = await getEnrichedVehicles(bbox);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[/api/vehicles]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
