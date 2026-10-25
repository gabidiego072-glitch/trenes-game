import * as THREE from 'three';
import { CELL_X, CELL_Z } from './config.js';
import { clamp } from './utils.js';

const PICKUP_COLOR = new THREE.Color(0x3dffa8);
const DELIVER_COLOR = new THREE.Color(0xffb347);
const SHIRTS = [0xe8504a, 0x3f7fe0, 0xf2c14e, 0x8e5bd6, 0x2bb39a, 0xf07ab0, 0xeeeeee, 0x4a4a4a];
const SKIN = [0xf1c7a3, 0xd9a07a, 0xa86f4c, 0x6e4630];
const REACH = 8.5; // radio en el que el tren "pasa por la estación"

const padGeo = new THREE.CylinderGeometry(5, 5.2, 3, 40); // alto para no quedar flotando en pendientes
const ringGeo = new THREE.TorusGeometry(5.05, 0.16, 8, 64);
ringGeo.rotateX(Math.PI / 2);
const beamGeo = new THREE.CylinderGeometry(5.4, 5.4, 170, 32, 1, true);
beamGeo.translate(0, 85, 0);
const bodyGeo = new THREE.CapsuleGeometry(0.27, 0.62, 4, 10);
const headGeo = new THREE.SphereGeometry(0.21, 12, 10);
const signGeo = new THREE.BoxGeometry(0.12, 2.6, 0.12);
const boardGeo = new THREE.BoxGeometry(1.8, 0.7, 0.1);
const padMat = new THREE.MeshStandardMaterial({ color: 0x3b3f48, roughness: 0.7, metalness: 0.2 });
const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.8, roughness: 0.3 });

function makeBeamMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
      void main() {
        float fade = pow(1.0 - vUv.y, 1.6);
        float bands = 0.75 + 0.25 * sin(vUv.y * 140.0 - uTime * 6.0);
        float edge = 0.55 + 0.45 * pow(abs(sin(vUv.x * 3.14159 * 8.0 + uTime)), 4.0);
        gl_FragColor = vec4(uColor * 1.3, fade * bands * edge * 0.42);
      }`,
  });
}

/** Una estación: plataforma, haz de luz visible desde lejos y gente esperando. */
class Station {
  constructor(scene, spot, kind, count) {
    this.scene = scene;
    this.spot = spot;
    this.kind = kind;
    const color = kind === 'pickup' ? PICKUP_COLOR : DELIVER_COLOR;
    this.group = new THREE.Group();
    this.group.position.set(spot.x, spot.y, spot.z);

    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = -1.3;
    pad.receiveShadow = true;
    this.ringMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 3 });
    const ring = new THREE.Mesh(ringGeo, this.ringMat);
    ring.position.y = 0.22;
    this.beamMat = makeBeamMaterial(color);
    const beam = new THREE.Mesh(beamGeo, this.beamMat);
    beam.frustumCulled = false;
    beam.renderOrder = 5;
    this.light = new THREE.PointLight(color, 60, 30, 1.6);
    this.light.position.y = 4;
    this.group.add(pad, ring, beam, this.light);

    // cartel de la estación
    const sign = new THREE.Group();
    sign.add(new THREE.Mesh(signGeo, poleMat));
    const board = new THREE.Mesh(boardGeo, new THREE.MeshStandardMaterial({ color: 0x0c1830, emissive: color, emissiveIntensity: 0.9 }));
    board.position.y = 1.3;
    sign.add(board);
    sign.position.set(-4.6, 1.3, 0);
    sign.traverse((m) => (m.castShadow = true));
    this.group.add(sign);

    // pasajeros alrededor del andén (fuera del paso del tren)
    this.people = [];
    for (let i = 0; i < count; i++) {
      const p = new THREE.Group();
      const shirt = new THREE.MeshStandardMaterial({ color: SHIRTS[(Math.random() * SHIRTS.length) | 0], roughness: 0.8 });
      const skin = new THREE.MeshStandardMaterial({ color: SKIN[(Math.random() * SKIN.length) | 0], roughness: 0.7 });
      const body = new THREE.Mesh(bodyGeo, shirt);
      body.position.y = 0.6;
      const head = new THREE.Mesh(headGeo, skin);
      head.position.y = 1.2;
      body.castShadow = head.castShadow = true;
      p.add(body, head);
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const r = 3.3 + Math.random() * 1.1;
      // en estaciones de destino la gente espera para recibir; en las de recogida, son los pasajeros
      p.position.set(Math.cos(a) * r, 0.2, Math.sin(a) * r);
      p.scale.setScalar(1.45); // un poco exagerados para que se lean desde la cámara
      p.rotation.y = Math.atan2(-p.position.x, -p.position.z);
      p.userData.phase = Math.random() * 6.28;
      this.people.push(p);
      this.group.add(p);
    }
    scene.add(this.group);
  }

  update(time, near) {
    this.beamMat.uniforms.uTime.value = time;
    this.ringMat.emissiveIntensity = 2.5 + Math.sin(time * 5) * 1.2;
    for (const p of this.people) {
      const ph = p.userData.phase;
      // cuando el tren se acerca, saltan y hacen señas
      const jump = near ? Math.abs(Math.sin(time * 7 + ph)) * 0.55 : Math.abs(Math.sin(time * 1.5 + ph)) * 0.05;
      p.position.y = 0.2 + jump;
      p.rotation.z = near ? Math.sin(time * 10 + ph) * 0.15 : 0;
    }
  }

  peopleWorld() {
    return this.people.map((p) => p.getWorldPosition(new THREE.Vector3()));
  }

  dispose() {
    this.scene.remove(this.group);
    this.beamMat.dispose();
    this.ringMat.dispose();
  }
}

/**
 * Misiones de pasajeros: recoger en una estación y llevarlos a otra antes de que se acabe el tiempo.
 * Si el tiempo se agota se pierde una vida.
 */
export class Missions {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.station = null;
    this.reset();
  }

  reset() {
    if (this.station) this.station.dispose();
    this.station = null;
    this.state = 'idle';
    this.hearts = 3;
    this.deliveries = 0;
    this.passengers = 0;   // total entregados
    this.carrying = 0;
    this.time = 0;
    this.limit = 1;
    this.lastTick = 0;
  }

  get active() {
    return this.state === 'pickup' || this.state === 'deliver';
  }

  get target() {
    return this.station ? this.station.spot : null;
  }

  begin(pos, fwd, speed) {
    this.reset();
    this.spawnPickup(pos, fwd, speed, true);
  }

  /** Busca un sitio para una estación: un tejado (pasa por encima) o un cruce de calles. */
  findSpot(tx, tz) {
    const world = this.world;
    for (let tries = 0; tries < 30; tries++) {
      const px = tx + (Math.random() - 0.5) * 70;
      const pz = tz + (Math.random() - 0.5) * 70;
      const cell = world.cell(Math.floor(px / CELL_X), Math.floor(pz / CELL_Z));
      let spot = null;
      if (!cell.city) {
        // en el campo o la montaña: un claro sin árboles ni edificios
        const gy = world.groundAt(px, pz);
        if (world.heightAt(px, pz, 5, false) - gy > 0.3 || world.biomes.water) continue;
        spot = { x: px, z: pz, y: gy, roof: false };
      } else if (Math.random() < 0.45 && cell.type !== 'park') {
        const cands = cell.obstacles.filter((o) => !o.tower && o.x1 - o.x0 > 10 && o.z1 - o.z0 > 10 && o.h > 4);
        if (cands.length) {
          const o = cands[(Math.random() * cands.length) | 0];
          const x = (o.x0 + o.x1) / 2, z = (o.z0 + o.z1) / 2;
          // nada más alto encima del andén (retranqueos, depósitos…)
          if (world.heightAt(x, z, 5, false) <= o.h + 0.01) spot = { x, z, y: o.h, roof: true };
        }
      }
      if (!spot) {
        const x = Math.round(px / CELL_X) * CELL_X, z = Math.round(pz / CELL_Z) * CELL_Z;
        spot = { x, z, y: 0, roof: false };
      }
      if (world.towerHit(spot.x, spot.z, 10)) continue;
      return spot;
    }
    return { x: Math.round(tx / CELL_X) * CELL_X, z: Math.round(tz / CELL_Z) * CELL_Z, y: 0, roof: false };
  }

  limitFor(dist, speed) {
    const pace = Math.max(11, speed * 0.72);
    const strict = clamp(1.3 - this.deliveries * 0.035, 0.9, 1.3);
    return Math.round(9 + (dist / pace) * strict);
  }

  spawnPickup(pos, fwd, speed, first = false) {
    const heading = Math.atan2(fwd.x, fwd.z);
    const a = heading + (Math.random() - 0.5) * (first ? 0.5 : 2.2);
    const d = first ? 110 : 150 + Math.random() * 120;
    const spot = this.findSpot(pos.x + Math.sin(a) * d, pos.z + Math.cos(a) * d);
    const count = 2 + ((Math.random() * 4) | 0);
    this.setStation(new Station(this.scene, spot, 'pickup', count), pos, speed, first ? 1.35 : 1);
    this.state = 'pickup';
  }

  spawnDestination(pos, fwd, speed) {
    const heading = Math.atan2(fwd.x, fwd.z);
    // a veces el destino está detrás: obliga a dar la vuelta
    const a = heading + (Math.random() - 0.5) * Math.PI * (Math.random() < 0.7 ? 1.3 : 2);
    const d = 230 + Math.random() * 200 + Math.min(this.deliveries * 12, 120);
    const spot = this.findSpot(pos.x + Math.sin(a) * d, pos.z + Math.cos(a) * d);
    this.setStation(new Station(this.scene, spot, 'deliver', 3 + ((Math.random() * 3) | 0)), pos, speed, 1);
    this.state = 'deliver';
  }

  setStation(st, pos, speed, extra) {
    if (this.station) this.station.dispose();
    this.station = st;
    const d = Math.hypot(st.spot.x - pos.x, st.spot.z - pos.z);
    this.limit = Math.round(this.limitFor(d, speed) * extra);
    this.time = this.limit;
    this.lastTick = Math.ceil(this.time);
  }

  distanceTo(pos) {
    if (!this.station) return 0;
    return Math.hypot(this.station.spot.x - pos.x, this.station.spot.z - pos.z);
  }

  /** Avanza la misión. Devuelve un evento (pickup | deliver | fail | tick) o null. */
  update(dt, time, pos, fwd, speed) {
    if (!this.active) return null;
    const dist = this.distanceTo(pos);
    this.station.update(time, dist < 45);
    this.time -= dt;

    if (dist < REACH) {
      const people = this.station.peopleWorld();
      const spot = this.station.spot;
      if (this.state === 'pickup') {
        this.carrying = this.station.people.length;
        this.spawnDestination(pos, fwd, speed);
        return { type: 'pickup', count: this.carrying, people, spot };
      }
      const remaining = Math.max(0, this.time);
      const ev = { type: 'deliver', count: this.carrying, remaining, people, spot, limit: this.limit };
      this.deliveries++;
      this.passengers += this.carrying;
      this.carrying = 0;
      this.spawnPickup(pos, fwd, speed);
      return ev;
    }

    if (this.time <= 0) {
      const wasDeliver = this.state === 'deliver';
      const spot = this.station.spot;
      this.hearts--;
      this.carrying = 0;
      if (this.hearts > 0) this.spawnPickup(pos, fwd, speed);
      else {
        this.station.dispose();
        this.station = null;
        this.state = 'idle';
      }
      return { type: 'fail', wasDeliver, spot, hearts: this.hearts };
    }

    const sec = Math.ceil(this.time);
    if (sec < this.lastTick) {
      this.lastTick = sec;
      if (sec <= 5) return { type: 'tick', sec };
    }
    return null;
  }
}
