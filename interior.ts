import * as THREE from 'three';
import { Cluster, InfoScreen } from './gauges';

function plastic(color: number, emissiveFactor = 0.34, rough = true) {
  const c = new THREE.Color(color);
  const m = new THREE.MeshLambertMaterial({ color });
  m.emissive = c.clone().multiplyScalar(emissiveFactor);
  if (!rough) m.emissive.multiplyScalar(1.4);
  return m;
}

function leatherMaterial() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#202225';
  c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1800; i++) {
    const v = 24 + Math.random() * 28;
    c.fillStyle = `rgba(${v},${v + 1},${v + 2},${0.18 + Math.random() * 0.3})`;
    c.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1);
  }
  const texture = new THREE.CanvasTexture(cv);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({
    color: 0x303235,
    map: texture,
    bumpMap: texture,
    bumpScale: 0.008,
    roughness: 0.82,
    metalness: 0.02,
  });
}

function box(mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  return m;
}

function strut(mat: THREE.Material, p1: THREE.Vector3, p2: THREE.Vector3, w: number, h: number) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
  m.position.copy(p1).addScaledVector(dir, 0.5);
  m.lookAt(p2);
  return m;
}

function glassTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, 512, 256);

  // Subtle gradient for glass tint
  const baseGrad = c.createLinearGradient(0, 0, 0, 256);
  baseGrad.addColorStop(0, 'rgba(180,200,220,0.08)');
  baseGrad.addColorStop(1, 'rgba(140,160,180,0.12)');
  c.fillStyle = baseGrad;
  c.fillRect(0, 0, 512, 256);

  // Dashboard reflection - softer, more realistic
  const dashRef = c.createLinearGradient(0, 256, 0, 140);
  dashRef.addColorStop(0, 'rgba(200,210,220,0.25)');
  dashRef.addColorStop(0.4, 'rgba(180,195,210,0.08)');
  dashRef.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = dashRef;
  c.fillRect(0, 0, 512, 256);

  // Subtle sun glare - more natural
  const glareGrad = c.createRadialGradient(180, 60, 0, 180, 60, 180);
  glareGrad.addColorStop(0, 'rgba(255,255,255,0.12)');
  glareGrad.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  glareGrad.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = glareGrad;
  c.beginPath();
  c.ellipse(180, 60, 140, 70, -0.25, 0, Math.PI * 2);
  c.fill();

  // Very subtle smudges - barely visible
  for (let i = 0; i < 5; i++) {
    c.strokeStyle = `rgba(200,210,220,${0.03 + Math.random() * 0.04})`;
    c.lineWidth = 6 + Math.random() * 4;
    c.lineCap = 'round';
    c.beginPath();
    const startX = 40 + Math.random() * 400;
    const startY = 80 + Math.random() * 120;
    c.moveTo(startX, startY);
    c.quadraticCurveTo(
      startX + (Math.random() - 0.5) * 120,
      startY + (Math.random() - 0.5) * 40,
      startX + (Math.random() > 0.5 ? 80 : -80),
      startY + (Math.random() - 0.5) * 20
    );
    c.stroke();
  }

  // Top tint band - realistic sun visor effect
  const tintGrad = c.createLinearGradient(0, 0, 0, 55);
  tintGrad.addColorStop(0, 'rgba(45,55,75,0.28)');
  tintGrad.addColorStop(0.6, 'rgba(45,55,75,0.12)');
  tintGrad.addColorStop(1, 'rgba(45,55,75,0)');
  c.fillStyle = tintGrad;
  c.fillRect(0, 0, 512, 55);

  // Faint edge vignette
  const edgeGrad = c.createRadialGradient(256, 128, 100, 256, 128, 320);
  edgeGrad.addColorStop(0, 'rgba(0,0,0,0)');
  edgeGrad.addColorStop(1, 'rgba(0,0,0,0.08)');
  c.fillStyle = edgeGrad;
  c.fillRect(0, 0, 512, 256);

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rainDropTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 256;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * cv.width;
    const y = Math.random() * cv.height;
    const r = 1 + Math.random() * 3.4;
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.62)');
    g.addColorStop(0.45, 'rgba(190,215,235,0.18)');
    g.addColorStop(0.72, 'rgba(25,45,65,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(x, y, r * 0.72, r * (1.1 + Math.random()), 0, 0, Math.PI * 2);
    c.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function gatePlateTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#15181c'; c.fillRect(0, 0, 128, 256);
  c.strokeStyle = '#2b3036'; c.lineWidth = 4; c.strokeRect(2, 2, 124, 252);
  c.fillStyle = '#0b0d10';
  c.beginPath(); c.roundRect(46, 18, 36, 220, 18); c.fill();
  const letters = ['P', 'R', 'N', 'D'];
  c.font = '700 30px ui-sans-serif, Helvetica, Arial';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  letters.forEach((l, i) => {
    c.fillStyle = '#c9d3dc';
    c.fillText(l, 26, 42 + i * 58);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface MirrorRef {
  mesh: THREE.Mesh;
  camPos: THREE.Object3D;
  material: THREE.MeshBasicMaterial;
}

export interface InteriorRefs {
  group: THREE.Group;
  wheelSpin: THREE.Object3D;
  gasPedal: THREE.Object3D;
  brakePedal: THREE.Object3D;
  gearLever: THREE.Object3D;
  handbrake: THREE.Object3D;
  stalk: THREE.Object3D;
  wipers: THREE.Object3D;
  eye: THREE.Vector3;
  mirrors: { rear: MirrorRef; left: MirrorRef; right: MirrorRef };
  gearLightMats: THREE.MeshBasicMaterial[];
  hornPad: THREE.Mesh;
  rainGlassMaterial: THREE.MeshBasicMaterial;
  cluster: Cluster;
  info: InfoScreen;
}

export function buildInterior(cluster: Cluster, info: InfoScreen): InteriorRefs {
  const group = new THREE.Group();

  const dark = plastic(0x24272b);
  const darker = plastic(0x191c1f);
  const leather = plastic(0x2f3237);
  const trim = plastic(0x3a3f45);
  const chrome = new THREE.MeshLambertMaterial({ color: 0xa8b0b8, emissive: 0x3a3f44 });
  const bodyPaint = new THREE.MeshLambertMaterial({ color: 0x9aa3ad, emissive: 0x1c2126 });
  const rubber = plastic(0x141618);

  // ---- bonnet & front body seen through the windshield --------------------
  const hood = box(bodyPaint, 0, 0.92, -1.72, 1.84, 0.07, 1.62);
  hood.rotation.x = -0.03;
  group.add(hood);
  group.add(box(bodyPaint, 0, 0.83, -2.5, 1.8, 0.2, 0.16));
  for (const s of [-1, 1]) {
    const fender = box(bodyPaint, s * 0.86, 0.945, -1.5, 0.14, 0.09, 1.3);
    group.add(fender);
  }
  // cowl / wiper channel
  group.add(box(darker, 0, 0.96, -0.93, 1.8, 0.08, 0.22));

  // wipers
  const wipers = new THREE.Object3D();
  wipers.position.set(0, 1.0, -0.95);
  for (const s of [-1, 1]) {
    const arm = box(rubber, s * 0.36, 0, 0.02, 0.62, 0.022, 0.03);
    arm.rotation.y = s * 0.16;
    wipers.add(arm);
  }
  group.add(wipers);

  // ---- floor, firewall, bulkhead -----------------------------------------
  group.add(box(darker, 0, 0.08, -0.2, 1.74, 0.05, 2.2));
  group.add(box(dark, 0, 0.5, -1.02, 1.8, 0.9, 0.08));

  // ---- dashboard ----------------------------------------------------------
  const dashMain = box(dark, 0, 0.78, -0.72, 1.82, 0.42, 0.44);
  dashMain.receiveShadow = true;
  group.add(dashMain);
  const dashTop = box(darker, 0, 0.99, -0.66, 1.82, 0.06, 0.56);
  dashTop.rotation.x = -0.09;
  dashTop.receiveShadow = true;
  group.add(dashTop);
  group.add(box(trim, 0, 0.66, -0.5, 1.82, 0.05, 0.1)); // trim strip
  group.add(box(dark, 0, 0.44, -0.62, 1.8, 0.28, 0.2)); // lower dash
  // glovebox
  group.add(box(trim, 0.45, 0.66, -0.49, 0.5, 0.24, 0.03));
  // air vents
  for (const vx of [-0.68, -0.08, 0.72]) {
    const v = box(darker, vx, 0.88, -0.487, 0.2, 0.075, 0.03);
    group.add(v);
    for (let i = 0; i < 3; i++) group.add(box(plastic(0x101214), vx, 0.855 + i * 0.024, -0.472, 0.185, 0.008, 0.012));
  }

  // ---- instrument cluster --------------------------------------------------
  const binnacle = box(darker, -0.36, 0.985, -0.62, 0.56, 0.06, 0.34);
  binnacle.rotation.x = -0.22;
  group.add(binnacle);
  const clusterMat = new THREE.MeshBasicMaterial({ map: cluster.texture, toneMapped: false });
  const clusterMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.172), clusterMat);
  clusterMesh.position.set(-0.36, 0.9, -0.47);
  clusterMesh.rotation.x = -0.26;
  group.add(clusterMesh);

  // ---- infotainment --------------------------------------------------------
  const infoMat = new THREE.MeshBasicMaterial({ map: info.texture, toneMapped: false });
  const infoMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15), infoMat);
  infoMesh.position.set(0.3, 0.88, -0.455);
  infoMesh.rotation.set(-0.2, -0.22, 0);
  group.add(infoMesh);
  const infoBezel = box(darker, 0.3, 0.88, -0.472, 0.225, 0.175, 0.02);
  infoBezel.rotation.set(-0.2, -0.22, 0);
  group.add(infoBezel);

  // ---- steering column & wheel --------------------------------------------
  const wheelPivot = new THREE.Object3D();
  wheelPivot.position.set(-0.36, 0.79, -0.31);
  wheelPivot.rotation.x = -0.42;
  group.add(wheelPivot);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.3, 8), darker);
  column.rotation.x = Math.PI / 2 - 0.42;
  column.position.set(-0.36, 0.73, -0.49);
  group.add(column);

  const wheelSpin = new THREE.Object3D();
  wheelPivot.add(wheelSpin);
  const wheelLeather = leatherMaterial();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.218, 0.027, 12, 48), wheelLeather);
  wheelSpin.add(rim);
  // Moulded thumb grips make the wheel read as a physical object at phone size.
  for (const a of [Math.PI * 0.82, Math.PI * 0.18]) {
    const grip = new THREE.Mesh(new THREE.TorusGeometry(0.218, 0.034, 10, 12, 0.82), wheelLeather);
    grip.rotation.z = a;
    wheelSpin.add(grip);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.079, 0.087, 0.055, 20), plastic(0x202326));
  hub.rotation.x = Math.PI / 2;
  wheelSpin.add(hub);
  const hornPad = new THREE.Mesh(new THREE.CircleGeometry(0.072, 24), plastic(0x2b2f34, 0.5));
  hornPad.position.z = 0.031;
  wheelSpin.add(hornPad);
  const badge = new THREE.Mesh(new THREE.RingGeometry(0.017, 0.029, 20), chrome);
  badge.position.z = 0.034;
  wheelSpin.add(badge);
  // Three substantial spokes, with the lower pair forming a modern V shape.
  for (const ang of [Math.PI, 0, -Math.PI * 0.66, -Math.PI * 0.34]) {
    const len = ang === 0 || ang === Math.PI ? 0.15 : 0.12;
    const sp = new THREE.Mesh(new THREE.BoxGeometry(len, 0.043, 0.026), plastic(0x292d31));
    sp.position.set(Math.cos(ang) * (len * 0.52 + 0.052), Math.sin(ang) * (len * 0.52 + 0.052), 0.006);
    sp.rotation.z = ang;
    wheelSpin.add(sp);
  }
  const lowerTrim = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.018, 0.029), chrome);
  lowerTrim.position.set(0, -0.13, 0.008);
  wheelSpin.add(lowerTrim);
  // wheel buttons
  for (const s of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.016, 0.008), plastic(0x35393f, 0.55));
      b.position.set(s * (0.075 + i * 0.035), 0.012 * (i ? -1 : 1) - 0.088 * 0, 0.018);
      wheelSpin.add(b);
    }
  }
  wheelSpin.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  // indicator stalk
  const stalk = new THREE.Object3D();
  stalk.position.set(-0.5, 0.74, -0.5);
  const stalkArm = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.016, 0.19, 7), plastic(0x1b1e21));
  stalkArm.rotation.z = Math.PI / 2;
  stalkArm.position.x = -0.09;
  stalk.add(stalkArm);
  group.add(stalk);
  // light stalk (right side)
  const stalkR = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.016, 0.17, 7), plastic(0x1b1e21));
  stalkR.rotation.z = Math.PI / 2;
  stalkR.position.set(-0.14, 0.74, -0.5);
  group.add(stalkR);

  // ---- centre console ------------------------------------------------------
  group.add(box(dark, 0.03, 0.42, 0.05, 0.36, 0.44, 1.0));
  const gate = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.24), new THREE.MeshBasicMaterial({ map: gatePlateTexture(), toneMapped: false }));
  gate.rotation.x = -Math.PI / 2;
  gate.position.set(0.03, 0.641, -0.12);
  group.add(gate);

  const gearLever = new THREE.Object3D();
  gearLever.position.set(0.055, 0.64, -0.2);
  const gearShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, 0.14, 8), chrome);
  gearShaft.position.y = 0.07;
  gearLever.add(gearShaft);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.043, 12, 9), plastic(0x1a1d20, 0.45));
  knob.scale.set(1, 1.15, 1.25);
  knob.position.y = 0.16;
  gearLever.add(knob);
  group.add(gearLever);

  // PRND indicator lights beside the gate
  const gearLightMats: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.MeshBasicMaterial({ color: 0x2a2f34, toneMapped: false });
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.009, 10), m);
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(0.093, 0.642, -0.215 + i * 0.055);
    group.add(dot);
    gearLightMats.push(m);
  }

  // handbrake
  const handbrake = new THREE.Object3D();
  handbrake.position.set(0.03, 0.6, 0.24);
  const hbArm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.3), plastic(0x202326));
  hbArm.position.z = -0.12;
  handbrake.add(hbArm);
  const hbGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.12, 8), plastic(0x141618, 0.45));
  hbGrip.rotation.x = Math.PI / 2;
  hbGrip.position.z = -0.26;
  handbrake.add(hbGrip);
  group.add(handbrake);

  // cupholders + start button
  group.add(box(darker, 0.03, 0.63, 0.12, 0.2, 0.02, 0.2));
  const startBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.012, 12), plastic(0x6b2a2a, 0.7));
  startBtn.position.set(0.2, 0.72, -0.42);
  startBtn.rotation.x = Math.PI / 2 - 0.2;
  group.add(startBtn);

  // ---- doors ---------------------------------------------------------------
  for (const s of [-1, 1]) {
    const cardX = s * 0.9;
    group.add(box(dark, cardX, 0.62, -0.15, 0.06, 0.6, 1.5));
    group.add(box(leather, cardX - s * 0.045, 0.72, -0.1, 0.03, 0.16, 0.9));
    const armrest = box(trim, cardX - s * 0.07, 0.86, -0.02, 0.1, 0.06, 0.5);
    group.add(armrest);
    group.add(box(darker, cardX, 0.94, -0.15, 0.07, 0.05, 1.5)); // window sill
    // door handle + window switches
    group.add(box(chrome, cardX - s * 0.075, 0.8, -0.3, 0.04, 0.03, 0.14));
    for (let i = 0; i < 2; i++) group.add(box(plastic(0x303439, 0.5), cardX - s * 0.075, 0.892, -0.05 + i * 0.07, 0.05, 0.012, 0.045));
    // B pillar & rear quarter
    group.add(box(dark, cardX, 1.2, 0.72, 0.05, 0.55, 0.14));
  }

  // ---- roof, header, pillars ------------------------------------------------
  const roof = box(plastic(0x3c4046, 0.42), 0, 1.44, 0.3, 1.72, 0.06, 1.7);
  group.add(roof);
  const header = box(dark, 0, 1.42, -0.62, 1.76, 0.1, 0.3);
  header.rotation.x = -0.28;
  group.add(header);
  for (const s of [-1, 1]) {
    const p = strut(dark,
      new THREE.Vector3(s * 0.86, 1.0, -0.9),
      new THREE.Vector3(s * 0.8, 1.44, -0.28), 0.085, 0.11);
    group.add(p);
  }
  // sun visors
  for (const s of [-1, 1]) {
    const v = box(plastic(0x4a4f55, 0.45), s * 0.4, 1.39, -0.52, 0.62, 0.02, 0.22);
    v.rotation.x = -0.36;
    group.add(v);
  }

  // ---- seats ----------------------------------------------------------------
  for (const s of [-1, 1]) {
    const sx = s * 0.36;
    group.add(box(leather, sx, 0.42, 0.42, 0.52, 0.14, 0.56));
    const back = box(leather, sx, 0.78, 0.72, 0.52, 0.66, 0.14);
    back.rotation.x = -0.14;
    group.add(back);
    const head = box(leather, sx, 1.14, 0.78, 0.24, 0.18, 0.11);
    group.add(head);
    group.add(box(darker, sx, 0.33, 0.42, 0.4, 0.06, 0.5));
  }
  // rear bench hint
  group.add(box(leather, 0, 0.45, 1.4, 1.5, 0.16, 0.5));
  group.add(box(leather, 0, 0.85, 1.68, 1.5, 0.6, 0.14));

  // ---- pedals -----------------------------------------------------------------
  const gasPedal = new THREE.Object3D();
  gasPedal.position.set(-0.2, 0.3, -0.9);
  const gasPad = box(plastic(0x2a2d31, 0.5), 0, -0.09, 0.02, 0.07, 0.2, 0.02);
  gasPedal.add(gasPad);
  group.add(gasPedal);

  const brakePedal = new THREE.Object3D();
  brakePedal.position.set(-0.44, 0.34, -0.86);
  const brakePad = box(plastic(0x35393e, 0.5), 0, -0.11, 0.02, 0.11, 0.13, 0.022);
  brakePedal.add(brakePad);
  const brakeArm = box(plastic(0x202326, 0.5), 0, -0.05, 0.01, 0.03, 0.12, 0.02);
  brakePedal.add(brakeArm);
  group.add(brakePedal);
  // dead pedal
  const dead = box(plastic(0x25282c, 0.5), -0.66, 0.2, -0.86, 0.09, 0.2, 0.03);
  dead.rotation.x = 0.35;
  group.add(dead);

  // ---- mirrors -----------------------------------------------------------------
  const mkMirror = (
    pos: THREE.Vector3, w: number, h: number, yaw: number, pitch: number, camYaw: number,
  ): MirrorRef => {
    const housing = box(dark, pos.x, pos.y, pos.z, w + 0.04, h + 0.035, 0.05);
    housing.rotation.y = yaw;
    group.add(housing);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9fb4c4, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.copy(pos);
    mesh.rotation.set(pitch, yaw, 0);
    mesh.translateZ(0.028);
    group.add(mesh);
    const camPos = new THREE.Object3D();
    camPos.position.copy(pos);
    camPos.rotation.set(0, camYaw, 0);
    group.add(camPos);
    return { mesh, camPos, material: mat };
  };

  const rear = mkMirror(new THREE.Vector3(-0.02, 1.315, -0.44), 0.3, 0.082, 0, -0.06, 0);
  // stalk holding the rear-view mirror
  group.add(box(dark, -0.02, 1.375, -0.47, 0.05, 0.09, 0.05));
  const left = mkMirror(new THREE.Vector3(-1.02, 0.96, -0.62), 0.2, 0.12, 0.34, -0.05, -0.34);
  const right = mkMirror(new THREE.Vector3(1.02, 0.96, -0.62), 0.2, 0.12, -0.34, -0.05, 0.34);
  // mirror arms
  for (const s of [-1, 1]) {
    const arm = box(bodyPaint, s * 0.94, 0.96, -0.66, 0.1, 0.06, 0.06);
    group.add(arm);
  }

  // ---- windshield glass ---------------------------------------------------------
  const glassMat = new THREE.MeshBasicMaterial({
    map: glassTexture(), transparent: true, opacity: 0.34, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.78), glassMat);
  glass.position.set(-0.08, 1.2, -0.62);
  glass.rotation.x = 0.62;
  glass.renderOrder = 20;
  group.add(glass);

  const rainGlassMaterial = new THREE.MeshBasicMaterial({
    map: rainDropTexture(), transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.NormalBlending, toneMapped: false,
  });
  const rainGlass = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.78), rainGlassMaterial);
  rainGlass.position.set(-0.08, 1.2, -0.615);
  rainGlass.rotation.x = 0.62;
  rainGlass.renderOrder = 21;
  group.add(rainGlass);

  group.traverse((o) => { o.frustumCulled = false; });

  return {
    group, wheelSpin, gasPedal, brakePedal, gearLever, handbrake, stalk, wipers,
    eye: new THREE.Vector3(-0.36, 1.15, 0.16),
    mirrors: { rear, left, right },
    gearLightMats, hornPad, rainGlassMaterial, cluster, info,
  };
}
