import * as THREE from 'three';
import { U } from './materials.js';

// A single orthographic shadow map that follows the player. Inside the ring
// the light comes from the skylight, so its direction is "local": we orient
// the shadow camera with the light direction at the player's position, which
// is accurate for the ~200 m around them where shadows are visible.

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

export class Shadows {
  constructor(renderer, size = 2048, extent = 95) {
    this.renderer = renderer;
    this.size = size;
    this.extent = extent;
    this.cam = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 1, 420);
    this.cam.layers.set(1);
    this.material = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.enabled = true;
    this.createTarget();
    this._v = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._upv = new THREE.Vector3();
  }

  createTarget() {
    if (this.rt) {
      this.rt.depthTexture.dispose();
      this.rt.dispose();
    }
    const dt = new THREE.DepthTexture(this.size, this.size);
    dt.type = THREE.UnsignedIntType;
    dt.compareFunction = THREE.LessEqualCompare;
    dt.minFilter = THREE.LinearFilter;
    dt.magFilter = THREE.LinearFilter;
    this.rt = new THREE.WebGLRenderTarget(this.size, this.size, { depthTexture: dt, depthBuffer: true });
    U.uShadowMap.value = dt;
    U.uShadowTexel.value.set(1 / this.size, 1 / this.size);
  }

  setSize(size) {
    if (size === this.size) return;
    this.size = size;
    this.createTarget();
  }

  update(scene, center, lightDir, upHint) {
    U.uShadowOn.value = this.enabled ? 1 : 0;
    if (!this.enabled) return;
    const cam = this.cam;
    cam.up.copy(upHint);
    cam.position.copy(center).addScaledVector(lightDir, 220);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    // Snap to shadow texels so edges don't shimmer as the player moves.
    const texel = (2 * this.extent) / this.size;
    this._right.setFromMatrixColumn(cam.matrixWorld, 0);
    this._upv.setFromMatrixColumn(cam.matrixWorld, 1);
    const px = this._v.copy(center).dot(this._right);
    const py = center.dot(this._upv);
    const dx = Math.round(px / texel) * texel - px;
    const dy = Math.round(py / texel) * texel - py;
    cam.position.addScaledVector(this._right, dx).addScaledVector(this._upv, dy);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();

    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    scene.overrideMaterial = this.material;
    r.setRenderTarget(this.rt);
    r.clear(false, true, false);
    r.render(scene, cam);
    scene.overrideMaterial = null;
    r.setRenderTarget(prevTarget);
    U.uShadowMatrix.value.multiplyMatrices(BIAS, cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  }
}
