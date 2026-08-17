import * as THREE from 'three';
import {
  Network,
  RLink,
  RNode,
  LANE_W,
  signalState,
  LightState,
} from './network';
import type { WeatherMode } from './types';

// ---------------------------------------------------------------------------
// small deterministic RNG
// ---------------------------------------------------------------------------
function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// geometry builder
// ---------------------------------------------------------------------------
class MeshBuilder {
  pos: number[] = [];
  norm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  useColor: boolean;
  constructor(useColor = false) { this.useColor = useColor; }

  quad(
    p: number[][], n: number[], uv: number[][], c?: [number, number, number],
  ) {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.norm.push(n[0], n[1], n[2]);
      this.uv.push(uv[i][0], uv[i][1]);
      if (this.useColor) this.col.push(c![0], c![1], c![2]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** flat quad on the XZ plane given 4 corners in CCW order seen from above */
  flat(pts: number[][], y: number, uvScale = 0.125, c?: [number, number, number]) {
    this.quad(
      pts.map((q) => [q[0], y, q[1]]),
      [0, 1, 0],
      pts.map((q) => [q[0] * uvScale, q[1] * uvScale]),
      c,
    );
  }

  /** axis aligned strip (rectangle) defined by centre line + width */
  strip(x1: number, z1: number, x2: number, z2: number, w: number, y: number, uvScale = 0.125, c?: [number, number, number]) {
    const dx = x2 - x1, dz = z2 - z1;
    const l = Math.hypot(dx, dz) || 1;
    const rx = (-dz / l) * w * 0.5, rz = (dx / l) * w * 0.5;
    this.flat([
      [x1 - rx, z1 - rz], [x2 - rx, z2 - rz], [x2 + rx, z2 + rz], [x1 + rx, z1 + rz],
    ], y, uvScale, c);
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, uvScale = 0.25, c?: [number, number, number]) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const X = [cx - hx, cx + hx], Y = [cy - hy, cy + hy], Z = [cz - hz, cz + hz];
    const uw = sx * uvScale, ud = sz * uvScale, uh = sy * uvScale;
    // top
    this.quad([[X[0], Y[1], Z[1]], [X[1], Y[1], Z[1]], [X[1], Y[1], Z[0]], [X[0], Y[1], Z[0]]], [0, 1, 0], [[0, 0], [uw, 0], [uw, ud], [0, ud]], c);
    // +z
    this.quad([[X[0], Y[0], Z[1]], [X[1], Y[0], Z[1]], [X[1], Y[1], Z[1]], [X[0], Y[1], Z[1]]], [0, 0, 1], [[0, 0], [uw, 0], [uw, uh], [0, uh]], c);
    // -z
    this.quad([[X[1], Y[0], Z[0]], [X[0], Y[0], Z[0]], [X[0], Y[1], Z[0]], [X[1], Y[1], Z[0]]], [0, 0, -1], [[0, 0], [uw, 0], [uw, uh], [0, uh]], c);
    // +x
    this.quad([[X[1], Y[0], Z[1]], [X[1], Y[0], Z[0]], [X[1], Y[1], Z[0]], [X[1], Y[1], Z[1]]], [1, 0, 0], [[0, 0], [ud, 0], [ud, uh], [0, uh]], c);
    // -x
    this.quad([[X[0], Y[0], Z[0]], [X[0], Y[0], Z[1]], [X[0], Y[1], Z[1]], [X[0], Y[1], Z[0]]], [-1, 0, 0], [[0, 0], [ud, 0], [ud, uh], [0, uh]], c);
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.useColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------
// canvas textures
// ---------------------------------------------------------------------------
function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = 1) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  draw(ctx);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

function asphaltTexture() {
  return canvasTex(256, 256, (c) => {
    // Base asphalt
    const grad = c.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#3a3c42');
    grad.addColorStop(1, '#32343a');
    c.fillStyle = grad;
    c.fillRect(0, 0, 256, 256);
    // Aggregate texture
    for (let i = 0; i < 8000; i++) {
      const v = 25 + Math.random() * 50;
      const a = 0.25 + Math.random() * 0.35;
      c.fillStyle = `rgba(${v},${v},${v + 3},${a})`;
      const s = 0.8 + Math.random() * 2.2;
      c.fillRect(Math.random() * 256, Math.random() * 256, s, s);
    }
    // Subtle wear patterns
    for (let i = 0; i < 12; i++) {
      c.strokeStyle = `rgba(60,55,50,${0.08 + Math.random() * 0.12})`;
      c.lineWidth = 1 + Math.random() * 2;
      c.beginPath();
      c.moveTo(Math.random() * 256, Math.random() * 256);
      for (let j = 0; j < 5; j++) {
        c.lineTo(Math.random() * 256, Math.random() * 256);
      }
      c.stroke();
    }
  });
}

function asphaltRoughnessTexture() {
  return canvasTex(256, 256, (c) => {
    c.fillStyle = '#dddddd';
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 6500; i++) {
      const v = 135 + Math.random() * 110;
      c.fillStyle = `rgb(${v},${v},${v})`;
      const s = 0.8 + Math.random() * 2;
      c.fillRect(Math.random() * 256, Math.random() * 256, s, s);
    }
  });
}

function grassTexture() {
  return canvasTex(256, 256, (c) => {
    // Base grass with variation
    for (let y = 0; y < 256; y += 4) {
      for (let x = 0; x < 256; x += 4) {
        const g = 85 + Math.random() * 45;
        const b = 50 + Math.random() * 30;
        c.fillStyle = `rgb(${g * 0.65},${g},${b * 0.55})`;
        c.fillRect(x, y, 4, 4);
      }
    }
    // Grass blades
    for (let i = 0; i < 4000; i++) {
      const g = 70 + Math.random() * 55;
      c.fillStyle = `rgba(${g * 0.7},${g},${g * 0.5},${0.6 + Math.random() * 0.4})`;
      const w = 1.5 + Math.random() * 2;
      const h = 3 + Math.random() * 4;
      c.fillRect(Math.random() * 256, Math.random() * 256, w, h);
    }
    // Dirt patches
    for (let i = 0; i < 80; i++) {
      c.fillStyle = `rgba(95,85,60,${0.15 + Math.random() * 0.2})`;
      const r = 3 + Math.random() * 8;
      c.beginPath();
      c.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2);
      c.fill();
    }
  });
}

function facadeTexture() {
  return canvasTex(256, 256, (c) => {
    c.fillStyle = '#9a958c';
    c.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const shade = 40 + Math.random() * 55;
        c.fillStyle = `rgb(${shade + 25},${shade + 30},${shade + 38})`;
        c.fillRect(x * 64 + 14, y * 64 + 16, 36, 30);
        c.fillStyle = 'rgba(255,255,255,0.16)';
        c.fillRect(x * 64 + 14, y * 64 + 16, 36, 8);
      }
    }
    c.strokeStyle = 'rgba(0,0,0,0.14)';
    c.lineWidth = 2;
    for (let y = 0; y <= 4; y++) { c.beginPath(); c.moveTo(0, y * 64); c.lineTo(256, y * 64); c.stroke(); }
  });
}

function skyTexture(mode: WeatherMode) {
  return canvasTex(8, 128, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 128);
    if (mode === 'sunset') {
      g.addColorStop(0, '#152036'); g.addColorStop(0.45, '#3a4a6b');
      g.addColorStop(0.72, '#9b6d59'); g.addColorStop(1, '#d99a63');
    } else if (mode === 'cloudy' || mode === 'rain') {
      g.addColorStop(0, mode === 'rain' ? '#3e4854' : '#67798a');
      g.addColorStop(0.55, mode === 'rain' ? '#65717b' : '#9eabb4');
      g.addColorStop(1, mode === 'rain' ? '#a4adb3' : '#d2d8dc');
    } else {
      g.addColorStop(0, '#3f74c4'); g.addColorStop(0.45, '#84b0e6');
      g.addColorStop(0.8, '#cfe0ee'); g.addColorStop(1, '#e8eef2');
    }
    c.fillStyle = g; c.fillRect(0, 0, 8, 128);
  });
}

