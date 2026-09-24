import * as THREE from 'three';
import { MeshBuilder, PAT } from '../geom/builder.js';
import { placementMatrix } from '../core/ring.js';
import { hash, rng, wrapS, deltaS } from '../core/math.js';
import { sliceAt, regionAt, groundHeight } from '../world/layout.js';
import { pathAt, occupied } from '../world/plan.js';
import { grassKey, grassColor } from '../world/sector.js';
import { CIRC } from '../core/config.js';

// Instanced grass tufts and crop plants around the player. Cells are
// classified once (cached) and the instance buffers rebuilt as the player moves.

const CELL = 0.62;
const RADIUS = 27;
const MAX = 9000;

function tuftGeometry(blades, height, spread, seed, crop = false) {
  const b = new MeshBuilder();
  const R = rng(seed);
  b.pattern(PAT.GRASS, 0);
  for (let i = 0; i < blades; i++) {
    const a = R() * Math.PI * 2;
    const r = R() * spread;
    const x0 = Math.cos(a) * r;
    const z0 = Math.sin(a) * r;
    const lean = R.range(0.1, 0.35);
    const dir = R() * Math.PI * 2;
    const h = height * R.range(0.65, 1.15);
    const w = crop ? 0.09 : 0.05;
    const dx = Math.cos(dir);
    const dz = Math.sin(dir);
    // perpendicular for the blade's width
    const px = -dz * w;
    const pz = dx * w;
    const pts = [];
    const segs = 3;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const off = lean * t * t * h;
      pts.push([x0 + dx * off, t * h, z0 + dz * off, 1 - t * 0.85]);
    }
    const idx = [];
    for (let k = 0; k <= segs; k++) {
      const [x, y, z, wk] = pts[k];
      const t = k / segs;
      const shade = 0.6 + 0.4 * t;
      b.colorBytes(Math.round(255 * shade), Math.round(255 * shade), Math.round(255 * shade));
      b.sway(t * t);
      idx.push(b.vert(x - px * wk, y, z - pz * wk, 0, 1, 0), b.vert(x + px * wk, y, z + pz * wk, 0, 1, 0));
    }
    for (let k = 0; k < segs; k++) {
      const a0 = idx[k * 2];
      const a1 = idx[k * 2 + 1];
      const c0 = idx[k * 2 + 2];
      const c1 = idx[k * 2 + 3];
      b.quad(a0, a1, c1, c0);
      b.quad(a1, a0, c0, c1);
    }
  }
  return b.toGeometry();
}

export class Grass {
  constructor(scene, mats) {
    this.density = 1;
    this.cache = new Map();
    this.center = null;
    const geoA = tuftGeometry(9, 0.3, 0.26, 11);
    const geoB = tuftGeometry(4, 0.7, 0.2, 12, true);
    this.grass = new THREE.InstancedMesh(geoA, mats.foliage, MAX);
    this.crops = new THREE.InstancedMesh(geoB, mats.foliage, MAX / 3);
    for (const m of [this.grass, this.crops]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
      scene.add(m);
    }
    this._m = new THREE.Matrix4();
    this._c = [0, 0, 0];
    this._reg = {};
    this._path = { d: 0, pave: 0 };
  }

