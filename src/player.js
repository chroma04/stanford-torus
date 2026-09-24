import * as THREE from 'three';
import { R0, OMEGA, EYE_HEIGHT, WALK_SPEED, RUN_SPEED, TUBE_HC, TUBE_R, WATER_H, CIRC } from './core/config.js';
import { ringToWorld, frameAt } from './core/ring.js';
import { wrapS, clamp } from './core/math.js';
import { probe, BODY_R } from './world/physics.js';

// First-person walker in the rotating frame of the habitat. Gravity is the
// centrifugal pull (ω²r), and jumps feel the Coriolis force.

const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class Player {
  constructor(manager) {
    this.manager = manager;
    this.s = 0;
    this.u = 0;
    this.h = 0;
    this.vs = 0;
    this.vu = 0;
    this.vh = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.grounded = false;
    this.flying = false;
    this.inWater = false;
    this.bobPhase = 0;
    this.bob = 0;
    this.speed = 0;
    this.onStep = null;
    this.surface = 'grass';
    this.probeOut = {};
    this.lastGround = 0;
  }

  place(s, u, yaw = 0) {
    this.s = wrapS(s);
    this.u = u;
    const p = probe(this.manager, this.s, u, 200, this.probeOut);
    this.h = p.ground;
    this.yaw = yaw;
    this.vs = this.vu = this.vh = 0;
  }

  update(dt, input, look) {
    // look
    this.yaw += look[0];
    this.pitch = clamp(this.pitch - look[1], -1.52, 1.52);

    let fIn = 0;
    let rIn = 0;
    if (input.down('KeyW', 'ArrowUp')) fIn += 1;
    if (input.down('KeyS', 'ArrowDown')) fIn -= 1;
    if (input.down('KeyD', 'ArrowRight')) rIn += 1;
    if (input.down('KeyA', 'ArrowLeft')) rIn -= 1;
    if (input.touchMove.active) {
      fIn -= input.touchMove.y;
      rIn += input.touchMove.x;
    }
    const len = Math.hypot(fIn, rIn);
    if (len > 1) {
      fIn /= len;
      rIn /= len;
    }
    const run = input.down('ShiftLeft', 'ShiftRight');
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);

    if (input.wasPressed('KeyF')) {
      this.flying = !this.flying;
      this.vh = 0;
    }

    if (this.flying) {
      const sp = run ? 60 : 22;
      const cp = Math.cos(this.pitch);
      const spn = Math.sin(this.pitch);
      let ts = (cy * cp * fIn - sy * rIn) * sp;
      let tu = (sy * cp * fIn + cy * rIn) * sp;
      let th = spn * fIn * sp;
      if (input.down('Space')) th += sp * 0.6;
      if (input.down('KeyC', 'ControlLeft')) th -= sp * 0.6;
      const k = Math.min(1, dt * 4);
      this.vs += (ts - this.vs) * k;
      this.vu += (tu - this.vu) * k;
      this.vh += (th - this.vh) * k;
      this.s = wrapS(this.s + (this.vs * dt * R0) / (R0 - this.h));
      this.u += this.vu * dt;
      this.h += this.vh * dt;
      // stay inside the tube and above ground
      const g = probe(this.manager, this.s, this.u, this.h + 50, this.probeOut).terrain;
      if (this.h < g) this.h = g;
      const dx = this.u;
      const dy = this.h - TUBE_HC;
      const r = Math.hypot(dx, dy);
      const maxR = TUBE_R - 3;
      if (r > maxR) {
        this.u = (dx / r) * maxR;
        this.h = TUBE_HC + (dy / r) * maxR;
      }
      this.grounded = false;
      this.speed = Math.hypot(this.vs, this.vu);
      return;
    }

    let target = run ? RUN_SPEED : WALK_SPEED;
    if (this.inWater) target *= 0.45;
    const ts = (cy * fIn - sy * rIn) * target;
    const tu = (sy * fIn + cy * rIn) * target;
    const accel = this.grounded ? 12 : 2.5;
    const k = Math.min(1, dt * accel);
    this.vs += (ts - this.vs) * k;
    this.vu += (tu - this.vu) * k;

    // gravity (centrifugal) + Coriolis in the rotating frame
    const g = OMEGA * OMEGA * (R0 - this.h);
    if (!this.grounded) {
      this.vh += (-g - 2 * OMEGA * this.vs) * dt;
      this.vs += 2 * OMEGA * this.vh * dt;
    }
    if (this.grounded && input.wasPressed('Space')) {
      this.vh = this.inWater ? 3.0 : 4.6;
      this.grounded = false;
      this.jumped = true;
    }

    // horizontal move with sliding, one axis at a time
    const feet = this.h;
    const dsWorld = (this.vs * dt * R0) / (R0 - this.h);
    const du = this.vu * dt;
    const cur = probe(this.manager, this.s, this.u, feet, this.probeOut).ground;
    const tryMove = (ns, nu, dirS, dirU) => {
      const p = probe(this.manager, ns, nu, feet, {});
      if (p.blocked) return false;
      // body radius probe in the direction of travel
      const l = Math.hypot(dirS, dirU);
      if (l > 1e-6) {
        const q = probe(this.manager, ns + (dirS / l) * BODY_R, nu + (dirU / l) * BODY_R, feet, {});
        if (q.blocked) return false;
      }
      // ledge guard: don't walk off drops > 1.25 m unless jumping
      if (this.grounded && p.ground < cur - 1.25) return false;
      return true;
    };
    if (dsWorld !== 0) {
      const ns = wrapS(this.s + dsWorld);
      if (tryMove(ns, this.u, dsWorld, 0)) this.s = ns;
      else this.vs = 0;
    }
    if (du !== 0) {
      const nu = this.u + du;
      if (tryMove(this.s, nu, 0, du)) this.u = nu;
      else this.vu = 0;
    }

    // vertical
    const p = probe(this.manager, this.s, this.u, this.h, this.probeOut);
    this.inWater = p.water;
    if (this.grounded) {
      // follow the ground (stairs, slopes) if it is close
      if (p.ground >= this.h - 0.45) {
        this.h = p.ground;
        this.vh = 0;
      } else {
        this.grounded = false;
      }
    } else {
      this.h += this.vh * dt;
      if (this.h <= p.ground) {
        const impact = -this.vh;
        this.h = p.ground;
        this.vh = 0;
        this.grounded = true;
        if (impact > 2.5) this.onLand?.(impact);
      }
    }
    const moveSpeed = Math.hypot(this.vs, this.vu);
    this.speed = moveSpeed;
    if (this.grounded && moveSpeed > 0.5) {
      const prev = this.bobPhase;
      this.bobPhase += dt * (5.2 + moveSpeed * 0.9);
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) this.onStep?.(this);
    } else {
      this.bobPhase += (Math.round(this.bobPhase / Math.PI) * Math.PI - this.bobPhase) * Math.min(1, dt * 6);
    }
    this.bob = Math.abs(Math.sin(this.bobPhase)) * 0.045 * Math.min(1, moveSpeed / 4);
  }

  /** Eye position and orientation → camera. */
  applyCamera(camera) {
    const eyeH = this.h + (this.flying ? 1.7 : EYE_HEIGHT) + this.bob;
    ringToWorld(this.s, this.u, eyeH, camera.position);
    frameAt(this.s, _up, _fwd, _lat);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    // horizontal forward and right
    const hf = new THREE.Vector3().copy(_fwd).multiplyScalar(cy).addScaledVector(_lat, sy);
    _x.copy(_lat).multiplyScalar(cy).addScaledVector(_fwd, -sy); // right
    const f = hf.multiplyScalar(cp).addScaledVector(_up, sp);
    _z.copy(f).negate();
    _y.crossVectors(_z, _x);
    _m.makeBasis(_x, _y, _z);
    camera.quaternion.setFromRotationMatrix(_m);
    camera.updateMatrixWorld();
  }

  get eyeWorld() {
    return ringToWorld(this.s, this.u, this.h + EYE_HEIGHT);
  }
}

export { WATER_H, CIRC };
