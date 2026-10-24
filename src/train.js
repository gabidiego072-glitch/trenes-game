import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from './utils.js';

const UP = new THREE.Vector3(0, 1, 0);
const _pf = new THREE.Vector3();
const _pr = new THREE.Vector3();
const _f = new THREE.Vector3();
const _sd = new THREE.Vector3();
const _u = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _v = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.5, metalness: 0.2 }, opts));
}

const M = {
  red: std(0xa8231b, { roughness: 0.38, metalness: 0.35 }),
  darkRed: std(0x5e1410, { roughness: 0.5 }),
  black: std(0x18191b, { roughness: 0.6, metalness: 0.4 }),
  iron: std(0x2c2e31, { roughness: 0.45, metalness: 0.8 }),
  brass: std(0xd9a531, { roughness: 0.25, metalness: 0.95 }),
  steel: std(0xb8bcc2, { roughness: 0.3, metalness: 0.9 }),
  coal: std(0x34302d, { roughness: 0.75, metalness: 0.3, flatShading: true }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1c8, emissiveIntensity: 6 }),
  window: new THREE.MeshStandardMaterial({ color: 0x221a10, emissive: 0xffc070, emissiveIntensity: 2.2, roughness: 0.3 }),
  roofGrey: std(0x3b3d40, { roughness: 0.7 }),
};
const WAGON_COLORS = [0x1f5e4a, 0x7a2b22, 0x22426e, 0x6b4f1d];

function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}

// Cada rueda es una sola malla (llanta, radios y tapa unidos con colores por vértice).
const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.75 });
const wheelGeoCache = new Map();
const _col = new THREE.Color();

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  _col.set(hex);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([_col.r, _col.g, _col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function wheelGeometry(r, w, spokes) {
  const key = r + ':' + w + ':' + spokes;
  if (wheelGeoCache.has(key)) return wheelGeoCache.get(key);
  const parts = [];
  const tire = new THREE.CylinderGeometry(r, r, w, 22);
  tire.rotateZ(Math.PI / 2);
  parts.push(colored(tire, 0x2c2e31));
  const hub = new THREE.CylinderGeometry(r * 0.78, r * 0.78, w + 0.02, 22);
  hub.rotateZ(Math.PI / 2);
  parts.push(colored(hub, 0xa8231b));
  if (spokes) {
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.BoxGeometry(w + 0.04, r * 1.45, 0.07);
      sp.rotateX((i * Math.PI) / 4);
      parts.push(colored(sp, 0x2c2e31));
    }
  }
  const cap = new THREE.CylinderGeometry(r * 0.2, r * 0.2, w + 0.06, 10);
  cap.rotateZ(Math.PI / 2);
  parts.push(colored(cap, 0xd9a531));
  const geo = mergeGeometries(parts);
  wheelGeoCache.set(key, geo);
  return geo;
}

function makeWheel(r, w, parent, x, y, z, wheels, spokes = true) {
  const m = new THREE.Mesh(wheelGeometry(r, w, spokes), wheelMat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.userData.dynamic = true;
  parent.add(m);
  wheels.push({ g: m, r });
  return m;
}

/** Une todas las piezas fijas de un coche por material: muchas menos llamadas de dibujo. */
function mergeStatic(group) {
  const byMat = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh || child.userData.dynamic) continue;
    child.updateMatrix();
    let g = child.geometry.clone().applyMatrix4(child.matrix);
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!byMat.has(child.material)) byMat.set(child.material, []);
    byMat.get(child.material).push(g);
    group.remove(child);
  }
  for (const [mat, geos] of byMat) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
}

