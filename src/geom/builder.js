import * as THREE from 'three';
import { R0 } from '../core/config.js';

// Material "patterns" understood by the toon shader (stored in aux.x).
export const PAT = {
  PLAIN: 0,
  STONE: 1, // ashlar blocks
  FACADE: 2, // window grid (uv.x in window cells, uv.y in metres)
  ROOF: 3, // tile rows
  PANEL: 4, // habitat shell panels
  WOOD: 5, // planks
  GLASS: 6, // glazing, lit at night
  LEAF: 7, // foliage
  LAMP: 8, // lamp glass, glows at night
  METAL: 9,
  PAVING: 10,
  GREENHOUSE: 11,
  STRIPES: 12, // awnings / fabric
  SKYLIGHT: 13, // light fixtures on the shell
  TRAINWIN: 14, // continuous window band
  GLOW: 15, // always emissive
  GRASS: 16,
  FIREFLY: 17,
  STRANDS: 18, // drooping foliage (willows)
};

class GrowArray {
  constructor(Type, initial = 1024) {
    this.Type = Type;
    this.a = new Type(initial);
    this.n = 0;
  }
  reserve(extra) {
    if (this.n + extra > this.a.length) {
      let cap = this.a.length * 2;
      while (cap < this.n + extra) cap *= 2;
      const b = new this.Type(cap);
      b.set(this.a.subarray(0, this.n));
      this.a = b;
    }
  }
  view() {
    return this.a.slice(0, this.n);
  }
}

const _c = new THREE.Color();

/** Parse a colour (hex number, CSS string or [r,g,b] 0..1 sRGB) into sRGB bytes. */
export function srgbBytes(col, out = [0, 0, 0]) {
  if (Array.isArray(col)) {
    out[0] = Math.round(Math.min(1, Math.max(0, col[0])) * 255);
    out[1] = Math.round(Math.min(1, Math.max(0, col[1])) * 255);
    out[2] = Math.round(Math.min(1, Math.max(0, col[2])) * 255);
    return out;
  }
  _c.set(col); // stored linear by three when color management is on
  _c.convertLinearToSRGB();
  out[0] = Math.round(_c.r * 255);
  out[1] = Math.round(_c.g * 255);
  out[2] = Math.round(_c.b * 255);
  return out;
}

/** Shift an sRGB colour by small random amounts (for variety). */
export function jitterColor(col, r, amt = 0.06) {
  const b = srgbBytes(col);
  const k = 1 + (r() * 2 - 1) * amt;
  const hueShift = (r() * 2 - 1) * amt * 0.5;
  return [
    (b[0] / 255) * k * (1 + hueShift),
    (b[1] / 255) * k,
    (b[2] / 255) * k * (1 - hueShift),
  ];
}

// Unit icospheres, cached by detail level.
const icoCache = new Map();
export function icosphere(detail) {
  if (icoCache.has(detail)) return icoCache.get(detail);
  const g = new THREE.IcosahedronGeometry(1, detail);
  // IcosahedronGeometry is non-indexed; merge duplicate vertices.
  const pos = g.getAttribute('position');
  const map = new Map();
  const verts = [];
  const idx = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      map.set(key, id);
      const l = Math.hypot(x, y, z);
      verts.push(x / l, y / l, z / l);
    }
    idx.push(id);
  }
  // Keep outward winding.
  const res = { v: new Float32Array(verts), i: new Uint16Array(idx) };
  icoCache.set(detail, res);
  g.dispose();
  return res;
}

/**
 * Accumulates coloured, patterned geometry and outputs a BufferGeometry.
 *
 * Geometry is authored in a local object frame (x right, y up, -z forward),
 * optionally transformed by a local matrix stack, and finally placed on the
 * ring either rigidly (placement matrix) or "bent" so long objects follow the
 * ring's curvature.
 */
