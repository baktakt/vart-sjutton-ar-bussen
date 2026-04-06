'use client';

import dynamic from 'next/dynamic';
import { Component, type ReactNode } from 'react';

const TransitMap = dynamic(() => import('@/components/Map'), { ssr: false });

// Catches JS errors inside the map so the whole page doesn't blank out.
// User gets a tap-to-reload button instead of "This page couldn't load".
class MapErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(err: Error) { console.error('[MapErrorBoundary]', err); }
  render() {
    if (this.state.crashed) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-slate-950 text-white">
          <p className="text-slate-400 text-sm">Något gick fel med kartan.</p>
          <button
            onClick={() => this.setState({ crashed: false })}
            className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-sm font-semibold"
          >
            Försök igen
          </button>
        </div>
      );
    }
    return this.state.crashed ? null : this.props.children;
  }
}

export default function Page() {
  return (
    <main className="w-screen h-screen bg-slate-950">
      <MapErrorBoundary>
        <TransitMap />
      </MapErrorBoundary>
    </main>
  );
}
