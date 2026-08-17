import type { Controls, Gear } from './types';

const GEAR_RATIO = [155, 96, 66, 49, 39, 32];
const SHIFT_UP = [22, 38, 56, 78, 104];
const SHIFT_DOWN = [0, 16, 30, 46, 66, 92];

export class Vehicle {
  x = 0;
  z = 0;
  heading = 0;      // radians; forward = (-sin h, -cos h)
  speed = 0;        // m/s, signed
  steerAngle = 0;   // rad, positive = left
  steerNorm = 0;    // -1..1 (positive = right) smoothed
  rpm = 750;
  autoGear = 0;     // index in D
  accelLong = 0;    // m/s^2 (for camera)
  accelLat = 0;
  odometer = 0;
  starting = 0;
  jolt = 0;
  wheelSpin = 0;
  readonly wheelbase = 2.62;
  prevSpeed = 0;

  get forwardX() { return -Math.sin(this.heading); }
  get forwardZ() { return -Math.cos(this.heading); }
  get rightX() { return Math.cos(this.heading); }
  get rightZ() { return -Math.sin(this.heading); }
  get kmh() { return Math.abs(this.speed) * 3.6; }

  place(x: number, z: number, heading: number) {
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0; this.steerAngle = 0; this.steerNorm = 0;
  }

  step(c: Controls, dt: number) {
    const v = this.speed;
    const av = Math.abs(v);

    // ---- steering (natural, speed-sensitive) ------------------------------
    const speedFactor = 1 - 0.62 * Math.min(1, av / 28);
    const maxSteer = 0.52 * speedFactor;
    const target = -c.steer * maxSteer;
    // Smooth steering with speed-dependent rate
    const rate = 4.8 * (1 - 0.4 * Math.min(1, av / 35));
    this.steerAngle += (target - this.steerAngle) * Math.min(1, rate * dt);
    this.steerNorm += (c.steer - this.steerNorm) * Math.min(1, 8 * dt);

    // ---- longitudinal (smooth, realistic) ---------------------------------
    let accel = 0;
    const locked = c.gear === 'P' || !c.engineOn;
    if (!locked) {
      if (c.gear === 'D') {
        const vmax = 45;
        // Progressive power delivery - less aggressive at low speeds
        const power = 4.8 * (1 - Math.min(0.88, Math.max(0, v) / vmax));
        accel += c.throttle * power;
        // Idle creep - natural automatic behavior
        if (c.throttle < 0.02 && c.brake < 0.04 && !c.handbrake && v < 2.0) {
          accel += 0.95 * (1 - Math.max(0, v) / 2.0);
        }
        if (v < -0.15) accel += 2.8;
      } else if (c.gear === 'R') {
        const vmax = 10;
        accel -= c.throttle * 2.8 * (1 - Math.min(0.85, Math.abs(Math.min(0, v)) / vmax));
        if (c.throttle < 0.02 && c.brake < 0.04 && !c.handbrake && v > -1.2) {
          accel -= 0.75 * (1 - Math.abs(Math.min(0, v)) / 1.2);
        }
        if (v > 0.15) accel -= 2.8;
      }
    }

    // Aerodynamic drag + rolling resistance
    const drag = 0.0038 * v * av;
    const roll = av > 0.02 ? Math.sign(v) * (0.38 + (c.gear === 'N' ? 0.08 : 0.24)) : 0;
    accel -= drag + roll;

    // Progressive braking
    const brakeForce = c.brake * 8.5 + (c.handbrake ? 5.5 : 0) + (locked ? 12 : 0);
    if (brakeForce > 0 && av > 0.001) {
      const dv = Math.min(av, brakeForce * dt);
      this.speed -= Math.sign(v) * dv;
    }
    this.speed += accel * dt;
    if (locked && Math.abs(this.speed) < 0.3) this.speed = 0;
    if ((c.brake > 0.12 || c.handbrake) && Math.abs(this.speed) < 0.1) this.speed = 0;
    if (Math.abs(this.speed) < 0.006) this.speed = 0;

    // ---- kinematics -------------------------------------------------------
    if (Math.abs(this.speed) > 0.0001) {
      const omega = (this.speed * Math.tan(this.steerAngle)) / this.wheelbase;
      this.heading += omega * dt;
      this.accelLat = this.speed * omega;
    } else {
      this.accelLat *= 0.9;
    }
    this.x += this.forwardX * this.speed * dt;
    this.z += this.forwardZ * this.speed * dt;
    this.odometer += (Math.abs(this.speed) * dt) / 1000;
    this.wheelSpin += (this.speed * dt) / 0.32;

    const rawAcc = (this.speed - this.prevSpeed) / Math.max(dt, 1 / 120);
    this.accelLong += (rawAcc - this.accelLong) * Math.min(1, 8 * dt);
    this.prevSpeed = this.speed;

    // ---- transmission / rpm ------------------------------------------------
    const kmh = this.kmh;
    if (c.gear === 'D') {
      while (this.autoGear < 5 && kmh > SHIFT_UP[this.autoGear] + (c.throttle > 0.7 ? 16 : 0)) this.autoGear++;
      while (this.autoGear > 0 && kmh < SHIFT_DOWN[this.autoGear]) this.autoGear--;
    } else {
      this.autoGear = 0;
    }
    let targetRpm = 750;
    if (c.engineOn) {
      if (c.gear === 'D') targetRpm = 700 + kmh * GEAR_RATIO[this.autoGear] * 0.36 + c.throttle * 700;
      else if (c.gear === 'R') targetRpm = 750 + kmh * 120 * 0.36 + c.throttle * 800;
      else targetRpm = 750 + c.throttle * 3200;
      targetRpm = Math.max(700, Math.min(6600, targetRpm));
    } else targetRpm = 0;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, 4.5 * dt);

    this.jolt *= Math.max(0, 1 - dt * 4);
  }

  gearAllowed(next: Gear, c: Controls, brakeOk: boolean): { ok: boolean; reason?: string } {
    if (!c.engineOn && next !== 'P') return { ok: false, reason: 'Start the engine first.' };
    if (this.kmh > 3 && (next === 'P' || next === 'R') && !(next === 'R' && this.speed < 0.1)) {
      return { ok: false, reason: 'Come to a full stop before selecting ' + next + '.' };
    }
    if (next !== 'P' && next !== 'N' && !brakeOk && this.kmh < 3) {
      return { ok: false, reason: 'Press the brake pedal, then select ' + next + '.' };
    }
    return { ok: true };
  }
}
