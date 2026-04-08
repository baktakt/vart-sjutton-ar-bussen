import { NextRequest, NextResponse } from 'next/server';
import { getCity }             from '@/lib/providers';
import { getEnrichedVehicles } from '@/lib/pipeline';
import type { BBox }           from '@/lib/providers';

export const dynamic     = 'force-dynamic';
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ city: string }> },
) {
  const { city: cityId } = await params;
  const city = getCity(cityId);
  if (!city) {
    return NextResponse.json({ error: `Unknown city: ${cityId}` }, { status: 404 });
  }

  let bbox: BBox | undefined;
  const b = req.nextUrl.searchParams.get('bounds');
  if (b) {
    const [swLat, swLng, neLat, neLng] = b.split(',').map(Number);
    if ([swLat, swLng, neLat, neLng].every(n => !isNaN(n))) {
      bbox = { lowerLeftLat: swLat, lowerLeftLong: swLng, upperRightLat: neLat, upperRightLong: neLng };
    }
  }

  try {
    // Use city's default bounds when no viewport bbox is given
    const data = await getEnrichedVehicles(bbox ?? city.defaultBounds);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error(`[/api/${cityId}/vehicles]`, err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
