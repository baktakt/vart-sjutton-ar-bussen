'use client';

interface Props {
  cityName: string;
  onLocate: () => void;
  onDismiss: () => void;
}

function PinIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 13-8 13S4 16 4 10a8 8 0 1 1 16 0Z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  );
}

function MapIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
      <line x1="9" y1="3" x2="9" y2="18"/>
      <line x1="15" y1="6" x2="15" y2="21"/>
    </svg>
  );
}

export default function LocationModal({ cityName, onLocate, onDismiss }: Props) {
  return (
    <div
      className="absolute inset-0 z-[2000] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)' }}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-xs shadow-2xl">

        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-full bg-blue-600/15 border border-blue-500/30
                          flex items-center justify-center text-blue-400">
            <PinIcon />
          </div>
        </div>

        {/* Text */}
        <h2 className="text-white font-bold text-lg text-center leading-snug mb-1">
          Var är du just nu?
        </h2>
        <p className="text-slate-400 text-sm text-center mb-6">
          Visa trafiken nära dig, eller se hela {cityName}.
        </p>

        {/* Buttons */}
        <div className="flex flex-col gap-2.5">
          <button
            onClick={onLocate}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
                       bg-blue-600 hover:bg-blue-500 active:scale-[0.98]
                       text-white font-semibold text-sm transition-all"
          >
            <PinIcon />
            Hitta mig
          </button>

          <button
            onClick={onDismiss}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
                       bg-slate-800 hover:bg-slate-700 active:scale-[0.98]
                       text-slate-200 font-semibold text-sm transition-all border border-slate-600"
          >
            <MapIcon />
            Visa {cityName}
          </button>
        </div>
      </div>
    </div>
  );
}