function signTexture(kind: string, label = '') {
  return canvasTex(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128);
    if (kind === 'stop') {
      c.fillStyle = '#b81d1d';
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i + Math.PI / 8;
        const x = 64 + Math.cos(a) * 60, y = 64 + Math.sin(a) * 60;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.closePath(); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 5; c.stroke();
      c.fillStyle = '#fff'; c.font = 'bold 40px Helvetica, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('STOP', 64, 66);
    } else if (kind === 'speed') {
      c.fillStyle = '#fff'; c.beginPath(); c.arc(64, 64, 60, 0, 7); c.fill();
      c.strokeStyle = '#c31f1f'; c.lineWidth = 13; c.beginPath(); c.arc(64, 64, 52, 0, 7); c.stroke();
      c.fillStyle = '#1b1b1b'; c.font = 'bold 54px Helvetica, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(label, 64, 68);
    } else if (kind === 'yield') {
      c.fillStyle = '#fff';
      c.beginPath(); c.moveTo(64, 118); c.lineTo(6, 16); c.lineTo(122, 16); c.closePath(); c.fill();
      c.strokeStyle = '#c31f1f'; c.lineWidth = 12; c.stroke();
      c.fillStyle = '#222'; c.font = 'bold 26px Helvetica, Arial'; c.textAlign = 'center';
      c.fillText('YIELD', 64, 62);
    } else if (kind === 'ped') {
      c.fillStyle = '#1c53a8'; c.fillRect(8, 8, 112, 112);
      c.fillStyle = '#fff'; c.fillRect(14, 14, 100, 100);
      c.fillStyle = '#1c53a8';
      c.beginPath(); c.arc(64, 36, 9, 0, 7); c.fill();
      c.fillRect(58, 46, 12, 30);
      c.fillRect(44, 50, 40, 7);
      c.fillRect(52, 74, 8, 28); c.fillRect(68, 74, 8, 28);
    } else if (kind === 'parking') {
      c.fillStyle = '#1c53a8'; c.fillRect(6, 6, 116, 116);
      c.fillStyle = '#fff'; c.font = 'bold 92px Helvetica, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('P', 64, 68);
    } else if (kind === 'round') {
      c.fillStyle = '#1c53a8'; c.beginPath(); c.arc(64, 64, 60, 0, 7); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 9;
      c.beginPath(); c.arc(64, 64, 32, 0.5, 5.6); c.stroke();
      c.beginPath(); c.moveTo(84, 34); c.lineTo(96, 56); c.lineTo(70, 54); c.closePath(); c.fillStyle = '#fff'; c.fill();
    }
  });
}

export interface ParkingBay {
  x: number; z: number; heading: number; id: number;
}

export interface WorldRefs {
  group: THREE.Group;
  bays: ParkingBay[];
  updateSignals: (time: number) => void;
  setDusk: (dusk: boolean) => void;
  setWeather: (mode: WeatherMode) => void;
  updateEnvironment: (time: number, x: number, z: number, dt: number) => void;
  /** Continuous streamed route leaving the northern edge of the authored town. */
  isEndlessRoad: (x: number, z: number) => { onRoad: boolean; speed: number } | null;
  pedestrians: { x: number; z: number }[];
  speedBumps: { x: number; z: number; radius: number }[];
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
}

interface LampRef { node: RNode; axis: 'ns' | 'ew' | 'diag'; mats: THREE.MeshBasicMaterial[]; }

const M_WHITE: [number, number, number] = [0.92, 0.92, 0.9];
const M_YELLOW: [number, number, number] = [0.92, 0.78, 0.25];

