import * as THREE from 'three';
import { buildNetwork, signalState, Network, RNode } from './network';
import { buildWorld, nearestLink, WorldRefs, ParkingBay } from './world';
import { buildInterior, InteriorRefs } from './interior';
import { Cluster, InfoScreen } from './gauges';
import { Traffic } from './traffic';
import { Vehicle } from './vehicle';
import { LESSONS, LessonCtx, NodeInfo } from './lessons';
import { Controls, defaultControls, Gear, Infraction, Telemetry, WeatherMode } from './types';

// ---------------------------------------------------------------------------
// audio
// ---------------------------------------------------------------------------
class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private engGain!: GainNode;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private noiseGain!: GainNode;
  private hornGain!: GainNode;
  enabled = true;

  init() {
    if (this.ctx) return;
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(c.destination);

    this.engGain = c.createGain();
    this.engGain.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 620;
    this.engGain.connect(lp);
    lp.connect(this.master);
    this.osc1 = c.createOscillator(); this.osc1.type = 'sawtooth'; this.osc1.frequency.value = 60;
    this.osc2 = c.createOscillator(); this.osc2.type = 'square'; this.osc2.frequency.value = 30;
    const g2 = c.createGain(); g2.gain.value = 0.45;
    this.osc1.connect(this.engGain); this.osc2.connect(g2); g2.connect(this.engGain);
    this.osc1.start(); this.osc2.start();

    // road / wind noise
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.4;
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    this.noiseGain = c.createGain(); this.noiseGain.gain.value = 0;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
    src.connect(bp); bp.connect(this.noiseGain); this.noiseGain.connect(this.master);
    src.start();

    this.hornGain = c.createGain(); this.hornGain.gain.value = 0;
    const h1 = c.createOscillator(); h1.type = 'square'; h1.frequency.value = 415;
    const h2 = c.createOscillator(); h2.type = 'square'; h2.frequency.value = 494;
    h1.connect(this.hornGain); h2.connect(this.hornGain);
    this.hornGain.connect(this.master);
    h1.start(); h2.start();
  }

  resume() { this.ctx?.resume(); }

  engine(on: boolean, rpm: number, load: number, speed: number) {
    if (!this.ctx || !this.enabled) return;
    const f = Math.max(24, (rpm / 60) * 2.6);
    this.osc1.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.06);
    this.osc2.frequency.setTargetAtTime(f * 0.5, this.ctx.currentTime, 0.06);
    this.engGain.gain.setTargetAtTime(on ? 0.055 + load * 0.075 : 0, this.ctx.currentTime, 0.12);
    this.noiseGain.gain.setTargetAtTime(Math.min(0.14, speed * 0.0035), this.ctx.currentTime, 0.2);
  }

  horn(on: boolean) {
    if (!this.ctx || !this.enabled) return;
    this.hornGain.gain.setTargetAtTime(on ? 0.16 : 0, this.ctx.currentTime, 0.02);
  }

  blip(freq = 1500, dur = 0.045, vol = 0.09) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const g = c.createGain(); g.gain.value = vol;
    o.connect(g); g.connect(this.master);
    const t = c.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  }
}

// ---------------------------------------------------------------------------

const PENALTY: Record<string, { p: number; title: string; detail: string }> = {
  redlight: { p: 15, title: 'Ran a red light', detail: 'You crossed the stop line while the signal was red. Always stop behind the line and wait for green.' },
  stopsign: { p: 12, title: 'Stop sign not observed', detail: 'A STOP sign requires the vehicle to come to a complete standstill behind the line, even if the road looks clear.' },
  speeding: { p: 8, title: 'Exceeding the speed limit', detail: 'Match your speed to the posted limit — check the round red-bordered signs at the roadside.' },
  wronglane: { p: 10, title: 'Wrong side of the road', detail: 'You drifted across the centre line. Keep to the right-hand lane at all times.' },
  offroad: { p: 10, title: 'Left the carriageway', detail: 'You mounted the kerb / left the road surface. Steer smaller corrections and look further ahead.' },
  hardbrake: { p: 5, title: 'Harsh braking', detail: 'Braking that hard is uncomfortable and unsafe. Read the road early and brake progressively.' },
  collision: { p: 25, title: 'Collision', detail: 'You made contact with another vehicle. Keep a two-second gap and check mirrors before moving.' },
  nosignal: { p: 6, title: 'Turned without signalling', detail: 'Indicate at least three seconds before turning so other road users can read your intention.' },
  handbrake: { p: 4, title: 'Driving with the handbrake on', detail: 'Release the parking brake fully before pulling away.' },
  parking: { p: 6, title: 'Inaccurate parking', detail: 'The car finished outside the bay markings. Straighten earlier and use your mirrors.' },
};

