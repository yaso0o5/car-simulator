import type { Controls } from './types';
import type { Vehicle } from './vehicle';
import type { RNode } from './network';
import type { ParkingBay } from './world';

export interface NodeInfo {
  node: RNode;
  dist: number;          // distance to the stop line ahead (m), <0 = passed
  state: 'green' | 'yellow' | 'red' | null;
  turn: number;          // -1 left, 0 straight, 1 right (planned by target)
}

export interface LessonCtx {
  car: Vehicle;
  controls: Controls;
  time: number;
  dt: number;
  kmh: number;
  lane: 'ok' | 'wrong' | 'offroad' | 'center';
  aheadSignal: NodeInfo | null;
  aheadStop: NodeInfo | null;
  nearestNodeDist: number;
  bays: ParkingBay[];
  data: Record<string, number>;
  setTarget: (x: number | null, z?: number, label?: string) => void;
  targetDist: number;
  toast: (msg: string, kind?: 'good' | 'bad' | 'info') => void;
  distanceFrom: (x: number, z: number) => number;
  headingDelta: (h: number) => number;
  nearest: (kind: 'signal' | 'stop') => { x: number; z: number } | null;
  parkBay: ParkingBay | null;
  setParkBay: (b: ParkingBay | null) => void;
  violationsThisLesson: number;
  reset: () => void;
}

