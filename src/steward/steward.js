import * as THREE from 'three';
import { Customer } from '../bar/customers.js';
import { enterCar, makeLabel } from '../interior.js';

// Vagón de pasajeros (coordenadas locales del vagón, suelo en y = 0)
const FLOOR_Y = 1.25;
const W2 = 1.5;          // media anchura interior
const H = 2.35;          // techo
const Z_BACK = -6.2;     // pared del fondo
const Z_FRONT = 4.2;     // pared de la cocina
const ROWS = [-5.2, -4.15, -3.1, -2.05, -1.0, 0.05];
const COLS = [{ l: 'A', x: 1.1 }, { l: 'B', x: 0.6 }, { l: 'C', x: -0.6 }, { l: 'D', x: -1.1 }];
const GALLEY_Z = 2.5;
const EYE = 1.64;
const SHIFT = 240;
const TRAY = 3;
const WALK = 2.4;        // m/s

export const ITEMS = {
  agua: { name: 'Agua', key: '1', side: 1, z: 1.75 },
  zumo: { name: 'Zumo', key: '2', side: 1, z: 2.45 },
  cafe: { name: 'Café', key: '3', side: 1, z: 3.2, brew: 2.2 },
  sandwich: { name: 'Sándwich', key: '4', side: -1, z: 1.75 },
  galletas: { name: 'Galletas', key: '5', side: -1, z: 2.45 },
  manta: { name: 'Manta', key: '6', side: -1, z: 3.2 },
};
const ITEM_KEYS = Object.keys(ITEMS);

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _ndc = new THREE.Vector2();

function std(color, o = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6 }, o));
}
function phys(color, o = {}) {
  return new THREE.MeshPhysicalMaterial(Object.assign({ color, roughness: 0.5 }, o));
}

// ---------- Iconos (canvas) ----------