function buildLoco() {
  const g = new THREE.Group();
  const wheels = [];
  // chasis
  mesh(new THREE.BoxGeometry(2.3, 0.45, 9.4), M.black, 0, 1.05, 0, g);
  mesh(new THREE.BoxGeometry(2.7, 0.5, 0.35), M.red, 0, 1.0, 4.75, g); // topera delantera
  for (const sx of [-0.85, 0.85]) {
    const buf = new THREE.CylinderGeometry(0.16, 0.16, 0.45, 10);
    buf.rotateX(Math.PI / 2);
    mesh(buf, M.steel, sx, 1.0, 5.1, g);
  }
  // quitapiedras
  const cc = new THREE.BufferGeometry();
  const v = new Float32Array([
    -1.25, 0.15, 5.6, 1.25, 0.15, 5.6, -1.25, 0.95, 4.7, 1.25, 0.95, 4.7, -1.25, 0.15, 4.7, 1.25, 0.15, 4.7,
  ]);
  cc.setAttribute('position', new THREE.BufferAttribute(v, 3));
  cc.setIndex([0, 1, 3, 0, 3, 2, 0, 4, 1, 1, 4, 5, 0, 2, 4, 1, 5, 3]);
  cc.computeVertexNormals();
  mesh(cc, M.darkRed, 0, 0, 0, g);
  // caldera
  const boiler = new THREE.CylinderGeometry(1.0, 1.0, 5.4, 28);
  boiler.rotateX(Math.PI / 2);
  mesh(boiler, M.red, 0, 2.25, 1.5, g);
  for (const z of [-0.6, 0.9, 2.4, 3.8]) {
    const band = new THREE.CylinderGeometry(1.03, 1.03, 0.12, 28);
    band.rotateX(Math.PI / 2);
    mesh(band, M.brass, 0, 2.25, z, g);
  }
  const smokebox = new THREE.CylinderGeometry(1.04, 1.04, 0.9, 28);
  smokebox.rotateX(Math.PI / 2);
  mesh(smokebox, M.black, 0, 2.25, 4.35, g);
  const face = new THREE.CylinderGeometry(0.9, 0.9, 0.08, 28);
  face.rotateX(Math.PI / 2);
  mesh(face, M.iron, 0, 2.25, 4.82, g);
  // faro
  const lampBody = new THREE.CylinderGeometry(0.32, 0.36, 0.5, 16);
  lampBody.rotateX(Math.PI / 2);
  mesh(lampBody, M.brass, 0, 3.15, 4.75, g);
  const lampGlass = new THREE.CircleGeometry(0.27, 16);
  mesh(lampGlass, M.lamp, 0, 3.15, 5.01, g);
  // chimenea
  mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.25, 16), M.black, 0, 3.75, 3.85, g);
  mesh(new THREE.CylinderGeometry(0.5, 0.36, 0.3, 16), M.black, 0, 4.48, 3.85, g);
  // cúpulas
  const dome = new THREE.SphereGeometry(0.5, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  mesh(dome, M.brass, 0, 3.15, 1.9, g);
  mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.25, 18), M.brass, 0, 3.1, 1.9, g);
  mesh(dome, M.red, 0, 3.15, 0.3, g).scale.set(0.8, 0.8, 0.8);
  // silbato
  mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), M.brass, 0.3, 3.45, -0.9, g);
  // cabina
  mesh(new THREE.BoxGeometry(2.6, 2.5, 2.8), M.red, 0, 2.55, -2.7, g);
  mesh(new THREE.BoxGeometry(2.95, 0.22, 3.3), M.black, 0, 3.9, -2.7, g);
  for (const sx of [-1.31, 1.31]) {
    mesh(new THREE.BoxGeometry(0.04, 0.8, 1.0), M.window, sx, 3.0, -2.5, g);
  }
  for (const sx of [-0.7, 0.7]) mesh(new THREE.BoxGeometry(0.6, 0.6, 0.04), M.window, sx, 3.2, -1.29, g);
  mesh(new THREE.BoxGeometry(2.62, 0.12, 2.82), M.brass, 0, 1.6, -2.7, g);
  // pasarelas laterales
  for (const sx of [-1.25, 1.25]) mesh(new THREE.BoxGeometry(0.3, 0.08, 6.0), M.black, sx, 1.33, 1.5, g);
  // ruedas motrices y bogie delantero
  for (const z of [-1.9, -0.25, 1.4]) {
    makeWheel(0.78, 0.22, g, -1.02, 0.78, z, wheels);
    makeWheel(0.78, 0.22, g, 1.02, 0.78, z, wheels);
  }
  for (const z of [3.3, 4.2]) {
    makeWheel(0.42, 0.18, g, -0.95, 0.42, z, wheels, false);
    makeWheel(0.42, 0.18, g, 0.95, 0.42, z, wheels, false);
  }
  // cilindros de vapor
  for (const sx of [-1.2, 1.2]) {
    const cyl = new THREE.CylinderGeometry(0.33, 0.33, 1.2, 16);
    cyl.rotateX(Math.PI / 2);
    mesh(cyl, M.black, sx, 0.95, 3.0, g);
  }
  // bielas
  const rods = [];
  for (const sx of [-1.17, 1.17]) {
    const rod = mesh(new THREE.BoxGeometry(0.08, 0.14, 3.6), M.steel, sx, 0.78, -0.25, g);
    rod.userData.dynamic = true;
    rods.push(rod);
  }
  const chimneyTop = new THREE.Vector3(0, 4.7, 3.85);
  mergeStatic(g);
  return { g, wheels, rods, length: 10.2, chimneyTop };
}

