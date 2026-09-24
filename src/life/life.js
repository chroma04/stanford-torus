import * as THREE from 'three';
import { MeshBuilder, PAT } from '../geom/builder.js';
import { placementMatrix, ringToWorld } from '../core/ring.js';
import { rng, wrapS, deltaS, hash, smoothstep, clamp } from '../core/math.js';
import { CIRC, RAIL_U, RAIL_H, SPOKES, SPOKE_SPACING, WATER_H, R0 } from '../core/config.js';
import { sliceAt, groundHeight, regionAt } from '../world/layout.js';

// Things that move: monorail trains, spoke elevators, birds, ducks,
// butterflies, fireflies and fountain spray. (No people.)

// ------------------------------------------------------------------- trains
const CAR_LEN = 13.5;
const CAR_GAP = 1.0;
const V_MAX = 18;
const ACC = 0.8;
const DWELL = 14;
const D_ACC = (V_MAX * V_MAX) / (2 * ACC);
const T_ACC = V_MAX / ACC;
const SEG_LEN = SPOKE_SPACING;
const T_CRUISE = (SEG_LEN - 2 * D_ACC) / V_MAX;
const T_SEG = DWELL + 2 * T_ACC + T_CRUISE;
const STATION_OFFSET = 30;

/** Arc position of a train's head at time t, and its speed. */
function trainState(t, phase) {
  const tt = t + phase * T_SEG * SPOKES;
  const seg = Math.floor(tt / T_SEG);
  let x = tt - seg * T_SEG;
  const base = wrapS(seg * SEG_LEN + STATION_OFFSET);
  let d;
  let v;
  if (x < DWELL) {
    d = 0;
    v = 0;
  } else {
    x -= DWELL;
    if (x < T_ACC) {
      d = 0.5 * ACC * x * x;
      v = ACC * x;
    } else if (x < T_ACC + T_CRUISE) {
      d = D_ACC + V_MAX * (x - T_ACC);
      v = V_MAX;
    } else {
      const y = Math.min(T_ACC, x - T_ACC - T_CRUISE);
      d = D_ACC + V_MAX * T_CRUISE + V_MAX * y - 0.5 * ACC * y * y;
      v = V_MAX - ACC * y;
    }
  }
  return { s: wrapS(base + d + CAR_LEN * 1.5), v };
}

function carGeometry(kind, accent) {
  const b = new MeshBuilder();
  const L = CAR_LEN;
  // body (local -z is forward)
  b.color(0xf4f6f7).pattern(PAT.PLAIN);
  b.bevelBox(0, 1.9, 0, 3.0, 2.6, L - (kind === 'mid' ? 0 : 2.2), 0.55);
  // window band
  b.pattern(PAT.TRAINWIN, 0).color(0x9fc6d8);
  b.box(0, 2.2, 0, 3.04, 0.95, L - (kind === 'mid' ? 0.6 : 2.8));
  b.reset().color(accent);
  b.box(0, 1.25, 0, 3.05, 0.28, L - (kind === 'mid' ? 0.2 : 2.4));
  // skirt around the beam
  b.color(0x5b6770);
  b.box(0, 0.35, 0, 2.2, 0.9, L - 1.5);
  // noses
  const nose = (dir) => {
    b.color(0xf4f6f7);
    b.push().translate(0, 1.9, dir * (L / 2 - 1.1)).scale(1.5, 1.3, 1.6);
    b.sphere(0, 0, 0, 1, 1, 1, 2, (x, y, z) => (dir * z > 0 ? 1 : 0.001 + 0 * x * y));
    b.pop();
    b.pattern(PAT.TRAINWIN, 0).color(0x6f9fb8);
    b.push().translate(0, 2.35, dir * (L / 2 - 0.5)).rotateX(dir * 0.5);
    b.box(0, 0, 0, 2.2, 0.7, 0.9);
    b.pop();
    b.reset().pattern(PAT.LAMP, 0).color(0xfff6d8);
    b.box(-0.9, 1.3, dir * (L / 2 + 0.3), 0.35, 0.18, 0.1);
    b.box(0.9, 1.3, dir * (L / 2 + 0.3), 0.35, 0.18, 0.1);
    b.reset();
  };
  if (kind === 'head') nose(-1);
  if (kind === 'tail') nose(1);
  if (kind !== 'head') {
    b.color(0x5b6770).box(0, 1.9, -L / 2 - 0.2, 2.4, 2.2, 0.6);
  }
  b.color(0xd9dee2).box(0, 3.25, 0, 1.6, 0.25, L * 0.5);
  return b.toGeometry();
}

