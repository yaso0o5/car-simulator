import * as THREE from 'three';
import type { Gear } from './types';
import type { Network } from './network';

export interface ClusterState {
  speed: number;
  rpm: number;
  gear: Gear;
  engineOn: boolean;
  handbrake: boolean;
  left: boolean;
  right: boolean;
  headlights: 0 | 1 | 2;
  fuel: number;
  odo: number;
  seatbelt: boolean;
}

/** Analogue instrument cluster drawn to a canvas texture. */
export class Cluster {
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  private blink = false;

  constructor() {
    this.canvas.width = 1024;
    this.canvas.height = 384;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  private dial(
    cx: number, cy: number, r: number, value: number, max: number,
    label: string, step: number, redline = -1, lit = true,
  ) {
    const c = this.ctx;
    c.save();
    c.translate(cx, cy);
    const grd = c.createRadialGradient(0, -r * 0.3, r * 0.1, 0, 0, r);
    grd.addColorStop(0, '#25292e');
    grd.addColorStop(1, '#0d0f12');
    c.fillStyle = grd;
    c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill();
    c.strokeStyle = '#3a4048'; c.lineWidth = 3; c.stroke();

    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ticks = Math.round(max / step);
    for (let i = 0; i <= ticks; i++) {
      const f = i / ticks;
      const a = a0 + (a1 - a0) * f;
      const major = i % 2 === 0;
      const isRed = redline > 0 && f * max >= redline;
      c.strokeStyle = isRed ? '#e0453a' : lit ? (major ? '#eef2f6' : '#8e979f') : '#4a5057';
      c.lineWidth = major ? 3.5 : 2;
      c.beginPath();
      c.moveTo(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6));
      c.lineTo(Math.cos(a) * (r - (major ? 20 : 13)), Math.sin(a) * (r - (major ? 20 : 13)));
      c.stroke();
      if (major) {
        c.fillStyle = lit ? '#d7dee5' : '#565c63';
        c.font = `600 ${r * 0.13}px ui-sans-serif, Helvetica, Arial`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(Math.round(f * max)), Math.cos(a) * (r - 34), Math.sin(a) * (r - 34));
      }
    }
    c.fillStyle = lit ? '#9aa4ad' : '#4c5259';
    c.font = `500 ${r * 0.12}px ui-sans-serif, Helvetica, Arial`;
    c.textAlign = 'center';
    c.fillText(label, 0, r * 0.52);

