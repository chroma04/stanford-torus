import * as THREE from 'three';
import { smoothstep, lerp } from '../core/math.js';
import { U } from './materials.js';

// Day/night cycle. The habitat's "sun" is sunlight bounced in by the mirrors;
// the mirror array is steered through the day so the light rakes in low from
// one end of the valley in the morning and the other in the evening, and is
// shuttered at night.

const C = (r, g, b) => new THREE.Color(r, g, b);
const KEYS = {
  sunDay: C(1.0, 0.95, 0.86),
  sunLow: C(1.0, 0.68, 0.42),
  sunNight: C(0.2, 0.26, 0.42),
  skyDay: C(0.44, 0.52, 0.66),
  skyDusk: C(0.46, 0.4, 0.55),
  skyNight: C(0.05, 0.07, 0.13),
  gndDay: C(0.36, 0.33, 0.26),
  gndDusk: C(0.34, 0.26, 0.24),
  gndNight: C(0.03, 0.035, 0.05),
  fogDay: C(0.74, 0.84, 0.94),
  fogDusk: C(0.9, 0.72, 0.66),
  fogNight: C(0.03, 0.04, 0.08),
  zenDay: C(0.52, 0.76, 0.98),
  zenDusk: C(0.48, 0.44, 0.78),
  horDay: C(0.86, 0.94, 1.0),
  horDusk: C(1.0, 0.7, 0.52),
  waterDay: C(0.72, 0.86, 0.95),
  waterDusk: C(0.9, 0.7, 0.62),
  waterNight: C(0.04, 0.06, 0.12),
};

const _c = new THREE.Color();

export class Environment {
  constructor() {
    this.time = 9.5; // hours
    this.speed = 1 / 120; // game hours per real second (1 day ≈ 48 min)
    this.paused = false;
    this.day = 1;
    this.night = 0;
  }

  advance(dt) {
    if (!this.paused) this.time = (this.time + dt * this.speed) % 24;
  }

  apply(sky, exterior, post) {
    const t = this.time;
    const day = smoothstep(5.2, 7.0, t) * (1 - smoothstep(18.3, 20.0, t));
    const dusk = Math.max(1 - Math.abs(t - 6.4) / 1.4, 1 - Math.abs(t - 18.9) / 1.5, 0);
    this.day = day;
    this.night = 1 - day;
    // mirror angle: -55° at 6h … +55° at 18h
    const a = THREE.MathUtils.clamp((t - 12) / 6, -1.15, 1.15) * THREE.MathUtils.degToRad(52);
    const lat = 0.3;
    const sun = new THREE.Vector3(lat, Math.cos(a), Math.sin(a)).normalize();
    const moon = new THREE.Vector3(-0.25, 1, 0.2).normalize();
    U.uSun.value.copy(sun).lerp(moon, 1 - day).normalize();
    const low = smoothstep(0.35, 0.95, Math.abs(Math.sin(a)));
    _c.copy(KEYS.sunDay).lerp(KEYS.sunLow, Math.max(low * 0.8, dusk));
    U.uSunColor.value.copy(_c).multiplyScalar(lerp(0.0, 1.0, day)).lerp(KEYS.sunNight, (1 - day) * 0.7);
    U.uSkyAmb.value.copy(KEYS.skyDay).lerp(KEYS.skyDusk, dusk * 0.7).lerp(KEYS.skyNight, 1 - day);
    U.uGroundAmb.value.copy(KEYS.gndDay).lerp(KEYS.gndDusk, dusk * 0.7).lerp(KEYS.gndNight, 1 - day);
    U.uFogColor.value.copy(KEYS.fogDay).lerp(KEYS.fogDusk, dusk * 0.8).lerp(KEYS.fogNight, 1 - day);
    U.uSkyTint.value.copy(KEYS.waterDay).lerp(KEYS.waterDusk, dusk * 0.8).lerp(KEYS.waterNight, 1 - day);
    U.uNight.value = smoothstep(0.25, 0.9, 1 - day);
    const su = sky.material.uniforms;
    su.uDay.value = day;
    su.uSkyZenith.value.copy(KEYS.zenDay).lerp(KEYS.zenDusk, dusk);
    su.uSkyHorizon.value.copy(KEYS.horDay).lerp(KEYS.horDusk, dusk);
    exterior.uniforms.uDay.value = day;
    exterior.uniforms.uHaze.value.copy(su.uSkyZenith.value).lerp(su.uSkyHorizon.value, 0.5);
    this.dusk = dusk;
    return { day, dusk, exposure: lerp(1.25, 0.95, day), bloom: lerp(0.55, 0.25, day) };
  }

  /** Light direction in world space at arc position s (for the shadow camera). */
  sunWorld(up, fwd, lat, out = new THREE.Vector3()) {
    const s = U.uSun.value;
    return out.copy(lat).multiplyScalar(s.x).addScaledVector(up, s.y).addScaledVector(fwd, s.z).normalize();
  }

  get clock() {
    const h = Math.floor(this.time);
    const m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
