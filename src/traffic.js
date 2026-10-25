import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL_X, CELL_Z } from './config.js';

const N = 90;
const AVE_LANES = [-5.25, -1.75, 1.75, 5.25];
const ST_LANES = [-2.6, 2.6];
const PAINTS = [0xf7b500, 0xf7b500, 0xf7b500, 0xf7b500, 0xf2c200, 0x15171a, 0xe9e9e9, 0x2a4a7a, 0x8a1c1c];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);

function part(geo, x, y, z, rgb) {
  geo.translate(x, y, z);
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function carGeometry() {
  const W = [1, 1, 1];        // la pintura llega por el color de instancia
  const GLASS = [0.05, 0.06, 0.08];
  const TIRE = [0.03, 0.03, 0.03];
  const parts = [
    part(new THREE.BoxGeometry(1.9, 0.62, 4.5), 0, 0.62, 0, W),
    part(new THREE.BoxGeometry(1.92, 0.2, 4.52), 0, 0.33, 0, [0.12, 0.12, 0.12]),
    part(new THREE.BoxGeometry(1.7, 0.6, 2.3), 0, 1.22, -0.25, GLASS),
    part(new THREE.BoxGeometry(1.62, 0.08, 2.1), 0, 1.55, -0.25, W),
    part(new THREE.BoxGeometry(0.75, 0.26, 0.26), 0, 1.72, -0.2, [1.25, 1.2, 1.0]),
    // franja de cuadros del taxi (un tono más oscuro)
    part(new THREE.BoxGeometry(1.94, 0.12, 2.6), 0, 0.82, -0.1, [0.25, 0.25, 0.25]),
  ];
  for (const [x, z] of [[-0.88, 1.45], [0.88, 1.45], [-0.88, -1.45], [0.88, -1.45]]) {
    const w = new THREE.CylinderGeometry(0.37, 0.37, 0.26, 14);
    w.rotateZ(Math.PI / 2);
    parts.push(part(w, x, 0.37, z, TIRE));
  }
  return mergeGeometries(parts);
}

function lightGeometry() {
  const parts = [];
  for (const x of [-0.66, 0.66]) {
    parts.push(part(new THREE.BoxGeometry(0.4, 0.18, 0.06), x, 0.7, 2.27, [1, 0.95, 0.8]));
    parts.push(part(new THREE.BoxGeometry(0.4, 0.16, 0.06), x, 0.72, -2.27, [1, 0.06, 0.04]));
  }
  return mergeGeometries(parts);
}

/** Taxis y coches que circulan por la cuadrícula. Si el tren los arrolla salen volando. */
export class Traffic {
  constructor(scene, world) {
    this.world = world;
    this.body = new THREE.InstancedMesh(
      carGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.4 }),
      N
    );
    this.lights = new THREE.InstancedMesh(
      lightGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(3, 3, 3) }),
      N
    );
    for (const m of [this.body, this.lights]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.setColorAt(0, _c.set(0xffffff));
    this.cars = [];
    for (let i = 0; i < N; i++) {
      this.cars.push({
        axis: 'z', line: 0, along: 0, dir: 1, speed: 10, state: 'drive', t: 0,
        pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), ang: new THREE.Vector3(),
      });
    }
  }

  reset(pos) {
    this.cars.forEach((car, i) => this.spawn(car, pos, i));
  }

  spawn(car, pos, i) {
    let ok = false;
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2;
      const rad = 30 + Math.random() * 240;
      const px = pos.x + Math.cos(a) * rad, pz = pos.z + Math.sin(a) * rad;
      // solo hay tráfico en la ciudad
      if (!this.world.isCity(px, pz)) continue;
      if (Math.random() < 0.55) {
        const ai = Math.round(px / CELL_X);
        car.axis = 'z';
        car.dir = ai & 1 ? 1 : -1; // avenidas de sentido único alterno
        car.line = ai * CELL_X + AVE_LANES[(Math.random() * 4) | 0];
        car.along = pz;
      } else {
        const sj = Math.round(pz / CELL_Z);
        car.axis = 'x';
        car.dir = sj & 1 ? 1 : -1;
        car.line = sj * CELL_Z + ST_LANES[(Math.random() * 2) | 0];
        car.along = px;
      }
      this.place(car);
      if (car.pos.distanceTo(pos) > 28 && this.world.isCity(car.pos.x, car.pos.z)) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      // sin calles cerca: el coche espera escondido y lo vuelve a intentar
      car.state = 'idle';
      car.t = 0;
      car.pos.set(0, -1000, 0);
      return;
    }
    car.speed = 7 + Math.random() * 6;
    car.state = 'drive';
    car.t = 0;
    this.body.setColorAt(i, _c.set(PAINTS[(Math.random() * PAINTS.length) | 0]));
    this.body.instanceColor.needsUpdate = true;
  }

  place(car) {
    if (car.axis === 'z') {
      car.pos.set(car.line, 0, car.along);
      car.quat.setFromAxisAngle(Y, car.dir > 0 ? 0 : Math.PI);
    } else {
      car.pos.set(car.along, 0, car.line);
      car.quat.setFromAxisAngle(Y, car.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  }

  /**
   * front: punto delantero de la locomotora; low: si el tren va a ras de suelo.
   * Devuelve los coches arrollados en este paso.
   */
  update(dt, trainPos, front, fwd, low, speed) {
    const hits = [];
    for (let i = 0; i < N; i++) {
      const car = this.cars[i];
      if (car.state === 'idle') {
        car.t += dt;
        if (car.t > 1.5 + Math.random()) this.spawn(car, trainPos, i);
      } else if (car.state === 'drive') {
        car.along += car.dir * car.speed * dt;
        this.place(car);
        const dx = car.pos.x - trainPos.x, dz = car.pos.z - trainPos.z;
        if (dx * dx + dz * dz > 300 * 300 || !this.world.isCity(car.pos.x, car.pos.z)) {
          this.spawn(car, trainPos, i);
        } else if (low) {
          const ex = car.pos.x - front.x, ez = car.pos.z - front.z;
          if (ex * ex + ez * ez < 3.4 * 3.4) {
            car.state = 'fly';
            car.t = 0;
            const side = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 5);
            car.vel.set(fwd.x * speed * 0.85 + fwd.z * side, 7 + Math.random() * 5, fwd.z * speed * 0.85 - fwd.x * side);
            car.ang.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
            hits.push(car);
          }
        }
      } else {
        car.t += dt;
        car.vel.y -= 22 * dt;
        car.pos.addScaledVector(car.vel, dt);
        const a = car.ang.length();
        if (a > 1e-4) {
          _qa.setFromAxisAngle(_v.copy(car.ang).divideScalar(a), a * dt);
          car.quat.premultiply(_qa);
        }
        const g = this.world.heightAt(car.pos.x, car.pos.z, 0, true);
        if (car.pos.y < g) {
          car.pos.y = g;
          if (car.vel.y < 0) car.vel.y *= -0.3;
          car.vel.x *= 0.8;
          car.vel.z *= 0.8;
          car.ang.multiplyScalar(0.75);
        }
        if (car.t > 4.5) this.spawn(car, trainPos, i);
      }
      _m.compose(car.pos, car.quat, _s);
      this.body.setMatrixAt(i, _m);
      this.lights.setMatrixAt(i, _m);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.lights.instanceMatrix.needsUpdate = true;
    return hits;
  }
}
