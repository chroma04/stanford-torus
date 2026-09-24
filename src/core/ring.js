import * as THREE from 'three';
import { R0, CIRC } from './config.js';

// Conversions between ring coordinates (s, u, h) and world space.
// See config.js for the conventions.

export function ringToWorld(s, u, h, out = new THREE.Vector3()) {
  const th = s / R0;
  const r = R0 - h;
  out.x = r * Math.cos(th);
  out.y = r * Math.sin(th);
  out.z = u;
  return out;
}

export function worldToRing(p, out = { s: 0, u: 0, h: 0 }) {
  let th = Math.atan2(p.y, p.x);
  if (th < 0) th += Math.PI * 2;
  out.s = th * R0;
  out.u = p.z;
  out.h = R0 - Math.hypot(p.x, p.y);
  return out;
}

/** Local unit vectors at arc position s: up (towards the axis), fwd (+s), lat (+u). */
export function frameAt(s, up = new THREE.Vector3(), fwd = new THREE.Vector3(), lat = new THREE.Vector3()) {
  const th = s / R0;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  up.set(-c, -sn, 0);
  fwd.set(-sn, c, 0);
  lat.set(0, 0, 1);
  return { up, fwd, lat };
}

const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _right = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _back = new THREE.Vector3();
const _pos = new THREE.Vector3();

/**
 * Rigid placement matrix for an object standing at (s, u, h), rotated by `yaw`
 * about the local up axis. Local axes: +x right, +y up, -z forward. With yaw = 0
 * the object's forward (-z) points along +s and its right (+x) along +u.
 */
export function placementMatrix(s, u, h, yaw = 0, scale = 1, out = new THREE.Matrix4()) {
  frameAt(s, _up, _fwd, _lat);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  _forward.copy(_fwd).multiplyScalar(cy).addScaledVector(_lat, sy);
  _right.copy(_lat).multiplyScalar(cy).addScaledVector(_fwd, -sy);
  _back.copy(_forward).negate();
  ringToWorld(s, u, h, _pos);
  const e = out.elements;
  e[0] = _right.x * scale; e[1] = _right.y * scale; e[2] = _right.z * scale; e[3] = 0;
  e[4] = _up.x * scale; e[5] = _up.y * scale; e[6] = _up.z * scale; e[7] = 0;
  e[8] = _back.x * scale; e[9] = _back.y * scale; e[10] = _back.z * scale; e[11] = 0;
  e[12] = _pos.x; e[13] = _pos.y; e[14] = _pos.z; e[15] = 1;
  return out;
}

export const sectorOfS = (s, sectorLen) => Math.floor((((s % CIRC) + CIRC) % CIRC) / sectorLen);