// --------------------------------------------------------------------- birds
function birdGeometry() {
  const b = new MeshBuilder();
  b.color(0xf2efe8);
  b.sphere(0, 0, 0, 0.12, 0.1, 0.34, 1);
  b.sphere(0, 0.04, -0.3, 0.08, 0.08, 0.09, 1);
  b.color(0xe8a040).push().translate(0, 0.03, -0.38).rotateX(-Math.PI / 2);
  b.cone(0, 0, 0, 0.025, 0.08, 5);
  b.pop();
  b.extra(0.8).color(0xdcd8d0);
  // wings (flap weight via aux.w; displacement grows with |x|)
  for (const sx of [-1, 1]) {
    const i0 = b.vert(0.08 * sx, 0.02, -0.12, 0, 1, 0);
    const i1 = b.vert(0.62 * sx, 0.02, 0.05, 0, 1, 0);
    const i2 = b.vert(0.1 * sx, 0.02, 0.14, 0, 1, 0);
    if (sx > 0) {
      b.tri(i0, i2, i1);
      b.tri(i0, i1, i2);
    } else {
      b.tri(i0, i1, i2);
      b.tri(i0, i2, i1);
    }
  }
  b.extra(0);
  return b.toGeometry();
}

function butterflyGeometry() {
  const b = new MeshBuilder();
  b.color(0x333333).sphere(0, 0, 0, 0.012, 0.012, 0.05, 0);
  b.extra(0.4).color(0xffffff);
  for (const sx of [-1, 1]) {
    for (const [z0, z1, r] of [[-0.05, 0.0, 0.07], [0.0, 0.05, 0.05]]) {
      const i0 = b.vert(0.005 * sx, 0, (z0 + z1) / 2, 0, 1, 0);
      const i1 = b.vert(r * sx, 0, z0, 0, 1, 0);
      const i2 = b.vert(r * sx, 0, z1, 0, 1, 0);
      b.tri(i0, i1, i2);
      b.tri(i0, i2, i1);
    }
  }
  b.extra(0);
  return b.toGeometry();
}

function duckGeometry() {
  const b = new MeshBuilder();
  b.color(0x8a6a4a).sphere(0, 0.12, 0, 0.16, 0.12, 0.26, 1);
  b.color(0xf4f1ea).sphere(0, 0.14, 0.12, 0.13, 0.1, 0.14, 1);
  b.color(0x2f7a4f).sphere(0, 0.34, -0.18, 0.09, 0.09, 0.09, 1);
  b.color(0xe8a040).push().translate(0, 0.33, -0.27).rotateX(-Math.PI / 2);
  b.cone(0, 0, 0, 0.035, 0.09, 5);
  b.pop();
  return b.toGeometry();
}

function cabinGeometry() {
  const b = new MeshBuilder();
  b.color(0xf4f6f7).box(0, 0.1, 0, 2.2, 0.2, 2.2);
  b.box(0, 3.0, 0, 2.2, 0.2, 2.2);
  b.pattern(PAT.GLASS, 0.3).color(0xa8cfde).box(0, 1.55, 0, 2.0, 2.7, 2.0);
  b.reset().pattern(PAT.LAMP, 0).color(0xdff4ff).box(0, 3.15, 0, 0.6, 0.12, 0.6);
  return b.toGeometry();
}