export function drawItem(g, key, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s / 100, s / 100);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (key === 'agua') {
    g.fillStyle = 'rgba(150,210,255,0.9)';
    g.strokeStyle = '#2d6f9e';
    g.lineWidth = 5;
    g.beginPath(); g.roundRect(-18, -24, 36, 70, 10); g.fill(); g.stroke();
    g.fillStyle = '#2d6f9e'; g.fillRect(-9, -42, 18, 16);
    g.fillStyle = '#ffffff'; g.fillRect(-18, 2, 36, 16);
  } else if (key === 'zumo') {
    g.fillStyle = '#ff9a1c';
    g.beginPath(); g.moveTo(-24, -20); g.lineTo(24, -20); g.lineTo(24, 46); g.lineTo(-24, 46); g.closePath(); g.fill();
    g.fillStyle = '#f2f2f2';
    g.beginPath(); g.moveTo(-24, -20); g.lineTo(0, -40); g.lineTo(24, -20); g.closePath(); g.fill();
    g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(0, 14, 13, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3fa34a'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, 1); g.lineTo(6, -8); g.stroke();
  } else if (key === 'cafe') {
    g.fillStyle = '#ffffff'; g.strokeStyle = '#5a3a22'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(-28, -14); g.lineTo(28, -14); g.lineTo(22, 40); g.lineTo(-22, 40); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#6b3a1e'; g.beginPath(); g.ellipse(0, -14, 26, 7, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(30, 12, 12, -1.2, 1.2); g.stroke();
    g.strokeStyle = 'rgba(120,120,120,0.7)'; g.lineWidth = 4;
    for (const dx of [-10, 6]) { g.beginPath(); g.moveTo(dx, -26); g.bezierCurveTo(dx - 8, -36, dx + 8, -42, dx, -52); g.stroke(); }
  } else if (key === 'sandwich') {
    g.fillStyle = '#f2d39a'; g.strokeStyle = '#b58a4a'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(-38, 34); g.lineTo(38, 34); g.lineTo(0, -34); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#5fb33a'; g.fillRect(-30, 22, 60, 6);
    g.fillStyle = '#e8506a'; g.fillRect(-24, 14, 48, 6);
  } else if (key === 'galletas') {
    for (const [dx, dy] of [[-14, 8], [14, 12], [0, -14]]) {
      g.fillStyle = '#d29a4a'; g.beginPath(); g.arc(dx, dy, 20, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4a2a14';
      for (const [cx, cy] of [[-6, -4], [6, 2], [-2, 8]]) { g.beginPath(); g.arc(dx + cx, dy + cy, 3, 0, Math.PI * 2); g.fill(); }
    }
  } else if (key === 'manta') {
    g.fillStyle = '#3a5fa8';
    g.beginPath(); g.roundRect(-38, -26, 76, 52, 8); g.fill();
    g.strokeStyle = '#e9c46a'; g.lineWidth = 5;
    for (let i = -28; i <= 28; i += 14) { g.beginPath(); g.moveTo(i, -26); g.lineTo(i, 26); g.stroke(); }
    g.strokeStyle = '#d64545';
    g.beginPath(); g.moveTo(-38, 0); g.lineTo(38, 0); g.stroke();
  }
  g.restore();
}

/** URL de imagen de un icono (para la interfaz HTML). */
const iconCache = {};
export function itemIconURL(key) {
  if (iconCache[key]) return iconCache[key];
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  drawItem(c.getContext('2d'), key, 48, 50, 80);
  iconCache[key] = c.toDataURL();
  return iconCache[key];
}

// ---------- Modelos 3D de los productos ----------

function itemModel(key) {
  const g = new THREE.Group();
  const add = (geo, m, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    g.add(o);
    return o;
  };
  if (key === 'agua') {
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 14), phys(0xa8d8ff, { transparent: true, opacity: 0.7, roughness: 0.05, clearcoat: 1 }), 0, 0.09);
    add(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 10), std(0x2d6f9e), 0, 0.195);
    add(new THREE.CylinderGeometry(0.031, 0.031, 0.04, 14), std(0xffffff), 0, 0.09);
  } else if (key === 'zumo') {
    add(new THREE.BoxGeometry(0.06, 0.12, 0.06), std(0xff9a1c), 0, 0.06);
    const top = add(new THREE.CylinderGeometry(0.0, 0.043, 0.03, 4), std(0xf2f2f2), 0, 0.135);
    top.rotation.y = Math.PI / 4;
  } else if (key === 'cafe') {
    add(new THREE.CylinderGeometry(0.04, 0.032, 0.1, 18), phys(0xffffff, { roughness: 0.4 }), 0, 0.05);
    add(new THREE.CylinderGeometry(0.041, 0.041, 0.012, 18), std(0x5a3a22), 0, 0.104);
  } else if (key === 'sandwich') {
    const tri = new THREE.Shape();
    tri.moveTo(-0.06, 0); tri.lineTo(0.06, 0); tri.lineTo(0, 0.09); tri.closePath();
    const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.045, bevelEnabled: false });
    const m = add(geo, std(0xf2d39a, { roughness: 0.8 }), 0, 0, -0.022);
    m.rotation.x = 0;
    add(new THREE.BoxGeometry(0.1, 0.006, 0.046), std(0x5fb33a), 0, 0.03, 0);
  } else if (key === 'galletas') {
    add(new THREE.BoxGeometry(0.1, 0.03, 0.07), std(0xd8262b), 0, 0.015);
    for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 14), std(0xd29a4a), -0.03 + i * 0.03, 0.036, 0);
  } else if (key === 'manta') {
    add(new THREE.BoxGeometry(0.18, 0.06, 0.12), phys(0x3a5fa8, { roughness: 0.95, sheen: 0.8 }), 0, 0.03);
    add(new THREE.BoxGeometry(0.181, 0.012, 0.121), std(0xe9c46a), 0, 0.03);
  }
  return g;
}

