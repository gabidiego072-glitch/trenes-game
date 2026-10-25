import * as THREE from 'three';

// ---------- Carta ----------

export const FLAVORS = {
  cola: { name: 'Cola', color: 0x3a1a0c },
  naranja: { name: 'Naranja', color: 0xff8a1c },
  limon: { name: 'Limón', color: 0xc9e83a },
};
export const TOPPINGS = ['cheese', 'lettuce', 'tomato', 'onion'];
export const SAUCES = ['ketchup', 'mustard'];
export const MOD_NAMES = {
  cheese: 'queso', lettuce: 'lechuga', tomato: 'tomate', onion: 'cebolla',
  ketchup: 'kétchup', mustard: 'mostaza', ice: 'hielo', salt: 'sal',
};

// Tiempos de cocinado (segundos): hecho a partir de `ok`, quemado a partir de `burnt`.
export const COOK = {
  patty: { ok: 6, burnt: 14 },
  sausage: { ok: 4.5, burnt: 11 },
  fries: { ok: 5, burnt: 12 },
};

export function quality(kind, t) {
  const c = COOK[kind];
  if (t < c.ok) return 'raw';
  if (t < c.burnt) return 'ok';
  return 'burnt';
}

export function price(o) {
  if (o.key === 'burger') return 5 + o.tops.length * 0.5;
  if (o.key === 'hotdog') return 4;
  if (o.key === 'fries') return 3;
  return 2;
}

// ---------- Materiales ----------

const mats = {};
function mat(key, params) {
  if (!mats[key]) mats[key] = new THREE.MeshStandardMaterial(params);
  return mats[key];
}
const physical = (p) => new THREE.MeshPhysicalMaterial(p);

const BUN = () => mat('bun', { color: 0xc98a3c, roughness: 0.55 });
const PLATE = () => mat('plate', { color: 0xf4f4f0, roughness: 0.25 });
export const TOPPING_MATS = {
  cheese: () => mat('cheese', { color: 0xffc21a, roughness: 0.5 }),
  lettuce: () => mat('lettuce', { color: 0x5fb33a, roughness: 0.6 }),
  tomato: () => mat('tomato', { color: 0xd8312a, roughness: 0.35 }),
  onion: () => mat('onion', { color: 0xf1e6f2, roughness: 0.4 }),
  ketchup: () => mat('ketchup', { color: 0xc8161d, roughness: 0.3 }),
  mustard: () => mat('mustard', { color: 0xf2c41a, roughness: 0.35 }),
};

/** Color de la carne / patatas según el tiempo de cocinado. */
const RAW = new THREE.Color(0xd9737a), DONE = new THREE.Color(0x6b3a1e), BURNT = new THREE.Color(0x161210);
const RAW_S = new THREE.Color(0xe8909a), DONE_S = new THREE.Color(0x9a3d1e);
const F_RAW = new THREE.Color(0xf3e3a0), F_DONE = new THREE.Color(0xe0a63a), F_BURNT = new THREE.Color(0x4a2a10);
export function cookColor(kind, t, out = new THREE.Color()) {
  const c = COOK[kind];
  if (kind === 'fries') {
    return t < c.ok ? out.copy(F_RAW).lerp(F_DONE, t / c.ok) : out.copy(F_DONE).lerp(F_BURNT, Math.min(1, (t - c.ok) / (c.burnt - c.ok)));
  }
  const raw = kind === 'sausage' ? RAW_S : RAW;
  const done = kind === 'sausage' ? DONE_S : DONE;
  if (t < c.ok) return out.copy(raw).lerp(done, t / c.ok);
  return out.copy(done).lerp(BURNT, Math.min(1, (t - c.ok) / (c.burnt - c.ok)));
}
const qT = (kind, q) => (q === 'raw' ? 1 : q === 'ok' ? COOK[kind].ok + 1.5 : COOK[kind].burnt + 6);

function shadowy(g) {
  g.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return g;
}

// ---------- Piezas sueltas ----------

