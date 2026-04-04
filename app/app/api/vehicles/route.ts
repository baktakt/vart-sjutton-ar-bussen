import { NextResponse } from 'next/server';
import { getEnrichedVehicles } from '@/lib/pipeline';

export const dynamic    = 'force-dynamic';
export const maxDuration = 30; // seconds

export async function GET() {
  try {
    const data = await getEnrichedVehicles();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[/api/vehicles]', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