function buildTender() {
  const g = new THREE.Group();
  const wheels = [];
  mesh(new THREE.BoxGeometry(2.3, 0.4, 5.6), M.black, 0, 1.0, 0, g);
  mesh(new THREE.BoxGeometry(2.6, 1.7, 5.4), M.red, 0, 2.05, 0, g);
  mesh(new THREE.BoxGeometry(2.66, 0.12, 5.46), M.brass, 0, 2.9, 0, g);
  mesh(new THREE.BoxGeometry(2.66, 0.12, 5.46), M.brass, 0, 1.3, 0, g);
  const coal = new THREE.IcosahedronGeometry(1, 1);
  const c = mesh(coal, M.coal, 0, 2.85, 0.2, g);
  c.scale.set(1.1, 0.32, 2.35);
  for (const z of [-1.8, -0.7, 0.7, 1.8]) {
    makeWheel(0.48, 0.18, g, -0.95, 0.48, z, wheels, false);
    makeWheel(0.48, 0.18, g, 0.95, 0.48, z, wheels, false);
  }
  mergeStatic(g);
  return { g, wheels, rods: [], length: 5.8 };
}

function buildWagon(color) {
  const g = new THREE.Group();
  const wheels = [];
  const body = std(color, { roughness: 0.42, metalness: 0.25 });
  mesh(new THREE.BoxGeometry(2.3, 0.4, 8.4), M.black, 0, 1.0, 0, g);
  mesh(new THREE.BoxGeometry(2.7, 2.2, 8.2), body, 0, 2.3, 0, g);
  mesh(new THREE.BoxGeometry(2.74, 0.14, 8.24), M.brass, 0, 1.75, 0, g);
  mesh(new THREE.BoxGeometry(2.74, 0.1, 8.24), M.brass, 0, 3.05, 0, g);
  const roof = new THREE.CylinderGeometry(1.5, 1.5, 8.6, 24, 1, false, -Math.PI / 2, Math.PI);
  roof.rotateX(-Math.PI / 2);
  const rm = mesh(roof, M.roofGrey, 0, 3.4, 0, g);
  rm.scale.set(1, 0.32, 1);
  // ventanas iluminadas
  for (let i = 0; i < 6; i++) {
    const z = -3.0 + i * 1.2;
    for (const sx of [-1.36, 1.36]) mesh(new THREE.BoxGeometry(0.04, 0.75, 0.8), M.window, sx, 2.5, z, g);
  }
  for (const sz of [-4.12, 4.12]) mesh(new THREE.BoxGeometry(0.9, 1.7, 0.06), M.black, 0, 2.15, sz, g);
  // bogies
  for (const bz of [-2.9, 2.9]) {
    mesh(new THREE.BoxGeometry(2.1, 0.3, 2.2), M.iron, 0, 0.62, bz, g);
    for (const dz of [-0.7, 0.7]) {
      makeWheel(0.42, 0.16, g, -0.92, 0.42, bz + dz, wheels, false);
      makeWheel(0.42, 0.16, g, 0.92, 0.42, bz + dz, wheels, false);
    }
  }
  mergeStatic(g);
  return { g, wheels, rods: [], length: 8.6 };
}