export function makePatty(t = 0) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.054, 0.018, 24),
    new THREE.MeshStandardMaterial({ color: cookColor('patty', t), roughness: 0.8 })
  );
  m.castShadow = true;
  return m;
}

export function makeSausage(t = 0) {
  const m = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.016, 0.1, 6, 12),
    new THREE.MeshStandardMaterial({ color: cookColor('sausage', t), roughness: 0.45 })
  );
  m.rotation.z = Math.PI / 2;
  m.castShadow = true;
  return m;
}

export function setCook(obj, kind, t) {
  if (obj.isMesh && obj.material && obj.material.color) cookColor(kind, t, obj.material.color);
}

/** Capa de ingrediente para la hamburguesa (y = altura de la base de la capa). Devuelve el grosor. */
function toppingLayer(g, kind, y) {
  if (kind === 'cheese') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.004, 0.1), TOPPING_MATS.cheese());
    m.rotation.y = Math.PI / 4;
    m.position.y = y + 0.002;
    g.add(m);
    return 0.005;
  }
  if (kind === 'lettuce') {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 6, 22), TOPPING_MATS.lettuce());
    m.rotation.x = Math.PI / 2;
    m.scale.z = 0.55;
    m.position.y = y + 0.004;
    g.add(m);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.004, 20), TOPPING_MATS.lettuce());
    c.position.y = y + 0.003;
    g.add(c);
    return 0.008;
  }
  if (kind === 'tomato') {
    for (const [dx, dz] of [[-0.02, 0.015], [0.02, -0.012], [0.005, 0.03]]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.006, 18), TOPPING_MATS.tomato());
      m.position.set(dx, y + 0.003, dz);
      g.add(m);
    }
    return 0.007;
  }
  if (kind === 'onion') {
    for (const [dx, dz, r] of [[-0.015, 0.01, 0.022], [0.018, -0.008, 0.018], [0, 0.025, 0.015]]) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.003, 6, 18), TOPPING_MATS.onion());
      m.rotation.x = Math.PI / 2;
      m.position.set(dx, y + 0.003, dz);
      g.add(m);
    }
    return 0.005;
  }
  return 0;
}

function sesameTop(g, y) {
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.06, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), BUN());
  top.scale.y = 0.7;
  top.position.y = y;
  g.add(top);
  const seedGeo = new THREE.SphereGeometry(0.004, 6, 4);
  seedGeo.scale(1, 0.5, 1.6);
  const seedMat = mat('seed', { color: 0xfff2cc, roughness: 0.6 });
  for (let i = 0; i < 14; i++) {
    const a = (i * 2.399) % (Math.PI * 2), r = Math.sqrt((i + 0.5) / 14) * 0.045;
    const s = new THREE.Mesh(seedGeo, seedMat);
    s.position.set(Math.cos(a) * r, y + Math.sqrt(Math.max(0, 0.06 * 0.06 - r * r)) * 0.7, Math.sin(a) * r);
    s.rotation.y = a;
    g.add(s);
  }
}

/**
 * Hamburguesa por capas. spec = { tops: [...], patty: true|false, q, closed, plate }
 * En la tabla de montaje va abierta (sin pan de arriba) y sin plato.
 */
export function makeBurger(spec = {}) {
  const { tops = [], patty = true, q = 'ok', closed = true, plate = true, pattyT } = spec;
  const g = new THREE.Group();
  let y = 0;
  if (plate) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.012, 32), PLATE());
    p.position.y = 0.006;
    g.add(p);
    y = 0.012;
  }
  const bot = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.055, 0.022, 28), BUN());
  bot.position.y = y + 0.011;
  g.add(bot);
  y += 0.022;
  if (patty) {
    const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 28), new THREE.MeshStandardMaterial({ roughness: 0.8 }));
    cookColor('patty', pattyT !== undefined ? pattyT : qT('patty', q), pm.material.color);
    pm.position.y = y + 0.01;
    g.add(pm);
    y += 0.02;
  }
  for (const k of TOPPINGS) if (tops.includes(k)) y += toppingLayer(g, k, y);
  if (closed) sesameTop(g, y);
  return shadowy(g);
}

