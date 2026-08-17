import * as THREE from 'three';
import { Network, RLink, laneOffset, signalState, otherEnd } from './network';

// Natural variation in driving behavior
const BODY_COLORS = [0xd8dbe0, 0x2f3a4a, 0x8d1f26, 0x1f4d3a, 0x3d4148, 0xb8b2a4, 0x27476e, 0xc9c2b6, 0x8b7355, 0x4a5568];

export interface AiCar {
  group: THREE.Group;
  link: RLink;
  fromA: boolean;
  t: number;
  lane: number;
  speed: number;
  targetSpeed: number;
  nextLink: RLink | null;
  nextFromA: boolean;
  inJunction: boolean;
  junctionLen: number;
  junctionStart: number;
  turnDir: number;
  stopTimer: number;
  waited: boolean;
  x: number; z: number; heading: number;
  brakeMat: THREE.MeshBasicMaterial;
  indL: THREE.MeshBasicMaterial;
  indR: THREE.MeshBasicMaterial;
  wheels: THREE.Object3D[];
  // Individual driver characteristics
  aggressiveness: number;      // 0.7-1.3 multiplier for acceleration/braking
  preferredSpeed: number;      // personal speed preference (0.85-1.0 of limit)
  reactionTime: number;        // 0.4-1.2s reaction delay
  followingDist: number;       // personal space preference (1.2-2.0s gap)
  turnSignaled: boolean;
  brakeLight: boolean;
  accel: number;
  lastBrake: number;
  idleTime: number;
  laneGoal: number;
  laneSignal: -1 | 0 | 1;
  laneCooldown: number;
  wanderPhase: number;
  prevSpeed: number;
}

// merged, shared geometry so each AI car costs only a handful of draw calls
interface CarGeos {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  wheels: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  brake: THREE.BufferGeometry;
  indL: THREE.BufferGeometry;
  indR: THREE.BufferGeometry;
}
let GEOS: CarGeos | null = null;

function mergeAll(list: THREE.BufferGeometry[]) {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  let off = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const i = g.getIndex()!;
    for (let k = 0; k < p.count; k++) {
      pos.push(p.getX(k), p.getY(k), p.getZ(k));
      nor.push(n.getX(k), n.getY(k), n.getZ(k));
    }
    for (let k = 0; k < i.count; k++) idx.push(i.getX(k) + off);
    off += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

function carGeos(): CarGeos {
  if (GEOS) return GEOS;
  const B = (w: number, h: number, d: number, x: number, y: number, z: number) =>
    new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const wheel = (x: number, z: number) => {
    const g = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 9);
    g.rotateZ(Math.PI / 2);
    g.translate(x, 0.33, z);
    return g;
  };
  GEOS = {
    body: mergeAll([
      B(1.78, 0.66, 4.3, 0, 0.68, 0),
      B(1.72, 0.3, 4.1, 0, 0.34, 0),
      B(1.62, 0.52, 2.2, 0, 1.2, 0.1),
      B(1.5, 0.09, 1.94, 0, 1.45, 0.12),
    ]),
    glass: mergeAll([B(1.655, 0.34, 2.06, 0, 1.22, 0.08)]),
    wheels: mergeAll([wheel(-0.85, -1.35), wheel(0.85, -1.35), wheel(-0.85, 1.35), wheel(0.85, 1.35)]),
    head: mergeAll([B(0.38, 0.13, 0.05, -0.6, 0.78, -2.16), B(0.38, 0.13, 0.05, 0.6, 0.78, -2.16)]),
    brake: mergeAll([B(0.34, 0.14, 0.05, -0.62, 0.82, 2.16), B(0.34, 0.14, 0.05, 0.62, 0.82, 2.16)]),
    indL: mergeAll([B(0.14, 0.1, 0.05, -0.82, 0.78, -2.15), B(0.14, 0.1, 0.05, -0.83, 0.82, 2.15)]),
    indR: mergeAll([B(0.14, 0.1, 0.05, 0.82, 0.78, -2.15), B(0.14, 0.1, 0.05, 0.83, 0.82, 2.15)]),
  };
  return GEOS;
}