    // needle
    const f = Math.max(0, Math.min(1, value / max));
    const a = a0 + (a1 - a0) * f;
    c.rotate(a);
    c.fillStyle = lit ? '#e8453c' : '#7d3a36';
    c.beginPath();
    c.moveTo(-6, -3.5); c.lineTo(r - 22, -1.6); c.lineTo(r - 22, 1.6); c.lineTo(-6, 3.5);
    c.closePath(); c.fill();
    c.rotate(-a);
    c.fillStyle = '#1a1d21';
    c.beginPath(); c.arc(0, 0, r * 0.11, 0, 7); c.fill();
    c.strokeStyle = '#43494f'; c.lineWidth = 2; c.stroke();
    c.restore();
  }

  update(s: ClusterState, time: number) {
    const c = this.ctx;
    this.blink = Math.floor(time * 1.6) % 2 === 0;
    c.fillStyle = '#0a0c0e';
    c.fillRect(0, 0, 1024, 384);
    // hood shading
    const g = c.createLinearGradient(0, 0, 0, 384);
    g.addColorStop(0, 'rgba(255,255,255,0.07)');
    g.addColorStop(0.4, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 1024, 384);

    this.dial(228, 190, 158, s.engineOn ? s.speed : 0, 180, 'km/h', 20, -1, s.engineOn);
    this.dial(796, 190, 158, s.engineOn ? s.rpm / 1000 : 0, 8, 'x1000 r/min', 1, 6.2, s.engineOn);

    // centre panel
    c.fillStyle = '#05070a';
    c.beginPath();
    c.roundRect(400, 74, 224, 236, 14);
    c.fill();
    c.strokeStyle = '#232a31'; c.lineWidth = 2; c.stroke();

    // gear indicator
    const gears: Gear[] = ['P', 'R', 'N', 'D'];
    c.font = '700 34px ui-sans-serif, Helvetica, Arial';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    gears.forEach((gr, i) => {
      const x = 430 + i * 55;
      const on = s.gear === gr && s.engineOn;
      c.fillStyle = on ? (gr === 'R' ? '#ff5a4d' : gr === 'D' ? '#57e08a' : '#eef3f7') : '#333a41';
      c.fillText(gr, x, 118);
      if (on) {
        c.shadowColor = gr === 'R' ? '#ff5a4d' : '#57e08a';
        c.shadowBlur = 18;
        c.fillText(gr, x, 118);
        c.shadowBlur = 0;
      }
    });

    // digital speed
    c.fillStyle = s.engineOn ? '#f2f6fa' : '#2c3238';
    c.font = '700 74px ui-sans-serif, Helvetica, Arial';
    c.fillText(String(Math.round(Math.abs(s.speed))), 512, 196);
    c.fillStyle = '#7d868e';
    c.font = '500 20px ui-sans-serif, Helvetica, Arial';
    c.fillText('km/h', 512, 240);
    c.fillStyle = '#5f686f';
    c.font = '500 17px ui-sans-serif, Helvetica, Arial';
    c.fillText(`${s.odo.toFixed(1)} km`, 512, 274);

    // fuel bar
    c.fillStyle = '#1b2026';
    c.fillRect(404, 296, 216, 8);
    c.fillStyle = s.fuel > 0.2 ? '#6fd3a0' : '#e8a33c';
    c.fillRect(404, 296, 216 * s.fuel, 8);

    // telltales
    const tell = (x: number, on: boolean, color: string, draw: () => void) => {
      c.save();
      c.translate(x, 344);
      c.globalAlpha = on ? 1 : 0.16;
      c.fillStyle = on ? color : '#5b636a';
      c.strokeStyle = on ? color : '#5b636a';
      draw();
      c.restore();
    };
    // left arrow
    tell(360, s.left && this.blink, '#4be07d', () => {
      c.beginPath(); c.moveTo(-16, 0); c.lineTo(0, -12); c.lineTo(0, -5); c.lineTo(14, -5);
      c.lineTo(14, 5); c.lineTo(0, 5); c.lineTo(0, 12); c.closePath(); c.fill();
    });
    tell(664, s.right && this.blink, '#4be07d', () => {
      c.beginPath(); c.moveTo(16, 0); c.lineTo(0, -12); c.lineTo(0, -5); c.lineTo(-14, -5);
      c.lineTo(-14, 5); c.lineTo(0, 5); c.lineTo(0, 12); c.closePath(); c.fill();
    });
    // headlights
    tell(440, s.headlights > 0, s.headlights === 2 ? '#5ea8ff' : '#63d76f', () => {
      c.beginPath(); c.ellipse(-2, 0, 11, 9, 0, 0, 7); c.fill();
      c.lineWidth = 2.4;
      for (let i = -1; i <= 1; i++) {
        c.beginPath(); c.moveTo(11, i * 6); c.lineTo(24, i * 6 + (s.headlights === 2 ? 0 : 4)); c.stroke();
      }
    });
    // handbrake
    tell(512, s.handbrake, '#ff5348', () => {
      c.lineWidth = 3;
      c.beginPath(); c.arc(0, 0, 12, 0, 7); c.stroke();
      c.font = '700 15px ui-sans-serif, Helvetica, Arial';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('P', 0, 1);
    });
    // seatbelt
    tell(584, s.seatbelt, '#ff5348', () => {
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(-9, -12); c.lineTo(9, 12); c.stroke();
      c.beginPath(); c.arc(0, -14, 4, 0, 7); c.fill();
      c.strokeRect(-11, -6, 22, 20);
    });

    this.texture.needsUpdate = true;
  }
}