/** Perrito: spec = { sauces: [...], sausage: true|false, q, tray } */
export function makeHotdog(spec = {}) {
  const { sauces = [], sausage = true, q = 'ok', tray = true, sausageT } = spec;
  const g = new THREE.Group();
  if (tray) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.02, 0.07), mat('tray', { color: 0xe8e2d6, roughness: 0.8 }));
    t.position.y = 0.01;
    g.add(t);
  }
  const y0 = tray ? 0.02 : 0;
  for (const s of [-1, 1]) {
    const half = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.11, 6, 12), BUN());
    half.rotation.z = Math.PI / 2;
    half.position.set(0, y0 + 0.016, s * 0.016);
    half.scale.set(1, 1, 0.9);
    g.add(half);
  }
  if (sausage) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.13, 6, 12), new THREE.MeshStandardMaterial({ roughness: 0.4 }));
    cookColor('sausage', sausageT !== undefined ? sausageT : qT('sausage', q), m.material.color);
    m.rotation.z = Math.PI / 2;
    m.position.y = y0 + 0.028;
    g.add(m);
  }
  SAUCES.forEach((k, idx) => {
    if (!sauces.includes(k)) return;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      pts.push(new THREE.Vector3(-0.065 + u * 0.13, y0 + 0.043 + idx * 0.003, Math.sin(u * Math.PI * 7 + idx * 1.6) * 0.009));
    }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.0028, 6, false), TOPPING_MATS[k]()));
  });
  return shadowy(g);
}

/** Vaso de papel; el líquido sube al servir; puede llevar hielo. */
export function makeCup(fill = null, level = 1, ice = false) {
  const g = new THREE.Group();
  const paper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.03, 0.12, 24, 1, true),
    physical({ color: 0xfafafa, roughness: 0.5, side: THREE.DoubleSide })
  );
  paper.position.y = 0.06;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.0375, 0.0345, 0.03, 24, 1, true), mat('cupStripe', { color: 0xd8262b, roughness: 0.5 }));
  stripe.position.y = 0.055;
  stripe.scale.setScalar(1.01);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), mat('cupBottom', { color: 0xeeeeee }));
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.002;
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.029, 1, 24), physical({ color: 0x000000, roughness: 0.15, clearcoat: 1 }));
  liquid.visible = false;
  const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.17, 8), mat('straw', { color: 0xffffff, roughness: 0.4 }));
  straw.position.set(0.012, 0.12, 0);
  straw.rotation.z = -0.18;
  straw.visible = false;
  const iceG = new THREE.Group();
  const iceMat = physical({ color: 0xdff4ff, roughness: 0.05, transmission: 0.3, transparent: true, opacity: 0.8, clearcoat: 1 });
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.018), iceMat);
    c.position.set(Math.cos(i * 1.7) * 0.013, 0.012 + (i % 2) * 0.012, Math.sin(i * 1.7) * 0.013);
    c.rotation.set(i, i * 2, i * 0.5);
    iceG.add(c);
  }
  iceG.visible = ice;
  g.add(paper, stripe, bottom, liquid, straw, iceG);
  g.userData = { liquid, straw, iceG };
  setFill(g, fill, level);
  return shadowy(g);
}

export function setFill(cup, fill, level = 1) {
  const { liquid, straw, iceG } = cup.userData;
  if (!fill || level <= 0) {
    liquid.visible = false;
    straw.visible = false;
    return;
  }
  liquid.visible = true;
  straw.visible = level >= 1;
  liquid.material.color.set(FLAVORS[fill].color);
  const h = 0.105 * Math.min(1, level);
  liquid.scale.set(1, h, 1);
  liquid.position.y = 0.005 + h / 2;
  if (iceG.visible) iceG.position.y = Math.max(0, h - 0.035);
}