const SHARED = {
  glass: new THREE.MeshLambertMaterial({ color: 0x1b2733, emissive: 0x0b1016 }),
  wheel: new THREE.MeshLambertMaterial({ color: 0x131416 }),
  head: new THREE.MeshBasicMaterial({ color: 0xfff2cf, toneMapped: false }),
};

function makeCarMesh(color: number) {
  const geo = carGeos();
  const g = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(geo.body, paint);
  body.castShadow = true;
  g.add(body);
  g.add(new THREE.Mesh(geo.glass, SHARED.glass));
  g.add(new THREE.Mesh(geo.wheels, SHARED.wheel));
  g.add(new THREE.Mesh(geo.head, SHARED.head));
  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x5a1410, toneMapped: false });
  g.add(new THREE.Mesh(geo.brake, brakeMat));
  const indL = new THREE.MeshBasicMaterial({ color: 0x3a2a10, toneMapped: false });
  const indR = new THREE.MeshBasicMaterial({ color: 0x3a2a10, toneMapped: false });
  g.add(new THREE.Mesh(geo.indL, indL));
  g.add(new THREE.Mesh(geo.indR, indR));
  return { g, brakeMat, indL, indR, wheels: [] as THREE.Object3D[] };
}

function headingFrom(dx: number, dz: number) {
  return Math.atan2(-dx, -dz);
}

export class Traffic {
  cars: AiCar[] = [];
  private net: Network;
  private tmp = { x: 0, z: 0, dx: 0, dz: 0 };

  constructor(scene: THREE.Scene, net: Network, count: number) {
    this.net = net;
    for (let i = 0; i < count; i++) {
      const { g, brakeMat, indL, indR, wheels } = makeCarMesh(BODY_COLORS[i % BODY_COLORS.length]);
      const model = i % 4;
      if (model === 1) g.scale.set(0.96, 1.13, 1.04); // compact SUV
      else if (model === 2) g.scale.set(0.92, 0.92, 0.88); // hatchback
      else if (model === 3) g.scale.set(1.02, 0.96, 1.1); // estate
      scene.add(g);
      const link = net.links[Math.floor(Math.random() * net.links.length)];
      // Each car has unique driver characteristics for natural variation
      const aggression = 0.7 + Math.random() * 0.6;  // 0.7-1.3
      const car: AiCar = {
        group: g, link, fromA: Math.random() < 0.5, t: Math.random() * link.len,
        lane: 0, speed: 5 + Math.random() * 3, targetSpeed: 8, nextLink: null, nextFromA: true,
        inJunction: false, junctionLen: 0, junctionStart: 0, turnDir: 0,
        stopTimer: 0, waited: false, x: 0, z: 0, heading: 0,
        brakeMat, indL, indR, wheels,
        aggressiveness: aggression,
        preferredSpeed: 0.84 + Math.random() * 0.16,  // some drive slower
        reactionTime: 0.4 + Math.random() * 0.8,      // reaction delay variation
        followingDist: 1.2 + Math.random() * 0.8,     // personal space
        turnSignaled: false,
        brakeLight: false,
        accel: 0,
        lastBrake: 0,
        idleTime: Math.random() * 2,
        laneGoal: 0,
        laneSignal: 0,
        laneCooldown: 3 + Math.random() * 8,
        wanderPhase: Math.random() * Math.PI * 2,
        prevSpeed: 0,
      };
      this.cars.push(car);
    }
  }

  private lanePos(l: RLink, fromA: boolean, t: number, lane: number) {
    const dx = fromA ? l.dx : -l.dx;
    const dz = fromA ? l.dz : -l.dz;
    const sx = fromA ? l.ax : l.bx;
    const sz = fromA ? l.az : l.bz;
    const off = laneOffset(l, lane);
    this.tmp.x = sx + dx * t + -dz * off;
    this.tmp.z = sz + dz * t + dx * off;
    this.tmp.dx = dx; this.tmp.dz = dz;
    return this.tmp;
  }

