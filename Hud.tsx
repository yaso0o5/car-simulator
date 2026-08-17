import { useState } from 'react';
import type { Sim } from '../sim/engine';
import type { Telemetry } from '../sim/types';

function SpeedSign({ limit }: { limit: number }) {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full border-[4px] border-red-600 bg-white shadow-lg">
      <span className="text-[15px] font-extrabold leading-none text-zinc-900">{limit}</span>
    </div>
  );
}

export default function Hud({ t, sim }: { t: Telemetry; sim: Sim | null }) {
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState(false);

  const warn = t.laneStatus === 'wrong' || t.laneStatus === 'offroad';
  const bearingDeg = (t.targetBearing * 180) / Math.PI;

  return (
    <>
      {/* lane / off-road warning vignette */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: warn && t.speed > 5 ? 1 : 0,
          boxShadow: 'inset 0 0 120px 20px rgba(220,38,38,0.35)',
        }}
      />

      {/* ---------- lesson card (compact, top-left) ---------- */}
      <div className="pointer-events-none absolute left-2 top-2 max-w-[min(42vw,360px)]">
        <div className="pointer-events-auto overflow-hidden rounded-xl border border-white/8 bg-black/50 shadow-xl backdrop-blur-md">
          <button className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left" onClick={() => setOpen((o) => !o)}>
            <span className="flex h-4 min-w-[32px] items-center justify-center rounded bg-sky-500/20 px-1 text-[9px] font-bold tracking-wide text-sky-200">
              {t.lessonIndex + 1}/{t.lessons}
            </span>
            <span className="flex-1 truncate text-[11px] font-semibold text-white/85">{t.lessonTitle}</span>
            <span className="text-white/35">{open ? '▾' : '▸'}</span>
          </button>
          {open && (
            <div className="px-2.5 pb-2">
              <p className="text-[11px] leading-snug text-white/90">{t.lessonStep}</p>
              <p className="mt-0.5 text-[10px] italic leading-snug text-white/40">{t.lessonHint}</p>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-[width] duration-200"
                  style={{ width: `${Math.round(t.lessonProgress * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* navigation chip */}
        {t.hasTarget && (
          <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-emerald-300/25 bg-black/55 px-2.5 py-1.5 backdrop-blur-md">
            <span
              className="text-lg leading-none text-emerald-300"
              style={{ transform: `rotate(${bearingDeg}deg)`, display: 'inline-block' }}
            >↑</span>
            <span className="text-[12px] font-semibold text-emerald-200">{Math.round(t.distanceToTarget)} m</span>
          </div>
        )}
      </div>

      {/* ---------- right cluster (compact, top-right) ---------- */}
      <div className="absolute right-2 top-2 flex items-start gap-1.5">
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-black/50 px-2 py-1 backdrop-blur-md">
            <div className="text-right">
              <div className="text-[8px] font-semibold tracking-[0.2em] text-white/35">SCORE</div>
              <div className={`text-base font-bold leading-none ${t.score >= 80 ? 'text-emerald-300' : t.score >= 55 ? 'text-amber-300' : 'text-red-400'}`}>
                {Math.round(t.score)}
              </div>
            </div>
            <SpeedSign limit={t.speedLimit} />
          </div>
          {t.lightAhead && t.lightDistance < 65 && t.lightDistance > -5 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-black/50 px-2 py-1 backdrop-blur-md">
              <span
                className={`h-2.5 w-2.5 rounded-full ${t.lightAhead === 'red' ? 'bg-red-500' : t.lightAhead === 'yellow' ? 'bg-amber-400' : 'bg-emerald-400'}`}
                style={{ boxShadow: '0 0 8px currentColor' }}
              />
              <span className="text-[9px] font-medium text-white/65">
                {t.lightAhead === 'red' ? 'STOP' : t.lightAhead === 'yellow' ? 'CAUTION' : 'GO'}
                {' '}{Math.max(0, Math.round(t.lightDistance))}m
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => setMenu((m) => !m)}
          className="h-8 w-8 rounded-lg border border-white/8 bg-black/50 text-white/60 backdrop-blur-md active:scale-95"
        >☰</button>
      </div>

      {/* ---------- fault feed (subtle, right side) ---------- */}
      <div className="pointer-events-none absolute right-2 top-16 flex w-[min(52vw,260px)] flex-col items-end gap-1">
        {t.infractions.slice(0, 2).map((inf) => (
          <div key={inf.id} className="w-full rounded-lg border border-red-400/20 bg-red-950/50 px-2 py-1 backdrop-blur-md">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold text-red-150">{inf.title}</span>
              <span className="text-[10px] font-bold text-red-250">−{inf.penalty}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ---------- Handbrake warning when driving ---------- */}
      {t.handbrake && t.speed > 5 && (
        <div className="pointer-events-none absolute left-1/2 top-[28%] -translate-x-1/2 animate-pulse">
          <div className="rounded-lg border-2 border-red-500/70 bg-red-950/80 px-3 py-1.5 backdrop-blur-md shadow-[0_0_20px_rgba(239,68,68,0.5)]">
            <div className="flex items-center gap-2">
              <span className="text-lg leading-none text-red-400">ⓟ</span>
              <span className="text-[11px] font-bold text-red-100">HANDBRAKE ENGAGED</span>
            </div>
          </div>
        </div>
      )}

      {/* ---------- toast (centered, below windscreen) ---------- */}
      {t.toast && (
        <div className="pointer-events-none absolute left-1/2 top-[18%] -translate-x-1/2">
          <div
            className={`rounded-full border px-3.5 py-1.5 text-[11px] font-semibold shadow-xl backdrop-blur-md ${
              t.toastKind === 'good' ? 'border-emerald-300/35 bg-emerald-500/20 text-emerald-100'
                : t.toastKind === 'bad' ? 'border-red-300/35 bg-red-600/25 text-red-50'
                  : 'border-white/15 bg-black/55 text-white/85'
            }`}
          >{t.toast}</div>
        </div>
      )}

      {/* ---------- menu (compact) ---------- */}
      {menu && (
        <div className="absolute right-2 top-12 w-[200px] rounded-xl border border-white/10 bg-black/90 p-2.5 text-white shadow-2xl backdrop-blur-xl">
          <div className="mb-1.5 text-[9px] font-bold tracking-widest text-white/35">MENU</div>
          <button
            onClick={() => { sim?.skipLesson(); setMenu(false); }}
            className="mb-1 w-full rounded-lg border border-white/8 bg-white/5 px-2.5 py-1.5 text-left text-[10px] font-medium active:bg-white/10"
          >→ Next lesson</button>
          <button
            onClick={() => sim?.cycleWeather()}
            className="mb-1 w-full rounded-lg border border-white/8 bg-white/5 px-2.5 py-1.5 text-left text-[10px] font-medium active:bg-white/10"
          >Weather: {t.weather === 'clear' ? 'Clear' : t.weather === 'cloudy' ? 'Cloudy' : t.weather === 'rain' ? 'Light rain' : 'Sunset'}</button>
          <button
            onClick={() => { if (sim) sim.sound.enabled = !sim.sound.enabled; }}
            className="mb-1 w-full rounded-lg border border-white/8 bg-white/5 px-2.5 py-1.5 text-left text-[10px] font-medium active:bg-white/10"
          >Sound on / off</button>
          <button
            onClick={() => { sim?.resetRun(); setMenu(false); }}
            className="w-full rounded-lg border border-red-400/20 bg-red-500/15 px-2.5 py-1.5 text-left text-[10px] font-medium text-red-200 active:bg-red-500/25"
          >Restart course</button>
        </div>
      )}

      {/* ---------- final report ---------- */}
      {t.completed && t.finalReport && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/95 p-5 text-white shadow-2xl">
            <div className="text-[11px] font-bold tracking-[0.25em] text-sky-300">EXAMINER REPORT</div>
            <h2 className="mt-1 text-2xl font-bold">{t.finalReport[0]}</h2>
            <ul className="mt-3 space-y-1.5">
              {t.finalReport.slice(1).map((l, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] text-white/80">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-sky-400" />{l}
                </li>
              ))}
            </ul>
            <button
              onClick={() => sim?.resetRun()}
              className="mt-4 w-full rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-white"
            >Drive again</button>
          </div>
        </div>
      )}
    </>
  );
}