export function makeFries(q = 'ok', t = 7, salt = false) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.036, 0.09, 4, 1, true), physical({ color: 0xd8262b, roughness: 0.6, side: THREE.DoubleSide }));
  box.rotation.y = Math.PI / 4;
  box.position.y = 0.045;
  g.add(box);
  const stickGeo = new THREE.BoxGeometry(0.008, 0.08, 0.008);
  const stickMat = new THREE.MeshStandardMaterial({ color: cookColor('fries', q === 'ok' ? Math.max(t, 6) : qT('fries', q)), roughness: 0.6 });
  for (let i = 0; i < 18; i++) {
    const s = new THREE.Mesh(stickGeo, stickMat);
    s.position.set(Math.sin(i * 2.1) * 0.025, 0.085 + ((i * 7) % 5) * 0.004, Math.cos(i * 1.3) * 0.025);
    s.rotation.set(Math.sin(i) * 0.2, i, Math.cos(i * 1.7) * 0.2);
    g.add(s);
  }
  if (salt) {
    const sm = mat('salt', { color: 0xffffff, roughness: 0.3 });
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.0017, 4, 3), sm);
      s.position.set(Math.sin(i * 3.7) * 0.026, 0.125 + ((i * 3) % 4) * 0.003, Math.cos(i * 2.3) * 0.026);
      g.add(s);
    }
  }
  g.userData.sticks = stickMat;
  return shadowy(g);
}

/** Modelo 3D de lo que llevas en la mano. */
export function makeHeld(item) {
  switch (item.kind) {
    case 'cup': return makeCup(item.fill, item.fill ? 1 : 0, item.ice);
    case 'patty': return makePatty(item.t);
    case 'sausage': return makeSausage(item.t);
    case 'burger': return makeBurger({ tops: item.tops, q: item.q });
    case 'hotdog': return makeHotdog({ sauces: item.sauces, q: item.q });
    case 'fries': return makeFries(item.q, item.t, item.salt);
    default: return new THREE.Group();
  }
}

/** Modelo de un pedido servido (para dejarlo en la barra delante del cliente). */
export function makeServed(o) {
  if (o.key === 'burger') return makeBurger({ tops: o.tops });
  if (o.key === 'hotdog') return makeHotdog({ sauces: o.sauces });
  if (o.key === 'fries') return makeFries('ok', 8, o.salt);
  return makeCup(o.flavor, 1, o.ice);
}

const list = (arr) => {
  const names = arr.map((k) => MOD_NAMES[k]);
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' y ' + names[names.length - 1];
};

export function itemLabel(item) {
  if (!item) return '';
  const qn = { raw: 'cruda', ok: 'en su punto', burnt: 'quemada' };
  switch (item.kind) {
    case 'cup':
      if (!item.fill) return item.ice ? 'Vaso con hielo' : 'Vaso vacío';
      return FLAVORS[item.fill].name + (item.ice ? ' con hielo' : ' sin hielo');
    case 'patty': return 'Carne ' + qn[quality('patty', item.t)];
    case 'sausage': return 'Salchicha ' + ({ raw: 'cruda', ok: 'hecha', burnt: 'quemada' })[quality('sausage', item.t)];
    case 'burger': return 'Hamburguesa' + (item.tops.length ? ' con ' + list(item.tops) : ' sola') + (item.q === 'ok' ? '' : item.q === 'raw' ? ' (cruda)' : ' (quemada)');
    case 'hotdog': return 'Perrito' + (item.sauces.length ? ' con ' + list(item.sauces) : ' solo') + (item.q === 'ok' ? '' : item.q === 'raw' ? ' (crudo)' : ' (quemado)');
    case 'fries': return 'Patatas' + (item.salt ? ' con sal' : ' sin sal') + (item.q === 'ok' ? '' : item.q === 'raw' ? ' (crudas)' : ' (quemadas)');
    default: return '';
  }
}