export function buildWorld(scene: THREE.Scene, net: Network): WorldRefs {
  const group = new THREE.Group();
  scene.add(group);
  const rnd = mulberry(20260419);

  // pad radii from link widths -------------------------------------------
  for (const n of net.nodeList) {
    if (n.kind === 'roundabout') continue;
    let mx = 3.2;
    for (const lid of n.links) mx = Math.max(mx, net.linkById[lid].half);
    n.radius = mx + 1.2;
  }

  // ---- ground ------------------------------------------------------------
  const groundMat = new THREE.MeshLambertMaterial({ map: grassTexture() });
  (groundMat.map as THREE.Texture).repeat.set(220, 220);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  group.add(ground);

  // ---- roads -------------------------------------------------------------
  const road = new MeshBuilder();
  const mark = new MeshBuilder(true);
  const wear = new MeshBuilder(true);
  const roadDetail = new MeshBuilder(true);
  const walk = new MeshBuilder();
  const asphaltMap = asphaltTexture();
  const asphaltRough = asphaltRoughnessTexture();
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: asphaltMap,
    roughnessMap: asphaltRough,
    roughness: 0.92,
    metalness: 0.01,
    color: 0xf2f2f2,
  });

  const rb = net.nodes['rbt'];

  for (const l of net.links) {
    const na = net.nodes[l.a], nb = net.nodes[l.b];
    const ra = na.kind === 'roundabout' ? na.radius : na.radius;
    const rbd = nb.kind === 'roundabout' ? nb.radius : nb.radius;
    const x1 = l.ax + l.dx * ra, z1 = l.az + l.dz * ra;
    const x2 = l.bx - l.dx * rbd, z2 = l.bz - l.dz * rbd;
    road.strip(x1, z1, x2, z2, l.half * 2, 0, 0.09);

    const rx = -l.dz, rz = l.dx;
    // Dirt gathers along the shoulders and tyre paths slowly polish the stone.
    for (const s of [-1, 1]) {
      wear.strip(
        x1 + rx * s * (l.half - 0.08), z1 + rz * s * (l.half - 0.08),
        x2 + rx * s * (l.half - 0.08), z2 + rz * s * (l.half - 0.08),
        0.34, 0.009, 1, [0.18, 0.16, 0.13],
      );
      for (let lane = 0; lane < l.lanes; lane++) {
        const path = (l.half - LANE_W * (lane + 0.5)) * s;
        for (const tyre of [-0.72, 0.72]) {
          wear.strip(
            x1 + rx * (path + tyre), z1 + rz * (path + tyre),
            x2 + rx * (path + tyre), z2 + rz * (path + tyre),
            0.1, 0.008, 1, [0.16, 0.17, 0.18],
          );
        }
      }
    }
    // edge lines
    for (const s of [-1, 1]) {
      mark.strip(
        x1 + rx * s * (l.half - 0.22), z1 + rz * s * (l.half - 0.22),
        x2 + rx * s * (l.half - 0.22), z2 + rz * s * (l.half - 0.22),
        0.16, 0.012, 1, M_WHITE,
      );
    }
    // centre line: dashed white for residential, solid yellow-ish for main/highway
    const segLen = Math.hypot(x2 - x1, z2 - z1);
    // Irregular repaired cracks break up long, perfectly clean surfaces.
    for (let q = 0; q < Math.floor(segLen / 48); q++) {
      const t = 14 + q * 47 + rnd() * 8;
      if (t > segLen - 10) continue;
      const side = (rnd() - 0.5) * l.half * 1.25;
      const bend = (rnd() - 0.5) * 1.1;
      wear.strip(
        x1 + l.dx * t + rx * side, z1 + l.dz * t + rz * side,
        x1 + l.dx * (t + 2.4) + rx * (side + bend), z1 + l.dz * (t + 2.4) + rz * (side + bend),
        0.055, 0.01, 1, [0.08, 0.085, 0.09],
      );
      wear.strip(
        x1 + l.dx * (t + 2.4) + rx * (side + bend), z1 + l.dz * (t + 2.4) + rz * (side + bend),
        x1 + l.dx * (t + 4.2) + rx * (side + bend * 0.3), z1 + l.dz * (t + 4.2) + rz * (side + bend * 0.3),
        0.045, 0.01, 1, [0.08, 0.085, 0.09],
      );
    }
    if (l.kind === 'highway') {
      for (const s of [-1, 1]) {
        mark.strip(x1 + rx * s * 0.18, z1 + rz * s * 0.18, x2 + rx * s * 0.18, z2 + rz * s * 0.18, 0.16, 0.012, 1, M_YELLOW);
      }
      // lane divider dashes between the 2 lanes each way
      for (const s of [-1, 1]) {
        const off = s * (l.half - LANE_W - 0.6);
        for (let t = 2; t < segLen - 3; t += 9) {
          const len = Math.min(4.5, segLen - 3 - t);
          mark.strip(
            x1 + l.dx * t + rx * off, z1 + l.dz * t + rz * off,
            x1 + l.dx * (t + len) + rx * off, z1 + l.dz * (t + len) + rz * off,
            0.14, 0.012, 1, M_WHITE,
          );
        }
      }
    } else if (l.kind === 'lot') {
      // no centre line
    } else {
      const dash = l.kind === 'residential';
      if (dash) {
        for (let t = 1; t < segLen - 2; t += 7) {
          const len = Math.min(3.2, segLen - 2 - t);
          mark.strip(x1 + l.dx * t, z1 + l.dz * t, x1 + l.dx * (t + len), z1 + l.dz * (t + len), 0.14, 0.012, 1, M_WHITE);
        }
      } else {
        for (const s of [-1, 1]) {
          mark.strip(x1 + rx * s * 0.16, z1 + rz * s * 0.16, x2 + rx * s * 0.16, z2 + rz * s * 0.16, 0.13, 0.012, 1, M_YELLOW);
        }
      }
    }
    // Main streets also have dashed lane separators, not just the highway.
    if (l.lanes > 1 && l.kind !== 'highway') {
      for (const s of [-1, 1]) {
        const off = s * (l.half - LANE_W);
        for (let t = 3; t < segLen - 3; t += 8.5) {
          const len = Math.min(3.8, segLen - 3 - t);
          mark.strip(
            x1 + l.dx * t + rx * off, z1 + l.dz * t + rz * off,
            x1 + l.dx * (t + len) + rx * off, z1 + l.dz * (t + len) + rz * off,
            0.13, 0.013, 1, M_WHITE,
          );
        }
      }
    }

    // sidewalks along city streets
    if (l.kind === 'main' || l.kind === 'residential') {
      const off = l.half + 1.7;
      for (const s of [-1, 1]) {
        const cx1 = x1 + rx * s * off, cz1 = z1 + rz * s * off;
        const cx2 = x2 + rx * s * off, cz2 = z2 + rz * s * off;
        const mx = (cx1 + cx2) / 2, mz = (cz1 + cz2) / 2;
        walk.box(mx, 0.075, mz,
          Math.abs(l.dx) > 0.5 ? Math.hypot(cx2 - cx1, cz2 - cz1) : 3.2, 0.15,
          Math.abs(l.dx) > 0.5 ? 3.2 : Math.hypot(cx2 - cx1, cz2 - cz1), 0.5);
      }
    }
  }

  const speedBumps: { x: number; z: number; radius: number }[] = [];
  const bumpLinks = net.links.filter((l) => l.kind === 'residential' && l.len > 58).slice(0, 5);
  for (const l of bumpLinks) {
    const t = l.len * (0.48 + rnd() * 0.12);
    const x = l.ax + l.dx * t, z = l.az + l.dz * t;
    speedBumps.push({ x, z, radius: l.half + 1 });
    if (l.axis === 'ew') roadDetail.box(x, 0.045, z, 0.65, 0.09, l.half * 2, 1, [0.19, 0.19, 0.18]);
    else roadDetail.box(x, 0.045, z, l.half * 2, 0.09, 0.65, 1, [0.19, 0.19, 0.18]);
    for (const s of [-1, 1]) {
      mark.strip(
        x + l.dx * s * 0.17 + -l.dz * (-l.half + 0.3), z + l.dz * s * 0.17 + l.dx * (-l.half + 0.3),
        x + l.dx * s * 0.17 + -l.dz * (l.half - 0.3), z + l.dz * s * 0.17 + l.dx * (l.half - 0.3),
        0.16, 0.105, 1, M_YELLOW,
      );
    }
  }

  // Storm drains sit just inside the kerb on city streets.
  for (const l of net.links.filter((link) => link.kind === 'main' || link.kind === 'residential').slice(0, 18)) {
    for (const t of [l.len * 0.28, l.len * 0.72]) {
      const off = l.half - 0.42;
      const x = l.ax + l.dx * t + -l.dz * off;
      const z = l.az + l.dz * t + l.dx * off;
      if (l.axis === 'ew') roadDetail.box(x, 0.018, z, 0.72, 0.025, 0.32, 1, [0.12, 0.13, 0.14]);
      else roadDetail.box(x, 0.018, z, 0.32, 0.025, 0.72, 1, [0.12, 0.13, 0.14]);
    }
  }

  // intersection pads + crossings + stop lines
  for (const n of net.nodeList) {
    if (n.kind === 'roundabout') continue;
    const R = n.radius;
    road.flat([[n.x - R, n.z - R], [n.x + R, n.z - R], [n.x + R, n.z + R], [n.x - R, n.z + R]], 0.001, 0.09);
    if (n.kind === 'signal' || n.kind === 'stop') {
      // corner sidewalks
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        walk.box(n.x + sx * (R + 1.6), 0.075, n.z + sz * (R + 1.6), 3.2, 0.15, 3.2, 0.5);
      }
      for (const lid of n.links) {
        const l = net.linkById[lid];
        const away = l.a === n.id ? 1 : -1;
        const dx = l.dx * away, dz = l.dz * away;
        const rx = -dz, rz = dx;
        // zebra crossing
        const c0 = R + 0.9;
        for (let k = -3; k <= 3; k++) {
          const off = k * 0.85;
          if (Math.abs(off) > l.half - 0.35) continue;
          mark.strip(
            n.x + dx * c0 + rx * off, n.z + dz * c0 + rz * off,
            n.x + dx * (c0 + 2.9) + rx * off, n.z + dz * (c0 + 2.9) + rz * off,
            0.52, 0.014, 1, M_WHITE,
          );
        }
        // stop line (right half only)
        const sl = R + 4.3;
        mark.strip(
          n.x + dx * sl + rx * 0.1, n.z + dz * sl + rz * 0.1,
          n.x + dx * sl + rx * (l.half - 0.1), n.z + dz * sl + rz * (l.half - 0.1),
          0.4, 0.014, 1, M_WHITE,
        );

        if (n.kind === 'signal' && l.lanes > 1) {
          const approachRightX = dz, approachRightZ = -dx;
          for (let lane = 0; lane < l.lanes; lane++) {
            const laneCentre = l.half - LANE_W * (lane + 0.5);
            const cx = n.x + dx * (R + 13) + approachRightX * laneCentre;
            const cz = n.z + dz * (R + 13) + approachRightZ * laneCentre;
            mark.strip(cx + dx * 2.1, cz + dz * 2.1, cx - dx * 1.6, cz - dz * 1.6, 0.19, 0.015, 1, M_WHITE);
            // Inner lanes point ahead; the outer lane also carries a right-turn branch.
            mark.strip(cx - dx * 1.6, cz - dz * 1.6, cx + dx * 0.1 + approachRightX * 0.9, cz + dz * 0.1 + approachRightZ * 0.9, 0.17, 0.015, 1, M_WHITE);
            mark.strip(cx - dx * 1.6, cz - dz * 1.6, cx + dx * 0.1 - approachRightX * 0.9, cz + dz * 0.1 - approachRightZ * 0.9, 0.17, 0.015, 1, M_WHITE);
            if (lane === 0) {
              mark.strip(cx, cz, cx + approachRightX * 1.25 - dx * 0.45, cz + approachRightZ * 1.25 - dz * 0.45, 0.18, 0.015, 1, M_WHITE);
            }
          }
        }
      }
    }
  }

  // ---- roundabout --------------------------------------------------------
  {
    const outer = rb.radius, inner = 9;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 48),
      asphaltMat,
    );
    asphaltMap.repeat.set(1, 1);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(rb.x, 0.002, rb.z);
    ring.receiveShadow = true;
    group.add(ring);

    const island = new THREE.Mesh(
      new THREE.CylinderGeometry(inner, inner + 0.4, 0.35, 32),
      new THREE.MeshLambertMaterial({ color: 0x6f8a57 }),
    );
    island.position.set(rb.x, 0.16, rb.z);
    island.receiveShadow = true;
    group.add(island);
    const monument = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 6, 6),
      new THREE.MeshLambertMaterial({ color: 0xb9b3a6 }),
    );
    monument.position.set(rb.x, 3.3, rb.z);
    monument.castShadow = true;
    group.add(monument);

    // dashed circulation line
    for (let i = 0; i < 40; i++) {
      const a0 = (i / 40) * Math.PI * 2, a1 = a0 + 0.055;
      const r = (inner + outer) / 2;
      mark.strip(rb.x + Math.cos(a0) * r, rb.z + Math.sin(a0) * r, rb.x + Math.cos(a1) * r, rb.z + Math.sin(a1) * r, 0.14, 0.014, 1, M_WHITE);
    }
  }

  // ---- parking lot -------------------------------------------------------
  const bays: ParkingBay[] = [];
  {
    const cx = 200, z0 = -18, z1 = 100;
    road.flat([[cx - 26, z0], [cx + 26, z0], [cx + 26, z1], [cx - 26, z1]], 0.001, 0.09);
    let id = 0;
    for (let z = z0 + 8; z < z1 - 8; z += 3.0) {
      for (const s of [-1, 1]) {
        // bay separator lines
        mark.strip(cx + s * 6.4, z, cx + s * 20, z, 0.13, 0.013, 1, M_WHITE);
        if (z + 3.0 < z1 - 8) {
          bays.push({ x: cx + s * 13.2, z: z + 1.5, heading: s > 0 ? -Math.PI / 2 : Math.PI / 2, id: id++ });
        }
      }
    }
    for (const s of [-1, 1]) {
      mark.strip(cx + s * 20, z0 + 8, cx + s * 20, z1 - 8, 0.14, 0.013, 1, M_WHITE);
    }
  }

  const roadMesh = new THREE.Mesh(road.toGeometry(), asphaltMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  const markMesh = new THREE.Mesh(
    mark.toGeometry(),
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.82, toneMapped: false }),
  );
  markMesh.renderOrder = 1;
  group.add(markMesh);

  const wearMesh = new THREE.Mesh(
    wear.toGeometry(),
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }),
  );
  wearMesh.renderOrder = 1;
  group.add(wearMesh);

  const roadDetailMesh = new THREE.Mesh(
    roadDetail.toGeometry(),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12 }),
  );
  roadDetailMesh.receiveShadow = true;
  group.add(roadDetailMesh);

  const walkMesh = new THREE.Mesh(
    walk.toGeometry(),
    new THREE.MeshLambertMaterial({ color: 0xb3b0a8 }),
  );
  walkMesh.receiveShadow = true;
  group.add(walkMesh);

  // ---- buildings ---------------------------------------------------------
  const walls = new MeshBuilder(true);
  const roofs = new MeshBuilder(true);
  const wallColors: [number, number, number][] = [
    [0.82, 0.79, 0.73], [0.69, 0.73, 0.76], [0.78, 0.67, 0.58],
    [0.72, 0.78, 0.67], [0.76, 0.71, 0.79], [0.63, 0.65, 0.67],
  ];
  const GX = [-120, -40, 40, 120];
  const GZ = [-120, -40, 40, 120];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const x0 = GX[i] + 12, x1 = GX[i + 1] - 12;
      const z0 = GZ[j] + 12, z1 = GZ[j + 1] - 12;
      const downtown = i === 1 && (j === 1 || j === 0);
      const count = downtown ? 5 : 6;
      for (let k = 0; k < count; k++) {
        const side = k % 4;
        const t = 0.18 + rnd() * 0.64;
        let bx = 0, bz = 0, w = 0, d = 0;
        w = 10 + rnd() * 12; d = 9 + rnd() * 10;
        if (side === 0) { bx = x0 + (x1 - x0) * t; bz = z0 + d / 2; }
        else if (side === 1) { bx = x0 + (x1 - x0) * t; bz = z1 - d / 2; }
        else if (side === 2) { bx = x0 + w / 2; bz = z0 + (z1 - z0) * t; }
        else { bx = x1 - w / 2; bz = z0 + (z1 - z0) * t; }
        const h = downtown ? 14 + rnd() * 30 : 5 + rnd() * 8;
        const bc = wallColors[Math.floor(rnd() * wallColors.length)];
        walls.box(bx, h / 2, bz, w, h, d, 0.16, bc);
        roofs.box(bx, h + 0.25, bz, w + 0.5, 0.5, d + 0.5, 0.16, [bc[0] * 0.45, bc[1] * 0.45, bc[2] * 0.45]);
      }
    }
  }
  // a couple of highway-side warehouses
  for (let k = 0; k < 6; k++) {
    const bx = -260 + k * 95 + rnd() * 20;
    const bz = -430 - rnd() * 30;
    const bc = wallColors[(k + 2) % wallColors.length];
    walls.box(bx, 6, bz, 40, 12, 22, 0.1, bc);
    roofs.box(bx, 12.3, bz, 41, 0.6, 23, 0.1, [0.28, 0.29, 0.3]);
  }
  const facade = facadeTexture();
  const wallMesh = new THREE.Mesh(walls.toGeometry(), new THREE.MeshLambertMaterial({ map: facade, color: 0xffffff, vertexColors: true }));
  wallMesh.castShadow = true; wallMesh.receiveShadow = true;
  group.add(wallMesh);
  const roofMesh = new THREE.Mesh(roofs.toGeometry(), new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }));
  roofMesh.castShadow = true;
  group.add(roofMesh);

  // ---- trees & lamps -----------------------------------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 2.2, 5);
  const crownGeo = new THREE.SphereGeometry(1.7, 7, 5);
  const treeCount = 120;
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b4f36 }), treeCount);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x4e7a41 }), treeCount);
  crowns.castShadow = true;
  const m4 = new THREE.Matrix4();
  let ti = 0;
  for (const l of net.links) {
    if (l.kind !== 'residential' && l.kind !== 'main') continue;
    const steps = Math.floor(l.len / 22);
    for (let s = 1; s < steps && ti < treeCount; s++) {
      for (const sd of [-1, 1]) {
        if (ti >= treeCount) break;
        if (rnd() < 0.45) continue;
        const t = s * 22;
        const off = (l.half + 4.6) * sd;
        const x = l.ax + l.dx * t + -l.dz * off;
        const z = l.az + l.dz * t + l.dx * off;
        const sc = 0.8 + rnd() * 0.6;
        m4.makeTranslation(x, 1.1 * sc, z); m4.scale(new THREE.Vector3(sc, sc, sc));
        trunks.setMatrixAt(ti, m4);
        m4.makeTranslation(x, (2.2 + 1.5) * sc, z); m4.scale(new THREE.Vector3(sc, sc * 1.15, sc));
        crowns.setMatrixAt(ti, m4);
        ti++;
      }
    }
  }
  for (let k = ti; k < treeCount; k++) {
    m4.makeScale(0.001, 0.001, 0.001);
    trunks.setMatrixAt(k, m4); crowns.setMatrixAt(k, m4);
  }
  trunks.instanceMatrix.needsUpdate = true; crowns.instanceMatrix.needsUpdate = true;
  group.add(trunks, crowns);

  // street lamps
  const lampGeo = new THREE.CylinderGeometry(0.09, 0.12, 7, 5);
  const lampPoles = new THREE.InstancedMesh(lampGeo, new THREE.MeshLambertMaterial({ color: 0x50555a }), 60);
  const headGeo = new THREE.BoxGeometry(0.7, 0.16, 0.34);
  const headMat = new THREE.MeshBasicMaterial({ color: 0x2a2c2e });
  const lampHeads = new THREE.InstancedMesh(headGeo, headMat, 60);
  let li = 0;
  for (const l of net.links) {
    if (l.kind === 'lot') continue;
    const steps = Math.max(1, Math.floor(l.len / 40));
    for (let s = 1; s <= steps && li < 60; s++) {
      const t = (s * l.len) / (steps + 1);
      const off = (l.half + 2.4) * (s % 2 ? 1 : -1);
      const x = l.ax + l.dx * t + -l.dz * off;
      const z = l.az + l.dz * t + l.dx * off;
      m4.makeTranslation(x, 3.5, z); lampPoles.setMatrixAt(li, m4);
      m4.makeTranslation(x - -l.dz * off * 0.12, 7.0, z - l.dx * off * 0.12); lampHeads.setMatrixAt(li, m4);
      li++;
    }
  }
  for (let k = li; k < 60; k++) { m4.makeScale(0.001, 0.001, 0.001); lampPoles.setMatrixAt(k, m4); lampHeads.setMatrixAt(k, m4); }
  lampPoles.instanceMatrix.needsUpdate = true; lampHeads.instanceMatrix.needsUpdate = true;
  group.add(lampPoles, lampHeads);

  // ---- street furniture, utilities and parked vehicles -------------------
  const furniture = new MeshBuilder(true);
  const metal: [number, number, number] = [0.25, 0.27, 0.29];
  const timber: [number, number, number] = [0.38, 0.25, 0.15];

  // Bus shelters and benches on the two busiest streets.
  const shelters = [
    { x: -15, z: -48, alongX: true }, { x: 70, z: 32, alongX: true },
    { x: -48, z: 70, alongX: false }, { x: 32, z: -70, alongX: false },
  ];
  for (const s of shelters) {
    if (s.alongX) {
      furniture.box(s.x, 1.25, s.z, 4.2, 0.12, 1.5, 1, metal);
      furniture.box(s.x, 2.45, s.z, 4.3, 0.12, 1.7, 1, metal);
      furniture.box(s.x - 2.05, 1.35, s.z, 0.12, 2.3, 1.6, 1, metal);
      furniture.box(s.x + 2.05, 1.35, s.z, 0.12, 2.3, 1.6, 1, metal);
      furniture.box(s.x, 0.55, s.z, 2.5, 0.16, 0.55, 1, timber);
    } else {
      furniture.box(s.x, 1.25, s.z, 1.5, 0.12, 4.2, 1, metal);
      furniture.box(s.x, 2.45, s.z, 1.7, 0.12, 4.3, 1, metal);
      furniture.box(s.x, 1.35, s.z - 2.05, 1.6, 2.3, 0.12, 1, metal);
      furniture.box(s.x, 1.35, s.z + 2.05, 1.6, 2.3, 0.12, 1, metal);
      furniture.box(s.x, 0.55, s.z, 0.55, 0.16, 2.5, 1, timber);
    }
  }

  // Low residential fences create believable property boundaries.
  for (let i = 0; i < 18; i++) {
    const x = -105 + i * 12;
    furniture.box(x, 0.55, 170, 8.5, 1.1, 0.09, 1, [0.42, 0.39, 0.33]);
  }
  for (let i = 0; i < 12; i++) {
    const z = -105 + i * 13;
    furniture.box(151, 0.5, z, 0.09, 1, 9.5, 1, [0.32, 0.34, 0.31]);
  }

  // Shop awnings add ground-level variation to the central blocks.
  const awnings = [
    [-18, 2.9, -51, 10, 0.25, 2], [72, 2.7, -29, 12, 0.25, 2],
    [-51, 2.8, 18, 2, 0.25, 11], [109, 2.6, 70, 2, 0.25, 9],
  ];
  const awningColors: [number, number, number][] = [[0.42, 0.12, 0.1], [0.08, 0.25, 0.34], [0.22, 0.38, 0.18], [0.54, 0.38, 0.12]];
  awnings.forEach((a, i) => furniture.box(a[0], a[1], a[2], a[3], a[4], a[5], 1, awningColors[i]));

  const furnitureMesh = new THREE.Mesh(
    furniture.toGeometry(),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.1 }),
  );
  furnitureMesh.castShadow = true;
  furnitureMesh.receiveShadow = true;
  group.add(furnitureMesh);

  // Wooden utility poles, deliberately offset from the modern street lamps.
  const utilityCount = 30;
  const utility = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.16, 7.8, 6),
    new THREE.MeshLambertMaterial({ color: 0x5d4632 }),
    utilityCount,
  );
  let ui = 0;
  for (const l of net.links) {
    if (l.kind !== 'residential') continue;
    for (let t = 18; t < l.len - 10 && ui < utilityCount; t += 34) {
      const off = l.half + 3.5;
      const x = l.ax + l.dx * t + -l.dz * off;
      const z = l.az + l.dz * t + l.dx * off;
      m4.makeTranslation(x, 3.9, z);
      utility.setMatrixAt(ui++, m4);
    }
  }
  for (let i = ui; i < utilityCount; i++) { m4.makeScale(0.001, 0.001, 0.001); utility.setMatrixAt(i, m4); }
  utility.instanceMatrix.needsUpdate = true;
  utility.castShadow = true;
  group.add(utility);

  // Parked cars use two low-poly instanced parts and per-instance paint.
  const parkedSlots = bays.filter((_, i) => i % 3 !== 1).slice(0, 18);
  const parkedBody = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.75, 0.62, 4.15),
    new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.18 }),
    parkedSlots.length,
  );
  const parkedCabin = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.52, 0.55, 2.05),
    new THREE.MeshStandardMaterial({ color: 0x33414d, roughness: 0.25, metalness: 0.08 }),
    parkedSlots.length,
  );
  const parkedColors = [0x8f959c, 0x273b50, 0x7a2025, 0xd2d0c7, 0x314c3c, 0x5c6065];
  const q4 = new THREE.Quaternion();
  for (let i = 0; i < parkedSlots.length; i++) {
    const p = parkedSlots[i];
    q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
    m4.compose(new THREE.Vector3(p.x, 0.62, p.z), q4, new THREE.Vector3(1, 1, 1));
    parkedBody.setMatrixAt(i, m4);
    parkedBody.setColorAt(i, new THREE.Color(parkedColors[i % parkedColors.length]));
    m4.compose(new THREE.Vector3(p.x, 1.16, p.z), q4, new THREE.Vector3(1, 1, 1));
    parkedCabin.setMatrixAt(i, m4);
  }
  parkedBody.instanceMatrix.needsUpdate = true;
  parkedCabin.instanceMatrix.needsUpdate = true;
  parkedBody.castShadow = true;
  parkedCabin.castShadow = true;
  group.add(parkedBody, parkedCabin);

  // A small instanced pedestrian system animates crossings for one draw call per body part.
  interface PedState { x: number; z: number; baseX: number; baseZ: number; axis: 'x' | 'z'; phase: number; span: number; }
  const signalNodes = net.nodeList.filter((n) => n.kind === 'signal');
  const pedestrians: PedState[] = Array.from({ length: 12 }, (_, i) => {
    const n = signalNodes[i % signalNodes.length];
    return {
      x: n.x, z: n.z, baseX: n.x, baseZ: n.z,
      axis: i % 2 ? 'x' : 'z', phase: i * 0.173, span: n.radius * 2 + 5,
    };
  });
  const pedTorso = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.22, 0.65, 3, 5), new THREE.MeshLambertMaterial({ color: 0x384f65 }), pedestrians.length);
  const pedHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 6, 5), new THREE.MeshLambertMaterial({ color: 0xb98b6e }), pedestrians.length);
  const pedLegA = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.075, 0.55, 2, 4), new THREE.MeshLambertMaterial({ color: 0x252a31 }), pedestrians.length);
  const pedLegB = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.075, 0.55, 2, 4), new THREE.MeshLambertMaterial({ color: 0x252a31 }), pedestrians.length);
  group.add(pedTorso, pedHead, pedLegA, pedLegB);

  // ---- signs -------------------------------------------------------------
  const postB = new MeshBuilder();
  const plateB: Record<string, MeshBuilder> = {};
  const signMats: Record<string, THREE.MeshBasicMaterial> = {};

  const addSign = (x: number, z: number, faceX: number, faceZ: number, kind: string, label = '') => {
    postB.box(x, 1.3, z, 0.075, 2.6, 0.075, 0.5);
    const key = kind + label;
    if (!signMats[key]) {
      signMats[key] = new THREE.MeshBasicMaterial({
        map: signTexture(kind, label), transparent: true, side: THREE.DoubleSide, toneMapped: false,
      });
      plateB[key] = new MeshBuilder();
    }
    const l = Math.hypot(faceX, faceZ) || 1;
    const dx = faceX / l, dz = faceZ / l;
    // right vector of a plate whose normal is (dx,0,dz)
    const rx = dz, rz = -dx;
    const h = 0.44, w = 0.44, cy = 2.45;
    const b = plateB[key];
    b.quad(
      [
        [x - rx * w, cy - h, z - rz * w],
        [x + rx * w, cy - h, z + rz * w],
        [x + rx * w, cy + h, z + rz * w],
        [x - rx * w, cy + h, z - rz * w],
      ],
      [dx, 0, dz],
      [[0, 0], [1, 0], [1, 1], [0, 1]],
    );
  };

  for (const n of net.nodeList) {
    if (n.kind === 'stop') {
      for (const lid of n.links) {
        const l = net.linkById[lid];
        const away = l.a === n.id ? 1 : -1;
        const dx = l.dx * away, dz = l.dz * away;
        const rx = -dz, rz = dx;
        const px = n.x + dx * (n.radius + 4.6) - rx * (l.half + 1.6);
        const pz = n.z + dz * (n.radius + 4.6) - rz * (l.half + 1.6);
        addSign(px, pz, dx, dz, 'stop');
      }
    }
    if (n.kind === 'signal') {
      for (const lid of n.links) {
        const l = net.linkById[lid];
        const away = l.a === n.id ? 1 : -1;
        const dx = l.dx * away, dz = l.dz * away;
        const rx = -dz, rz = dx;
        addSign(n.x + dx * (n.radius + 5.4) - rx * (l.half + 1.7), n.z + dz * (n.radius + 5.4) - rz * (l.half + 1.7), dx, dz, 'ped');
      }
    }
  }
  // speed limit + info signs along links
  for (const l of net.links) {
    if (l.len < 40) continue;
    const t = l.len * 0.35;
    const off = l.half + 1.9;
    addSign(l.ax + l.dx * t + -l.dz * off, l.az + l.dz * t + l.dx * off, -l.dx, -l.dz, 'speed', String(l.speed));
    if (l.len > 90) {
      const t2 = l.len * 0.7;
      addSign(l.ax + l.dx * t2 + l.dz * off, l.az + l.dz * t2 - l.dx * off, l.dx, l.dz, 'speed', String(l.speed));
    }
  }
  // roundabout warning + yields
  for (const lid of rb.links) {
    const l = net.linkById[lid];
    const away = l.a === rb.id ? 1 : -1;
    const dx = l.dx * away, dz = l.dz * away;
    addSign(rb.x + dx * (rb.radius + 6) + dz * (l.half + 1.8), rb.z + dz * (rb.radius + 6) - dx * (l.half + 1.8), dx, dz, 'yield');
    addSign(rb.x + dx * (rb.radius + 12) + dz * (l.half + 1.8), rb.z + dz * (rb.radius + 12) - dx * (l.half + 1.8), dx, dz, 'round');
  }
  addSign(200 - 24, 44, -1, 0, 'parking');
  addSign(200 + 24, 44, 1, 0, 'parking');

  const postMesh = new THREE.Mesh(postB.toGeometry(), new THREE.MeshLambertMaterial({ color: 0x8d9195 }));
  postMesh.castShadow = false;
  group.add(postMesh);
  for (const key of Object.keys(plateB)) {
    const m = new THREE.Mesh(plateB[key].toGeometry(), signMats[key]);
    m.renderOrder = 2;
    group.add(m);
  }

  // ---- traffic lights ----------------------------------------------------
  const lampRefs: LampRef[] = [];
  const housingGeo = new THREE.BoxGeometry(0.42, 1.15, 0.3);
  const housingMat = new THREE.MeshLambertMaterial({ color: 0x22262a });
  const bulbGeo = new THREE.SphereGeometry(0.13, 8, 6);
  const armGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6);
  const poleGeo = new THREE.CylinderGeometry(0.11, 0.13, 5.6, 6);

  for (const n of net.nodeList) {
    if (n.kind !== 'signal') continue;
    for (const lid of n.links) {
      const l = net.linkById[lid];
      const away = l.a === n.id ? 1 : -1;
      const dx = l.dx * away, dz = l.dz * away;
      const rx = -dz, rz = dx;
      const bx = n.x + dx * (n.radius + 1.2) + rx * (l.half + 1.5);
      const bz = n.z + dz * (n.radius + 1.2) + rz * (l.half + 1.5);
      const g = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, housingMat);
      pole.position.y = 2.8;
      g.add(pole);
      const arm = new THREE.Mesh(armGeo, housingMat);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(-1.7, 5.4, 0);
      g.add(arm);
      const head = new THREE.Mesh(housingGeo, housingMat);
      head.position.set(-3.2, 4.85, 0);
      g.add(head);
      const mats: THREE.MeshBasicMaterial[] = [];
      for (let k = 0; k < 3; k++) {
        const m = new THREE.MeshBasicMaterial({ color: 0x20130f, toneMapped: false });
        const b = new THREE.Mesh(bulbGeo, m);
        b.position.set(-3.2, 5.22 - k * 0.37, -0.16);
        g.add(b);
        mats.push(m);
      }
      g.position.set(bx, 0, bz);
      g.rotation.y = Math.atan2(-dx, -dz);
      group.add(g);
      lampRefs.push({ node: n, axis: l.axis, mats });
    }
  }

  const COL: Record<LightState, [number, number, number]> = {
    red: [0xff2a1c, 0x2a1210, 0x141414],
    yellow: [0x2a1210, 0xffb114, 0x141414],
    green: [0x2a1210, 0x241a08, 0x2fe05a],
  };
  const OFF = [0x321412, 0x30240c, 0x11301a];

  const updateSignals = (time: number) => {
    for (const r of lampRefs) {
      const st = signalState(r.node, r.axis, time);
      const c = COL[st];
      for (let k = 0; k < 3; k++) {
        const on = c[k] > 0x400000 || (k === 2 && st === 'green') || (k === 1 && st === 'yellow') || (k === 0 && st === 'red');
        r.mats[k].color.setHex(on ? [0xff2a1c, 0xffb114, 0x2fe05a][k] : OFF[k]);
      }
    }
  };

  // ---- lighting ----------------------------------------------------------
  // Naturalistic ambient light
  const hemi = new THREE.HemisphereLight(0xa8c4e8, 0x4a5240, 0.85);
  scene.add(hemi);
  // Warm sunlight
  const sun = new THREE.DirectionalLight(0xffecd0, 1.35);
  sun.position.set(80, 95, 50);
  sun.castShadow = true;
  const shadowSize = window.innerWidth < 1100 ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -65; sc.right = 65; sc.top = 65; sc.bottom = -65; sc.near = 1; sc.far = 300;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const skyGeo = new THREE.SphereGeometry(900, 20, 12);
  const skyMats: Record<WeatherMode, THREE.MeshBasicMaterial> = {
    clear: new THREE.MeshBasicMaterial({ map: skyTexture('clear'), side: THREE.BackSide, depthWrite: false, fog: false }),
    cloudy: new THREE.MeshBasicMaterial({ map: skyTexture('cloudy'), side: THREE.BackSide, depthWrite: false, fog: false }),
    rain: new THREE.MeshBasicMaterial({ map: skyTexture('rain'), side: THREE.BackSide, depthWrite: false, fog: false }),
    sunset: new THREE.MeshBasicMaterial({ map: skyTexture('sunset'), side: THREE.BackSide, depthWrite: false, fog: false }),
  };
  const sky = new THREE.Mesh(skyGeo, skyMats.clear);
  sky.renderOrder = -10;
  scene.add(sky);

  // Camera-centred rain uses a single line-segment draw call.
  const rainCount = 220;
  const rainData = new Float32Array(rainCount * 6);
  const rainSeed = mulberry(7104);
  for (let i = 0; i < rainCount; i++) {
    const p = i * 6;
    const x = (rainSeed() - 0.5) * 46;
    const y = rainSeed() * 18;
    const z = (rainSeed() - 0.5) * 54;
    rainData[p] = x; rainData[p + 1] = y; rainData[p + 2] = z;
    rainData[p + 3] = x + 0.08; rainData[p + 4] = y + 0.7; rainData[p + 5] = z + 0.05;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainData, 3));
  const rainLines = new THREE.LineSegments(
    rainGeo,
    new THREE.LineBasicMaterial({ color: 0xb9cee0, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false }),
  );
  rainLines.frustumCulled = false;
  rainLines.visible = false;
  scene.add(rainLines);

  let weather: WeatherMode = 'clear';
  const setWeather = (mode: WeatherMode) => {
    weather = mode;
    sky.material = skyMats[mode];
    const fog = scene.fog as THREE.Fog;
    const wallMat = wallMesh.material as THREE.MeshLambertMaterial;
    if (mode === 'clear') {
      hemi.intensity = 0.85; hemi.color.setHex(0xa8c4e8); hemi.groundColor.setHex(0x4a5240);
      sun.intensity = 1.35; sun.color.setHex(0xffecd0);
      sun.position.set(80, 95, 50);
      fog.color.setHex(0xc6d6e4); fog.near = 130; fog.far = 640;
      (scene.background as THREE.Color).setHex(0xc6d6e4);
      groundMat.color.setHex(0xffffff); asphaltMat.color.setHex(0xf2f2f2);
      asphaltMat.roughness = 0.92; asphaltMat.metalness = 0.01;
      wallMat.color.setHex(0xffffff); headMat.color.setHex(0x2a2c2e);
    } else if (mode === 'cloudy') {
      hemi.intensity = 0.78; hemi.color.setHex(0x9eabb8); hemi.groundColor.setHex(0x50544c);
      sun.intensity = 0.48; sun.color.setHex(0xdce3e8);
      sun.position.set(45, 80, 20);
      fog.color.setHex(0xaeb7be); fog.near = 105; fog.far = 520;
      (scene.background as THREE.Color).setHex(0xaeb7be);
      groundMat.color.setHex(0xd7ddd3); asphaltMat.color.setHex(0xc7c9cb);
      asphaltMat.roughness = 0.88; asphaltMat.metalness = 0.02;
      wallMat.color.setHex(0xd8dce0); headMat.color.setHex(0x35383b);
    } else if (mode === 'rain') {
      hemi.intensity = 0.58; hemi.color.setHex(0x788895); hemi.groundColor.setHex(0x363b39);
      sun.intensity = 0.24; sun.color.setHex(0xcad3da);
      sun.position.set(30, 70, 10);
      fog.color.setHex(0x737f88); fog.near = 75; fog.far = 390;
      (scene.background as THREE.Color).setHex(0x737f88);
      groundMat.color.setHex(0x9da899); asphaltMat.color.setHex(0x85898c);
      asphaltMat.roughness = 0.38; asphaltMat.metalness = 0.12;
      wallMat.color.setHex(0xb0b6ba); headMat.color.setHex(0xffe9b0);
    } else {
      hemi.intensity = 0.42; hemi.color.setHex(0x53617a); hemi.groundColor.setHex(0x322a24);
      sun.intensity = 0.55; sun.color.setHex(0xffa96e);
      sun.position.set(-120, 26, -30);
      fog.color.setHex(0x5e5261); fog.near = 105; fog.far = 500;
      (scene.background as THREE.Color).setHex(0x5e5261);
      groundMat.color.setHex(0x82796d); asphaltMat.color.setHex(0x8c8582);
      asphaltMat.roughness = 0.86; asphaltMat.metalness = 0.02;
      wallMat.color.setHex(0xb9a79b); headMat.color.setHex(0xffe9b0);
    }
    rainLines.visible = mode === 'rain';
    asphaltMat.needsUpdate = true;
  };

  const setDusk = (dusk: boolean) => setWeather(dusk ? 'sunset' : 'clear');

  // ---- streamed northern route ------------------------------------------
  // The town remains hand-authored.  Beyond it, small deterministic chunks are
  // retained around the driver so there is no visible edge or loading pause.
  const endless = new THREE.Group();
  endless.name = 'streamed-endless-road';
  scene.add(endless);
  const endlessChunks = new Map<number, THREE.Group>();
  const chunkLength = 92;
  const chunkZ = (i: number) => -300 - i * chunkLength;
  const centreX = (i: number) => Math.sin(i * 0.43) * 18 + Math.sin(i * 0.11) * 32;
  const roadMat = asphaltMat;
  const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x786c58, roughness: 0.98 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8dfbe, transparent: true, opacity: 0.72, toneMapped: false });
  const patchMat = new THREE.MeshBasicMaterial({ color: 0x202226, transparent: true, opacity: 0.32, depthWrite: false });

  const strip = (width: number, length: number, material: THREE.Material, x: number, z: number, heading: number, y = 0.004) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, length), material);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = 0;
    m.rotation.y = heading;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    return m;
  };
  const makeChunk = (i: number) => {
    const rng = mulberry(9001 + i * 97);
    const g = new THREE.Group();
    const x0 = centreX(i), x1 = centreX(i + 1);
    const z0 = chunkZ(i), z1 = chunkZ(i + 1);
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    const heading = Math.atan2(dx, dz);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const highway = i % 7 === 2 || i % 7 === 3;
    const width = highway ? 15.2 : (i % 5 === 1 ? 8.4 : 11.6);
    g.add(strip(width, len + 0.5, roadMat, cx, cz, heading));
    g.add(strip(width + 3.4, len + 1, shoulderMat, cx, cz, heading, -0.002));
    // Edge paint, lane dividers and repaired areas are per-chunk, but seeded
    // from the chunk index so the road has a stable, designed feel.
    for (const side of [-1, 1]) g.add(strip(0.14, len - 2, lineMat, cx + Math.cos(heading) * side * (width / 2 - 0.28), cz - Math.sin(heading) * side * (width / 2 - 0.28), heading, 0.014));
    const laneOffsets = highway ? [-3.7, 0, 3.7] : [0];
    for (const off of laneOffsets) {
      if (off === 0 && !highway) continue;
      for (let t = 8; t < len - 5; t += 10) {
        const px = x0 + (dx / len) * t + Math.cos(heading) * off;
        const pz = z0 + (dz / len) * t - Math.sin(heading) * off;
        g.add(strip(0.14, 4.5, lineMat, px, pz, heading, 0.015));
      }
    }
    for (let p = 0; p < 4; p++) {
      const t = 9 + rng() * (len - 18);
      const off = (rng() - 0.5) * (width - 1.4);
      const px = x0 + (dx / len) * t + Math.cos(heading) * off;
      const pz = z0 + (dz / len) * t - Math.sin(heading) * off;
      g.add(strip(0.15 + rng() * 0.18, 1.5 + rng() * 4, patchMat, px, pz, heading + (rng() - 0.5) * 0.7, 0.017));
    }
    const roadsideMat = new THREE.MeshLambertMaterial({ color: i % 4 === 0 ? 0x73875a : 0x536b46 });
    const buildingMat = new THREE.MeshLambertMaterial({ color: i % 3 === 0 ? 0xa89f91 : 0x7e8588 });
    const urban = i % 6 === 0 || i % 6 === 1;
    for (let n = 0; n < (urban ? 9 : 15); n++) {
      const t = 5 + rng() * (len - 10);
      const side = rng() < 0.5 ? -1 : 1;
      const off = width / 2 + 5 + rng() * (urban ? 14 : 25);
      const px = x0 + (dx / len) * t + Math.cos(heading) * side * off;
      const pz = z0 + (dz / len) * t - Math.sin(heading) * side * off;
      if (urban && rng() > 0.3) {
        const buildingHeight = 4 + rng() * 12;
        const b = new THREE.Mesh(new THREE.BoxGeometry(5 + rng() * 9, buildingHeight, 5 + rng() * 7), buildingMat);
        b.position.set(px, buildingHeight / 2, pz); b.castShadow = true; g.add(b);
      } else {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.25, 2.2, 5), new THREE.MeshLambertMaterial({ color: 0x564331 }));
        trunk.position.set(px, 1.1, pz); g.add(trunk);
        const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(1.5 + rng() * 1.8, 0), roadsideMat);
        crown.position.set(px, 3.1 + rng(), pz); crown.castShadow = true; g.add(crown);
      }
    }
    if (highway) {
      const railMat = new THREE.MeshLambertMaterial({ color: 0x9a9da0 });
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, len), railMat);
        rail.position.set(cx + Math.cos(heading) * side * (width / 2 + 0.8), 0.45, cz - Math.sin(heading) * side * (width / 2 + 0.8));
        rail.rotation.y = heading; g.add(rail);
      }
    }
    endless.add(g); endlessChunks.set(i, g);
  };
  const updateChunks = (z: number) => {
    if (z > -260) return;
    const at = Math.max(0, Math.floor((-z - 300) / chunkLength));
    for (let i = Math.max(0, at - 3); i <= at + 9; i++) if (!endlessChunks.has(i)) makeChunk(i);
    for (const [i, g] of endlessChunks) if (i < at - 4 || i > at + 10) { endless.remove(g); g.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); } }); endlessChunks.delete(i); }
  };
  const isEndlessRoad = (x: number, z: number) => {
    if (z > -285) return null;
    const i = Math.max(0, Math.floor((-z - 300) / chunkLength));
    for (const n of [i - 1, i, i + 1]) {
      if (n < 0) continue;
      const x0 = centreX(n), x1 = centreX(n + 1), z0 = chunkZ(n), z1 = chunkZ(n + 1);
      const vx = x1 - x0, vz = z1 - z0, l2 = vx * vx + vz * vz;
      const t = Math.max(0, Math.min(1, ((x - x0) * vx + (z - z0) * vz) / l2));
      const d = Math.hypot(x - (x0 + vx * t), z - (z0 + vz * t));
      if (d < 7.8) return { onRoad: true, speed: n % 7 === 2 || n % 7 === 3 ? 100 : 60 };
    }
    return { onRoad: false, speed: 60 };
  };

  const tempPos = new THREE.Vector3();
  const tempScale = new THREE.Vector3(1, 1, 1);
  const tempQuat = new THREE.Quaternion();
  const updateEnvironment = (time: number, x: number, z: number, dt: number) => {
    updateChunks(z);
    for (let i = 0; i < pedestrians.length; i++) {
      const p = pedestrians[i];
      const cycle = (time * (0.052 + (i % 3) * 0.005) + p.phase) % 1;
      const ping = cycle < 0.5 ? cycle * 2 : 2 - cycle * 2;
      const offset = (ping - 0.5) * p.span;
      p.x = p.baseX + (p.axis === 'x' ? offset : (i % 2 ? 1.4 : -1.4));
      p.z = p.baseZ + (p.axis === 'z' ? offset : (i % 2 ? 1.4 : -1.4));
      const step = Math.sin(time * 7.5 + i) * 0.32;
      const bob = Math.abs(Math.sin(time * 7.5 + i)) * 0.035;
      tempQuat.identity();
      tempPos.set(p.x, 1.08 + bob, p.z); m4.compose(tempPos, tempQuat, tempScale); pedTorso.setMatrixAt(i, m4);
      tempPos.set(p.x, 1.72 + bob, p.z); m4.compose(tempPos, tempQuat, tempScale); pedHead.setMatrixAt(i, m4);
      tempQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), step);
      tempPos.set(p.x - 0.1, 0.45, p.z); m4.compose(tempPos, tempQuat, tempScale); pedLegA.setMatrixAt(i, m4);
      tempQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -step);
      tempPos.set(p.x + 0.1, 0.45, p.z); m4.compose(tempPos, tempQuat, tempScale); pedLegB.setMatrixAt(i, m4);
    }
    pedTorso.instanceMatrix.needsUpdate = true; pedHead.instanceMatrix.needsUpdate = true;
    pedLegA.instanceMatrix.needsUpdate = true; pedLegB.instanceMatrix.needsUpdate = true;

    if (weather === 'rain') {
      const attr = rainGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < rainCount; i++) {
        const p = i * 2;
        let y = attr.getY(p) - dt * 24;
        if (y < -1) y += 19;
        attr.setY(p, y); attr.setY(p + 1, y + 0.7);
      }
      attr.needsUpdate = true;
      rainLines.position.set(x, 0, z);
    }
  };

  scene.background = new THREE.Color(0xc6d6e4);
  updateEnvironment(0, 0, 0, 0);
  return { group, bays, updateSignals, setDusk, setWeather, updateEnvironment, isEndlessRoad, pedestrians, speedBumps, sun, hemi, sky };
}

export function nearestLink(net: Network, x: number, z: number): { link: RLink; t: number; lat: number; dist: number } | null {
  let best: { link: RLink; t: number; lat: number; dist: number } | null = null;
  for (const l of net.links) {
    const rx = x - l.ax, rz = z - l.az;
    let t = rx * l.dx + rz * l.dz;
    const lat = rx * -l.dz + rz * l.dx;
    const clamped = Math.max(0, Math.min(l.len, t));
    const dx = rx - l.dx * clamped, dz = rz - l.dz * clamped;
    const dist = Math.hypot(dx, dz);
    if (!best || dist < best.dist) best = { link: l, t, lat, dist };
  }
  return best;
}
