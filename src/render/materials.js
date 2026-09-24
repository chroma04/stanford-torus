import * as THREE from 'three';
import { TOON_VERT, TOON_FRAG, TERRAIN_VERT, TERRAIN_FRAG, WATER_VERT, WATER_FRAG } from './shaders.js';

// Uniforms shared by every habitat material (same objects by reference, so
// updating them once per frame updates all materials).
export const U = {
  uTime: { value: 0 },
  uSun: { value: new THREE.Vector3(0.3, 1, 0.1).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
  uSkyAmb: { value: new THREE.Color(0.42, 0.5, 0.62) },
  uGroundAmb: { value: new THREE.Color(0.32, 0.3, 0.24) },
  uNight: { value: 0 },
  uLampColor: { value: new THREE.Color(1.0, 0.72, 0.42).multiplyScalar(1.6) },
  uFogColor: { value: new THREE.Color(0.7, 0.8, 0.9) },
  uFogDensity: { value: 1 / 1500 },
  uSway: { value: 1 },
  uShadowMap: { value: null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowOn: { value: 1 },
  uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
  uSkyTint: { value: new THREE.Color(0.75, 0.88, 0.95) },
};

function make(vertexShader, fragmentShader, extra = {}, opts = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: { ...U, ...extra },
    side: opts.side ?? THREE.FrontSide,
    ...opts.params,
  });
}

export function createMaterials() {
  return {
    toon: make(TOON_VERT, TOON_FRAG, { uLineWeight: { value: 1 } }),
    shell: make(TOON_VERT, TOON_FRAG, { uLineWeight: { value: 0.75 } }),
    foliage: make(TOON_VERT, TOON_FRAG, { uLineWeight: { value: 1 } }),
    terrain: make(TERRAIN_VERT, TERRAIN_FRAG),
    water: make(WATER_VERT, WATER_FRAG),
  };
}