export interface SimCallbacks {
  onTelemetry: (t: Telemetry) => void;
}

export class Sim {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  net: Network;
  world: WorldRefs;
  interior: InteriorRefs;
  traffic: Traffic;
  car = new Vehicle();
  controls: Controls = defaultControls();
  cluster = new Cluster();
  info: InfoScreen;
  sound = new Sound();
  // Set directly by the touch wheel so the rendered wheel exactly matches the
  // driver's hands instead of being inferred from the front-wheel angle.
  steeringWheelAngle = 0;

  private carGroup = new THREE.Group();
  private clock = new THREE.Clock();
  private raf = 0;
  private time = 0;
  private telemetryTimer = 0;
  private clusterAcc = 0;
  private infoAcc = 0;
  private mirrorIdx = 0;
  private mirrorAcc = 0;
  private mirrorCams: THREE.PerspectiveCamera[] = [];
  private mirrorTargets: THREE.WebGLRenderTarget[] = [];
  private waypoint: THREE.Group;
  private bayMarker: THREE.Mesh;
  private headlightGlow: THREE.Mesh;
  private hazardTick = 0;
  private lastBlink = false;

  // state
  score = 100;
  infractions: Infraction[] = [];
  lessonIndex = 0;
  private lessonData: Record<string, number> = {};
  private toastMsg: string | null = null;
  private toastKind: 'good' | 'bad' | 'info' = 'info';
  private toastTime = 0;
  private target: { x: number; z: number; label: string } | null = null;
  private parkBay: ParkingBay | null = null;
  private cooldown: Record<string, number> = {};
  private approach: { id: string; kind: 'signal' | 'stop'; minKmh: number; wasRed: boolean; signalled: boolean; heading: number } | null = null;
  private wrongLaneTime = 0;
  private offRoadTime = 0;
  private speedTime = 0;
  private handbrakeTime = 0;
  private laneStatus: 'ok' | 'wrong' | 'offroad' | 'center' = 'ok';
  private speedLimit = 30;
  private aheadSignal: NodeInfo | null = null;
  private aheadStop: NodeInfo | null = null;
  private lightAhead: 'green' | 'yellow' | 'red' | null = null;
  private lightDistance = 0;
  private completed = false;
  private finalReport: string[] | null = null;
  private lessonEntered = -1;
  private dusk = false;
  private weather: WeatherMode = 'clear';
  private cb: SimCallbacks;
  private paused = false;
  private camShake = 0;
  private lastHorn = false;
  private lastBrakeAt = -99;

  constructor(canvas: HTMLCanvasElement, cb: SimCallbacks) {
    this.cb = cb;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 1.6, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr > 1.9 ? 1.5 : dpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene.fog = new THREE.Fog(0xc6d6e4, 130, 640);
    this.camera = new THREE.PerspectiveCamera(64, 1, 0.06, 1200);

    this.net = buildNetwork();
    this.world = buildWorld(this.scene, this.net);
    this.info = new InfoScreen(this.net);
    this.interior = buildInterior(this.cluster, this.info);

    this.carGroup.add(this.interior.group);
    this.carGroup.add(this.camera);
    this.scene.add(this.carGroup);

    this.traffic = new Traffic(this.scene, this.net, window.innerWidth < 1000 ? 18 : 22);

    // mirrors
    const sizes: [number, number][] = [[512, 140], [256, 160], [256, 160]];
    const fovs = [17, 26, 26];
    const mirrors = [this.interior.mirrors.rear, this.interior.mirrors.left, this.interior.mirrors.right];
    mirrors.forEach((m, i) => {
      const rt = new THREE.WebGLRenderTarget(sizes[i][0], sizes[i][1], { depthBuffer: true });
      rt.texture.wrapS = THREE.RepeatWrapping;
      rt.texture.repeat.x = -1;
      rt.texture.offset.x = 1;
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      this.mirrorTargets.push(rt);
      const cam = new THREE.PerspectiveCamera(fovs[i], sizes[i][0] / sizes[i][1], 0.4, 1150);
      this.mirrorCams.push(cam);
      m.material.map = rt.texture;
      m.material.color.setHex(0xffffff);
      m.material.needsUpdate = true;
    });

    // waypoint marker
    this.waypoint = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x3ee08a, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.16, 6, 28), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    this.waypoint.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 2.2, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x3ee08a, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    beam.position.y = 13;
    this.waypoint.add(beam);
    this.waypoint.visible = false;
    this.scene.add(this.waypoint);

    // parking bay highlight
    this.bayMarker = new THREE.Mesh(
      new THREE.PlaneGeometry(2.7, 5.2),
      new THREE.MeshBasicMaterial({ color: 0x36d98a, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false }),
    );
    this.bayMarker.rotation.x = -Math.PI / 2;
    this.bayMarker.position.y = 0.03;
    this.bayMarker.visible = false;
    this.scene.add(this.bayMarker);

