import { useEffect, useRef } from 'react';
import type { Sim } from '../sim/engine';
import type { Gear, Telemetry } from '../sim/types';

interface Props {
  sim: Sim | null;
  t: Telemetry;
}

// One complete turn in either direction. The road wheels use the normalized
// value while the cockpit wheel follows this angle exactly.
const MAX_WHEEL = 360;
const THREE_DEG = Math.PI / 180;

export default function Controls({ sim, t }: Props) {
  const gasRef = useRef<HTMLDivElement>(null);
  const brakeRef = useRef<HTMLDivElement>(null);
  const st = useRef({
    wheel: 0, dragging: false, pointerId: -1, lastAng: 0,
    gas: 0, brake: 0, gasDown: false, brakeDown: false,
    keyL: false, keyR: false,
    looking: false, lookId: -1, lx: 0, ly: 0, tlx: 0, tly: 0, sx: 0, sy: 0,
    last: performance.now(),
  });

  // ---- main input loop ----------------------------------------------------
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = st.current;
      const now = performance.now();
      const dt = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;
      if (!sim) return;
      const c = sim.controls;

      // pedals (progressive)
      s.gas += (s.gasDown ? 1.55 : -5.5) * dt;
      s.brake += (s.brakeDown ? 2.6 : -7) * dt;
      s.gas = Math.max(0, Math.min(1, s.gas));
      s.brake = Math.max(0, Math.min(1, s.brake));
      c.throttle = s.gas;
      c.brake = s.brake;

      // steering
      if (s.keyL || s.keyR) {
        s.wheel += ((s.keyR ? 1 : 0) - (s.keyL ? 1 : 0)) * 300 * dt;
        s.wheel = Math.max(-MAX_WHEEL, Math.min(MAX_WHEEL, s.wheel));
      } else if (!s.dragging) {
        const speed = sim.car.kmh;
        const k = Math.min(1, dt * (1.45 + speed * 0.1));
        s.wheel += -s.wheel * k;
        if (Math.abs(s.wheel) < 0.4) s.wheel = 0;
      }
      c.steer = Math.max(-1, Math.min(1, s.wheel / MAX_WHEEL));
      sim.steeringWheelAngle = -THREE_DEG * s.wheel;

      // look
      s.lx += (s.tlx - s.lx) * Math.min(1, dt * 9);
      s.ly += (s.tly - s.ly) * Math.min(1, dt * 9);
      c.lookX = s.lx;
      c.lookY = s.ly;

      if (gasRef.current) gasRef.current.style.height = `${(s.gas * 100).toFixed(0)}%`;
      if (brakeRef.current) brakeRef.current.style.height = `${(s.brake * 100).toFixed(0)}%`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sim]);

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const s = st.current;
      if (!sim) return;
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': s.keyL = true; break;
        case 'ArrowRight': case 'KeyD': s.keyR = true; break;
        case 'ArrowUp': case 'KeyW': s.gasDown = true; break;
        case 'ArrowDown': case 'KeyS': case 'Space': s.brakeDown = true; e.preventDefault(); break;
        case 'KeyP': sim.requestGear('P'); break;
        case 'KeyR': sim.requestGear('R'); break;
        case 'KeyN': sim.requestGear('N'); break;
        case 'KeyG': sim.requestGear('D'); break;
        case 'KeyH': sim.toggleHandbrake(); break;
        case 'KeyE': sim.startEngine(); break;
        case 'KeyL': sim.cycleHeadlights(); break;
        case 'KeyQ': sim.indicate('left'); break;
        case 'KeyX': sim.indicate('right'); break;
        case 'KeyB': sim.setHorn(true); break;
      }
    };
    const up = (e: KeyboardEvent) => {
      const s = st.current;
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': s.keyL = false; break;
        case 'ArrowRight': case 'KeyD': s.keyR = false; break;
        case 'ArrowUp': case 'KeyW': s.gasDown = false; break;
        case 'ArrowDown': case 'KeyS': case 'Space': s.brakeDown = false; break;
        case 'KeyB': sim?.setHorn(false); break;
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [sim]);

  // ---- steering wheel pointer ---------------------------------------------
  const wheelDown = (e: React.PointerEvent) => {
    const s = st.current;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    s.dragging = true;
    s.pointerId = e.pointerId;
    s.lastAng = Math.atan2(e.clientY - cy, e.clientX - cx);
    sim?.sound.init();
  };
  const wheelMove = (e: React.PointerEvent) => {
    const s = st.current;
    if (!s.dragging || e.pointerId !== s.pointerId) return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const a = Math.atan2(e.clientY - cy, e.clientX - cx);
    let d = (a - s.lastAng) * (180 / Math.PI);
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    s.wheel = Math.max(-MAX_WHEEL, Math.min(MAX_WHEEL, s.wheel + d));
    s.lastAng = a;
  };
  const wheelUp = (e: React.PointerEvent) => {
    const s = st.current;
    if (e.pointerId === s.pointerId) { s.dragging = false; s.pointerId = -1; }
  };

  // ---- look pad -------------------------------------------------------------
  const lookDown = (e: React.PointerEvent) => {
    const s = st.current;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    s.looking = true; s.lookId = e.pointerId; s.sx = e.clientX; s.sy = e.clientY;
    sim?.sound.init();
  };
  const lookMove = (e: React.PointerEvent) => {
    const s = st.current;
    if (!s.looking || e.pointerId !== s.lookId) return;
    s.tlx = Math.max(-1, Math.min(1, (e.clientX - s.sx) / (window.innerWidth * 0.28)));
    s.tly = Math.max(-1, Math.min(1, (e.clientY - s.sy) / (window.innerHeight * 0.5)));
  };
  const lookUp = () => { const s = st.current; s.looking = false; s.tlx = 0; s.tly = 0; };

  const press = (setter: (v: boolean) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setter(true); sim?.sound.init();
    },
    onPointerUp: () => setter(false),
    onPointerCancel: () => setter(false),
    onPointerLeave: (e: React.PointerEvent) => { if ((e.buttons & 1) === 0) setter(false); },
  });

  const gears: Gear[] = ['P', 'R', 'N', 'D'];

  return (
    <>
      {/* look-around pad - subtle, covers upper area for looking around */}
      <div
        className="absolute inset-x-0 top-0 bottom-[48%] touch-none opacity-0"
        onPointerDown={lookDown}
        onPointerMove={lookMove}
        onPointerUp={lookUp}
        onPointerCancel={lookUp}
      />

      {/* The transparent touch ring sits over the rendered cockpit wheel. */}
      <div
        aria-label="Steering wheel"
        className="absolute bottom-[1vh] left-1/2 h-[44vh] w-[44vh] max-h-[270px] max-w-[270px] min-h-[150px] min-w-[150px] -translate-x-1/2 rounded-full touch-none"
        onPointerDown={wheelDown}
        onPointerMove={wheelMove}
        onPointerUp={wheelUp}
        onPointerCancel={wheelUp}
      >
        <button
          aria-label="Horn"
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            sim?.sound.init();
            sim?.setHorn(true);
          }}
          onPointerUp={(e) => { e.stopPropagation(); sim?.setHorn(false); }}
          onPointerCancel={() => sim?.setHorn(false)}
          className="absolute left-1/2 top-1/2 h-[28%] w-[28%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-transparent bg-transparent text-[8px] font-semibold tracking-[0.2em] text-white/20 active:border-white/10 active:bg-white/5 active:text-white/45"
        >HORN</button>
      </div>

      {/* Secondary switches stay under the left thumb and clear of the road. */}
      <div className="absolute bottom-[2vh] left-[8vw] flex gap-1.5 select-none">
        <button
          aria-label="Left indicator"
          onPointerDown={() => sim?.indicate('left')}
          className={`h-10 w-12 rounded-lg border text-base font-bold backdrop-blur-sm transition active:scale-95 ${
            t.indicatorLeft ? 'border-emerald-300/55 bg-emerald-400/20 text-emerald-200' : 'border-white/10 bg-black/35 text-white/45'
          }`}
        >&#9664;</button>
        <button
          aria-label="Right indicator"
          onPointerDown={() => sim?.indicate('right')}
          className={`h-10 w-12 rounded-lg border text-base font-bold backdrop-blur-sm transition active:scale-95 ${
            t.indicatorRight ? 'border-emerald-300/55 bg-emerald-400/20 text-emerald-200' : 'border-white/10 bg-black/35 text-white/45'
          }`}
        >&#9654;</button>
      </div>

      {/* ---------- pedals (lower right, angled naturally) ---------- */}
      <div className="absolute right-[4vw] bottom-[1vh] flex items-end gap-[1.5vw] touch-none select-none">
        <div
          {...press((v) => { st.current.brakeDown = v; })}
          className="relative h-[24vh] max-h-[170px] min-h-[110px] w-[14vw] max-w-[76px] min-w-[56px] overflow-hidden rounded-2xl border border-white/12 bg-gradient-to-b from-zinc-800/75 to-zinc-950/85 shadow-[0_6px_20px_rgba(0,0,0,0.5)] backdrop-blur-sm"
        >
          <div ref={brakeRef} className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-red-600/75 to-red-400/35" style={{ height: '0%' }} />
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-3">
            <span className="text-[10px] font-bold tracking-[0.25em] text-white/75">BRAKE</span>
          </div>
          <div className="absolute inset-x-2.5 top-2 h-1/2 rounded-lg border border-white/8" />
        </div>
        <div
          {...press((v) => { st.current.gasDown = v; })}
          className="relative h-[28vh] max-h-[195px] min-h-[125px] w-[14vw] max-w-[76px] min-w-[56px] overflow-hidden rounded-2xl border border-white/12 bg-gradient-to-b from-zinc-800/75 to-zinc-950/85 shadow-[0_6px_20px_rgba(0,0,0,0.5)] backdrop-blur-sm"
        >
          <div ref={gasRef} className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-emerald-500/75 to-emerald-300/35" style={{ height: '0%' }} />
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-3">
            <span className="text-[10px] font-bold tracking-[0.25em] text-white/75">GAS</span>
          </div>
          <div className="absolute inset-x-2.5 top-2 h-2/3 rounded-lg border border-white/8" />
        </div>
      </div>

      {/* ---------- gear selector (center-right, thumb-friendly) ---------- */}
      <div className="absolute bottom-[36vh] right-[2vw] select-none">
        <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-black/50 p-1.5 backdrop-blur-md shadow-xl">
          <span className="text-[8px] font-semibold tracking-[0.3em] text-white/35">GEAR</span>
          <div className="flex gap-1">
            {gears.map((g) => (
              <button
                key={g}
                onPointerDown={() => sim?.requestGear(g)}
                className={`h-10 w-10 rounded-xl border text-sm font-bold transition active:scale-95 ${
                  t.gear === g
                    ? g === 'R' ? 'border-red-300/60 bg-red-500/25 text-red-100 shadow-[0_0_12px_rgba(248,113,113,0.3)]'
                      : g === 'D' ? 'border-emerald-300/60 bg-emerald-500/25 text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.3)]'
                        : 'border-white/40 bg-white/15 text-white'
                    : 'border-white/8 bg-white/3 text-white/40'
                }`}
              >{g}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- start engine button ---------- */}
      <div className="absolute bottom-[36vh] right-[30vw] select-none">
        <button
          onPointerDown={() => sim?.startEngine()}
          className={`h-9 w-16 rounded-xl border text-[10px] font-bold tracking-wider transition active:scale-95 ${
            t.engineOn ? 'border-emerald-300/45 bg-emerald-500/20 text-emerald-150' : 'border-red-300/55 bg-red-500/25 text-red-100 animate-pulse'
          }`}
        >{t.engineOn ? 'ON' : 'START'}</button>
      </div>

      {/* ---------- HANDBRAKE LEVER (proper vertical lever) ---------- */}
      <div className="absolute bottom-[12vh] left-[1vw] select-none touch-none">
        <button
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            sim?.toggleHandbrake();
          }}
          className="group relative flex h-[22vh] max-h-[160px] min-h-[110px] w-[9vw] max-w-[54px] min-w-[42px] flex-col items-center justify-end rounded-2xl border border-white/15 bg-gradient-to-b from-zinc-900/80 to-black/85 shadow-[0_6px_20px_rgba(0,0,0,0.6)] backdrop-blur-sm active:scale-[0.97]"
        >
          {/* Slot track */}
          <div className="absolute left-1/2 top-3 h-[calc(100%_-_56px)] w-1.5 -translate-x-1/2 rounded-full bg-black/60 shadow-inner" />

          {/* Lever handle */}
          <div
            className="absolute left-1/2 -translate-x-1/2 transition-all duration-200 ease-out"
            style={{
              top: t.handbrake ? '6px' : 'calc(100% - 62px)',
            }}
          >
            {/* Lever button (top of lever) */}
            <div className={`h-4 w-2 rounded-t-sm mx-auto ${t.handbrake ? 'bg-red-500' : 'bg-zinc-600'}`}
                 style={{ boxShadow: t.handbrake ? '0 0 8px rgba(239,68,68,0.6)' : 'none' }} />
            {/* Lever grip */}
            <div className={`h-11 w-9 rounded-lg border shadow-lg ${
              t.handbrake
                ? 'border-amber-400/50 bg-gradient-to-b from-zinc-800 to-zinc-900'
                : 'border-white/20 bg-gradient-to-b from-zinc-700 to-zinc-900'
            }`}>
              {/* Grip ridges */}
              <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="h-0.5 w-full rounded-full bg-black/40" />
                ))}
              </div>
            </div>
          </div>

          {/* Label at bottom */}
          <div className={`z-10 mb-1.5 rounded px-1 text-center text-[8px] font-bold tracking-widest transition-colors ${
            t.handbrake ? 'text-amber-300' : 'text-white/40'
          }`}>
            <div>P</div>
            <div className="text-[7px] leading-none opacity-70">BRAKE</div>
          </div>

          {/* Warning indicator when engaged */}
          {t.handbrake && (
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-red-500 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-lg animate-pulse">
              ⓟ
            </div>
          )}
        </button>
      </div>

      {/* ---------- secondary switches (left thumb rail) ---------- */}
      <div className="absolute bottom-[2vh] left-[22vw] flex gap-1 select-none">
        <button
          onPointerDown={() => sim?.cycleHeadlights()}
          className={`h-9 w-12 rounded-lg border text-[8px] font-bold tracking-wider backdrop-blur-sm transition active:scale-95 ${
            t.headlights === 2 ? 'border-sky-300/55 bg-sky-400/20 text-sky-100'
              : t.headlights === 1 ? 'border-emerald-300/45 bg-emerald-400/15 text-emerald-100'
                : 'border-white/10 bg-black/35 text-white/45'
          }`}
        >{t.headlights === 0 ? 'LIGHT' : t.headlights === 1 ? 'LOW' : 'HIGH'}</button>
        <button
          onPointerDown={() => sim?.toggleHazards()}
          className={`h-9 w-12 rounded-lg border text-[8px] font-bold tracking-wider backdrop-blur-sm transition active:scale-95 ${
            t.hazards ? 'border-amber-300/60 bg-amber-500/25 text-amber-100' : 'border-white/10 bg-black/35 text-white/45'
          }`}
        >HAZ</button>
        <button
          onPointerDown={() => sim?.toggleWipers()}
          className={`h-9 w-12 rounded-lg border text-[8px] font-bold tracking-wider backdrop-blur-sm transition active:scale-95 ${
            t.wipers ? 'border-sky-300/45 bg-sky-400/18 text-sky-100' : 'border-white/10 bg-black/35 text-white/45'
          }`}
        >WIPE</button>
      </div>
    </>
  );
}
