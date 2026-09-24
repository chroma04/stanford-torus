import { CIRC } from './config.js';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export function smoothstep(e0, e1, x) {
  const t = saturate((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
export const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// ---------------------------------------------------------------------------
// Hashing & seeded randomness

function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic 32-bit hash of up to four integers. */
export function hash(a, b = 0, c = 0, d = 0) {
  let h = mix32((a | 0) + 0x9e3779b9);
  h = mix32(h ^ ((b | 0) + 0x632be5ab));
  h = mix32(h ^ ((c | 0) + 0x85157af5));
  h = mix32(h ^ ((d | 0) + 0x2c1b3c6d));
  return h;
}

/** Hash to a float in [0, 1). */
export const hashf = (a, b = 0, c = 0, d = 0) => hash(a, b, c, d) / 4294967296;

/** mulberry32 PRNG with a few conveniences. */
export function rng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  r.sign = () => (r() < 0.5 ? -1 : 1);
  r.normal = () => {
    const u = Math.max(1e-9, r());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  };
  r.weighted = (items) => {
    // items: [[value, weight], ...]
    let total = 0;
    for (const it of items) total += it[1];
    let x = r() * total;
    for (const it of items) {
      x -= it[1];
      if (x <= 0) return it[0];
    }
    return items[items.length - 1][0];
  };
  return r;
}

// ---------------------------------------------------------------------------
// Noise. Everything that varies along the ring is periodic in s with period
// CIRC so the world closes seamlessly on itself.

function lattice(wavelength) {
  return Math.max(1, Math.round(CIRC / wavelength));
}

function grad1(seed, i) {
  return hashf(seed, i) * 2 - 1;
}

/** 1D gradient noise along the ring, roughly in [-1, 1]. */
export function noiseS(s, wavelength, seed) {
  const n = lattice(wavelength);
  const x = (s / CIRC) * n;
  const fi = Math.floor(x);
  const f = x - fi;
  const i = ((fi % n) + n) % n;
  const j = i + 1 === n ? 0 : i + 1;
  const a = grad1(seed, i) * f;
  const b = grad1(seed, j) * (f - 1);
  return (a + (b - a) * fade(f)) * 2;
}

/** Fractal sum of noiseS octaves. */
export function fbmS(s, wavelength, seed, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let wl = wavelength;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noiseS(s, wl, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    wl *= 0.5;
  }
  return sum / norm;
}

const GRAD_ANG = new Float32Array(256);
for (let i = 0; i < 256; i++) GRAD_ANG[i] = (i / 256) * Math.PI * 2 + 0.37;

function g2(seed, i, j, x, y) {
  const a = GRAD_ANG[hash(seed, i, j) & 255];
  return Math.cos(a) * x + Math.sin(a) * y;
}

/**
 * 2D gradient noise over (s, u): periodic in s, open in u. Roughly in [-1, 1].
 * `wavelength` applies to both axes.
 */
export function noise2(s, u, wavelength, seed) {
  const n = lattice(wavelength);
  const cell = CIRC / n;
  const x = s / cell;
  const y = u / cell;
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const tx = x - fx;
  const ty = y - fy;
  const i0 = ((fx % n) + n) % n;
  const i1 = i0 + 1 === n ? 0 : i0 + 1;
  const v00 = g2(seed, i0, fy, tx, ty);
  const v10 = g2(seed, i1, fy, tx - 1, ty);
  const v01 = g2(seed, i0, fy + 1, tx, ty - 1);
  const v11 = g2(seed, i1, fy + 1, tx - 1, ty - 1);
  const sx = fade(tx);
  const sy = fade(ty);
  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return (a + (b - a) * sy) * 1.6;
}

export function fbm2(s, u, wavelength, seed, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let wl = wavelength;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(s, u, wl, seed + o * 131);
    norm += amp;
    amp *= 0.5;
    wl *= 0.5;
  }
  return sum / norm;
}

/** Plain (non-periodic) 3D value noise for decorating meshes. */
export function noise3(x, y, z, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const v = (a, b, c) => hashf(seed, ix + a, iy + b, iz + c);
  const x00 = lerp(v(0, 0, 0), v(1, 0, 0), fx);
  const x10 = lerp(v(0, 1, 0), v(1, 1, 0), fx);
  const x01 = lerp(v(0, 0, 1), v(1, 0, 1), fx);
  const x11 = lerp(v(0, 1, 1), v(1, 1, 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz) * 2 - 1;
}

// ---------------------------------------------------------------------------
// Ring-periodic helpers

export function wrapS(s) {
  s %= CIRC;
  return s < 0 ? s + CIRC : s;
}

/** Signed shortest distance from a to b around the ring, in (-CIRC/2, CIRC/2]. */
export function deltaS(a, b) {
  let d = (b - a) % CIRC;
  if (d > CIRC / 2) d -= CIRC;
  else if (d <= -CIRC / 2) d += CIRC;
  return d;
}

export function wrapIndex(i, n) {
  return ((i % n) + n) % n;
}
