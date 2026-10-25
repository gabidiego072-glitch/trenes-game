import * as THREE from 'three';
import {
  DS, CLEAR, KMAX, KRATE, LOOK, S_LOOK, S_UP, S_DOWN, SMOOTH_W,
} from './config.js';
import { clamp } from './utils.js';

const CAP = 2400;             // puntos visibles en el anillo de instancias (1,2 km de vía)
const PILLAR_EVERY = 10;      // un pilar cada 5 m
const SLEEPER_EVERY = 2;      // una traviesa cada metro
const BED_DROP = 0.84;        // del carril a la base del balasto

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _f = new THREE.Vector3();
const _sd = new THREE.Vector3();
const _u = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _sc = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * La vía se construye punto a punto por delante del tren.
 * - El jugador controla la curvatura (izquierda / derecha).
 * - La altura es automática: mira LOOK metros hacia delante y empieza a subir
 *   con tiempo para pasar por encima de cualquier edificio normal.
 * - Los rascacielos (balizas rojas) son demasiado altos: si la vía entra en uno, se corta.
 */
export class Track {
  constructor(scene, world) {
    this.world = world;
    this.pts = [];
    this.base = 0;          // índice absoluto del primer punto guardado
    this.steer = 0;         // -1 izquierda … +1 derecha
    this.k = 0;             // curvatura actual en la cabeza
    this.lockIndex = 0;     // por debajo de este índice la vía ya no se modifica (el tren está encima)
    this.blockedAt = null;  // índice donde la vía choca con un rascacielos

    const railGeo = new THREE.BoxGeometry(0.13, 0.17, 1);
    const sleeperGeo = new THREE.BoxGeometry(2.6, 0.15, 0.28);
    const bedGeo = new THREE.BoxGeometry(3.2, 0.55, 1);
    const pillarGeo = new THREE.CylinderGeometry(0.42, 0.55, 1, 14);
    pillarGeo.translate(0, 0.5, 0);
    const capGeo = new THREE.BoxGeometry(3.4, 0.35, 1.2);

    const railMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.95, roughness: 0.28 });
    const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.9 });
    const bedMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x9a948c, roughness: 0.8 });

    const mk = (geo, mat, n, color = false) => {
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.frustumCulled = false;
      im.castShadow = true;
      im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) im.setMatrixAt(i, ZERO);
      if (color) im.setColorAt(0, _c.set(0xffffff));
      scene.add(im);
      return im;
    };
    this.rails = mk(railGeo, railMat, CAP * 2);
    this.sleepers = mk(sleeperGeo, sleeperMat, CAP / SLEEPER_EVERY);
    this.bed = mk(bedGeo, bedMat, CAP, true);
    this.pillars = mk(pillarGeo, pillarMat, CAP / PILLAR_EVERY);
    this.caps = mk(capGeo, pillarMat, CAP / PILLAR_EVERY);
    this.meshes = [this.rails, this.sleepers, this.bed, this.pillars, this.caps];
  }

  get headIndex() {
    return this.base + this.pts.length - 1;
  }
  get headS() {
    return this.headIndex * DS;
  }
  get head() {
    return this.pts[this.pts.length - 1];
  }
  get endS() {
    return this.blockedAt === null ? Infinity : this.blockedAt * DS;
  }
  get(i) {
    const j = i - this.base;
    if (j < 0) return this.pts[0];
    if (j >= this.pts.length) return this.pts[this.pts.length - 1];
    return this.pts[j];
  }

  reset() {
    for (const im of this.meshes) {
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, ZERO);
      im.instanceMatrix.needsUpdate = true;
    }
    this.pts = [];
    this.steer = 0;
    this.k = 0;
    this.blockedAt = null;
    // vía inicial recta por el centro de la calle x = 0, mirando hacia +z
    const start = -400;
    this.base = start;
    for (let i = start; i <= 60; i++) {
      this.pts.push({ x: 0, z: i * DS, h: 0, k: 0, r: CLEAR, y: CLEAR, elev: 0 });
    }
    this.lockIndex = 0;
    for (let i = start + 1; i <= this.headIndex; i++) this.writeSeg(i);
    this.flush();
  }

  /** Predice el recorrido desde la cabeza con una curvatura dada (para la vista previa y la IA). */
  predict(k, dist, step, cb) {
    const hd = this.head;
    let x = hd.x, z = hd.z, h = hd.h, kk = this.k;
    for (let d = step; d <= dist; d += step) {
      kk += clamp(k - kk, -KRATE * step, KRATE * step);
      h += kk * step;
      x += Math.sin(h) * step;
      z += Math.cos(h) * step;
      if (cb(x, z, d) === false) return;
    }
  }

  addPoint() {
    if (this.blockedAt !== null) return;
    const last = this.head;
    const world = this.world;
    const kT = -this.steer * KMAX;
    this.k += clamp(kT - this.k, -KRATE * DS, KRATE * DS);
    const h = last.h + this.k * DS;
    const x = last.x + Math.sin(h) * DS;
    const z = last.z + Math.cos(h) * DS;

    // Altura necesaria aquí y anticipación de lo que viene delante.
    const ground = world.heightAt(x, z, 1.5, false);
    let req = ground + CLEAR;
    let px = x, pz = z, ph = h;
    for (let d = 1; d <= LOOK; d++) {
      ph += this.k;
      px += Math.sin(ph);
      pz += Math.cos(ph);
      const v = world.heightAt(px, pz, 1.5, false) + CLEAR - S_LOOK * d;
      if (v > req) req = v;
    }
    const r = Math.max(req, last.r - S_DOWN * DS, ground + CLEAR);
    const p = { x, z, h, k: this.k, r, y: r, elev: 0 };
    this.pts.push(p);
    const idx = this.headIndex;

    // Si la vía entra en un rascacielos, se corta aquí.
    if (world.towerHit(x, z, 1.7)) {
      this.blockedAt = idx;
    }

    // Pase hacia atrás: si hace falta subir más rápido, levanta los puntos anteriores.
    let lo = idx;
    const minJ = Math.max(this.lockIndex, this.base + 1);
    for (let j = idx - 1; j >= minJ; j--) {
      const need = this.get(j + 1).r - S_UP * DS;
      const pj = this.get(j);
      if (pj.r >= need - 1e-6) break;
      pj.r = need;
      lo = j;
    }
    if (lo === minJ && this.get(minJ - 1).r < this.get(minJ).r - S_UP * DS - 0.05) {
      this.blockedAt = idx; // ni siquiera con pendiente máxima se llega: choque
    }

    this.resmooth(Math.max(minJ - SMOOTH_W, lo - SMOOTH_W * 2, this.base + SMOOTH_W), idx);

    if (this.pts.length > 5200) {
      this.pts.splice(0, 1200);
      this.base += 1200;
    }
  }

  /**
   * Suavizado que nunca baja de la altura mínima: primero un máximo móvil,
   * luego una media móvil del resultado (cierre morfológico).
   */
  resmooth(lo, hi) {
    const W = SMOOTH_W;
    const head = this.headIndex;
    const mStart = lo - W;
    const ms = new Float32Array(hi - mStart + 1);
    for (let i = mStart; i <= hi; i++) {
      let m = -Infinity;
      for (let j = i - W; j <= i + W; j++) {
        const pj = this.get(Math.min(j, head));
        if (pj.r > m) m = pj.r;
      }
      ms[i - mStart] = m;
    }
    for (let i = lo; i <= hi; i++) {
      let sum = 0, n = 0;
      for (let j = i - W; j <= i + W; j++) {
        const jj = Math.min(Math.max(j, mStart), hi);
        sum += ms[jj - mStart];
        n++;
      }
      const p = this.get(i);
      const y = Math.max(sum / n, p.r);
      if (Math.abs(y - p.y) > 1e-4 || i === hi) {
        p.y = y;
        this.writeSeg(i);
        if (i + 1 <= head) this.writeSeg(i + 1);
      }
    }
  }

  /** Escribe las instancias del tramo que termina en el punto i. */
  writeSeg(i) {
    const p0 = this.get(i - 1), p1 = this.get(i);
    if (p0 === p1) return;
    const slot = ((i % CAP) + CAP) % CAP;
    _a.set(p0.x, p0.y, p0.z);
    _b.set(p1.x, p1.y, p1.z);
    _f.subVectors(_b, _a);
    const len = _f.length();
    _f.divideScalar(len);
    _sd.crossVectors(UP, _f).normalize();
    _u.crossVectors(_f, _sd);
    const mid = _pos.addVectors(_a, _b).multiplyScalar(0.5);

    const basis = (scaleZ, offSide, offUp, base) => {
      _m.makeBasis(_sd, _u, _f);
      _m.scale(_sc.set(1, 1, scaleZ));
      _m.setPosition(
        base.x + _sd.x * offSide + _u.x * offUp,
        base.y + _sd.y * offSide + _u.y * offUp,
        base.z + _sd.z * offSide + _u.z * offUp
      );
      return _m;
    };
    this.rails.setMatrixAt(slot * 2, basis(len * 1.04, -0.75, -0.085, mid));
    this.rails.setMatrixAt(slot * 2 + 1, basis(len * 1.04, 0.75, -0.085, mid));

    const surf = this.world.heightAt(p1.x, p1.z, 0, false, false);
    const elev = p1.y - BED_DROP - surf;
    p1.elev = elev;
    this.bed.setMatrixAt(slot, basis(len * 1.06, 0, -0.17 - 0.15 - 0.275, mid));
    // balasto marrón en el suelo, hormigón cuando es un viaducto
    _c.set(elev > 0.6 ? 0x8d8780 : 0x5e5148);
    this.bed.setColorAt(slot, _c);

    if (((i % SLEEPER_EVERY) + SLEEPER_EVERY) % SLEEPER_EVERY === 0) {
      const ss = Math.floor(slot / SLEEPER_EVERY);
      this.sleepers.setMatrixAt(ss, basis(1, 0, -0.24, _b));
    }
    if (((i % PILLAR_EVERY) + PILLAR_EVERY) % PILLAR_EVERY === 0) {
      const ps = Math.floor(slot / PILLAR_EVERY);
      if (elev > 0.9) {
        _m.makeScale(1, elev, 1);
        _m.setPosition(p1.x, surf, p1.z);
        this.pillars.setMatrixAt(ps, _m);
        this.caps.setMatrixAt(ps, basis(1, 0, -BED_DROP - 0.1, _b));
      } else {
        this.pillars.setMatrixAt(ps, ZERO);
        this.caps.setMatrixAt(ps, ZERO);
      }
    }
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    for (const im of this.meshes) im.instanceMatrix.needsUpdate = true;
    if (this.bed.instanceColor) this.bed.instanceColor.needsUpdate = true;
    this.dirty = false;
  }

  /** Posición interpolada en la longitud de arco s. */
  sample(s, out) {
    const f = s / DS;
    const i = Math.floor(f);
    const t = f - i;
    const a = this.get(i), b = this.get(i + 1);
    out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    return out;
  }

  curvatureAt(s) {
    return this.get(Math.round(s / DS)).k;
  }

  slopeAt(s) {
    const a = this.get(Math.floor(s / DS) - 2), b = this.get(Math.floor(s / DS) + 2);
    return (b.y - a.y) / (4 * DS);
  }

  elevationAt(s) {
    return this.get(Math.round(s / DS)).elev;
  }
}
