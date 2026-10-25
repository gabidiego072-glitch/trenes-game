import * as THREE from 'three';
import { makeGroundMaterial } from './materials.js';

const SIZE = 1600;
const STEP = 10;
const N = SIZE / STEP + 1;
const RECENTER = 40;

/**
 * Suelo con relieve: una malla que sigue al tren y se recalcula al moverse.
 * Cada vértice guarda su bioma (ciudad / montaña) para que el shader pinte calles, campos, roca o nieve.
 */
export class Terrain {
  constructor(scene, biomesRef) {
    this.biomesRef = biomesRef; // función que devuelve los biomas actuales
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * N * 3);
    this.bio = new Float32Array(N * N * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aBio', new THREE.BufferAttribute(this.bio, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let t = 0;
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i, b = a + N, c = a + 1, d = b + 1;
        idx[t++] = a; idx[t++] = b; idx[t++] = c;
        idx[t++] = c; idx[t++] = b; idx[t++] = d;
      }
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, makeGroundMaterial());
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.cache = new Map();
    this.cx = NaN;
    this.cz = NaN;
  }

  reset() {
    this.cache.clear();
    this.cx = NaN;
    this.cz = NaN;
  }

  sample(ix, iz) {
    const key = ix * 131071 + iz;
    let v = this.cache.get(key);
    if (!v) {
      const b = this.biomesRef();
      const h = b.ground(ix * STEP, iz * STEP);
      v = [h, b.c, b.m];
      this.cache.set(key, v);
    }
    return v;
  }

  update(pos) {
    const cx = Math.round(pos.x / RECENTER) * RECENTER;
    const cz = Math.round(pos.z / RECENTER) * RECENTER;
    if (cx === this.cx && cz === this.cz) return;
    this.cx = cx;
    this.cz = cz;
    if (this.cache.size > 250000) this.cache.clear();
    const i0 = Math.round(cx / STEP) - (N - 1) / 2;
    const j0 = Math.round(cz / STEP) - (N - 1) / 2;
    const P = this.pos, B = this.bio;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const v = this.sample(i0 + i, j0 + j);
        const k = j * N + i;
        P[k * 3] = (i0 + i) * STEP;
        P[k * 3 + 1] = v[0];
        P[k * 3 + 2] = (j0 + j) * STEP;
        B[k * 2] = v[1];
        B[k * 2 + 1] = v[2];
      }
    }
    this.geo.computeVertexNormals();
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aBio.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }
}