export interface InfoState {
  title: string;
  step: string;
  score: number;
  px: number; pz: number; heading: number;
  targetX: number | null; targetZ: number | null;
  clock: number;
  speedLimit: number;
}

/** Centre-console infotainment screen: navigation minimap + lesson info. */
export class InfoScreen {
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  private lines: number[][] = [];

  constructor(net: Network) {
    this.canvas.width = 512;
    this.canvas.height = 384;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    for (const l of net.links) this.lines.push([l.ax, l.az, l.bx, l.bz, l.kind === 'highway' ? 5 : l.kind === 'main' ? 4 : 3]);
  }

  update(s: InfoState) {
    const c = this.ctx;
    c.fillStyle = '#0b1016';
    c.fillRect(0, 0, 512, 384);

    // ---- map ------------------------------------------------------------
    c.save();
    c.beginPath(); c.rect(0, 54, 512, 258); c.clip();
    c.translate(256, 190);
    const scale = 0.62;
    c.rotate(s.heading);
    c.translate(-s.px * scale, -s.pz * scale);
    c.lineCap = 'round';
    for (const l of this.lines) {
      c.strokeStyle = l[4] >= 5 ? '#2d4a6b' : l[4] >= 4 ? '#26384c' : '#1e2b38';
      c.lineWidth = l[4] * scale * 2.4;
      c.beginPath();
      c.moveTo(l[0] * scale, l[1] * scale);
      c.lineTo(l[2] * scale, l[3] * scale);
      c.stroke();
    }
    if (s.targetX !== null && s.targetZ !== null) {
      c.fillStyle = '#39d98a';
      c.beginPath(); c.arc(s.targetX * scale, s.targetZ * scale, 7, 0, 7); c.fill();
      c.strokeStyle = 'rgba(57,217,138,0.45)'; c.lineWidth = 3;
      c.beginPath(); c.arc(s.targetX * scale, s.targetZ * scale, 13, 0, 7); c.stroke();
    }
    c.restore();

    // car chevron
    c.save();
    c.translate(256, 190);
    c.fillStyle = '#4aa8ff';
    c.beginPath(); c.moveTo(0, -13); c.lineTo(9, 11); c.lineTo(0, 6); c.lineTo(-9, 11); c.closePath(); c.fill();
    c.restore();

    // ---- header ---------------------------------------------------------
    c.fillStyle = '#111a24';
    c.fillRect(0, 0, 512, 54);
    c.fillStyle = '#66c2ff';
    c.font = '600 21px ui-sans-serif, Helvetica, Arial';
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(s.title.slice(0, 34), 16, 28);
    c.textAlign = 'right';
    c.fillStyle = '#8fa3b5';
    c.font = '500 19px ui-sans-serif, Helvetica, Arial';
    const mm = Math.floor(s.clock / 60), ss = Math.floor(s.clock % 60);
    c.fillText(`${mm}:${ss.toString().padStart(2, '0')}`, 496, 28);

    // ---- footer ---------------------------------------------------------
    c.fillStyle = '#111a24';
    c.fillRect(0, 312, 512, 72);
    c.fillStyle = '#d7e4ef';
    c.font = '500 18px ui-sans-serif, Helvetica, Arial';
    c.textAlign = 'left';
    const words = s.step.split(' ');
    let line = '', y = 334;
    for (const w of words) {
      if ((line + w).length > 40) { c.fillText(line, 16, y); line = w + ' '; y += 22; if (y > 376) break; }
      else line += w + ' ';
    }
    if (y <= 376) c.fillText(line, 16, y);

    c.textAlign = 'right';
    c.fillStyle = '#39d98a';
    c.font = '700 22px ui-sans-serif, Helvetica, Arial';
    c.fillText(`${Math.round(s.score)}`, 496, 336);
    c.fillStyle = '#5d6f80';
    c.font = '500 12px ui-sans-serif, Helvetica, Arial';
    c.fillText('SCORE', 496, 356);

    this.texture.needsUpdate = true;
  }
}