    // headlight pool of light on the road
    this.headlightGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 26),
      new THREE.MeshBasicMaterial({ color: 0xfff0cf, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.headlightGlow.rotation.x = -Math.PI / 2;
    this.headlightGlow.position.set(0, 0.04, -14);
    this.headlightGlow.visible = false;
    this.carGroup.add(this.headlightGlow);

    this.resetRun();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.clock.start();
    this.raf = requestAnimationFrame(this.loop);
  }

  // -------------------------------------------------------------------------
  resetRun() {
    this.car.place(-100, 191.35, -Math.PI / 2);
    this.controls = defaultControls();
    this.score = 100;
    this.infractions = [];
    this.lessonIndex = 0;
    this.lessonData = {};
    this.lessonEntered = -1;
    this.completed = false;
    this.finalReport = null;
    this.target = null;
    this.parkBay = null;
    this.time = 0;
    this.steeringWheelAngle = 0;
  }

  resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // widen the FOV a little on tall phone screens so the cockpit reads well
    this.camera.fov = w / h < 0.75 ? 74 : w / h < 1.2 ? 68 : 62;
    this.camera.updateProjectionMatrix();
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
    this.mirrorTargets.forEach((t) => t.dispose());
  }

  setPaused(p: boolean) { this.paused = p; }

  setDusk(d: boolean) {
    this.dusk = d;
    this.weather = d ? 'sunset' : 'clear';
    this.world.setWeather(this.weather);
    if (d && this.controls.headlights === 0) this.toast('It is getting dark — switch your headlights on.', 'info');
  }

  setWeather(mode: WeatherMode) {
    this.weather = mode;
    this.dusk = mode === 'sunset';
    this.world.setWeather(mode);
    if ((mode === 'rain' || mode === 'sunset') && this.controls.headlights === 0) {
      this.toast('Low visibility: switch on the dipped headlights.', 'info');
    }
    if (mode === 'rain' && !this.controls.wipers) this.toast('Rain started: switch on the wipers.', 'info');
  }

  cycleWeather() {
    const modes: WeatherMode[] = ['clear', 'cloudy', 'rain', 'sunset'];
    this.setWeather(modes[(modes.indexOf(this.weather) + 1) % modes.length]);
  }

  // ---- player actions -------------------------------------------------------
  startEngine() {
    this.sound.init();
    this.sound.resume();
    if (this.controls.engineOn) { this.controls.engineOn = false; this.toast('Engine off', 'info'); return; }
    if (this.controls.gear !== 'P' && this.controls.gear !== 'N') {
      this.toast('Select P before starting.', 'bad');
      return;
    }
    if (!this.brakeOk) {
      this.toast('Press and hold the brake pedal, then press START.', 'bad');
      return;
    }
    this.controls.engineOn = true;
    this.sound.blip(880, 0.12, 0.05);
    this.toast('Engine started', 'good');
  }

  private get brakeOk() {
    return this.controls.brake > 0.12 || this.time - this.lastBrakeAt < 1.6;
  }

  requestGear(g: Gear) {
    const r = this.car.gearAllowed(g, this.controls, this.brakeOk);
    if (!r.ok) { this.toast(r.reason!, 'bad'); this.sound.blip(220, 0.09, 0.05); return; }
    if (this.controls.gear === g) return;
    this.controls.gear = g;
    this.sound.blip(660, 0.05, 0.04);
    if (g !== 'P' && this.controls.handbrake && g !== 'N') {
      this.toast('Remember to release the handbrake.', 'info');
    }
  }

  toggleHandbrake() {
    this.controls.handbrake = !this.controls.handbrake;
    this.sound.blip(this.controls.handbrake ? 420 : 620, 0.07, 0.05);
  }

  indicate(dir: 'left' | 'right' | 'off') {
    if (dir === 'off') { this.controls.indicatorLeft = false; this.controls.indicatorRight = false; return; }
    if (dir === 'left') {
      this.controls.indicatorLeft = !this.controls.indicatorLeft;
      if (this.controls.indicatorLeft) this.controls.indicatorRight = false;
    } else {
      this.controls.indicatorRight = !this.controls.indicatorRight;
      if (this.controls.indicatorRight) this.controls.indicatorLeft = false;
    }
  }

  cycleHeadlights() {
    this.controls.headlights = ((this.controls.headlights + 1) % 3) as 0 | 1 | 2;
    this.sound.blip(520, 0.05, 0.035);
  }

  toggleHazards() { this.controls.hazards = !this.controls.hazards; }
  setHorn(on: boolean) { this.controls.horn = on; }
  toggleWipers() { this.controls.wipers = !this.controls.wipers; }

  skipLesson() {
    if (this.lessonIndex < LESSONS.length - 1) {
      this.lessonIndex++;
      this.lessonData = {};
      this.lessonEntered = -1;
      this.toast('Lesson skipped', 'info');
    }
  }

  toast(msg: string, kind: 'good' | 'bad' | 'info' = 'info') {
    this.toastMsg = msg;
    this.toastKind = kind;
    this.toastTime = 4.2;
  }

  private penalise(key: string, extra?: string) {
    if ((this.cooldown[key] ?? 0) > 0) return;
    const p = PENALTY[key];
    this.cooldown[key] = key === 'collision' ? 3 : key === 'hardbrake' ? 6 : 9;
    this.score = Math.max(0, this.score - p.p);
    this.infractions.unshift({
      id: key + this.time.toFixed(1),
      time: this.time,
      title: p.title,
      detail: extra ? `${p.detail} ${extra}` : p.detail,
      penalty: p.p,
    });
    if (this.infractions.length > 12) this.infractions.pop();
    this.toast(`${p.title} −${p.p}`, 'bad');
    this.sound.blip(180, 0.18, 0.07);
  }

  // ---- per-frame road awareness ---------------------------------------------
  private evaluateRoad(dt: number) {
    const car = this.car;
    const nl = nearestLink(this.net, car.x, car.z);
    let onJunction = false;
    let nearestNodeDist = 999;
    let nearestNode: RNode | null = null;
    for (const n of this.net.nodeList) {
      const d = Math.hypot(n.x - car.x, n.z - car.z);
      if (d < nearestNodeDist) { nearestNodeDist = d; nearestNode = n; }
      if (d < n.radius + 2.5) onJunction = true;
    }
    const inLot = car.x > 172 && car.x < 228 && car.z > -20 && car.z < 102;
    const onRoundabout = nearestNode?.kind === 'roundabout' && nearestNodeDist < 21;

    const endless = this.world.isEndlessRoad(car.x, car.z);
    if (endless && car.z < -285) {
      this.speedLimit = endless.speed;
      this.laneStatus = endless.onRoad ? 'ok' : 'offroad';
    } else if (nl) {
      this.speedLimit = nl.link.speed;
      const fwdDot = car.forwardX * nl.link.dx + car.forwardZ * nl.link.dz;
      const latTravel = fwdDot >= 0 ? nl.lat : -nl.lat;
      const half = nl.link.half;
      if (nl.dist > half + 1.6 && !onJunction && !inLot && !onRoundabout) this.laneStatus = 'offroad';
      else if (latTravel < -0.45 && !onJunction && !inLot && !onRoundabout && nl.link.kind !== 'lot') this.laneStatus = 'wrong';
      else if (Math.abs(latTravel) < 0.35 && !onJunction) this.laneStatus = 'center';
      else this.laneStatus = 'ok';
    }
    if (inLot) this.speedLimit = 20;

    const moving = car.kmh > 6;
    if (this.laneStatus === 'wrong' && moving) {
      this.wrongLaneTime += dt;
      if (this.wrongLaneTime > 2.2) { this.penalise('wronglane'); this.wrongLaneTime = 0; }
    } else this.wrongLaneTime = Math.max(0, this.wrongLaneTime - dt);

    if (this.laneStatus === 'offroad' && moving) {
      this.offRoadTime += dt;
      if (this.offRoadTime > 1.4) { this.penalise('offroad'); this.offRoadTime = 0; }
    } else this.offRoadTime = Math.max(0, this.offRoadTime - dt);

    if (car.kmh > this.speedLimit + 9) {
      this.speedTime += dt;
      if (this.speedTime > 1.6) {
        this.penalise('speeding', `Limit here is ${this.speedLimit} km/h.`);
        this.speedTime = 0;
      }
    } else this.speedTime = Math.max(0, this.speedTime - dt * 0.6);

    if (this.controls.handbrake && car.kmh > 8) {
      this.handbrakeTime += dt;
      if (this.handbrakeTime > 1.5) { this.penalise('handbrake'); this.handbrakeTime = 0; }
    } else this.handbrakeTime = 0;

    if (car.accelLong < -6.8 && car.kmh > 12) this.penalise('hardbrake');

    // ---- junction ahead -------------------------------------------------
    this.aheadSignal = null;
    this.aheadStop = null;
    let bestAhead = 1e9;
    let bestNode: RNode | null = null;
    for (const n of this.net.nodeList) {
      if (n.kind !== 'signal' && n.kind !== 'stop') continue;
      const rx = n.x - car.x, rz = n.z - car.z;
      const ahead = rx * car.forwardX + rz * car.forwardZ;
      const lat = Math.abs(rx * car.rightX + rz * car.rightZ);
      if (ahead < -14 || ahead > 130 || lat > 9) continue;
      if (ahead < bestAhead) { bestAhead = ahead; bestNode = n; }
    }
    const axis: 'ns' | 'ew' = Math.abs(car.forwardX) > Math.abs(car.forwardZ) ? 'ew' : 'ns';
    this.lightAhead = null;
    if (bestNode) {
      const stopLine = bestNode.radius + 4.3;
      const dist = bestAhead - stopLine;
      const info: NodeInfo = {
        node: bestNode,
        dist,
        state: bestNode.kind === 'signal' ? signalState(bestNode, axis, this.time) : null,
        turn: 0,
      };
      if (bestNode.kind === 'signal') { this.aheadSignal = info; this.lightAhead = info.state; this.lightDistance = dist; }
      else this.aheadStop = info;

      // approach tracking for violations
      if (dist < 45 && dist > -2) {
        if (!this.approach || this.approach.id !== bestNode.id) {
          this.approach = { id: bestNode.id, kind: bestNode.kind as 'signal' | 'stop', minKmh: 99, wasRed: false, signalled: false, heading: car.heading };
        }
        if (dist < 12) this.approach.minKmh = Math.min(this.approach.minKmh, car.kmh);
        if (dist < 6 && info.state === 'red') this.approach.wasRed = true;
        if (this.controls.indicatorLeft || this.controls.indicatorRight) this.approach.signalled = true;
      } else if (this.approach && this.approach.id === bestNode.id && dist <= -2) {
        this.judgeApproach(bestNode);
      }
    } else if (this.approach) {
      const n = this.net.nodes[this.approach.id];
      const rx = n.x - car.x, rz = n.z - car.z;
      const ahead = rx * car.forwardX + rz * car.forwardZ;
      if (ahead < -3) this.judgeApproach(n);
    }

    return { nearestNodeDist };
  }

  private judgeApproach(node: RNode) {
    const a = this.approach;
    this.approach = null;
    if (!a || a.id !== node.id) return;
    if (a.kind === 'signal' && a.wasRed && a.minKmh > 4) this.penalise('redlight');
    if (a.kind === 'stop' && a.minKmh > 1.6) this.penalise('stopsign', `You slowed to ${a.minKmh.toFixed(0)} km/h but never stopped.`);
    // signalling on turns
    let dh = this.car.heading - a.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    if (Math.abs(dh) > 0.9 && !a.signalled) this.penalise('nosignal');
  }

  private checkCollisions() {
    const car = this.car;
    const fx = car.forwardX, fz = car.forwardZ;
    for (const o of this.traffic.cars) {
      const dx = o.x - car.x, dz = o.z - car.z;
      if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
      const ofx = -Math.sin(o.heading), ofz = -Math.cos(o.heading);
      for (const a of [-1.15, 1.15]) {
        for (const b of [-1.15, 1.15]) {
          const px = car.x + fx * a, pz = car.z + fz * a;
          const qx = o.x + ofx * b, qz = o.z + ofz * b;
          const d = Math.hypot(qx - px, qz - pz);
          if (d < 2.0) {
            const nx = (px - qx) / (d || 1), nz = (pz - qz) / (d || 1);
            car.x += nx * (2.0 - d) * 0.9;
            car.z += nz * (2.0 - d) * 0.9;
            car.speed *= 0.25;
            o.speed *= 0.3;
            car.jolt = 1;
            this.camShake = 0.6;
            this.penalise('collision');
            return;
          }
        }
      }
    }
  }

  // ---- lessons ---------------------------------------------------------------
  private lessonCtx(dt: number, nearestNodeDist: number): LessonCtx {
    const car = this.car;
    return {
      car,
      controls: this.controls,
      time: this.time,
      dt,
      kmh: car.kmh,
      lane: this.laneStatus,
      aheadSignal: this.aheadSignal,
      aheadStop: this.aheadStop,
      nearestNodeDist,
      bays: this.world.bays,
      data: this.lessonData,
      setTarget: (x, z, label) => {
        if (x === null) this.target = null;
        else this.target = { x, z: z!, label: label ?? 'Target' };
      },
      targetDist: this.target ? Math.hypot(this.target.x - car.x, this.target.z - car.z) : 0,
      toast: (m, k) => this.toast(m, k),
      distanceFrom: (x, z) => Math.hypot(x - car.x, z - car.z),
      headingDelta: (h) => {
        let d = car.heading - h;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return d;
      },
      nearest: (kind) => {
        let best: RNode | null = null;
        let bd = 1e9;
        for (const n of this.net.nodeList) {
          if (n.kind !== kind) continue;
          const d = Math.hypot(n.x - car.x, n.z - car.z);
          if (d < bd) { bd = d; best = n; }
        }
        return best ? { x: best.x, z: best.z } : null;
      },
      parkBay: this.parkBay,
      setParkBay: (b) => { this.parkBay = b; },
      violationsThisLesson: 0,
      reset: () => { this.lessonData = {}; },
    };
  }

  private updateLesson(dt: number, nearestNodeDist: number) {
    if (this.completed) return;
    const lesson = LESSONS[this.lessonIndex];
    const ctx = this.lessonCtx(dt, nearestNodeDist);
    if (this.lessonEntered !== this.lessonIndex) {
      this.lessonEntered = this.lessonIndex;
      this.lessonData = {};
      ctx.data = this.lessonData;
      lesson.enter?.(ctx);
    }
    if (lesson.update(ctx)) {
      this.toast(lesson.successMsg, 'good');
      this.sound.blip(1180, 0.1, 0.06);
      this.score = Math.min(100, this.score + 2);
      if (this.lessonIndex >= LESSONS.length - 1) {
        this.completed = true;
        this.finalReport = this.buildReport();
      } else {
        this.lessonIndex++;
        this.lessonEntered = -1;
        this.target = null;
      }
    }
  }

  private buildReport(): string[] {
    const r: string[] = [];
    const counts: Record<string, number> = {};
    for (const i of this.infractions) counts[i.title] = (counts[i.title] ?? 0) + 1;
    r.push(this.score >= 80 ? 'PASS — you drove to test standard.' : this.score >= 60 ? 'BORDERLINE — a few serious faults.' : 'FAIL — repeat the course.');
    r.push(`Final score: ${Math.round(this.score)} / 100`);
    r.push(`Distance driven: ${this.car.odometer.toFixed(2)} km`);
    if (Object.keys(counts).length === 0) r.push('No faults recorded. Exemplary drive.');
    else for (const k of Object.keys(counts)) r.push(`${k} × ${counts[k]}`);
    return r;
  }

  // ---- animation --------------------------------------------------------------
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    let dt = this.clock.getDelta();
    if (dt > 0.1) dt = 0.1;
    if (this.paused) { this.renderer.render(this.scene, this.camera); return; }
    this.time += dt;
    // A complete drive naturally evolves from clear daylight through weather
    // and into dusk; manual weather controls remain available for testing.
    if (this.time > 315 && this.weather !== 'sunset') this.setWeather('sunset');
    else if (this.time > 205 && this.weather !== 'rain') this.setWeather('rain');
    else if (this.time > 115 && this.weather === 'clear') this.setWeather('cloudy');
    for (const k of Object.keys(this.cooldown)) this.cooldown[k] = Math.max(0, this.cooldown[k] - dt);
    if (this.toastTime > 0) { this.toastTime -= dt; if (this.toastTime <= 0) this.toastMsg = null; }

    const c = this.controls;
    const car = this.car;
    if (c.brake > 0.12) this.lastBrakeAt = this.time;
    car.step(c, dt);

    const { nearestNodeDist } = this.evaluateRoad(dt);
    this.checkCollisions();
    this.updateLesson(dt, nearestNodeDist);

    this.world.updateEnvironment(this.time, car.x, car.z, dt);
    this.traffic.update(dt, this.time, car.x, car.z, car.forwardX, car.forwardZ, this.world.pedestrians);
    this.world.updateSignals(this.time);

    // ---- car transform -------------------------------------------------------
    this.carGroup.position.set(car.x, 0, car.z);
    this.carGroup.rotation.y = car.heading;

    // ---- interior animation ---------------------------------------------------
    this.interior.wheelSpin.rotation.z = this.steeringWheelAngle;
    const cabinPitch = THREE.MathUtils.clamp(-car.accelLong * 0.0018, -0.01, 0.014);
    const cabinRoll = THREE.MathUtils.clamp(-car.accelLat * 0.0022, -0.014, 0.014);
    this.interior.group.rotation.x += (cabinPitch - this.interior.group.rotation.x) * Math.min(1, dt * 4.5);
    this.interior.group.rotation.z += (cabinRoll - this.interior.group.rotation.z) * Math.min(1, dt * 4.5);
    this.interior.gasPedal.rotation.x = c.throttle * 0.34;
    this.interior.brakePedal.rotation.x = c.brake * 0.3;
    const gearZ = { P: -0.22, R: -0.15, N: -0.08, D: -0.01 }[c.gear];
    this.interior.gearLever.position.z += (gearZ - this.interior.gearLever.position.z) * Math.min(1, dt * 12);
    this.interior.handbrake.rotation.x += ((c.handbrake ? -0.5 : -0.05) - this.interior.handbrake.rotation.x) * Math.min(1, dt * 9);
    const blink = Math.floor(this.time * 1.6) % 2 === 0;
    const anyInd = c.hazards || c.indicatorLeft || c.indicatorRight;
    this.interior.stalk.rotation.z = (c.indicatorLeft ? 0.16 : c.indicatorRight ? -0.16 : 0);
    if (anyInd && blink !== this.lastBlink) { this.sound.blip(blink ? 2100 : 1500, 0.03, 0.035); }
    this.lastBlink = blink;
    this.hazardTick += dt;
    if (c.wipers) {
      this.interior.wipers.rotation.z = Math.abs(Math.sin(this.time * 2.2)) * 1.15;
    } else {
      this.interior.wipers.rotation.z *= Math.max(0, 1 - dt * 6);
    }
    this.interior.gearLightMats.forEach((m, i) => {
      const on = ['P', 'R', 'N', 'D'][i] === c.gear;
      m.color.setHex(on ? (c.gear === 'R' ? 0xff5a4d : c.gear === 'D' ? 0x57e08a : 0xdfe8f0) : 0x2a2f34);
    });
    this.headlightGlow.visible = c.headlights > 0 && (this.dusk || this.weather === 'rain' || this.weather === 'cloudy');
    (this.headlightGlow.material as THREE.MeshBasicMaterial).opacity = c.headlights === 2 ? 0.24 : 0.15;
    this.interior.rainGlassMaterial.opacity = this.weather === 'rain' ? (c.wipers ? 0.16 : 0.38) : 0;

    // ---- gauges ----------------------------------------------------------------
    this.clusterAcc += dt;
    if (this.clusterAcc > 0.055) {
      this.clusterAcc = 0;
      this.cluster.update({
      speed: car.kmh,
      rpm: car.rpm,
      gear: c.gear,
      engineOn: c.engineOn,
      handbrake: c.handbrake,
      left: c.indicatorLeft || c.hazards,
      right: c.indicatorRight || c.hazards,
      headlights: c.headlights,
      fuel: Math.max(0.08, 0.92 - car.odometer * 0.012),
        odo: car.odometer,
        seatbelt: false,
      }, this.time);
    }
    this.infoAcc += dt;
    if (this.infoAcc > 0.22) {
      this.infoAcc = 0;
      this.info.update({
        title: LESSONS[Math.min(this.lessonIndex, LESSONS.length - 1)].title.replace('Lesson ', 'L'),
        step: this.target ? `Follow the route — ${this.target.label} ${Math.round(Math.hypot(this.target.x - car.x, this.target.z - car.z))} m` : LESSONS[this.lessonIndex].step,
        score: this.score,
        px: car.x, pz: car.z, heading: car.heading,
        targetX: this.target ? this.target.x : null,
        targetZ: this.target ? this.target.z : null,
        clock: this.time,
        speedLimit: this.speedLimit,
      });
    }

    // ---- waypoint --------------------------------------------------------------
    if (this.target) {
      this.waypoint.visible = true;
      this.waypoint.position.set(this.target.x, 0, this.target.z);
      this.waypoint.rotation.y = this.time * 0.6;
      const s = 1 + Math.sin(this.time * 3) * 0.06;
      this.waypoint.scale.set(s, 1, s);
    } else this.waypoint.visible = false;
    if (this.parkBay) {
      this.bayMarker.visible = true;
      this.bayMarker.position.set(this.parkBay.x, 0.03, this.parkBay.z);
      this.bayMarker.rotation.z = -this.parkBay.heading;
      (this.bayMarker.material as THREE.MeshBasicMaterial).opacity = 0.22 + Math.sin(this.time * 3) * 0.08;
    } else this.bayMarker.visible = false;

    // ---- camera (natural head movement) ------------------------------------------
    const eye = this.interior.eye;
    const shake = this.camShake > 0 ? this.camShake : 0;
    this.camShake = Math.max(0, this.camShake - dt * 2.5);
    // Engine vibration - subtle
    const idle = c.engineOn ? (0.0006 + (car.rpm / 6600) * 0.0015) : 0;
    const vib = Math.sin(this.time * 38) * idle + Math.sin(this.time * 29.7) * idle * 0.5;
    // Road texture vibration
    const bump = Math.sin(car.odometer * 850) * Math.min(0.004, car.kmh * 0.00008);
    let speedBump = 0;
    for (const b of this.world.speedBumps) {
      const d = Math.hypot(car.x - b.x, car.z - b.z);
      if (d < 1.4) speedBump = Math.max(speedBump, Math.sin((1 - d / 1.4) * Math.PI) * Math.min(0.022, car.kmh * 0.0007));
    }
    // Acceleration/braking body movement - subtle pitch
    const accel = THREE.MathUtils.clamp(car.accelLong, -7, 5);
    // Lateral G-force in turns
    const lat = THREE.MathUtils.clamp(car.accelLat, -6, 6);
    // Speed-based forward lean
    const speedLean = Math.min(0.008, car.speed * 0.00012);
    this.camera.position.set(
      eye.x - lat * 0.0045 + (Math.random() - 0.5) * shake * 0.04,
      eye.y + vib + bump + speedBump - Math.abs(lat) * 0.0015 - accel * 0.0012 + (Math.random() - 0.5) * shake * 0.045,
      eye.z + accel * 0.004 + speedLean,
    );
    // Natural head movement when looking
    const yaw = -c.lookX * 1.2 + lat * 0.003;
    const pitch = -c.lookY * 0.45 + accel * 0.006 + vib * 1.5;
    const roll = -lat * 0.008 - c.steer * 0.0045;
    this.camera.rotation.set(pitch, yaw, roll, 'YXZ');

    // ---- sun follows the car -------------------------------------------------------
    const sunOff = this.dusk ? new THREE.Vector3(-90, 40, -20) : new THREE.Vector3(60, 85, 35);
    this.world.sun.position.set(car.x + sunOff.x, sunOff.y, car.z + sunOff.z);
    this.world.sun.target.position.set(car.x, 0, car.z);
    this.world.sun.target.updateMatrixWorld();
    this.world.sky.position.set(car.x, 0, car.z);

    // ---- audio -----------------------------------------------------------------------
    this.sound.engine(c.engineOn, car.rpm, c.throttle, car.kmh);
    if (c.horn !== this.lastHorn) { this.sound.horn(c.horn); this.lastHorn = c.horn; }

    // ---- mirrors ----------------------------------------------------------------------
    this.mirrorAcc += dt;
    if (this.mirrorAcc > 1 / 30) {
      this.mirrorAcc = 0;
      this.carGroup.updateMatrixWorld(true);
      const mIdx = this.mirrorIdx % 3;
      this.mirrorIdx++;
      const mirrors = [this.interior.mirrors.rear, this.interior.mirrors.left, this.interior.mirrors.right];
      const mref = mirrors[mIdx];
      const mcam = this.mirrorCams[mIdx];
      mref.camPos.getWorldPosition(mcam.position);
      mref.camPos.getWorldQuaternion(mcam.quaternion);
      mcam.rotateY(Math.PI);
      if (mIdx > 0) mcam.position.y -= 0.02;
      this.interior.group.visible = false;
      this.waypoint.visible = false;
      const oldTarget = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.mirrorTargets[mIdx]);
      this.renderer.render(this.scene, mcam);
      this.renderer.setRenderTarget(oldTarget);
      this.interior.group.visible = true;
      if (this.target) this.waypoint.visible = true;
    }

    this.renderer.render(this.scene, this.camera);

    // ---- telemetry -----------------------------------------------------------------------
    this.telemetryTimer += dt;
    if (this.telemetryTimer > 0.1) {
      this.telemetryTimer = 0;
      this.pushTelemetry();
    }
  };

  private pushTelemetry() {
    const car = this.car;
    const lesson = LESSONS[Math.min(this.lessonIndex, LESSONS.length - 1)];
    const ctx = this.lessonCtx(0.0001, 0);
    let bearing = 0, dist = 0;
    if (this.target) {
      const dx = this.target.x - car.x, dz = this.target.z - car.z;
      dist = Math.hypot(dx, dz);
      const fwd = dx * car.forwardX + dz * car.forwardZ;
      const rgt = dx * car.rightX + dz * car.rightZ;
      bearing = Math.atan2(rgt, fwd);
    }
    this.cb.onTelemetry({
      speed: car.kmh,
      rpm: car.rpm,
      gear: this.controls.gear,
      engineOn: this.controls.engineOn,
      handbrake: this.controls.handbrake,
      score: this.score,
      lessonIndex: this.lessonIndex,
      lessonTitle: lesson.title,
      lessonStep: lesson.step,
      lessonHint: lesson.hint,
      lessonProgress: lesson.progress ? Math.max(0, Math.min(1, lesson.progress(ctx))) : 0,
      lessons: LESSONS.length,
      speedLimit: this.speedLimit,
      laneStatus: this.laneStatus,
      distanceToTarget: dist,
      targetBearing: bearing,
      hasTarget: !!this.target,
      infractions: this.infractions,
      toast: this.toastMsg,
      toastKind: this.toastKind,
      lightAhead: this.lightAhead,
      lightDistance: this.lightDistance,
      indicatorLeft: this.controls.indicatorLeft,
      indicatorRight: this.controls.indicatorRight,
      hazards: this.controls.hazards,
      headlights: this.controls.headlights,
      wipers: this.controls.wipers,
      completed: this.completed,
      finalReport: this.finalReport,
      odometer: car.odometer,
      timeOfDay: this.dusk ? 'dusk' : 'day',
      weather: this.weather,
    });
  }
}