export class StewardMode {
  constructor(camera, sfx) {
    this.camera = camera;
    this.sfx = sfx;
    this.root = new THREE.Group();
    this.root.position.y = FLOOR_Y;
    this.clickables = [];
    this.active = false;
    this.pax = [];
    this.build();
    this.trayGroup = new THREE.Group();
    this.trayGroup.position.set(0.2, -0.32, -0.55);
    this.trayGroup.rotation.set(0.35, -0.2, 0);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.24), std(0x2b2b30, { roughness: 0.35, metalness: 0.3 }));
    this.trayGroup.add(tray);
    this.trayItems = new THREE.Group();
    this.trayGroup.add(this.trayItems);
    this.trayGroup.visible = false;
    camera.add(this.trayGroup);
    this.raycaster = new THREE.Raycaster();
    const $ = (id) => document.getElementById(id);
    this.ui = {
      hud: $('stewHud'), money: $('sMoney'), clock: $('sClock'), stars: $('sStars'), hint: $('sHint'), pop: $('sPop'),
      tickets: $('sTickets'), tray: $('sTray'), galley: $('sGalley'), brew: $('sBrew'),
    };
    this.buildGalleyButtons();
  }

  // ---------- Construcción ----------

  build() {
    const R = this.root;
    const add = (geo, mat, x, y, z, parent = R, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const L = Z_FRONT - Z_BACK, ZC = (Z_FRONT + Z_BACK) / 2;

    // suelo con moqueta y pasillo
    const carpet = std(0x3a3f5a, { roughness: 0.95 });
    add(new THREE.PlaneGeometry(W2 * 2, L), carpet, 0, 0.002, ZC, R, false).rotation.x = -Math.PI / 2;
    const runner = add(new THREE.PlaneGeometry(0.62, L), std(0x7a2e3a, { roughness: 0.95 }), 0, 0.004, ZC, R, false);
    runner.rotation.x = -Math.PI / 2;
    // techo con tiras de luz
    const ceiling = std(0xece6da, { roughness: 0.8 });
    add(box(W2 * 2 + 0.1, 0.06, L + 0.1), ceiling, 0, H + 0.03, ZC);
    for (const x of [-0.45, 0.45]) add(box(0.12, 0.02, L - 0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.25, 1.15) }), x, H - 0.005, ZC, R, false);
    // paredes con ventanas en cada fila
    const wall = std(0xd9d2c4, { roughness: 0.7 });
    const panel = std(0x8a8f99, { roughness: 0.5, metalness: 0.3 });
    for (const s of [-1, 1]) {
      const x = s * (W2 + 0.03);
      add(box(0.06, 0.85, L), panel, x, 0.425, ZC);
      add(box(0.06, H - 1.75, L), wall, x, 1.75 + (H - 1.75) / 2, ZC);
      let z = Z_BACK;
      const winW = 0.75;
      for (const rz of ROWS) {
        const w0 = rz - winW / 2 - z;
        if (w0 > 0) add(box(0.07, 0.9, w0), wall, x, 1.3, z + w0 / 2);
        z = rz + winW / 2;
        add(box(0.08, 0.04, winW + 0.04), std(0x55595f, { metalness: 0.6 }), x - s * 0.01, 0.86, rz);
        add(box(0.08, 0.04, winW + 0.04), std(0x55595f, { metalness: 0.6 }), x - s * 0.01, 1.74, rz);
      }
      add(box(0.07, 0.9, Z_FRONT - z), wall, x, 1.3, (z + Z_FRONT) / 2);
      // portaequipajes
      add(box(0.42, 0.03, L - 2.5), std(0xb9bec4, { metalness: 0.8, roughness: 0.3 }), s * (W2 - 0.22), 1.92, ZC - 1.25);
      add(box(0.02, 0.1, L - 2.5), std(0xb9bec4, { metalness: 0.8, roughness: 0.3 }), s * (W2 - 0.43), 1.96, ZC - 1.25);
    }
    for (const z of [Z_BACK - 0.03, Z_FRONT + 0.03]) add(box(W2 * 2, H, 0.06), wall, 0, H / 2, z);

    // asientos
    const fabric = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = '#1f3c78';
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#2b4f96';
      for (let i = 0; i < 64; i += 8) for (let j = 0; j < 64; j += 8) if ((i + j) % 16 === 0) g.fillRect(i, j, 4, 4);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(3, 3);
      t.colorSpace = THREE.SRGBColorSpace;
      return phys(0xffffff, { map: t, roughness: 0.9, sheen: 0.5 });
    })();
    const white = std(0xf4f4f0, { roughness: 0.8 });
    const metalM = std(0x9aa0a8, { metalness: 0.8, roughness: 0.35 });
    this.seats = [];
    ROWS.forEach((rz, r) => {
      COLS.forEach((c) => {
        const g = new THREE.Group();
        g.position.set(c.x, 0, rz);
        add(box(0.46, 0.12, 0.46), fabric, 0, 0.42, 0, g);
        const back = add(box(0.46, 0.72, 0.1), fabric, 0, 0.82, -0.25, g);
        back.rotation.x = -0.12;
        add(box(0.3, 0.14, 0.02), white, 0, 1.08, -0.2, g).rotation.x = -0.12;
        add(box(0.08, 0.36, 0.3), metalM, 0, 0.18, -0.02, g);
        add(box(0.05, 0.05, 0.4), std(0x2a2a2e), Math.sign(c.x) * 0.25, 0.6, -0.02, g);
        R.add(g);
        // luz de llamada sobre el asiento
        const light = add(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: 0x333333 }), c.x * 0.95, 1.9, rz + 0.1, R, false);
        this.seats.push({ row: r + 1, col: c.l, x: c.x, z: rz, light, pax: null });
      });
      // número de fila en el portaequipajes
      for (const s of [-1, 1]) {
        const l = makeLabel(THREE, 'Fila ' + (r + 1), 0.04);
        l.position.set(s * (W2 - 0.45), 1.85, rz + 0.2);
        R.add(l);
      }
    });

    // ---- cocina (galley) ----
    const counter = std(0xc9ced6, { metalness: 0.85, roughness: 0.3 });
    const cab = std(0x6d7480, { metalness: 0.5, roughness: 0.45 });
    for (const s of [-1, 1]) {
      add(box(0.85, 0.9, 2.3), cab, s * (W2 - 0.43), 0.45, GALLEY_Z + 0.2);
      add(box(0.9, 0.04, 2.34), counter, s * (W2 - 0.45), 0.92, GALLEY_Z + 0.2);
      add(box(0.6, 0.55, 2.3), cab, s * (W2 - 0.3), 1.85, GALLEY_Z + 0.2);
    }
    // separador entre cocina y asientos
    for (const s of [-1, 1]) add(box(0.9, H, 0.08), wall, s * (W2 - 0.45), H / 2, 1.05);
    const sign = makeLabel(THREE, 'Cocina', 0.07);
    sign.position.set(0, 2.15, 1.05);
    R.add(sign);

    this.itemSpots = {};
    for (const k of ITEM_KEYS) {
      const it = ITEMS[k];
      const x = it.side * (W2 - 0.5);
      const g = new THREE.Group();
      g.position.set(x, 0.94, it.z);
      if (k === 'cafe') {
        // cafetera
        add(box(0.32, 0.42, 0.32), std(0x1c1c1e, { metalness: 0.5, roughness: 0.4 }), 0, 0.21, 0, g);
        add(box(0.2, 0.06, 0.04), std(0xd04040), -it.side * 0.0, 0.34, -it.side * 0, g);
        this.brewLight = add(new THREE.SphereGeometry(0.015, 8, 6), new THREE.MeshBasicMaterial({ color: 0x333333 }), -it.side * 0.165, 0.33, 0.08, g, false);
      } else {
        for (let i = 0; i < 4; i++) {
          const m = itemModel(k);
          m.position.set((i % 2) * 0.12 - 0.06, k === 'manta' ? Math.floor(i / 2) * 0.065 : 0, Math.floor(i / 2) * 0.13 - 0.065 + (k === 'manta' ? -Math.floor(i / 2) * 0.13 : 0));
          g.add(m);
        }
      }
      R.add(g);
      const hit = add(box(0.4, 0.5, 0.45), new THREE.MeshBasicMaterial({ visible: false }), x, 1.15, it.z, R, false);
      hit.userData = { action: 'item', item: k };
      this.clickables.push(hit);
      const lab = makeLabel(THREE, it.key + ' · ' + it.name, 0.045);
      lab.position.set(x, k === 'cafe' ? 1.5 : 1.25, it.z);
      R.add(lab);
      this.itemSpots[k] = { x, z: it.z };
    }

    // luces
    const l1 = new THREE.PointLight(0xfff2e0, 2.2, 8, 1.4);
    l1.position.set(0, H - 0.3, -2.5);
    const l2 = new THREE.PointLight(0xfff2e0, 1.6, 5, 1.4);
    l2.position.set(0, H - 0.3, GALLEY_Z);
    R.add(l1, l2);
  }

  buildGalleyButtons() {
    const el = this.ui.galley;
    if (!el) return;
    el.innerHTML = ITEM_KEYS.map((k) => `
      <button class="g-btn" data-item="${k}" title="Coger ${ITEMS[k].name} (${ITEMS[k].key})">
        <img src="${itemIconURL(k)}" alt=""><span>${ITEMS[k].name}</span><kbd>${ITEMS[k].key}</kbd>
      </button>`).join('');
    el.querySelectorAll('.g-btn').forEach((b) => b.addEventListener('click', () => this.fetch(b.dataset.item)));
    this.ui.tray.addEventListener('click', (e) => {
      const slot = e.target.closest('.t-slot');
      if (slot && slot.dataset.i !== undefined) this.discard(+slot.dataset.i);
    });
    this.ui.tickets.addEventListener('click', (e) => {
      const t = e.target.closest('.ticket');
      if (!t) return;
      const p = this.pax.find((q) => q.id === +t.dataset.id);
      if (p) this.goTo(p);
    });
  }

  // ---------- Ciclo de vida ----------

  start(train) {
    this.restoreTrain = enterCar(train, 3, this.root);
    this.active = true;
    this.money = 0;
    this.time = SHIFT;
    this.stars = 3;
    this.served = 0;
    this.deliveries = 0;
    this.angry = 0;
    this.walked = 0;
    this.elapsed = 0;
    this.callT = 3;
    this.tray = [];
    this.brewing = null;
    this.target = null;
    this.z = GALLEY_Z;
    this.speed = 0;
    this.yaw = 0;
    this.yawGoal = 0;
    this.yawDrag = 0;
    this.pitch = -0.08;
    this.bob = 0;
    this.manual = 0;
    this.stepAcc = 0;
    this.tut = {};
    for (const p of this.pax) this.root.remove(p.model.root), this.root.remove(p.bubble);
    this.pax = [];
    for (const s of this.seats) {
      s.pax = null;
      s.light.material.color.set(0x333333);
    }
    // pasajeros sentados
    const free = this.seats.slice().sort(() => Math.random() - 0.5).slice(0, 11);
    free.forEach((s, i) => {
      const m = new Customer();
      m.seated = 1;
      m.root.position.set(s.x, -0.28, s.z - 0.04);
      m.root.rotation.y = 0;
      this.root.add(m.root);
      const p = { id: i, seat: s, model: m, state: 'idle', want: [], patience: 1, maxPatience: 1, bubble: this.makeBubble(), dirty: true, voice: 0.75 + Math.random() * 0.7, speech: null, speechT: 0 };
      p.say = (text) => {
        p.speech = text;
        p.speechT = 2.4;
        p.dirty = true;
      };
      m.root.traverse((o) => (o.userData.pax = p));
      this.root.add(p.bubble);
      s.pax = p;
      this.pax.push(p);
    });
    this.camera.near = 0.06;
    this.camera.updateProjectionMatrix();
    this.trayGroup.visible = true;
    this.ui.hud.hidden = false;
    this.hint('Cuando un pasajero llame, tócalo o toca su comanda para ir', 4);
    this.renderTray();
    this.ticketsDirty = true;
    this.renderHud();
  }

  stop() {
    this.active = false;
    for (const p of this.pax) {
      this.root.remove(p.model.root);
      this.root.remove(p.bubble);
    }
    this.pax = [];
    this.trayGroup.visible = false;
    if (this.restoreTrain) this.restoreTrain();
    this.restoreTrain = null;
    this.camera.near = 0.3;
    this.camera.updateProjectionMatrix();
    this.ui.hud.hidden = true;
  }

  results() {
    return { money: this.money, served: this.served, deliveries: this.deliveries, angry: this.angry, walked: Math.round(this.walked) };
  }

  // ---------- Acciones ----------

  /** Ir a la cocina a coger un producto. */
  fetch(key) {
    if (!this.active) return;
    if (this.tray.length >= TRAY) return this.hint('La bandeja está llena · toca un producto de la bandeja para dejarlo');
    this.target = { kind: 'item', item: key, z: ITEMS[key].z };
    this.manual = 0;
    if (Math.abs(this.z - this.target.z) < 0.1) this.arrive();
  }

  goTo(p) {
    this.target = { kind: 'pax', pax: p, z: p.seat.z };
    this.manual = 0;
    if (Math.abs(this.z - this.target.z) < 0.1) this.arrive();
  }

  discard(i) {
    if (i >= this.tray.length) return;
    const k = this.tray.splice(i, 1)[0];
    this.hint(ITEMS[k].name + ' devuelto a la cocina');
    this.sfx.trash();
    this.renderTray();
  }

  arrive() {
    const t = this.target;
    this.target = null;
    if (!t) return;
    if (t.kind === 'item') {
      this.yawGoal = ITEMS[t.item].side > 0 ? -Math.PI / 2 : Math.PI / 2;
      if (ITEMS[t.item].brew) {
        if (this.brewing) return this.hint('Ya hay un café haciéndose');
        this.brewing = { item: t.item, t: 0 };
        this.sfx.pour();
        return;
      }
      if (this.tray.length >= TRAY) return this.hint('La bandeja está llena');
      this.tray.push(t.item);
      this.sfx.plop();
      this.renderTray();
      if (!this.tut.take) {
        this.tut.take = true;
        this.hint('Ahora toca al pasajero o su comanda para llevárselo', 3.5);
      }
      return;
    }
    // junto al pasajero: le doy lo que tenga en la bandeja
    const p = t.pax;
    this.yawGoal = p.seat.x > 0 ? -Math.PI / 2 : Math.PI / 2;
    if (p.state !== 'calling') {
      p.say(['¡Hola!', 'Todo bien, gracias', 'Bonito paisaje, ¿eh?'][Math.floor(Math.random() * 3)]);
      this.sfx.voice(p.voice, 2);
      return;
    }
    let gave = 0;
    for (const w of p.want) {
      if (w.done) continue;
      const i = this.tray.indexOf(w.key);
      if (i >= 0) {
        this.tray.splice(i, 1);
        w.done = true;
        gave++;
        this.deliveries++;
      }
    }
    this.renderTray();
    if (!gave) {
      p.say('Quería ' + p.want.filter((w) => !w.done).map((w) => ITEMS[w.key].name.toLowerCase()).join(' y '));
      this.sfx.voice(p.voice, 3);
      return;
    }
    p.dirty = true;
    this.ticketsDirty = true;
    this.sfx.serveItem();
    if (p.want.every((w) => w.done)) {
      const frac = Math.max(0, p.patience / p.maxPatience);
      const tip = 1 + p.want.length + Math.round(frac * 3 * p.want.length);
      this.money += tip;
      this.served++;
      p.state = 'happy';
      p.t = 0;
      p.model.setMood('happy');
      p.seat.light.material.color.set(0x333333);
      p.say(frac > 0.5 ? '¡Qué rápido, gracias!' : '¡Gracias!');
      this.sfx.voice(p.voice, 3);
      this.sfx.register();
      this.pop('+$' + tip + ' de propina');
    } else {
      p.say('¡Gracias! ¿Y lo demás?');
      this.sfx.voice(p.voice, 2);
    }
  }

  // ---------- Pasajeros ----------

  makeBubble() {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 190;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false, fog: false }));
    s.scale.set(0.42, 0.25, 1);
    s.renderOrder = 9;
    s.visible = false;
    s.userData.canvas = canvas;
    return s;
  }

  drawBubble(p) {
    const cv = p.bubble.userData.canvas;
    const g = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.96)';
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(8, 8, w - 16, h - 46, 24);
    g.moveTo(w / 2 - 16, h - 39);
    g.lineTo(w / 2, h - 12);
    g.lineTo(w / 2 + 16, h - 39);
    g.fill();
    g.stroke();
    g.fillStyle = '#7a6a5a';
    g.font = "700 20px 'Inter', Arial, sans-serif";
    g.textAlign = 'left';
    g.fillText(p.seat.row + p.seat.col, 24, 34);
    if (p.speech) {
      g.fillStyle = '#1b1b1b';
      g.font = "700 26px 'Inter', Arial, sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(p.speech, w / 2, (h - 38) / 2 + 10, w - 36);
      g.textBaseline = 'alphabetic';
    } else {
      const n = p.want.length;
      const step = 110;
      const sx = w / 2 - ((n - 1) * step) / 2;
      p.want.forEach((it, i) => {
        g.globalAlpha = it.done ? 0.3 : 1;
        drawItem(g, it.key, sx + i * step, 80, 78);
        g.globalAlpha = 1;
      });
      const f = Math.max(0, p.patience / p.maxPatience);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.beginPath(); g.roundRect(30, h - 60, w - 60, 9, 5); g.fill();
      g.fillStyle = `hsl(${Math.round(f * 120)}, 75%, 45%)`;
      g.beginPath(); g.roundRect(30, h - 60, (w - 60) * f, 9, 5); g.fill();
    }
    p.bubble.material.map.needsUpdate = true;
  }

  call() {
    const idle = this.pax.filter((p) => p.state === 'idle');
    if (!idle.length) return;
    const p = idle[Math.floor(Math.random() * idle.length)];
    const progress = Math.min(1, this.elapsed / SHIFT);
    const n = Math.random() < 0.65 - progress * 0.35 ? 1 : 2;
    p.want = [];
    for (let i = 0; i < n; i++) {
      let k = ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)];
      if (p.want.some((w) => w.key === k)) k = ITEM_KEYS[(ITEM_KEYS.indexOf(k) + 1) % ITEM_KEYS.length];
      p.want.push({ key: k, done: false });
    }
    // los primeros, una sola cosa
    if (this.served + this.angry < 2) p.want = p.want.slice(0, 1);
    p.maxPatience = (38 + p.want.length * 14) * (1 - progress * 0.25);
    p.patience = p.maxPatience;
    p.state = 'calling';
    p.dirty = true;
    p.seat.light.material.color.set(0xffb020);
    this.ticketsDirty = true;
    this.sfx.pickup(); // "ding-dong" del botón de llamada
  }

  updatePax(dt, t) {
    const cam = this.camera.getWorldPosition(_v);
    for (const p of this.pax) {
      const m = p.model;
      if (p.state === 'calling') {
        p.patience -= dt;
        const f = p.patience / p.maxPatience;
        m.setMood(f < 0.3 ? 'impatient' : 'neutral');
        m.calling = true;
        p.seat.light.material.color.set(Math.sin(t * 6) > 0 ? 0xffb020 : 0x7a5200);
        if (p.patience <= 0) {
          p.state = 'angry';
          p.t = 0;
          m.setMood('angry');
          m.calling = false;
          p.say('¡Qué mal servicio!');
          this.stars--;
          this.angry++;
          this.ticketsDirty = true;
          p.seat.light.material.color.set(0x333333);
          this.sfx.angry(1);
        }
      } else {
        m.calling = false;
        p.t = (p.t || 0) + dt;
        if ((p.state === 'happy' || p.state === 'angry') && p.t > 3) {
          p.state = 'idle';
          m.setMood('neutral');
          p.want = [];
        }
      }
      // brazo levantado mientras llama
      m.pose(t, dt, cam);
      if (m.calling) {
        const arm = m.arms[p.seat.x > 0 ? 1 : 0];
        arm.shoulder.rotation.set(-2.7 + Math.sin(t * 5) * 0.1, 0, arm.side * 0.25);
        arm.elbow.rotation.x = -0.4;
      }
      if (p.speechT > 0) {
        p.speechT -= dt;
        if (p.speechT <= 0) {
          p.speech = null;
          p.dirty = true;
        }
      }
      const show = p.speech || p.state === 'calling';
      p.bubble.visible = !!show;
      p.bubble.position.set(p.seat.x * 0.85, 1.55, p.seat.z + 0.12);
      p.redrawT = (p.redrawT || 0) - dt;
      if (show && (p.dirty || p.redrawT <= 0)) {
        this.drawBubble(p);
        p.dirty = false;
        p.redrawT = 0.25;
      }
    }
  }

  // ---------- Cámara e interacción ----------

  applyCamera(camera, dt) {
    this.root.updateWorldMatrix(true, false);
    const bob = Math.sin(this.bob) * 0.025 * Math.min(1, Math.abs(this.speed) / WALK);
    camera.position.set(0, EYE + bob, this.z).applyMatrix4(this.root.matrixWorld);
    // giro suave hacia donde caminas o hacia el pasajero / la estantería
    let d = this.yawGoal - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 5);
    this.root.getWorldQuaternion(_q);
    _q2.setFromEuler(_e.set(this.pitch, this.yaw + this.yawDrag, 0, 'YXZ'));
    camera.quaternion.copy(_q).multiply(_q2);
    this.trayGroup.position.y = -0.32 + bob * 0.4;
  }

  drag(dx, dy) {
    this.yawDrag = THREE.MathUtils.clamp(this.yawDrag + dx * 0.004, -1.3, 1.3);
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.003, -0.6, 0.4);
  }

  pointerLook() {}

  hover() {}

  click(nx, ny) {
    _ndc.set(nx * 2 - 1, -(ny * 2 - 1));
    this.raycaster.setFromCamera(_ndc, this.camera);
    const targets = this.clickables.concat(this.pax.map((p) => p.model.root));
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.action && !o.userData.pax) o = o.parent;
      if (!o) continue;
      if (o.userData.pax) return this.goTo(o.userData.pax);
      if (o.userData.action === 'item') return this.fetch(o.userData.item);
    }
  }

  key(code) {
    for (const k of ITEM_KEYS) if (code === 'Digit' + ITEMS[k].key || code === 'Numpad' + ITEMS[k].key) return this.fetch(k);
  }

  // ---------- Bucle ----------

  update(dt, t, keys) {
    if (!this.active) return null;
    this.elapsed += dt;
    this.time -= dt;

    // llamadas de los pasajeros
    this.callT -= dt;
    const calling = this.pax.filter((p) => p.state === 'calling').length;
    if (this.time > 15 && this.callT <= 0) {
      if (calling < 5) this.call();
      const progress = Math.min(1, this.elapsed / SHIFT);
      this.callT = (11 - progress * 5) * (0.7 + Math.random() * 0.6);
    }

    // caminar: manual (W/S, flechas) o automático hacia el destino
    const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    let want = 0;
    if (fwd) {
      this.target = null;
      want = -fwd * WALK; // hacia los asientos es -z
    } else if (this.target) {
      const d = this.target.z - this.z;
      if (Math.abs(d) < 0.05) {
        this.z = this.target.z;
        this.speed = 0;
        this.arrive();
      } else {
        want = Math.sign(d) * Math.min(WALK, Math.abs(d) * 3 + 0.4);
      }
    }
    this.speed += (want - this.speed) * Math.min(1, dt * 8);
    const prevZ = this.z;
    this.z = THREE.MathUtils.clamp(this.z + this.speed * dt, Z_BACK + 0.6, Z_FRONT - 0.6);
    this.walked += Math.abs(this.z - prevZ);
    if (Math.abs(this.speed) > 0.2) {
      this.yawGoal = this.speed < 0 ? 0 : Math.PI;
      this.yawDrag *= Math.exp(-dt * 3);
      this.bob += dt * Math.abs(this.speed) * 4.2;
      this.stepAcc += Math.abs(this.speed) * dt;
      if (this.stepAcc > 0.75) {
        this.stepAcc = 0;
        this.sfx.step();
      }
    }

    // cafetera
    if (this.brewing) {
      this.brewing.t += dt;
      const k = Math.min(1, this.brewing.t / ITEMS.cafe.brew);
      this.brewLight.material.color.set(k < 1 ? 0xffb020 : 0x2bd66b);
      this.ui.brew.hidden = false;
      this.ui.brew.style.setProperty('--p', k);
      if (k >= 1 && Math.abs(this.z - ITEMS.cafe.z) < 0.3) {
        if (this.tray.length < TRAY) {
          this.tray.push('cafe');
          this.renderTray();
          this.sfx.ding();
          this.brewing = null;
          this.ui.brew.hidden = true;
          this.brewLight.material.color.set(0x333333);
        }
      } else if (k >= 1 && !this.brewReady) {
        this.brewReady = true;
        this.hint('El café está listo en la cafetera');
        this.sfx.ding();
      }
      if (!this.brewing) this.brewReady = false;
    }

    this.updatePax(dt, t);
    this.hudT = (this.hudT || 0) - dt;
    if (this.hudT <= 0) {
      this.hudT = 0.2;
      this.renderHud();
    }
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.ui.hint.classList.remove('show');
    }
    if (this.stars <= 0) return 'over';
    if (this.time <= 0 && !this.pax.some((p) => p.state === 'calling')) return 'over';
    if (this.time <= -30) return 'over';
    return null;
  }

  renderTray() {
    const el = this.ui.tray;
    let html = '';
    for (let i = 0; i < TRAY; i++) {
      const k = this.tray[i];
      html += k
        ? `<button class="t-slot full" data-i="${i}" title="Devolver ${ITEMS[k].name}"><img src="${itemIconURL(k)}" alt="${ITEMS[k].name}"><span>×</span></button>`
        : '<div class="t-slot"></div>';
    }
    el.innerHTML = html;
    // modelos en la bandeja
    const g = this.trayItems;
    while (g.children.length) g.remove(g.children[0]);
    this.tray.forEach((k, i) => {
      const m = itemModel(k);
      m.position.set(-0.1 + i * 0.1, 0.006, 0);
      m.scale.setScalar(0.9);
      g.add(m);
    });
  }

  renderHud() {
    const u = this.ui;
    u.money.textContent = '$' + this.money;
    const t = Math.max(0, Math.ceil(this.time));
    u.clock.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    u.clock.classList.toggle('low', this.time < 30);
    const spans = u.stars.children;
    for (let i = 0; i < spans.length; i++) spans[i].classList.toggle('lost', i >= this.stars);
    const list = this.pax.filter((p) => p.state === 'calling').sort((a, b) => a.patience - b.patience);
    if (this.ticketsDirty || u.tickets.children.length !== list.length) {
      this.ticketsDirty = false;
      u.tickets.innerHTML = list.map((p) => `
        <button class="ticket s-ticket" data-id="${p.id}">
          <div class="t-head"><span>Asiento ${p.seat.row}${p.seat.col}</span><span>ir ›</span></div>
          <div class="t-icons">${p.want.map((w) => `<img class="${w.done ? 'done' : ''}" src="${itemIconURL(w.key)}" alt="${ITEMS[w.key].name}">`).join('')}</div>
          <div class="t-bar"><i></i></div>
        </button>`).join('');
    }
    for (const p of list) {
      const bar = u.tickets.querySelector(`.ticket[data-id="${p.id}"] .t-bar i`);
      if (!bar) continue;
      const f = Math.max(0, p.patience / p.maxPatience);
      bar.style.width = f * 100 + '%';
      bar.style.background = `hsl(${Math.round(f * 120)}, 70%, 45%)`;
    }
  }

  hint(text, dur = 2) {
    this.ui.hint.textContent = text;
    this.ui.hint.classList.add('show');
    this.hintT = dur;
  }

  pop(text) {
    const el = this.ui.pop;
    el.textContent = text;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }
}
