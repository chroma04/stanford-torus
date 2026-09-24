import { groundHeight } from './layout.js';
import { deltaS, clamp } from '../core/math.js';
import { MAX_STEP, WATER_H } from '../core/config.js';

// Walkable surfaces and obstacles around the player, in ring coordinates.

const BODY_R = 0.32;
const HEAD = 1.75;

function colliderSurface(c, s, u, out) {
  // returns { top, thin } if (s,u) is within the collider footprint (inflated by BODY_R)
  switch (c.t) {
    case 'circle': {
      const ds = deltaS(c.s, s);
      const du = u - c.u;
      const r = c.r + BODY_R;
      if (ds * ds + du * du > r * r) return null;
      out.top = c.top;
      out.bottom = c.bottom;
      out.thin = false;
      return out;
    }
    case 'box': {
      let ds = deltaS(c.s, s);
      let du = u - c.u;
      if (c.yaw) {
        // into the object's frame: hs is along its local forward (-z), hu along local x
        const cy = Math.cos(c.yaw);
        const sy = Math.sin(c.yaw);
        const lf = ds * cy + du * sy;
        const lx = du * cy - ds * sy;
        ds = lf;
        du = lx;
      }
      if (Math.abs(ds) > c.hs + BODY_R || Math.abs(du) > c.hu + BODY_R) return null;
      out.top = c.top;
      out.bottom = c.bottom;
      out.thin = false;
      return out;
    }
    case 'ramp': {
      const lo = Math.min(c.sLow, c.sHigh);
      const len = Math.abs(c.sHigh - c.sLow);
      const d = deltaS(lo, s);
      if (d < -0.05 || d > len + 0.05 || u < c.uMin - 0.05 || u > c.uMax + 0.05) return null;
      const t = clamp(deltaS(c.sLow, s) / (c.sHigh - c.sLow), 0, 1);
      out.top = c.hLow + (c.hHigh - c.hLow) * t;
      out.bottom = c.hLow - 1;
      out.thin = false;
      return out;
    }
    case 'deck': {
      const ds = deltaS(c.s, s);
      if (Math.abs(ds) > c.hw) return null;
      const a = Math.min(c.uA, c.uB);
      const b = Math.max(c.uA, c.uB);
      if (u < a - 0.1 || u > b + 0.1) return null;
      let top;
      if (c.flat) top = c.hA;
      else {
        const t = clamp((u - c.uA) / (c.uB - c.uA), 0, 1);
        const span = c.uB - c.uA;
        const k = (u - c.c) / (span / 2);
        top = c.hA + (c.hB - c.hA) * t + c.rise * Math.max(0, 1 - k * k) * 0.9 + 0.05;
      }
      out.top = top;
      out.bottom = top - 0.7;
      out.thin = true;
      return out;
    }
    default:
      return null;
  }
}

const _o = { top: 0, bottom: 0, thin: false };

/**
 * Query the ground at (s, u) for a body whose feet are at `feet`.
 * Returns { ground, blocked, water }.
 */
export function probe(manager, s, u, feet, out = {}) {
  const terrain = groundHeight(s, u);
  let ground = terrain;
  let blocked = terrain > feet + MAX_STEP;
  const recs = manager.near(s, 30);
  for (const rec of recs) {
    const cols = rec.data.colliders;
    for (let k = 0; k < cols.length; k++) {
      const c = cols[k];
      const r = colliderSurface(c, s, u, _o);
      if (!r) continue;
      if (r.top <= feet + MAX_STEP) {
        if (r.top > ground) ground = r.top;
      } else if (!r.thin || (r.bottom < feet + HEAD && r.top > feet)) {
        if (r.bottom < feet + HEAD) blocked = true;
      }
    }
  }
  out.water = terrain < WATER_H && feet < WATER_H + 0.05;
  // deep water: swim with the head above the surface
  if (terrain < WATER_H - 1.1 && ground < WATER_H - 1.1) ground = WATER_H - 1.1;
  out.ground = ground;
  out.terrain = terrain;
  out.blocked = blocked;
  return out;
}

export { BODY_R };