  private chooseNext(car: AiCar) {
    const l = car.link;
    const endId = car.fromA ? l.b : l.a;
    const node = this.net.nodes[endId];
    const options = node.links.filter((id) => id !== l.id);
    let pick: RLink;
    if (options.length === 0) pick = l;
    else {
      // prefer straight-ish
      const weights: { link: RLink; w: number }[] = [];
      const fx = car.fromA ? l.dx : -l.dx;
      const fz = car.fromA ? l.dz : -l.dz;
      for (const id of options) {
        const nl = this.net.linkById[id];
        const outA = nl.a === endId;
        const ndx = outA ? nl.dx : -nl.dx;
        const ndz = outA ? nl.dz : -nl.dz;
        const dot = fx * ndx + fz * ndz;
        weights.push({ link: nl, w: dot > 0.7 ? 3.2 : dot > -0.3 ? 1.4 : 0.05 });
      }
      let total = weights.reduce((s, w) => s + w.w, 0);
      let r = Math.random() * total;
      pick = weights[0].link;
      for (const w of weights) { r -= w.w; if (r <= 0) { pick = w.link; break; } }
    }
    car.nextLink = pick;
    car.nextFromA = pick.a === endId;
    const fx = car.fromA ? l.dx : -l.dx;
    const fz = car.fromA ? l.dz : -l.dz;
    const ndx = car.nextFromA ? pick.dx : -pick.dx;
    const ndz = car.nextFromA ? pick.dz : -pick.dz;
    const cross = fx * ndz - fz * ndx;
    const dot = fx * ndx + fz * ndz;
    car.turnDir = dot > 0.7 ? 0 : cross > 0 ? -1 : 1;
  }