export function orderLabel(o) {
  if (o.key === 'burger') return 'Hamburguesa' + (o.tops.length ? ': ' + list(o.tops) : ' sola');
  if (o.key === 'hotdog') return 'Perrito' + (o.sauces.length ? ': ' + list(o.sauces) : ' solo');
  if (o.key === 'fries') return 'Patatas' + (o.salt ? ' con sal' : ' sin sal');
  return FLAVORS[o.flavor].name + (o.ice ? ' con hielo' : ' sin hielo');
}

/** Convierte lo que llevas en la mano en una entrada comparable con el pedido. */
export function asOrder(item) {
  if (!item) return null;
  if (item.kind === 'cup') return item.fill ? { key: 'drink', flavor: item.fill, ice: !!item.ice } : null;
  if (item.kind === 'burger') return { key: 'burger', tops: [...item.tops].sort(), q: item.q };
  if (item.kind === 'hotdog') return { key: 'hotdog', sauces: [...item.sauces].sort(), q: item.q };
  if (item.kind === 'fries') return { key: 'fries', salt: !!item.salt, q: item.q };
  return null;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
export function matches(o, s) {
  if (o.key !== s.key) return false;
  if (o.key === 'burger') return same(o.tops, s.tops);
  if (o.key === 'hotdog') return same(o.sauces, s.sauces);
  if (o.key === 'fries') return o.salt === s.salt;
  return o.flavor === s.flavor && o.ice === s.ice;
}

/** Frase de queja explicando en qué se ha equivocado el camarero. */
export function complaint(o, s) {
  if (o.key === 'drink') {
    if (o.flavor !== s.flavor) return '¡Yo pedí ' + FLAVORS[o.flavor].name.toLowerCase() + '!';
    return o.ice ? '¿Y el hielo?' : '¡Lo pedí sin hielo!';
  }
  if (o.key === 'fries') return o.salt ? '¡Le falta sal!' : '¡Las quería sin sal!';
  const want = o.key === 'burger' ? o.tops : o.sauces;
  const got = o.key === 'burger' ? s.tops : s.sauces;
  const missing = want.find((k) => !got.includes(k));
  if (missing) return '¡Le falta ' + MOD_NAMES[missing] + '!';
  const extra = got.find((k) => !want.includes(k));
  return '¡La pedí sin ' + MOD_NAMES[extra] + '!';
}

// ---------- Iconos (dibujados a mano en canvas) ----------

export function drawIcon(g, o, x, y, s) {
  const key = o.key === 'drink' ? o.flavor : o.key;
  g.save();
  g.translate(x, y);
  g.scale(s / 100, s / 100);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (FLAVORS[key]) {
    const col = '#' + new THREE.Color(FLAVORS[key].color).getHexString();
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#2b2b2b';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(-28, -32); g.lineTo(28, -32); g.lineTo(20, 42); g.lineTo(-20, 42); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(-25, -18); g.lineTo(25, -18); g.lineTo(19, 38); g.lineTo(-19, 38); g.closePath();
    g.fill();
    g.fillStyle = '#d8262b';
    g.fillRect(-24, 0, 47, 9);
    g.strokeStyle = '#d8262b';
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(6, -30); g.lineTo(16, -52); g.stroke();
  } else if (key === 'burger') {
    g.fillStyle = '#d9963f';
    g.beginPath(); g.ellipse(0, -8, 44, 30, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#6b3a1e'; g.fillRect(-44, 2, 88, 18);
    g.fillStyle = '#c98a3c';
    g.beginPath(); g.roundRect(-42, 22, 84, 16, 7); g.fill();
    g.fillStyle = '#fff2cc';
    for (const [sx, sy] of [[-18, -24], [0, -30], [16, -22], [-6, -16], [26, -14]]) { g.beginPath(); g.ellipse(sx, sy, 4, 2.4, 0.4, 0, Math.PI * 2); g.fill(); }
  } else if (key === 'hotdog') {
    g.rotate(-0.25);
    g.fillStyle = '#d9963f';
    g.beginPath(); g.roundRect(-46, -2, 92, 26, 13); g.fill();
    g.fillStyle = '#a5401f';
    g.beginPath(); g.roundRect(-52, -14, 104, 18, 9); g.fill();
    g.fillStyle = '#c98a3c';
    g.beginPath(); g.roundRect(-46, 6, 92, 18, 9); g.fill();
  } else if (key === 'fries') {
    g.fillStyle = '#f0b43a';
    for (let i = 0; i < 7; i++) { g.save(); g.translate(-24 + i * 8, -14); g.rotate((i - 3) * 0.07); g.fillRect(-3.5, -30, 7, 40); g.restore(); }
    g.fillStyle = '#d8262b';
    g.beginPath(); g.moveTo(-34, -12); g.lineTo(34, -12); g.lineTo(26, 42); g.lineTo(-26, 42); g.closePath(); g.fill();
    g.fillStyle = '#ffd23f';
    g.beginPath(); g.arc(0, 14, 9, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

/** Mini iconos de ingredientes y extras. */
export function drawMod(g, mod, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s / 40, s / 40);
  if (mod === 'cheese') {
    g.fillStyle = '#ffc21a';
    g.beginPath(); g.moveTo(-16, 10); g.lineTo(16, 10); g.lineTo(16, -6); g.lineTo(-6, -14); g.lineTo(-16, -6); g.fill();
    g.fillStyle = '#e8a400';
    for (const [cx, cy] of [[-6, 2], [6, -2], [8, 6]]) { g.beginPath(); g.arc(cx, cy, 2.5, 0, Math.PI * 2); g.fill(); }
  } else if (mod === 'lettuce') {
    g.fillStyle = '#5fb33a';
    g.beginPath();
    for (let i = 0; i <= 12; i++) { const a = Math.PI + (i / 12) * Math.PI; const r = i % 2 ? 13 : 17; g.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.9 + 6); }
    g.closePath(); g.fill();
  } else if (mod === 'tomato') {
    g.fillStyle = '#d8312a';
    g.beginPath(); g.arc(0, 0, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff9a8a';
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.6; g.beginPath(); g.ellipse(Math.cos(a) * 7, Math.sin(a) * 7, 3.5, 2, a, 0, Math.PI * 2); g.fill(); }
  } else if (mod === 'onion') {
    g.strokeStyle = '#b07ab8';
    g.lineWidth = 4;
    g.beginPath(); g.arc(0, 0, 14, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.stroke();
  } else if (mod === 'ketchup' || mod === 'mustard') {
    g.fillStyle = mod === 'ketchup' ? '#c8161d' : '#f2c41a';
    g.beginPath(); g.moveTo(0, -17); g.bezierCurveTo(14, 0, 12, 15, 0, 15); g.bezierCurveTo(-12, 15, -14, 0, 0, -17); g.fill();
  } else if (mod === 'ice') {
    g.fillStyle = '#bfe8ff'; g.strokeStyle = '#6fb3d6'; g.lineWidth = 3;
    g.beginPath(); g.roundRect(-13, -13, 26, 26, 5); g.fill(); g.stroke();
    g.fillStyle = '#ffffff'; g.fillRect(-7, -8, 6, 4);
  } else if (mod === 'salt') {
    g.fillStyle = '#e9e9e9'; g.strokeStyle = '#777'; g.lineWidth = 3;
    g.beginPath(); g.roundRect(-10, -8, 20, 24, 4); g.fill(); g.stroke();
    g.fillStyle = '#9aa0a8'; g.beginPath(); g.roundRect(-10, -16, 20, 9, 3); g.fill();
  }
  g.restore();
}

/** Extras que se muestran bajo el icono principal del pedido. */
export function modsOf(o) {
  if (o.key === 'burger') return o.tops;
  if (o.key === 'hotdog') return o.sauces;
  if (o.key === 'fries') return o.salt ? ['salt'] : [];
  return o.ice ? ['ice'] : [];
}
