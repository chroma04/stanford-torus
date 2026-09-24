import * as THREE from 'three';
import { SECTORS, SECTOR_LEN } from '../core/config.js';
import { wrapIndex, deltaS } from '../core/math.js';
import { generateSector, buildFoliageGen } from './sector.js';

// Streams sectors in and out around the player, spreading generation work
// over frames, and swaps foliage level of detail with distance.

export class SectorManager {
  constructor(scene, materials, opts = {}) {
    this.scene = scene;
    this.mat = materials;
    this.loadRadius = opts.loadRadius ?? 16; // sectors each way
    this.unloadRadius = this.loadRadius + 2;
    this.highLodDist = opts.highLodDist ?? 175;
    this.sectors = new Map();
    this.job = null; // { i, gen }
    this.lodJob = null;
    this.generatedCount = 0;
  }

  _mesh(geo, material, caster) {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, material);
    m.matrixAutoUpdate = false;
    if (caster) m.layers.enable(1);
    this.scene.add(m);
    return m;
  }

  _add(data) {
    const rec = {
      i: data.i,
      data,
      terrain: this._mesh(data.terrain, this.mat.terrain, true),
      water: this._mesh(data.water, this.mat.water, false),
      props: this._mesh(data.props, this.mat.toon, true),
      shell: this._mesh(data.shell, this.mat.shell, false),
      foliageLow: this._mesh(data.foliageLow, this.mat.foliage, true),
      foliageHigh: null,
      highState: 'none',
    };
    this.sectors.set(data.i, rec);
    this.generatedCount++;
  }

  _remove(rec) {
    for (const k of ['terrain', 'water', 'props', 'shell', 'foliageLow', 'foliageHigh']) {
      const m = rec[k];
      if (m) {
        this.scene.remove(m);
        m.geometry.dispose();
      }
    }
    this.sectors.delete(rec.i);
  }

  desired(playerS) {
    const ci = Math.floor((((playerS % (SECTORS * SECTOR_LEN)) + SECTORS * SECTOR_LEN) % (SECTORS * SECTOR_LEN)) / SECTOR_LEN);
    const out = [];
    for (let d = 0; d <= this.loadRadius; d++) {
      out.push(wrapIndex(ci + d, SECTORS));
      if (d > 0) out.push(wrapIndex(ci - d, SECTORS));
    }
    return out;
  }

  /** Work for up to budgetMs; returns true if everything needed is loaded. */
  update(playerS, budgetMs = 6) {
    const t0 = performance.now();
    const want = this.desired(playerS);
    // unload
    for (const rec of [...this.sectors.values()]) {
      const mid = (rec.i + 0.5) * SECTOR_LEN;
      if (Math.abs(deltaS(playerS, mid)) > (this.unloadRadius + 0.5) * SECTOR_LEN) this._remove(rec);
    }
    let complete = true;
    while (performance.now() - t0 < budgetMs) {
      if (!this.job) {
        const next = want.find((i) => !this.sectors.has(i));
        if (next === undefined) break;
        this.job = { i: next, gen: generateSector(next) };
      }
      const r = this.job.gen.next();
      if (r.done) {
        this._add(r.value);
        this.job = null;
      }
    }
    if (this.job || want.some((i) => !this.sectors.has(i))) complete = false;
    if (complete) this.updateLod(playerS, t0, budgetMs);
    return complete;
  }

  updateLod(playerS, t0, budgetMs) {
    for (const rec of this.sectors.values()) {
      const mid = (rec.i + 0.5) * SECTOR_LEN;
      const d = Math.abs(deltaS(playerS, mid)) - SECTOR_LEN / 2;
      if (d > this.highLodDist + 60 && rec.foliageHigh) {
        this.scene.remove(rec.foliageHigh);
        rec.foliageHigh.geometry.dispose();
        rec.foliageHigh = null;
        rec.highState = 'none';
        if (rec.foliageLow) rec.foliageLow.visible = true;
      }
    }
    if (!this.lodJob) {
      let best = null;
      let bestD = Infinity;
      for (const rec of this.sectors.values()) {
        if (rec.highState !== 'none') continue;
        const mid = (rec.i + 0.5) * SECTOR_LEN;
        const d = Math.abs(deltaS(playerS, mid)) - SECTOR_LEN / 2;
        if (d < this.highLodDist && d < bestD) {
          best = rec;
          bestD = d;
        }
      }
      if (best) {
        best.highState = 'building';
        this.lodJob = { rec: best, gen: buildFoliageGen(best.data.trees, best.i) };
      }
    }
    while (this.lodJob && performance.now() - t0 < budgetMs) {
      const r = this.lodJob.gen.next();
      if (r.done) {
        const rec = this.lodJob.rec;
        this.lodJob = null;
        if (!this.sectors.has(rec.i)) break;
        rec.foliageHigh = this._mesh(r.value, this.mat.foliage, true);
        rec.highState = 'done';
        if (rec.foliageLow && rec.foliageHigh) rec.foliageLow.visible = false;
      }
    }
  }

  /** Sector records within `range` metres of s. */
  near(s, range = SECTOR_LEN) {
    const out = [];
    for (const rec of this.sectors.values()) {
      const mid = (rec.i + 0.5) * SECTOR_LEN;
      if (Math.abs(deltaS(s, mid)) < range + SECTOR_LEN / 2) out.push(rec);
    }
    return out;
  }

  get loadedCount() {
    return this.sectors.size;
  }
}