export class MeshBuilder {
  constructor() {
    this.P = new GrowArray(Float32Array, 4096 * 3);
    this.N = new GrowArray(Int16Array, 4096 * 3);
    this.C = new GrowArray(Uint8Array, 4096 * 4);
    this.UV = new GrowArray(Float32Array, 4096 * 2);
    this.A = new GrowArray(Uint8Array, 4096 * 4);
    this.I = new GrowArray(Uint32Array, 8192);
    this.col = [200, 200, 200];
    this.alpha = 255;
    this.aux = [0, 0, 0, 0];
    // local affine (3x4, column major like THREE.Matrix4 without last row)
    this.L = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    this.Ln = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]); // inverse-transpose of L's 3x3
    this.stack = [];
    this.place = null; // Float64Array(16) rigid placement
    this.bend = null; // {s, u, h, cy, sy}
    this.vertexCount = 0;
  }

  // ----- state -----------------------------------------------------------
  color(c) {
    srgbBytes(c, this.col);
    return this;
  }
  colorBytes(r, g, b) {
    this.col[0] = r;
    this.col[1] = g;
    this.col[2] = b;
    return this;
  }
  pattern(p, seed = this.aux[1] / 255) {
    this.aux[0] = p;
    this.aux[1] = Math.round(Math.min(1, Math.max(0, seed)) * 255);
    return this;
  }
  sway(v) {
    this.aux[2] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    return this;
  }
  extra(v) {
    this.aux[3] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    return this;
  }
  /** Colour alpha channel carries ambient occlusion (1 = unoccluded). */
  ao(v) {
    this.alpha = Math.round(Math.min(1, Math.max(0, v)) * 255);
    return this;
  }
  reset() {
    this.aux[0] = 0;
    this.aux[1] = 0;
    this.aux[2] = 0;
    this.aux[3] = 0;
    this.alpha = 255;
    return this;
  }

  /** Rigid placement from a THREE.Matrix4. */
  placeMatrix(m) {
    this.place = Float64Array.from(m.elements);
    this.bend = null;
    return this;
  }
  /** Bent placement: local x → +u, y → +h, -z → +s, rotated by yaw. */
  placeBent(s, u, h, yaw = 0) {
    this.bend = { s, u, h, cy: Math.cos(yaw), sy: Math.sin(yaw) };
    this.place = null;
    return this;
  }
  identity() {
    this.L.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    this.stack.length = 0;
    this._updateNormalMatrix();
    return this;
  }
  push() {
    this.stack.push(Float64Array.from(this.L));
    return this;
  }
  pop() {
    this.L.set(this.stack.pop());
    this._updateNormalMatrix();
    return this;
  }
  _updateNormalMatrix() {
    const m = this.L;
    const a = m[0], b = m[3], c = m[6];
    const d = m[1], e = m[4], f = m[7];
    const g = m[2], h = m[5], i = m[8];
    // cofactor matrix = det * inverse-transpose; the scale doesn't matter for normals
    const n = this.Ln;
    n[0] = e * i - f * h; n[3] = -(d * i - f * g); n[6] = d * h - e * g;
    n[1] = -(b * i - c * h); n[4] = a * i - c * g; n[7] = -(a * h - b * g);
    n[2] = b * f - c * e; n[5] = -(a * f - c * d); n[8] = a * e - b * d;
    // orientation fix when det < 0
    const det = a * n[0] + b * n[3] + c * n[6];
    if (det < 0) for (let k = 0; k < 9; k++) n[k] = -n[k];
  }
  _mul(m) {
    // L = L * m (m: 3x4 column major)
    const a = this.L;
    const r = new Float64Array(12);
    for (let c = 0; c < 3; c++) {
      for (let rr = 0; rr < 3; rr++) {
        r[c * 3 + rr] = a[rr] * m[c * 3] + a[3 + rr] * m[c * 3 + 1] + a[6 + rr] * m[c * 3 + 2];
      }
    }
    for (let rr = 0; rr < 3; rr++) {
      r[9 + rr] = a[rr] * m[9] + a[3 + rr] * m[10] + a[6 + rr] * m[11] + a[9 + rr];
    }
    this.L.set(r);
    this._updateNormalMatrix();
    return this;
  }
  translate(x, y, z) {
    return this._mul([1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z]);
  }
  rotateY(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return this._mul([c, 0, -s, 0, 1, 0, s, 0, c, 0, 0, 0]);
  }
  rotateX(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return this._mul([1, 0, 0, 0, c, s, 0, -s, c, 0, 0, 0]);
  }
  rotateZ(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return this._mul([c, s, 0, -s, c, 0, 0, 0, 1, 0, 0, 0]);
  }
  scale(x, y = x, z = x) {
    return this._mul([x, 0, 0, 0, y, 0, 0, 0, z, 0, 0, 0]);
  }

  // ----- raw emission ------------------------------------------------------
  vert(x, y, z, nx, ny, nz, tu = 0, tv = 0) {
    const L = this.L;
    // local transform
    const px = L[0] * x + L[3] * y + L[6] * z + L[9];
    const py = L[1] * x + L[4] * y + L[7] * z + L[10];
    const pz = L[2] * x + L[5] * y + L[8] * z + L[11];
    const Ln = this.Ln;
    const qx = Ln[0] * nx + Ln[3] * ny + Ln[6] * nz;
    const qy = Ln[1] * nx + Ln[4] * ny + Ln[7] * nz;
    const qz = Ln[2] * nx + Ln[5] * ny + Ln[8] * nz;
    let wx;
    let wy;
    let wz;
    let mx;
    let my;
    let mz;
    if (this.place) {
      const e = this.place;
      wx = e[0] * px + e[4] * py + e[8] * pz + e[12];
      wy = e[1] * px + e[5] * py + e[9] * pz + e[13];
      wz = e[2] * px + e[6] * py + e[10] * pz + e[14];
      mx = e[0] * qx + e[4] * qy + e[8] * qz;
      my = e[1] * qx + e[5] * qy + e[9] * qz;
      mz = e[2] * qx + e[6] * qy + e[10] * qz;
    } else if (this.bend) {
      const B = this.bend;
      // yaw within the tangent plane (matches placementMatrix): local x → right, -z → forward
      const du = B.cy * px - B.sy * pz;
      const ds = -B.sy * px - B.cy * pz;
      const h = B.h + py;
      const s = B.s + (ds * R0) / (R0 - h);
      const th = s / R0;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const r = R0 - h;
      wx = r * c;
      wy = r * sn;
      wz = B.u + du;
      const nu = B.cy * qx - B.sy * qz;
      const ns = -B.sy * qx - B.cy * qz;
      // world = nu*lat + qy*up + ns*fwd ; up = (-c,-sn,0), fwd = (-sn, c, 0)
      mx = -qy * c - ns * sn;
      my = -qy * sn + ns * c;
      mz = nu;
    } else {
      wx = px;
      wy = py;
      wz = pz;
      mx = qx;
      my = qy;
      mz = qz;
    }
    const l = Math.hypot(mx, my, mz) || 1;
    const P = this.P;
    const N = this.N;
    const C = this.C;
    const UV = this.UV;
    const A = this.A;
    P.reserve(3);
    N.reserve(3);
    C.reserve(4);
    UV.reserve(2);
    A.reserve(4);
    P.a[P.n++] = wx;
    P.a[P.n++] = wy;
    P.a[P.n++] = wz;
    N.a[N.n++] = Math.round((mx / l) * 32767);
    N.a[N.n++] = Math.round((my / l) * 32767);
    N.a[N.n++] = Math.round((mz / l) * 32767);
    C.a[C.n++] = this.col[0];
    C.a[C.n++] = this.col[1];
    C.a[C.n++] = this.col[2];
    C.a[C.n++] = this.alpha;
    UV.a[UV.n++] = tu;
    UV.a[UV.n++] = tv;
    A.a[A.n++] = this.aux[0];
    A.a[A.n++] = this.aux[1];
    A.a[A.n++] = this.aux[2];
    A.a[A.n++] = this.aux[3];
    return this.vertexCount++;
  }
  tri(a, b, c) {
    const I = this.I;
    I.reserve(3);
    I.a[I.n++] = a;
    I.a[I.n++] = b;
    I.a[I.n++] = c;
  }
  quad(a, b, c, d) {
    // a-b-c-d counter-clockwise
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  // ----- primitives --------------------------------------------------------

  /**
   * Flat quad with explicit corners (counter-clockwise seen from the front).
   * uv: optional [u0,v0,u1,v1] mapped a→(u0,v0), c→(u1,v1).
   */
  quadFace(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, uv) {
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = dx - ax;
    const vy = dy - ay;
    const vz = dz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const [u0, v0, u1, v1] = uv || [0, 0, 1, 1];
    const i0 = this.vert(ax, ay, az, nx, ny, nz, u0, v0);
    const i1 = this.vert(bx, by, bz, nx, ny, nz, u1, v0);
    const i2 = this.vert(cx, cy, cz, nx, ny, nz, u1, v1);
    const i3 = this.vert(dx, dy, dz, nx, ny, nz, u0, v1);
    this.quad(i0, i1, i2, i3);
  }

  /**
   * Axis-aligned box centred at (cx, cy, cz) with size (sx, sy, sz).
   * opts.uv: 'metres' (default) — each face gets planar uv in metres;
   *          'facade' — side faces get uv.x in window cells (opts.cell wide), uv.y metres from box bottom.
   * opts.skip: set of faces to omit ('px','nx','py','ny','pz','nz').
   * opts.faceColors: per face colour overrides.
   */
  box(cx, cy, cz, sx, sy, sz, opts = {}) {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const skip = opts.skip || '';
    const facade = opts.uv === 'facade';
    const cell = opts.cell || 2.6;
    const vOff = opts.vOff || 0;
    const fc = opts.faceColors;
    const saved = fc ? this.col.slice() : null;
    const face = (name, fn) => {
      if (skip.includes(name)) return;
      if (fc && fc[name] !== undefined) this.color(fc[name]);
      fn();
      if (fc) this.col = saved.slice();
    };
    const sideUV = (w, hgt) => (facade ? [0, vOff, Math.max(1, Math.round(w / cell)), vOff + hgt] : [0, 0, w, hgt]);
    const topPat = opts.topPattern;
    // +z (back, faces viewer looking -z)
    face('pz', () => this.quadFace(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, sideUV(sx, sy)));
    face('nz', () => this.quadFace(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, sideUV(sx, sy)));
    face('px', () => this.quadFace(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, sideUV(sz, sy)));
    face('nx', () => this.quadFace(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, sideUV(sz, sy)));
    face('py', () => {
      let saveAux;
      if (topPat !== undefined) {
        saveAux = this.aux.slice();
        this.aux[0] = topPat;
      }
      this.quadFace(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, [x0, z1, x1, z0]);
      if (saveAux) this.aux = saveAux;
    });
    face('ny', () => this.quadFace(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, [0, 0, sx, sz]));
  }

  /** Box with bevelled vertical edges (octagonal footprint) — reads much softer under outlines. */
  bevelBox(cx, cy, cz, sx, sy, sz, bevel, opts = {}) {
    const b = Math.min(bevel, sx * 0.3, sz * 0.3);
    const hx = sx / 2;
    const hz = sz / 2;
    const pts = [
      [hx - b, -hz], [hx, -hz + b], [hx, hz - b], [hx - b, hz],
      [-hx + b, hz], [-hx, hz - b], [-hx, -hz + b], [-hx + b, -hz],
    ];
    this.prism(cx, cy - sy / 2, cz, pts, sy, opts);
  }

  /**
   * Vertical prism from a convex CCW (seen from above, x right, z towards viewer
   * i.e. we treat [x, z]) footprint polygon.
   */
  prism(cx, y0, cz, pts, height, opts = {}) {
    const n = pts.length;
    const y1 = y0 + height;
    const facade = opts.uv === 'facade';
    const cell = opts.cell || 2.6;
    const vOff = opts.vOff || 0;
    // sides
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % n];
      const w = Math.hypot(bx - ax, bz - az);
      if (w < 1e-4) continue;
      const cells = facade ? Math.max(1, Math.round(w / cell)) : w;
      // Wind so the outward normal points away from the centre.
      this.quadFace(
        cx + bx, y0, cz + bz,
        cx + ax, y0, cz + az,
        cx + ax, y1, cz + az,
        cx + bx, y1, cz + bz,
        facade ? [0, vOff, cells, vOff + height] : [0, 0, cells, height],
      );
    }
    if (!opts.noTop) {
      let saveAux;
      if (opts.topPattern !== undefined) {
        saveAux = this.aux.slice();
        this.aux[0] = opts.topPattern;
      }
      if (opts.topColor !== undefined) {
        this._savedCol = this.col.slice();
        this.color(opts.topColor);
      }
      const c = this.vert(cx, y1, cz, 0, 1, 0, cx, cz);
      const idx = pts.map(([x, z]) => this.vert(cx + x, y1, cz + z, 0, 1, 0, cx + x, cz + z));
      for (let i = 0; i < n; i++) this.tri(c, idx[(i + 1) % n], idx[i]);
      if (saveAux) this.aux = saveAux;
      if (opts.topColor !== undefined) this.col = this._savedCol;
    }
    if (opts.bottom) {
      const c = this.vert(cx, y0, cz, 0, -1, 0);
      const idx = pts.map(([x, z]) => this.vert(cx + x, y0, cz + z, 0, -1, 0));
      for (let i = 0; i < n; i++) this.tri(c, idx[i], idx[(i + 1) % n]);
    }
  }

  /**
   * Cylinder / frustum along +y from y0, centred at (cx, cz).
   * opts: caps ('both' | 'top' | 'bottom' | 'none'), smooth (default true), uvScale
   */
  cylinder(cx, y0, cz, rBot, rTop, height, segs = 12, opts = {}) {
    const caps = opts.caps || 'both';
    const smooth = opts.smooth !== false;
    const y1 = y0 + height;
    const slope = (rBot - rTop) / height;
    const a0 = opts.angle0 || 0;
    const ring = [];
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (i / segs) * Math.PI * 2;
      ring.push([Math.cos(a), Math.sin(a)]);
    }
    const circ = 2 * Math.PI * Math.max(rBot, rTop);
    if (smooth) {
      const base = [];
      for (let i = 0; i <= segs; i++) {
        const [c, s] = ring[i];
        const nl = Math.hypot(1, slope);
        const nx = c / nl;
        const nz = s / nl;
        const ny = slope / nl;
        const tu = (i / segs) * circ;
        base.push(this.vert(cx + c * rBot, y0, cz + s * rBot, nx, ny, nz, tu, 0));
        base.push(this.vert(cx + c * rTop, y1, cz + s * rTop, nx, ny, nz, tu, height));
      }
      for (let i = 0; i < segs; i++) {
        const a = base[i * 2];
        const b = base[i * 2 + 1];
        const c = base[i * 2 + 2];
        const d = base[i * 2 + 3];
        // outward facing: a(bottom i) → c(bottom i+1) → d(top i+1) → b(top i)?
        this.tri(a, b, c);
        this.tri(b, d, c);
      }
    } else {
      for (let i = 0; i < segs; i++) {
        const [c0, s0] = ring[i];
        const [c1, s1] = ring[i + 1];
        this.quadFace(
          cx + c1 * rBot, y0, cz + s1 * rBot,
          cx + c0 * rBot, y0, cz + s0 * rBot,
          cx + c0 * rTop, y1, cz + s0 * rTop,
          cx + c1 * rTop, y1, cz + s1 * rTop,
          [0, 0, 1, height],
        );
      }
    }
    if ((caps === 'both' || caps === 'top') && rTop > 0.001) {
      const c = this.vert(cx, y1, cz, 0, 1, 0, cx, cz);
      const idx = [];
      for (let i = 0; i < segs; i++) {
        const [co, si] = ring[i];
        idx.push(this.vert(cx + co * rTop, y1, cz + si * rTop, 0, 1, 0, cx + co * rTop, cz + si * rTop));
      }
      for (let i = 0; i < segs; i++) this.tri(c, idx[(i + 1) % segs], idx[i]);
    }
    if ((caps === 'both' || caps === 'bottom') && rBot > 0.001) {
      const c = this.vert(cx, y0, cz, 0, -1, 0);
      const idx = [];
      for (let i = 0; i < segs; i++) {
        const [co, si] = ring[i];
        idx.push(this.vert(cx + co * rBot, y0, cz + si * rBot, 0, -1, 0));
      }
      for (let i = 0; i < segs; i++) this.tri(c, idx[i], idx[(i + 1) % segs]);
    }
  }

  /** Cylinder between two arbitrary local points (for branches, struts, rails). */
  tube(x0, y0, z0, x1, y1, z1, r0, r1 = r0, segs = 6, caps = 'none') {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return;
    // basis with y along the segment
    const ay = [dx / len, dy / len, dz / len];
    let ref = Math.abs(ay[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const ax = [ay[1] * ref[2] - ay[2] * ref[1], ay[2] * ref[0] - ay[0] * ref[2], ay[0] * ref[1] - ay[1] * ref[0]];
    const la = Math.hypot(...ax);
    ax[0] /= la;
    ax[1] /= la;
    ax[2] /= la;
    const az = [ax[1] * ay[2] - ax[2] * ay[1], ax[2] * ay[0] - ax[0] * ay[2], ax[0] * ay[1] - ax[1] * ay[0]];
    this.push();
    this._mul([ax[0], ax[1], ax[2], ay[0], ay[1], ay[2], az[0], az[1], az[2], x0, y0, z0]);
    this.cylinder(0, 0, 0, r0, r1, len, segs, { caps });
    this.pop();
  }

  /** Smooth sphere / ellipsoid. detail: icosphere subdivision level. */
  sphere(cx, cy, cz, rx, ry = rx, rz = rx, detail = 2, displace = null) {
    const ico = icosphere(detail);
    const v = ico.v;
    const base = this.vertexCount;
    for (let i = 0; i < v.length; i += 3) {
      let x = v[i];
      let y = v[i + 1];
      let z = v[i + 2];
      let k = 1;
      if (displace) k = displace(x, y, z);
      // ellipsoid normal: gradient of (x/rx)^2+... → (x/rx, y/ry, z/rz)
      this.vert(cx + x * rx * k, cy + y * ry * k, cz + z * rz * k, x / rx, y / ry, z / rz, x, y);
    }
    const idx = ico.i;
    for (let i = 0; i < idx.length; i += 3) this.tri(base + idx[i], base + idx[i + 1], base + idx[i + 2]);
  }

  /** Hemisphere dome (upper half) of radius r at (cx, y0, cz). */
  dome(cx, y0, cz, r, ry = r, segs = 16, rings = 6) {
    const base = this.vertexCount;
    for (let j = 0; j <= rings; j++) {
      const phi = (j / rings) * (Math.PI / 2);
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = Math.cos(a) * cp;
        const z = Math.sin(a) * cp;
        this.vert(cx + x * r, y0 + sp * ry, cz + z * r, x / r, sp / ry, z / r, i / segs, j / rings);
      }
    }
    const w = segs + 1;
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const a = base + j * w + i;
        const b = a + 1;
        const c = a + w;
        const d = c + 1;
        this.tri(a, c, b);
        this.tri(b, c, d);
      }
    }
  }

  /** Surface of revolution around the local y axis from a profile [[r, y], ...]. */
  lathe(cx, cy, cz, profile, segs = 16, opts = {}) {
    const base = this.vertexCount;
    const n = profile.length;
    // profile normals (2D) via neighbour differences
    const pn = [];
    for (let j = 0; j < n; j++) {
      const p0 = profile[Math.max(0, j - 1)];
      const p1 = profile[Math.min(n - 1, j + 1)];
      const dr = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const l = Math.hypot(dr, dy) || 1;
      pn.push([dy / l, -dr / l]);
    }
    for (let i = 0; i <= segs; i++) {
      const a = (opts.angle0 || 0) + (i / segs) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (let j = 0; j < n; j++) {
        const [r, y] = profile[j];
        const [nr, ny] = pn[j];
        this.vert(cx + c * r, cy + y, cz + s * r, c * nr, ny, s * nr, (i / segs) * 2 * Math.PI * r, y);
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < n - 1; j++) {
        const a = base + i * n + j;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        this.tri(a, b, c);
        this.tri(b, d, c);
      }
    }
  }

  /** Cone from base radius at y0 to apex at y0 + height. */
  cone(cx, y0, cz, r, height, segs = 12) {
    this.cylinder(cx, y0, cz, r, 0.0001, height, segs, { caps: 'bottom' });
  }

  /**
   * Extrude a closed 2D profile (in the local x/y plane, CCW) along a polyline in
   * the local x/z plane (list of [x, y, z]); profile x maps to the path's left/right.
   */
  sweep(profile, path, closed = false, smoothProfile = false) {
    const n = profile.length;
    const m = path.length;
    for (let i = 0; i < m - 1; i++) {
      const p0 = path[i];
      const p1 = path[i + 1];
      const pPrev = path[Math.max(0, i - 1)];
      const pNext = path[Math.min(m - 1, i + 2)];
      const frame = (a, b) => {
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const l = Math.hypot(dx, dz) || 1;
        return [dz / l, -dx / l]; // right vector in x/z
      };
      const r0 = frame(pPrev, p1);
      const r1 = frame(p0, pNext);
      for (let j = 0; j < n; j++) {
        const q0 = profile[j];
        const q1 = profile[(j + 1) % n];
        if (!closed && j === n - 1) break;
        const A = [p0[0] + r0[0] * q0[0], p0[1] + q0[1], p0[2] + r0[1] * q0[0]];
        const B = [p0[0] + r0[0] * q1[0], p0[1] + q1[1], p0[2] + r0[1] * q1[0]];
        const C = [p1[0] + r1[0] * q1[0], p1[1] + q1[1], p1[2] + r1[1] * q1[0]];
        const D = [p1[0] + r1[0] * q0[0], p1[1] + q0[1], p1[2] + r1[1] * q0[0]];
        void smoothProfile;
        this.quadFace(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], D[0], D[1], D[2]);
      }
    }
  }

  /** Append the contents of another builder (already in world space). */
  merge(other) {
    const off = this.vertexCount;
    const add = (dst, src) => {
      dst.reserve(src.n);
      dst.a.set(src.a.subarray(0, src.n), dst.n);
      dst.n += src.n;
    };
    add(this.P, other.P);
    add(this.N, other.N);
    add(this.C, other.C);
    add(this.UV, other.UV);
    add(this.A, other.A);
    this.I.reserve(other.I.n);
    for (let i = 0; i < other.I.n; i++) this.I.a[this.I.n++] = other.I.a[i] + off;
    this.vertexCount += other.vertexCount;
  }

  get empty() {
    return this.vertexCount === 0;
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.view(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.view(), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.view(), 4, true));
    g.setAttribute('uv', new THREE.BufferAttribute(this.UV.view(), 2));
    g.setAttribute('aux', new THREE.BufferAttribute(this.A.view(), 4, true));
    const idx = this.I.view();
    g.setIndex(new THREE.BufferAttribute(this.vertexCount > 65535 ? idx : Uint16Array.from(idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