export class Train {
  constructor(scene) {
    this.scene = scene;
    const loco = buildLoco();
    const parts = [loco, buildTender()];
    for (let i = 0; i < 4; i++) parts.push(buildWagon(WAGON_COLORS[i % WAGON_COLORS.length]));
    // distancia desde el frente del tren hasta el centro de cada coche
    let off = 0;
    this.cars = parts.map((p, i) => {
      const center = off + p.length / 2;
      off += p.length + (i === 0 ? 0.5 : 0.9);
      scene.add(p.g);
      return Object.assign(p, { offset: center, vel: new THREE.Vector3(), ang: new THREE.Vector3() });
    });
    this.loco = loco;
    this.wheelPhase = 0;

    // faro
    this.headlight = new THREE.SpotLight(0xffe2b0, 220, 90, 0.42, 0.55, 1.4);
    this.headlight.position.set(0, 3.15, 5.0);
    this.headlight.target.position.set(0, 0.5, 30);
    loco.g.add(this.headlight, this.headlight.target);
    this.crashed = false;
    this.roll = 0;
  }

  reset() {
    this.crashed = false;
    for (const c of this.cars) {
      c.vel.set(0, 0, 0);
      c.ang.set(0, 0, 0);
    }
  }

  /** Coloca cada coche sobre la vía: sus dos bogies siguen la curva y la pendiente. */
  place(track, s, speed, dt) {
    this.wheelPhase += speed * dt;
    const k = track.curvatureAt(s - 5);
    const targetRoll = clamp(-k * speed * speed * 0.0016, -0.13, 0.13);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 4);
    for (const car of this.cars) {
      const sc = s - car.offset;
      const b = car.length / 2 - 1.3;
      track.sample(sc + b, _pf);
      track.sample(sc - b, _pr);
      _f.subVectors(_pf, _pr).normalize();
      _sd.crossVectors(UP, _f).normalize();
      _u.crossVectors(_f, _sd);
      _m.makeBasis(_sd, _u, _f);
      _q.setFromRotationMatrix(_m);
      _qr.setFromAxisAngle(Z_AXIS, this.roll);
      car.g.quaternion.copy(_q).multiply(_qr);
      car.g.position.addVectors(_pf, _pr).multiplyScalar(0.5);
      for (const w of car.wheels) w.g.rotation.x = this.wheelPhase / w.r;
      for (const rod of car.rods) {
        const a = this.wheelPhase / 0.78;
        rod.position.y = 0.78 + Math.sin(a) * 0.32;
        rod.position.z = -0.25 + Math.cos(a) * 0.32;
      }
    }
  }

  get position() {
    return this.loco.g.position;
  }

  forward(out) {
    return out.set(0, 0, 1).applyQuaternion(this.loco.g.quaternion);
  }

  chimneyWorld(out) {
    return this.loco.g.localToWorld(out.copy(this.loco.chimneyTop));
  }

  /** Empieza el accidente: cada coche sale despedido con su propia física. */
  crash(speed) {
    this.crashed = true;
    this.cars.forEach((car, i) => {
      const fwd = _v.set(0, 0, 1).applyQuaternion(car.g.quaternion);
      if (i === 0) {
        car.vel.copy(fwd).multiplyScalar(-speed * 0.15);
        car.vel.y = 7 + speed * 0.15;
        car.ang.set(-1.5 - Math.random(), (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3);
      } else {
        const side = new THREE.Vector3().crossVectors(UP, fwd).normalize();
        const push = (i % 2 ? 1 : -1) * (3 + Math.random() * 6);
        car.vel.copy(fwd).multiplyScalar(speed * (0.35 + Math.random() * 0.3)).addScaledVector(side, push);
        car.vel.y = 3 + Math.random() * 6;
        car.ang.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
      }
    });
  }

  updateCrash(dt, world) {
    for (const car of this.cars) {
      car.vel.y -= 24 * dt;
      car.g.position.addScaledVector(car.vel, dt);
      const ang = car.ang.length();
      if (ang > 1e-4) {
        _qr.setFromAxisAngle(_v.copy(car.ang).divideScalar(ang), ang * dt);
        car.g.quaternion.premultiply(_qr);
      }
      const h = world.heightAt(car.g.position.x, car.g.position.z, 0, true);
      if (car.g.position.y < h + 0.6) {
        car.g.position.y = h + 0.6;
        if (car.vel.y < 0) car.vel.y *= -0.3;
        car.vel.x *= 0.82;
        car.vel.z *= 0.82;
        car.ang.multiplyScalar(0.8);
      }
    }
  }
}
