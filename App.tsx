import { useEffect, useRef, useState } from 'react';
import { Sim } from './sim/engine';
import type { Telemetry } from './sim/types';
import Controls from './ui/Controls';
import Hud from './ui/Hud';

const INITIAL: Telemetry = {
  speed: 0, rpm: 0, gear: 'P', engineOn: false, handbrake: true, score: 100,
  lessonIndex: 0, lessonTitle: 'Lesson 1 — Starting the car',
  lessonStep: 'Press and hold the BRAKE pedal, then press START to fire up the engine.',
  lessonHint: 'An automatic will only start with the brake pressed and the selector in P.',
  lessonProgress: 0, lessons: 13, speedLimit: 30, laneStatus: 'ok',
  distanceToTarget: 0, targetBearing: 0, hasTarget: false, infractions: [],
  toast: null, toastKind: 'info', lightAhead: null, lightDistance: 0,
  indicatorLeft: false, indicatorRight: false, hazards: false, headlights: 0,
  wipers: false,
  completed: false, finalReport: null, odometer: 0, timeOfDay: 'day', weather: 'clear',
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Sim | null>(null);
  const [sim, setSim] = useState<Sim | null>(null);
  const [t, setT] = useState<Telemetry>(INITIAL);
  const [started, setStarted] = useState(false);
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || simRef.current) return;
    const s = new Sim(canvasRef.current, { onTelemetry: (tel) => setT({ ...tel }) });
    simRef.current = s;
    setSim(s);
    const onOrient = () => setPortrait(window.innerHeight > window.innerWidth * 1.15);
    onOrient();
    window.addEventListener('resize', onOrient);
    return () => {
      window.removeEventListener('resize', onOrient);
      s.dispose();
      simRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (started) sim?.setPaused(portrait);
  }, [portrait, sim, started]);

  const begin = async () => {
    setStarted(true);
    sim?.sound.init();
    sim?.sound.resume();
    // Browsers only permit fullscreen/orientation requests from a user gesture.
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (value: 'landscape') => Promise<void>;
      };
      await orientation.lock?.('landscape');
    } catch {
      // iOS does not expose orientation lock; the landscape overlay remains as fallback.
    }
  };

  return (
    <div className="fixed inset-0 h-[100dvh] w-screen touch-none overflow-hidden bg-black text-white antialiased select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* subtle windshield / cabin vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: 'inset 0 0 130px 28px rgba(0,0,0,0.36)' }}
      />

      {started && (
        <div
          className="absolute"
          style={{
            left: 'env(safe-area-inset-left, 0px)',
            right: 'env(safe-area-inset-right, 0px)',
            top: 'env(safe-area-inset-top, 0px)',
            bottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          <Controls sim={sim} t={t} />
          <Hud t={t} sim={sim} />
        </div>
      )}

      {/* ---------- title screen ---------- */}
      {!started && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-zinc-950 via-zinc-950/95 to-black p-4">
          <div className="w-full max-w-md">
            <div className="text-[10px] font-bold tracking-[0.35em] text-sky-400">DRIVING SCHOOL SIMULATOR</div>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-tight">
              Auto<span className="text-sky-400">Drive</span>
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-white/55">
              Realistic first-person automatic transmission driving. Learn proper techniques through 13 guided lessons.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-1.5 text-[10px] text-white/65">
              {[
                ['W', 'Turn the physical wheel'],
                ['P', 'Progressive pedals'],
                ['G', 'P R N D gears'],
                ['M', 'Three live mirrors'],
                ['S', 'Signals and signs'],
                ['T', 'Independent traffic'],
              ].map(([i, txt]) => (
                <div key={txt} className="flex items-center gap-1.5 rounded-lg border border-white/6 bg-white/4 px-2 py-1.5">
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-white/8 text-[8px] font-bold text-sky-300">{i}</span>
                  <span className="leading-tight">{txt}</span>
                </div>
              ))}
            </div>

            <button
              onClick={begin}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-sky-500 to-emerald-500 px-5 py-3 text-sm font-bold text-white shadow-lg active:scale-[0.98]"
            >
              START DRIVING →
            </button>
            <p className="mt-2 text-center text-[9px] text-white/30">
              Rotate to landscape · Turn on sound
            </p>
          </div>
        </div>
      )}

      {/* ---------- rotate hint ---------- */}
      {started && portrait && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="rounded-2xl border border-white/15 bg-zinc-900/90 px-6 py-4 text-center shadow-2xl">
            <div className="text-4xl">↻</div>
            <div className="mt-2 text-sm font-semibold text-white/85">Rotate to Landscape</div>
            <div className="mt-1 text-xs text-white/50">Turn your phone sideways for the best driving experience</div>
          </div>
        </div>
      )}
    </div>
  );
}
