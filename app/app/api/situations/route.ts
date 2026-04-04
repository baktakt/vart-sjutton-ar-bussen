import { NextResponse } from 'next/server';
import { getToken } from '@/lib/vasttrafik/token';
import type { VTSituation } from '@/types/vasttrafik';

export const dynamic    = 'force-dynamic';
export const maxDuration = 15;

const TS_BASE = process.env.VASTTRAFIK_TS_BASE ?? 'https://ext-api.vasttrafik.se/ts/v1';

// Module-level cache — situations change rarely
let cached: { data: unknown; fetchedAt: number } | null = null;
const TTL_MS = 60_000;

export async function GET() {
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return NextResponse.json(cached.data);
  }

  try {
    const token = await getToken();
    const res = await fetch(`${TS_BASE}/traffic-situations`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (!res.ok) throw new Error(`Traffic situations: ${res.status}`);

    const raw: VTSituation[] = await res.json();

    const situations = raw.map(s => ({
      id:            s.situationNumber,
      severity:      s.severity ?? 'unknown',
      title:         s.title ?? '',
      description:   s.description ?? '',
      affectedLines: s.affectedLines.map(l => l.designation ?? l.name ?? l.gid),
      startTime:     s.startTime,
      endTime:       s.endTime ?? null,
    }));

    const data = { situations, fetchedAt: new Date().toISOString() };
    cached = { data, fetchedAt: Date.now() };
    return NextResponse.json(data);
  } catch (err) {
    console.error('[/api/situations]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