export class Life {
  constructor(scene, mats, manager) {
    this.scene = scene;
    this.manager = manager;
    const m = mats.toon;
    // trains
    this.trains = [];
    const accents = [0x4f86c6, 0xd9534f, 0x3f9e7a, 0xe0a030];
    const geos = {};
    for (let k = 0; k < 4; k++) {
      const cars = [];
      for (const kind of ['head', 'mid', 'mid', 'tail']) {
        const key = kind + k;
        geos[key] = geos[key] || carGeometry(kind, accents[k]);
        const mesh = new THREE.Mesh(geos[key], m);
        mesh.matrixAutoUpdate = false;
        mesh.layers.enable(1);
        scene.add(mesh);
        cars.push(mesh);
      }
      this.trains.push({ cars, phase: k / 4 + 0.03 });
    }
    // spoke elevators
    this.cabins = [];
    const cg = cabinGeometry();
    for (let k = 0; k < SPOKES; k++) {
      for (let j = 0; j < 3; j++) {
        const mesh = new THREE.Mesh(cg, m);
        mesh.matrixAutoUpdate = false;
        scene.add(mesh);
        this.cabins.push({ mesh, spoke: k, j, phase: hash(k, j) / 4294967296 });
      }
    }
    // birds
    this.birdCount = 34;
    this.birds = new THREE.InstancedMesh(birdGeometry(), m, this.birdCount);
    this.birds.frustumCulled = false;
    this.birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.birds);
    const R = rng(99);
    this.birdParams = Array.from({ length: this.birdCount }, (_, i) => ({
      flock: i % 2,
      r: R.range(6, 22),
      w: R.range(0.25, 0.45) * (R() < 0.5 ? -1 : 1),
      ph: R() * 6.28,
      dh: R.range(-5, 5),
      bob: R.range(0.3, 1.2),
    }));
    // butterflies
    this.flyCount = 26;
    this.butterflies = new THREE.InstancedMesh(butterflyGeometry(), m, this.flyCount);
    this.butterflies.frustumCulled = false;
    this.butterflies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.flyCount * 3), 3);
    const fc = [[1, 0.85, 0.3], [1, 0.55, 0.2], [0.55, 0.75, 1], [1, 1, 1], [0.95, 0.5, 0.8]];
    this.flyParams = Array.from({ length: this.flyCount }, (_, i) => {
      const c = fc[i % fc.length];
      this.butterflies.instanceColor.setXYZ(i, c[0], c[1], c[2]);
      return { ph: R() * 100, sp: R.range(0.3, 0.7), s0: R.range(-14, 14), u0: R.range(-14, 14) };
    });
    scene.add(this.butterflies);
    // fireflies
    this.ffCount = 70;
    const fb = new MeshBuilder();
    fb.pattern(PAT.FIREFLY, 0).color(0xd8ff7a).sphere(0, 0, 0, 0.05, 0.05, 0.05, 0);
    this.fireflies = new THREE.InstancedMesh(fb.toGeometry(), m, this.ffCount);
    this.fireflies.frustumCulled = false;
    this.ffParams = Array.from({ length: this.ffCount }, () => ({ ph: R() * 100, s0: R.range(-25, 25), u0: R.range(-25, 25), hh: R.range(0.4, 2.2) }));
    scene.add(this.fireflies);
    // ducks
    this.duckCount = 12;
    this.ducks = new THREE.InstancedMesh(duckGeometry(), m, this.duckCount);
    this.ducks.frustumCulled = false;
    this.duckParams = Array.from({ length: this.duckCount }, () => ({ ds: R.range(-45, 45), off: R.range(-0.8, 0.8), ph: R() * 10, v: R.range(-0.25, 0.25) }));
    scene.add(this.ducks);
    // fountain spray
    this.dropCount = 260;
    const db = new MeshBuilder();
    db.pattern(PAT.PLAIN, 0).color(0xd8f0f6).sphere(0, 0, 0, 0.045, 0.08, 0.045, 0);
    this.drops = new THREE.InstancedMesh(db.toGeometry(), m, this.dropCount);
    this.drops.frustumCulled = false;
    this.drops.count = 0;
    this.dropParams = Array.from({ length: this.dropCount }, () => ({ a: R() * 6.28, sp: R.range(0.8, 1.6), ph: R(), up: R.range(3.2, 4.4) }));
    scene.add(this.drops);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Matrix4();
    this.nearTrain = 0;
  }

  update(dt, t, player, env) {
    const M = this._m;
    // trains
    let nearest = 1e9;
    for (const tr of this.trains) {
      const st = trainState(t, tr.phase);
      tr.speed = st.v;
      for (let c = 0; c < tr.cars.length; c++) {
        const s = wrapS(st.s - c * (CAR_LEN + CAR_GAP));
        placementMatrix(s, RAIL_U, RAIL_H - 0.6, 0, 1, M);
        tr.cars[c].matrix.copy(M);
        tr.cars[c].matrixWorldNeedsUpdate = true;
        const d = Math.hypot(deltaS(player.s, s), player.u - RAIL_U, player.h - RAIL_H);
        if (d < nearest) nearest = d;
      }
      tr.near = nearest;
    }
    this.nearTrain = nearest;
    this.trainSpeed = Math.max(...this.trains.map((tr) => (tr.near === nearest ? tr.speed : 0)));
    // elevators
    for (const cb of this.cabins) {
      const s = cb.spoke * SPOKE_SPACING;
      const a = (cb.j / 3) * Math.PI * 2 + Math.PI / 6;
      const cyc = ((t / 70 + cb.phase) % 1 + 1) % 1;
      // up, dwell, down, dwell
      let y;
      if (cyc < 0.4) y = smoothstep(0, 0.4, cyc);
      else if (cyc < 0.5) y = 1;
      else if (cyc < 0.9) y = 1 - smoothstep(0.5, 0.9, cyc);
      else y = 0;
      const h = 13 + y * 78;
      const r = 6.6;
      placementMatrix(s + Math.sin(a) * -r, Math.cos(a) * r, h, -a, 1, M);
      cb.mesh.matrix.copy(M);
      cb.mesh.matrixWorldNeedsUpdate = true;
    }
    // birds: two flocks wheeling above the valley near the player
    const day = env.day;
    for (let i = 0; i < this.birdCount; i++) {
      const p = this.birdParams[i];
      const fs = player.s + (p.flock ? 60 : -30) + 35 * Math.sin(t * 0.03 + p.flock * 2);
      const fu = (p.flock ? 12 : -14) + 8 * Math.sin(t * 0.05 + p.flock);
      const fh = 36 + p.flock * 12 + 6 * Math.sin(t * 0.07 + p.flock);
      const ang = t * p.w + p.ph;
      const s = fs + Math.cos(ang) * p.r;
      const u = fu + Math.sin(ang) * p.r * 0.7;
      const h = fh + p.dh + Math.sin(t * p.bob + p.ph) * 1.2;
      const yaw = Math.atan2(Math.cos(ang) * 0.7 * Math.sign(p.w), -Math.sin(ang) * Math.sign(p.w));
      placementMatrix(wrapS(s), u, h, yaw, day > 0.3 ? 1.1 : 0.0001, M);
      this.birds.setMatrixAt(i, M);
    }
    this.birds.instanceMatrix.needsUpdate = true;
    // butterflies (daytime, near the player, over grass)
    for (let i = 0; i < this.flyCount; i++) {
      const p = this.flyParams[i];
      const tt = t * p.sp + p.ph;
      const s = player.s + p.s0 + Math.sin(tt * 0.7) * 3 + Math.sin(tt * 1.9) * 0.8;
      const u = clamp(player.u + p.u0 + Math.cos(tt * 0.6) * 3, -60, 60);
      const g = groundHeight(s, u);
      const h = g + 0.7 + Math.abs(Math.sin(tt * 2.3)) * 0.9;
      const yaw = tt * 0.8;
      const vis = day > 0.5 && g > WATER_H + 0.2 ? 1.4 : 0.0001;
      placementMatrix(wrapS(s), u, h, yaw, vis, M);
      this.butterflies.setMatrixAt(i, M);
    }
    this.butterflies.instanceMatrix.needsUpdate = true;
    // fireflies (night)
    const night = env.night;
    for (let i = 0; i < this.ffCount; i++) {
      const p = this.ffParams[i];
      const tt = t * 0.3 + p.ph;
      const s = player.s + p.s0 + Math.sin(tt * 0.9) * 2.5;
      const u = clamp(player.u + p.u0 + Math.cos(tt * 0.7) * 2.5, -60, 60);
      const g = groundHeight(s, u);
      const pulse = Math.max(0, Math.sin(t * 2.1 + p.ph * 3));
      const sc = night > 0.5 && g > WATER_H + 0.1 ? 0.3 + pulse * 1.2 : 0.0001;
      placementMatrix(wrapS(s), u, g + p.hh + Math.sin(tt * 2.2) * 0.3, 0, sc, M);
      this.fireflies.setMatrixAt(i, M);
    }
    this.fireflies.instanceMatrix.needsUpdate = true;
    // ducks on the river near the player
    for (let i = 0; i < this.duckCount; i++) {
      const p = this.duckParams[i];
      let ds = ((p.ds + t * p.v + 45) % 90 + 90) % 90 - 45;
      const s = wrapS(player.s + ds);
      const sl = sliceAt(s);
      const r = sl.river;
      const u = r.c + p.off * Math.max(0.5, r.hw - 1.2);
      const bob = Math.sin(t * 1.6 + p.ph) * 0.03;
      const yaw = p.v >= 0 ? Math.sin(t * 0.3 + p.ph) * 0.4 : Math.PI + Math.sin(t * 0.3 + p.ph) * 0.4;
      placementMatrix(s, u, WATER_H - 0.05 + bob, yaw, 1.3, M);
      this.ducks.setMatrixAt(i, M);
    }
    this.ducks.instanceMatrix.needsUpdate = true;
    // fountain spray: nearest fountains
    const fountains = [];
    for (const rec of this.manager.near(player.s, 120)) for (const f of rec.data.fountains) fountains.push(f);
    let n = 0;
    if (fountains.length) {
      fountains.sort((a, b) => Math.abs(deltaS(player.s, a.s)) - Math.abs(deltaS(player.s, b.s)));
      const use = fountains.slice(0, 2);
      const per = Math.floor(this.dropCount / use.length);
      for (const f of use) {
        const top = f.h + 3.3;
        for (let k = 0; k < per; k++) {
          const p = this.dropParams[(n + k) % this.dropCount];
          const life = 1.6;
          const x = ((t / life + p.ph) % 1) * life;
          const r = x * p.sp;
          const y = p.up * x - 0.5 * 9.81 * 0.55 * x * x;
          placementMatrix(f.s + Math.sin(p.a) * r, f.u + Math.cos(p.a) * r, Math.max(f.h + 0.5, top + y), 0, 1, M);
          this.drops.setMatrixAt(n + k - (n + k >= this.dropCount ? this.dropCount : 0), M);
        }
        n += per;
      }
    }
    this.drops.count = Math.min(n, this.dropCount);
    this.drops.instanceMatrix.needsUpdate = true;
  }
}

export { ringToWorld, regionAt, R0, CIRC };