  classify(ci, cj) {
    const key = ci * 1000 + cj;
    let v = this.cache.get(key);
    if (v !== undefined) return v;
    v = null;
    const hsd = hash(ci, cj, 4711);
    const s = wrapS((ci + ((hsd & 1023) / 1023)) * CELL);
    const u = (cj + (((hsd >>> 10) & 1023) / 1023)) * CELL;
    const sl = sliceAt(s);
    const reg = regionAt(sl, u, this._reg);
    let kind = 0;
    if (reg.kind === 'valley' || reg.kind === 'terrace' || reg.kind === 'berm') {
      if (reg.kind === 'terrace') {
        const side = reg.side;
        const dx = reg.x - side.x[reg.k];
        const db = side.x[reg.k + 1] - reg.x;
        if (dx < 0.25 || db < 0.2) kind = -1;
        else if (side.tw > 0.5 && side.use === 'farm') kind = 2;
        else if (side.paddy > 0.5 && side.tw > 0.6 && dx > 2.45) kind = 3;
        else if (side.paddy > 0.5 && side.tw > 0.6 && dx > 2.2) kind = -1;
        else kind = 1;
      } else if (reg.kind === 'valley') {
        if (reg.x - reg.side.bankTop < 0.3) kind = -1;
        else kind = sl.z.lake > 0.2 && reg.x - reg.side.bankTop < 4 ? -1 : 1;
      } else kind = 1;
    }
    if (kind > 0) {
      pathAt(s, u, sl, this._path);
      if (this._path.d < 0.15) kind = -1;
    }
    if (kind > 0 && occupied(s, u, 0.1)) kind = -1;
    if (kind > 0) {
      const h = groundHeight(s, u);
      let col;
      let su = u;
      if (kind === 3) {
        // rice: planted in rows standing in the paddy water
        const side = reg.side;
        const k = reg.k;
        const wl = side.L[k + 1] - 0.28 * side.paddy + 0.14;
        col = [0.5, 0.74, 0.3];
        v = { s, u, h: wl - 0.12, kind: 2, col, yaw: ((hsd >>> 20) & 1023) / 1023 * 6.283, sc: 0.55 + (((hsd >>> 5) & 255) / 255) * 0.25 };
        this.cache.set(key, v);
        return v;
      }
      if (kind === 2) {
        // snap crops to the painted rows
        su = (Math.floor(u / 0.95) + 0.45) * 0.95;
        const field = ((hash(Math.floor(s / 11.52), Math.floor(su / 12)) >>> 8) & 0xffff) / 65536;
        col = field < 0.25 ? [0.36, 0.62, 0.24] : field < 0.5 ? [0.7, 0.68, 0.3] : field < 0.72 ? [0.86, 0.7, 0.3] : field < 0.86 ? [0.3, 0.52, 0.28] : [0.5, 0.38, 0.54];
      } else {
        col = grassColor(s, u, grassKey(sl, reg), [0, 0, 0]);
      }
      v = { s, u: su, h: groundHeight(s, su), kind, col, yaw: ((hsd >>> 20) & 1023) / 1023 * 6.283, sc: 0.75 + (((hsd >>> 5) & 255) / 255) * 0.6 };
      void h;
    }
    this.cache.set(key, v);
    if (this.cache.size > 60000) {
      // drop the oldest half
      let n = 0;
      for (const k of this.cache.keys()) {
        this.cache.delete(k);
        if (++n > 30000) break;
      }
    }
    return v;
  }

  update(player) {
    if (this.density <= 0) {
      this.grass.count = 0;
      this.crops.count = 0;
      return;
    }
    if (this.center && Math.abs(deltaS(this.center.s, player.s)) < 2.5 && Math.abs(this.center.u - player.u) < 2.5) return;
    this.center = { s: player.s, u: player.u };
    const ci0 = Math.floor(player.s / CELL);
    const cj0 = Math.floor(player.u / CELL);
    const n = Math.ceil(RADIUS / CELL);
    const nCells = Math.round(CIRC / CELL);
    let gi = 0;
    let ci2 = 0;
    const keep = this.density;
    for (let di = -n; di <= n; di++) {
      for (let dj = -n; dj <= n; dj++) {
        if (di * di + dj * dj > n * n) continue;
        const cj = cj0 + dj;
        if (Math.abs(cj * CELL) > 68) continue;
        const ci = (((ci0 + di) % nCells) + nCells) % nCells;
        if (keep < 1 && ((hash(ci, cj, 9) & 255) / 255) > keep) continue;
        const v = this.classify(ci, cj);
        if (!v) continue;
        const dist = Math.sqrt(di * di + dj * dj) * CELL;
        const fadeScale = dist > RADIUS - 6 ? Math.max(0.05, (RADIUS - dist) / 6) : 1;
        placementMatrix(v.s, v.u, v.h - 0.02, v.yaw, v.sc * fadeScale, this._m);
        if (v.kind === 2) {
          if (ci2 >= this.crops.instanceMatrix.count) continue;
          this.crops.setMatrixAt(ci2, this._m);
          this.crops.instanceColor.setXYZ(ci2, v.col[0], v.col[1], v.col[2]);
          ci2++;
        } else {
          if (gi >= MAX) continue;
          this.grass.setMatrixAt(gi, this._m);
          this.grass.instanceColor.setXYZ(gi, v.col[0], v.col[1], v.col[2]);
          gi++;
        }
      }
    }
    this.grass.count = gi;
    this.crops.count = ci2;
    this.grass.instanceMatrix.needsUpdate = true;
    this.grass.instanceColor.needsUpdate = true;
    this.crops.instanceMatrix.needsUpdate = true;
    this.crops.instanceColor.needsUpdate = true;
  }
}
