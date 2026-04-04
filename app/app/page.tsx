'use client';

import dynamic from 'next/dynamic';

const TransitMap = dynamic(() => import('@/components/Map'), { ssr: false });

export default function Page() {
  return (
    <main className="w-screen h-screen bg-slate-950">
      <TransitMap />
    </main>
  );
}