  update(
    dt: number, time: number, px: number, pz: number, _pFx: number, _pFz: number,
    pedestrians: { x: number; z: number }[] = [],
  ) {

    for (const car of this.cars) {
      const l = car.link;
      const endId = car.fromA ? l.b : l.a;
      const node = this.net.nodes[endId];
      const R = node.radius;
      if (!car.nextLink) this.chooseNext(car);

      car.idleTime += dt;
      car.laneCooldown = Math.max(0, car.laneCooldown - dt);
      const playerDistanceStart = Math.hypot(car.x - px, car.z - pz);

      // ---- direction vectors ----
      const fx = car.inJunction ? -Math.sin(car.heading) : (car.fromA ? l.dx : -l.dx);
      const fz = car.inJunction ? -Math.cos(car.heading) : (car.fromA ? l.dz : -l.dz);
      const distToNode = car.inJunction ? 999 : l.len - R - car.t;

      // ---- personalized speed limit ----
      const baseLimit = l.speed / 3.6;
      const personalLimit = baseLimit * car.preferredSpeed;
      let target = personalLimit;

      // ---- junction approach with natural behavior ----
      let approachingStop = false;
      let stopDistance = 999;

      if (!car.inJunction && distToNode < 55) {
        const axis = l.axis;
        if (node.kind === 'signal') {
          const st = signalState(node, axis, time);
          if (st === 'red') {
            approachingStop = true;
            stopDistance = distToNode - 2.5;
          } else if (st === 'yellow' && distToNode > 8 && !car.waited) {
            approachingStop = true;
            stopDistance = distToNode - 2.5;
          } else if (st === 'green') {
            car.waited = false;
          }
        } else if (node.kind === 'stop') {
          if (!car.waited) {
            approachingStop = true;
            stopDistance = distToNode - 2.0;
          }
        } else if (node.kind === 'roundabout') {
          if (distToNode < 18) {
            const circulating = this.cars.some((o) => {
              if (o === car) return false;
              const d = Math.hypot(o.x - node.x, o.z - node.z);
              return d < node.radius + 3 && d > node.radius - 12;
            });
            if (circulating && !car.waited) {
              approachingStop = true;
              stopDistance = distToNode - 3;
            }
          }
        }

        if (approachingStop) {
          if (stopDistance > 0) {
            const brakeDist = Math.max(0, stopDistance);
            target = Math.min(target, brakeDist * (0.6 + car.aggressiveness * 0.2));
            if (brakeDist < 3 && car.speed < 0.5) {
              car.stopTimer += dt;
              const requiredStop = node.kind === 'stop' ? 1.8 : node.kind === 'signal' ? 0.8 : 1.2;
              if (car.stopTimer > requiredStop * car.reactionTime) {
                car.waited = true;
              }
            }
          } else target = 0;
        }

        // Signal for turns - start earlier for natural look
        const signalDist = car.turnDir !== 0 ? 38 : 0;
        if (distToNode < signalDist && distToNode > 8) {
          car.turnSignaled = true;
        }
      }

      // Slow for turns
      if (car.turnDir !== 0 && distToNode < 35 && distToNode > -10) {
        target = Math.min(target, 5.5 * car.aggressiveness);
      }

      // ---- look ahead for traffic ----
      let minGap = 999;
      let leadCar: AiCar | null = null;

      // Distant traffic keeps moving and obeying junctions without paying the
      // cost of detailed local awareness every frame.
      if (playerDistanceStart < 230) {
        for (const o of this.cars) {
          if (o === car) continue;
          const rx = o.x - car.x, rz = o.z - car.z;
          const ahead = rx * fx + rz * fz;
          const lat = Math.abs(rx * -fz + rz * fx);

          if (ahead > 0.8 && ahead < 45 && lat < 2.0) {
            if (ahead < minGap) {
              minGap = ahead;
              leadCar = o;
            }
          }
        }
      }

      // Player vehicle
      const prx = px - car.x, prz = pz - car.z;
      const pahead = prx * fx + prz * fz;
      const plat = Math.abs(prx * -fz + prz * fx);
      if (pahead > 1 && pahead < 40 && plat < 2.1 && pahead < minGap) {
        minGap = pahead;
      }

      // Pedestrians are treated as moving hazards rather than scenery.
      if (playerDistanceStart < 180) {
        for (const p of pedestrians) {
          const rx = p.x - car.x, rz = p.z - car.z;
          const ahead = rx * fx + rz * fz;
          const lat = Math.abs(rx * -fz + rz * fx);
          if (ahead > 1 && ahead < 24 && lat < 1.45) {
            minGap = Math.min(minGap, ahead);
            target = Math.min(target, Math.max(0, (ahead - 3.2) * 0.7));
          }
        }
      }

      // Use the second lane only to pass a substantially slower vehicle, then
      // return to the outer lane when there is a safe gap.
      if (!car.inJunction && l.lanes > 1 && distToNode > 65 && car.laneCooldown <= 0) {
        let desiredLane = car.laneGoal;
        if (leadCar && minGap < 24 && leadCar.speed < car.speed * 0.86 && car.laneGoal < l.lanes - 1) {
          desiredLane = car.laneGoal + 1;
        } else if (!leadCar && car.laneGoal > 0 && car.idleTime % 14 < dt * 1.5) {
          desiredLane = car.laneGoal - 1;
        }
        if (desiredLane !== car.laneGoal) {
          const clear = this.cars.every((o) => {
            if (o === car || o.link.id !== l.id || o.fromA !== car.fromA) return true;
            return Math.abs(o.lane - desiredLane) > 0.48 || Math.abs(o.t - car.t) > (o.t > car.t ? 26 : 16);
          });
          if (clear) {
            car.laneSignal = desiredLane > car.laneGoal ? -1 : 1;
            car.laneGoal = desiredLane;
            car.laneCooldown = 7 + car.reactionTime * 4;
          } else car.laneCooldown = 2;
        }
      }
      if (!car.inJunction && car.nextLink && distToNode < 55) {
        car.laneGoal = Math.min(car.laneGoal, car.nextLink.lanes - 1);
      }
      const laneDelta = car.laneGoal - car.lane;
      car.lane += laneDelta * Math.min(1, dt * 0.48);
      if (Math.abs(laneDelta) < 0.04) car.laneSignal = 0;

      // ---- adaptive following ----
      if (minGap < 55 && leadCar) {
        const timeGap = car.followingDist * car.reactionTime;
        const safeDist = Math.max(4, car.speed * timeGap + 2.5);

        if (minGap < safeDist * 1.3) {
          // Adjust target based on gap and closing speed
          const urgency = (safeDist - minGap) / safeDist;
          const brakeIntensity = car.aggressiveness * (0.7 + urgency);
          target = Math.min(target, leadCar.speed * 0.95, Math.max(0, (minGap - 3) * brakeIntensity));
        }

        // Emergency braking
        if (minGap < 6 && car.speed > 3) {
          target = Math.max(0, target - (6 - minGap) * 2.5);
        }
      } else if (minGap < 55 && minGap > 0) {
        // Gap without clear lead car (e.g., player)
        const safeDist = Math.max(4, car.speed * car.followingDist + 2);
        if (minGap < safeDist) {
          target = Math.min(target, Math.max(0, (minGap - 2.5) * 1.2));
        }
      }

      // ---- smooth acceleration/braking ----
      const accelRate = 2.8 * car.aggressiveness;
      const brakeRate = 5.5 / car.aggressiveness;
      const speedDiff = target - car.speed;
      let desiredAccel = 0;
      if (speedDiff > 0.05) desiredAccel = Math.min(accelRate, speedDiff * 1.4);
      else if (speedDiff < -0.05) desiredAccel = Math.max(-brakeRate, speedDiff * 1.7);
      // Jerk limiting gives the car visible weight instead of instant changes.
      const response = desiredAccel < car.accel ? 3.8 : 2.1;
      car.accel += (desiredAccel - car.accel) * Math.min(1, dt * response);
      car.prevSpeed = car.speed;
      car.speed += car.accel * dt;
      car.speed = Math.max(0, Math.min(personalLimit * 1.1, car.speed));

      // Natural idle creep when stopped at light
      if (approachingStop && car.speed < 0.3 && car.stopTimer > 0.5) {
        car.speed = 0;
      }

      // ---- integrate position ----
      car.t += car.speed * dt;

      // ---- junction traversal ----
      if (!car.inJunction && car.t > l.len - R) {
        car.inJunction = true;
        car.junctionStart = l.len - R;
        const nextR = node.radius;
        car.junctionLen = R + nextR + (car.turnDir !== 0 ? 4 : 0);
      }

      if (car.inJunction) {
        const nl = car.nextLink!;
        const u = Math.min(1, (car.t - car.junctionStart) / car.junctionLen);
        const p0 = this.lanePos(l, car.fromA, l.len - R, car.lane);
        const nR = this.net.nodes[endId].radius;
        const p2 = this.lanePos(nl, car.nextFromA, nR, car.lane);
        const cx = node.x, cz = node.z;
        const iu = 1 - u;
        car.x = iu * iu * p0.x + 2 * iu * u * cx + u * u * p2.x;
        car.z = iu * iu * p0.z + 2 * iu * u * cz + u * u * p2.z;
        const dxu = 2 * iu * (cx - p0.x) + 2 * u * (p2.x - cx);
        const dzu = 2 * iu * (cz - p0.z) + 2 * u * (p2.z - cz);
        car.heading = headingFrom(dxu / (Math.hypot(dxu, dzu) || 1), dzu / (Math.hypot(dxu, dzu) || 1));

        if (u >= 1) {
          car.link = nl;
          car.fromA = car.nextFromA;
          car.t = nR;
          car.laneGoal = Math.min(car.laneGoal, nl.lanes - 1);
          car.lane = Math.min(car.lane, nl.lanes - 1);
          car.inJunction = false;
          car.nextLink = null;
          car.waited = false;
          car.stopTimer = 0;
          car.turnDir = 0;
          car.turnSignaled = false;
        }
      } else {
        const naturalLane = car.lane + Math.sin(time * 0.31 + car.wanderPhase) * 0.018;
        const p = this.lanePos(l, car.fromA, car.t, naturalLane);
        car.x = p.x;
        car.z = p.z;
        car.heading = headingFrom(p.dx, p.dz);
      }

      // ---- respawn distant cars ----
      const dp = Math.hypot(car.x - px, car.z - pz);
      if (dp > 380) {
        const candidates = this.net.links.filter((li) => {
          const d = Math.hypot((li.ax + li.bx) / 2 - px, (li.az + li.bz) / 2 - pz);
          return d > 80 && d < 220;
        });
        if (candidates.length) {
          const nl = candidates[Math.floor(Math.random() * candidates.length)];
          car.link = nl;
          car.fromA = Math.random() < 0.5;
          car.t = 8 + Math.random() * Math.max(10, nl.len - 16);
          car.inJunction = false;
          car.nextLink = null;
          car.speed = nl.speed / 5;
          car.waited = false;
          car.stopTimer = 0;
          car.lane = 0;
          car.laneGoal = 0;
          car.laneSignal = 0;
        }
      }

      // ---- visuals ----
      car.group.position.set(car.x, 0, car.z);
      const bodyPitch = THREE.MathUtils.clamp(-car.accel * 0.012, -0.035, 0.048);
      const turnRoll = car.inJunction ? THREE.MathUtils.clamp(car.turnDir * car.speed * 0.0035, -0.035, 0.035) : 0;
      car.group.rotation.set(bodyPitch, car.heading, turnRoll, 'YXZ');
      const visible = dp < 280;
      car.group.visible = visible;

      if (!visible) continue;

      // Brake lights with memory for natural fade
      const isBraking = car.accel < -0.8 || car.speed < 0.8 || (target < car.speed - 1.2);
      car.lastBrake += dt;
      if (isBraking) car.lastBrake = 0;
      const brakeGlow = isBraking || car.lastBrake < 0.15;
      car.brakeMat.color.setHex(brakeGlow ? 0xff3a2a : 0x5a1410);
      car.brakeLight = brakeGlow;

      // Turn signals
      const signalBlink = Math.floor(time * 1.8) % 2 === 0;
      const showLeft = (car.turnSignaled && car.turnDir === -1) || car.laneSignal === -1;
      const showRight = (car.turnSignaled && car.turnDir === 1) || car.laneSignal === 1;
      car.indL.color.setHex(showLeft && signalBlink ? 0xffb13a : 0x3a2a10);
      car.indR.color.setHex(showRight && signalBlink ? 0xffb13a : 0x3a2a10);

      // Wheel rotation
      if (dp < 90 && car.speed > 0.1) {
        const rot = (car.speed * dt) / 0.33;
        for (const w of car.wheels) w.rotation.x += rot;
      }

      // Subtle body movement
      if (dp < 70) {
        const bounce = Math.sin(time * 12 + car.idleTime) * car.speed * 0.0008;
        car.group.position.y = bounce;
      }
    }
  }

  /** nearest AI car in front of the player within `range` metres */
  carAhead(px: number, pz: number, fx: number, fz: number, range: number) {
    let best = range;
    for (const o of this.cars) {
      const rx = o.x - px, rz = o.z - pz;
      const ahead = rx * fx + rz * fz;
      if (ahead < 0 || ahead > range) continue;
      const lat = Math.abs(rx * -fz + rz * fx);
      if (lat > 2.2) continue;
      best = Math.min(best, ahead);
    }
    return best;
  }
}

export { otherEnd };