export interface Lesson {
  id: string;
  title: string;
  step: string;
  hint: string;
  enter?: (c: LessonCtx) => void;
  update: (c: LessonCtx) => boolean;
  progress?: (c: LessonCtx) => number;
  successMsg: string;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const LESSONS: Lesson[] = [
  {
    id: 'start',
    title: 'Lesson 1 — Starting the car',
    step: 'Press and hold the BRAKE pedal, then press START to fire up the engine.',
    hint: 'An automatic will only start with the brake pressed and the selector in P.',
    successMsg: 'Engine running. Nicely done.',
    update: (c) => c.controls.engineOn,
    progress: (c) => (c.controls.brake > 0.2 ? 0.5 : 0) + (c.controls.engineOn ? 0.5 : 0),
  },
  {
    id: 'gear-d',
    title: 'Lesson 2 — Selecting Drive',
    step: 'Keep the brake held and move the selector from P to D.',
    hint: 'P locks the transmission. R reverses, N is neutral, D drives forward.',
    successMsg: 'D selected — the car is ready to move.',
    update: (c) => c.controls.gear === 'D',
    progress: (c) => (c.controls.gear === 'D' ? 1 : c.controls.gear === 'N' || c.controls.gear === 'R' ? 0.5 : 0.15),
  },
  {
    id: 'release',
    title: 'Lesson 3 — Releasing the brake',
    step: 'Release the handbrake, then ease off the brake and let the car creep forward.',
    hint: 'An automatic creeps at idle — you rarely need throttle to pull away.',
    successMsg: 'Smooth pull-away. That is exactly how it is done.',
    update: (c) => !c.controls.handbrake && c.kmh > 4 && c.car.speed > 0,
    progress: (c) => (c.controls.handbrake ? 0.2 : 0.5) + clamp01(c.kmh / 4) * 0.5,
  },
  {
    id: 'accel',
    title: 'Lesson 4 — Gentle acceleration',
    step: 'Squeeze the accelerator and hold a steady 25–40 km/h for 4 seconds.',
    hint: 'Roll onto the pedal progressively — passengers should not feel the change.',
    successMsg: 'Great throttle control.',
    enter: (c) => { c.data.hold = 0; },
    update: (c) => {
      if (c.kmh > 24 && c.kmh < 42) c.data.hold += c.dt;
      else c.data.hold = Math.max(0, c.data.hold - c.dt * 0.8);
      return c.data.hold >= 4;
    },
    progress: (c) => clamp01((c.data.hold || 0) / 4),
  },
  {
    id: 'lane',
    title: 'Lesson 5 — Lane discipline',
    step: 'Drive 150 m staying inside your own lane.',
    hint: 'Look far ahead, not at the bonnet — the car follows your eyes.',
    successMsg: 'Excellent lane position.',
    enter: (c) => { c.data.dist = 0; },
    update: (c) => {
      if (c.car.speed > 1) {
        if (c.lane === 'ok') c.data.dist += c.car.speed * c.dt;
        else c.data.dist = Math.max(0, c.data.dist - c.car.speed * c.dt * 1.5);
      }
      return c.data.dist >= 150;
    },
    progress: (c) => clamp01((c.data.dist || 0) / 150),
  },
  {
    id: 'signal',
    title: 'Lesson 6 — Turn signals',
    step: 'Signal your intention: switch on an indicator and keep it on for 3 seconds while moving.',
    hint: 'Signal at least 30 m — about 3 seconds — before every turn or lane change.',
    successMsg: 'Good signalling discipline.',
    enter: (c) => { c.data.hold = 0; },
    update: (c) => {
      const on = c.controls.indicatorLeft || c.controls.indicatorRight;
      if (on && c.kmh > 3) c.data.hold += c.dt; else c.data.hold = Math.max(0, c.data.hold - c.dt);
      return c.data.hold >= 3;
    },
    progress: (c) => clamp01((c.data.hold || 0) / 3),
  },
  {
    id: 'lights',
    title: 'Lesson 7 — Traffic lights',
    step: 'Follow the route to the signalised junction and obey the lights.',
    hint: 'Green = go if clear. Amber = stop unless it is unsafe. Red = stop behind the line.',
    successMsg: 'Junction cleared correctly.',
    enter: (c) => { c.data.armed = 0; c.data.stopped = 0; },
    update: (c) => {
      const s = c.aheadSignal;
      if (s) {
        c.setTarget(s.node.x, s.node.z, 'Traffic light');
        if (s.dist < 60) c.data.armed = 1;
        if (s.state === 'red' && s.dist < 12 && c.kmh < 2) c.data.stopped = 1;
        if (c.data.armed && s.dist < -6) return true;
      } else {
        const n = c.nearest('signal');
        if (n) c.setTarget(n.x, n.z, 'Traffic light');
      }
      return false;
    },
    progress: (c) => (c.aheadSignal ? clamp01(1 - Math.max(0, c.aheadSignal.dist) / 90) : 0.1),
  },
  {
    id: 'stopsign',
    title: 'Lesson 8 — Stop signs',
    step: 'Reach the STOP sign and make a full stop behind the line before proceeding.',
    hint: 'A rolling stop is a fail — the wheels must stop turning completely.',
    successMsg: 'Full stop observed. Perfect.',
    enter: (c) => { c.data.stopped = 0; },
    update: (c) => {
      const s = c.aheadStop;
      if (s) {
        c.setTarget(s.node.x, s.node.z, 'Stop sign');
        if (s.dist < 8 && s.dist > -3 && c.kmh < 1.2) c.data.stopped = 1;
        if (c.data.stopped && s.dist < -6) return true;
      } else {
        const n = c.nearest('stop');
        if (n) c.setTarget(n.x, n.z, 'Stop sign');
      }
      return false;
    },
    progress: (c) => (c.data.stopped ? 0.8 : c.aheadStop ? clamp01(1 - Math.max(0, c.aheadStop.dist) / 80) * 0.7 : 0.1),
  },
  {
    id: 'turn',
    title: 'Lesson 9 — Making a turn',
    step: 'Signal, slow to under 25 km/h and complete a full 80° turn at a junction.',
    hint: 'Brake before the corner, then gently accelerate out of it.',
    successMsg: 'Well judged turn.',
    enter: (c) => { c.data.h0 = c.car.heading; c.data.turned = 0; },
    update: (c) => {
      const d = c.headingDelta(c.data.h0 ?? c.car.heading);
      c.data.turned = Math.max(c.data.turned || 0, Math.abs(d));
      if (Math.abs(d) < 0.12) c.data.h0 = c.car.heading;
      return (c.data.turned || 0) > 1.4 && c.kmh < 45;
    },
    progress: (c) => clamp01((c.data.turned || 0) / 1.4),
  },
  {
    id: 'roundabout',
    title: 'Lesson 10 — Roundabout & intersections',
    step: 'Follow the route north to the roundabout, give way, circulate and take an exit.',
    hint: 'Give way to traffic already on the roundabout. Signal left as you leave.',
    successMsg: 'Roundabout negotiated safely.',
    enter: (c) => { c.data.inside = 0; c.setTarget(0, -260, 'Roundabout'); },
    update: (c) => {
      c.setTarget(0, -260, 'Roundabout');
      const d = c.distanceFrom(0, -260);
      if (d < 22) c.data.inside = 1;
      return !!c.data.inside && d > 34;
    },
    progress: (c) => (c.data.inside ? 0.7 : clamp01(1 - c.distanceFrom(0, -260) / 260) * 0.7),
  },
  {
    id: 'reverse',
    title: 'Lesson 11 — Reversing',
    step: 'Stop completely, hold the brake, select R and reverse 12 m using your mirrors.',
    hint: 'Look over your shoulder and check the mirrors — reverse slowly.',
    successMsg: 'Controlled reverse. Well done.',
    enter: (c) => { c.data.rev = 0; c.setTarget(null); },
    update: (c) => {
      if (c.controls.gear === 'R' && c.car.speed < -0.1) c.data.rev = (c.data.rev || 0) + -c.car.speed * c.dt;
      return (c.data.rev || 0) >= 12;
    },
    progress: (c) => clamp01((c.data.rev || 0) / 12),
  },
  {
    id: 'park',
    title: 'Lesson 12 — Parking',
    step: 'Drive to the car park and stop squarely inside the highlighted bay, then select P.',
    hint: 'Approach slowly, straighten up early and use the mirrors to judge the lines.',
    successMsg: 'Parked neatly inside the bay.',
    enter: (c) => {
      const bay = c.bays[Math.floor(c.bays.length * 0.5)] ?? c.bays[0];
      c.setParkBay(bay);
      if (bay) c.setTarget(bay.x, bay.z, 'Parking bay');
    },
    update: (c) => {
      const b = c.parkBay;
      if (!b) return true;
      c.setTarget(b.x, b.z, 'Parking bay');
      const d = c.distanceFrom(b.x, b.z);
      const hd = Math.abs(c.headingDelta(b.heading));
      return d < 1.5 && hd < 0.35 && c.kmh < 0.5 && c.controls.gear === 'P';
    },
    progress: (c) => (c.parkBay ? clamp01(1 - c.distanceFrom(c.parkBay.x, c.parkBay.z) / 120) : 0),
  },
  {
    id: 'test',
    title: 'Lesson 13 — The driving test',
    step: 'Free drive for 3 minutes. Every rule is now assessed: speed, lane, signals, signs and smoothness.',
    hint: 'Drive as you would with an examiner beside you. Mirrors, signal, manoeuvre.',
    successMsg: 'Test complete — see your examiner report.',
    enter: (c) => { c.data.t = 0; c.setParkBay(null); c.setTarget(null); },
    update: (c) => {
      if (c.controls.engineOn) c.data.t = (c.data.t || 0) + c.dt;
      return (c.data.t || 0) >= 180;
    },
    progress: (c) => clamp01((c.data.t || 0) / 180),
  },
];
