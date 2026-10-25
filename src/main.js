import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import {
  DS, CLEAR, KMAX, START_SPEED, MAX_SPEED, MIN_SPEED, COIN_POINTS, GEM_POINTS,
} from './config.js';
import { clamp, damp, isTouchDevice, storageGet, storageSet } from './utils.js';
import { makeSkyMaterial, SKY } from './materials.js';
import { World } from './world.js';
import { Track } from './track.js';
import { Train } from './train.js';
import { Particles, Builder } from './effects.js';
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { Missions } from './missions.js';
import { Traffic } from './traffic.js';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), score: $('score'), dist: $('dist'), coins: $('coins'), mult: $('mult'),
  speed: $('speed'), alt: $('alt'), altFill: $('altFill'), warn: $('warn'), toast: $('toast'),
  menu: $('menu'), pause: $('pause'), over: $('over'), best: $('best'), loading: $('loading'),
  oScore: $('oScore'), oDist: $('oDist'), oCoins: $('oCoins'), oAlt: $('oAlt'), newBest: $('newBest'),
  qualityBtn: $('qualityBtn'), muteBtn: $('muteBtn'), tl: $('tl'), tr: $('tr'),
  mission: $('mission'), mText: $('mText'), mDist: $('mDist'), mCount: $('mCount'), mTime: $('mTime'),
  mBar: $('mBar'), mArrow: $('mArrow'), hearts: $('hearts'), oTitle: $('oTitle'), oReason: $('oReason'),
  oDeliv: $('oDeliv'), oPass: $('oPass'),
};
const touch = isTouchDevice();

// ---------- Render ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(SKY.hor, 0.0036);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 2500);

const sunDir = new THREE.Vector3(-0.78, 0.2, 0.6).normalize();
const skyMat = makeSkyMaterial(sunDir);
const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 40, 20), skyMat);
sky.renderOrder = -10;
sky.frustumCulled = false;
scene.add(sky);

// reflejos del cielo en los cristales
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), makeSkyMaterial(sunDir)));
  scene.environment = pmrem.fromScene(envScene, 0.02, 0.1, 500).texture;
  pmrem.dispose();
}

const hemi = new THREE.HemisphereLight(0x7f88d8, 0x2e2230, 0.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffa86e, 2.5);
sun.castShadow = true;
sun.shadow.camera.left = -95;
sun.shadow.camera.right = 95;
sun.shadow.camera.top = 95;
sun.shadow.camera.bottom = -95;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 600;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

const flash = new THREE.PointLight(0xff8a3a, 0, 80, 1.5);
scene.add(flash);

// ---------- Calidad ----------
const QUALITY = {
  high: { ratio: Math.min(devicePixelRatio, 2), bloom: true, shadow: 2048, label: 'Alta' },
  low: { ratio: Math.min(devicePixelRatio, 1), bloom: false, shadow: 1024, label: 'Baja' },
};
let quality = storageGet('vialibre.quality', touch ? 'low' : 'high');
if (!QUALITY[quality]) quality = 'high';
let composer = null;
let bloomPass = null;

function applyQuality() {
  const q = QUALITY[quality];
  renderer.setPixelRatio(q.ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  if (sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }
  if (q.bloom) {
    if (!composer) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.55, 0.86);
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
    }
    composer.setPixelRatio(q.ratio);
    composer.setSize(innerWidth, innerHeight);
  }
  ui.qualityBtn.textContent = 'Calidad: ' + q.label;
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  if (composer) composer.setSize(innerWidth, innerHeight);
}
window.addEventListener('resize', onResize);

// ---------- Mundo ----------
const world = new World(scene);
const track = new Track(scene, world);
const train = new Train(scene);
const builder = new Builder(scene);
const missions = new Missions(scene, world);
const traffic = new Traffic(scene, world);
const smoke = new Particles(scene, 1600, { soft: true, drag: 1.6, gravity: 1.2 });
const sparks = new Particles(scene, 900, { additive: true, gravity: -14, drag: 0.6 });
const fire = new Particles(scene, 300, { additive: true, soft: true, gravity: 3, drag: 2.2 });
const sfx = new Sfx();
const input = new Input(canvas);

const C_SMOKE = new THREE.Color(0.78, 0.72, 0.7);
const C_DARK = new THREE.Color(0.16, 0.14, 0.14);
const C_GOLD = new THREE.Color(1.0, 0.75, 0.2);
const C_GEM = new THREE.Color(0.35, 0.9, 1.0);
const C_FIRE = new THREE.Color(1.0, 0.45, 0.12);
const C_FIRE2 = new THREE.Color(1.0, 0.8, 0.3);
const C_PICKUP = new THREE.Color(0.24, 1.0, 0.66);
const C_STEAM = new THREE.Color(0.9, 0.88, 0.92);
const C_TAXI = new THREE.Color(1.0, 0.8, 0.1);
const TAXI_LINES = ['¡Taxi!', '¡Ese taxi volaba!', '¡Cuidado con los taxis!', '¡Paso, que voy!'];
const CONFETTI = [0xff5a5f, 0xffc93c, 0x3dffa8, 0x5ef2ff, 0xb388ff, 0xffffff].map((c) => new THREE.Color(c));

// ---------- Estado ----------
const G = {
  mode: 'menu',     // menu | playing | paused | crash | over
  attract: true,    // la IA juega en el menú
  s: 0, v: START_SPEED, dist: 0, score: 0, coins: 0, mult: 1, maxAlt: 0, taxis: 0,
  time: 0, crashT: 0, shake: 0, slowmo: 1, danger: false, playT: 0,
  best: Number(storageGet('vialibre.best', '0')) || 0,
};
ui.best.textContent = G.best.toLocaleString('es-ES');

let muted = storageGet('vialibre.muted', '0') === '1';
sfx.setMuted(muted);
ui.muteBtn.textContent = 'Sonido: ' + (muted ? 'No' : 'Sí');

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpF = new THREE.Vector3();
const tmpL = new THREE.Vector3();

function resetRun(attract) {
  G.attract = attract;
  G.s = 0;
  G.v = START_SPEED;
  G.dist = 0;
  G.score = 0;
  G.coins = 0;
  G.mult = 1;
  G.maxAlt = 0;
  G.taxis = 0;
  G.crashT = 0;
  G.shake = 0;
  G.slowmo = 1;
  G.playT = 0;
  G.danger = false;
  world.reset((Math.random() * 1e9) | 0);
  track.reset();
  train.reset();
  smoke.clear();
  sparks.clear();
  fire.clear();
  flash.intensity = 0;
  builder.setDanger(false);
  world.update(new THREE.Vector3(0, 0, 0), 100000);
  traffic.reset(new THREE.Vector3(0, 0, 0));
  track.lockIndex = 3;
  while (track.headS < 40) track.addPoint();
  track.flush();
  train.place(track, G.s, 0, 0);
  missions.reset();
  if (!attract) missions.begin(train.position, train.forward(new THREE.Vector3()), G.v);
  updateHearts();
  updateCamera(0, true);
  hintStep = 0;
  hintT = 1.2;
}

// ---------- IA del modo demostración ----------
let aiT = 0;
let aiChoice = 0;
function aiSteer(dt) {
  aiT -= dt;
  if (aiT <= 0) {
    aiT = 0.3;
    const wander = Math.sin(G.time * 0.21) * 0.6;
    let best = -Infinity;
    for (const st of [-1, -0.5, 0, 0.5, 1]) {
      let hit = false;
      let heights = 0;
      track.predict(-st * KMAX, 75, 2, (x, z) => {
        if (world.towerHit(x, z, 2.5)) {
          hit = true;
          return false;
        }
        heights += Math.min(world.heightAt(x, z, 0, false), 25);
      });
      const score = (hit ? -1000 : 0) + heights * 0.04 - Math.abs(st - wander) * 2;
      if (score > best) {
        best = score;
        aiChoice = st;
      }
    }
  }
  return aiChoice;
}

function towerAhead(steer, dist) {
  let hit = false;
  track.predict(-steer * KMAX, dist, 1.5, (x, z) => {
    if (world.towerHit(x, z, 1.7)) {
      hit = true;
      return false;
    }
  });
  return hit;
}

// ---------- Mensajes ----------
let toastTimer = 0;
function toast(text, dur = 1.8, color = '') {
  ui.toast.textContent = text;
  ui.toast.style.color = color;
  ui.toast.classList.add('show');
  toastTimer = dur;
}
let hintStep = 0;
let hintT = 0;
const HINTS = touch
  ? ['Toca los lados para dirigir la vía', 'Sigue la flecha hasta la estación verde', 'Evita los rascacielos de luces rojas']
  : ['Usa ← → para dirigir la vía', 'Sigue la flecha hasta la estación verde', 'Evita los rascacielos de luces rojas'];

// ---------- Bucle de juego ----------
function stepRun(dt) {
  const steerIn = G.attract ? aiSteer(dt) : input.steer;
  track.steer = damp(track.steer, steerIn, 10, dt);

  // la pendiente frena al subir y acelera al bajar
  const slope = track.slopeAt(G.s - 6);
  const vTarget = Math.min(MAX_SPEED, START_SPEED + G.dist * 0.0045);
  const acc = (vTarget - G.v) * 0.45 - slope * 9.8 * 0.5;
  G.v = clamp(G.v + acc * dt, MIN_SPEED, MAX_SPEED + 8);
  const ds = G.v * dt;
  G.s += ds;
  G.dist += ds;

  track.lockIndex = Math.floor(G.s / DS) + 3;
  const lead = 28 + G.v * 0.55;
  let guard = 0;
  while (track.blockedAt === null && track.headS < G.s + lead && guard++ < 500) track.addPoint();
  track.flush();

  if (G.s >= track.endS - 1.5) {
    crash();
    return;
  }
  train.place(track, G.s, G.v, dt);

  // altura sobre la calle y multiplicador
  const alt = Math.max(0, track.get(Math.round((G.s - 4) / DS)).y - CLEAR);
  G.maxAlt = Math.max(G.maxAlt, alt);
  const newMult = alt > 18 ? 3 : alt > 3.5 ? 2 : 1;
  if (newMult > G.mult && !G.attract) {
    toast(newMult === 3 ? '¡Por las nubes! x3' : '¡Sobre los tejados! x2', 1.4, newMult === 3 ? '#5ef2ff' : '#ffb347');
    sfx.bonus();
  }
  G.mult = newMult;
  G.score += ds * G.mult;

  // monedas
  const fwd = train.forward(tmpF);
  tmpV.copy(train.position).addScaledVector(fwd, 2.5);
  tmpV.y += 1.9;
  const got = world.collect(tmpV, 3.1);
  for (const c of got) {
    if (!G.attract) {
      G.coins += 1;
      G.score += (c.gem ? GEM_POINTS : COIN_POINTS) * G.mult;
      c.gem ? sfx.gem() : sfx.coin();
      ui.coins.parentElement.classList.remove('pulse');
      void ui.coins.offsetWidth;
      ui.coins.parentElement.classList.add('pulse');
      if (c.gem) toast('+' + GEM_POINTS * G.mult + ' ¡Gema!', 1.2, '#5ef2ff');
    }
    const col = c.gem ? C_GEM : C_GOLD;
    for (let i = 0; i < (c.gem ? 30 : 14); i++) {
      sparks.spawn(c.x, c.y, c.z, (Math.random() - 0.5) * 9, Math.random() * 7, (Math.random() - 0.5) * 9,
        0.5 + Math.random() * 0.4, 0.35, 0.05, col, 1);
    }
  }

  // taxis: si el tren va a ras de suelo, los arrolla (y frena un poco)
  tmpL.copy(train.position).addScaledVector(fwd, 5.5);
  const hits = traffic.update(dt, train.position, tmpL, fwd, train.position.y < 2.2, G.v);
  for (const car of hits) {
    for (let i = 0; i < 18; i++) {
      sparks.spawn(car.pos.x, car.pos.y + 1, car.pos.z, (Math.random() - 0.5) * 10, Math.random() * 8, (Math.random() - 0.5) * 10,
        0.4 + Math.random() * 0.4, 0.3, 0.05, C_TAXI, 1);
    }
    if (G.attract) continue;
    G.v *= 0.86;
    G.shake = Math.max(G.shake, 0.35);
    G.score += 100 * G.mult;
    G.taxis++;
    sfx.honk();
    if (Math.random() < 0.6) toast(TAXI_LINES[(Math.random() * TAXI_LINES.length) | 0] + ' +' + 100 * G.mult, 1.1, '#ffd400');
  }

  if (!G.attract) handleMission(dt, fwd);
  if (G.mode !== 'playing' && !G.attract) return;

  // aviso de rascacielos
  const danger = track.blockedAt !== null || towerAhead(track.steer, 42);
  if (danger && !G.danger && !G.attract) sfx.warn();
  if (danger && !G.attract && Math.random() < dt * 2) sfx.warn();
  G.danger = danger;
  builder.setDanger(danger);

  // humo de la chimenea
  const n = Math.random() < 0.6 ? 1 : 0;
  train.chimneyWorld(tmpL);
  for (let i = 0; i < n; i++) {
    smoke.spawn(
      tmpL.x, tmpL.y, tmpL.z,
      fwd.x * G.v * 0.7 + (Math.random() - 0.5) * 1.5, 8 + Math.random() * 3, fwd.z * G.v * 0.7 + (Math.random() - 0.5) * 1.5,
      1.6 + Math.random() * 0.7, 0.7, 4 + Math.random() * 1.5, C_SMOKE, 0.2
    );
  }
}

// ---------- Pasajeros ----------
function handleMission(dt, fwd) {
  const ev = missions.update(dt, G.time, train.position, fwd, G.v);
  if (!ev) return;
  if (ev.type === 'pickup') {
    sfx.pickup();
    toast('¡' + ev.count + ' pasajeros a bordo!', 1.8, '#3dffa8');
    for (const p of ev.people) {
      for (let i = 0; i < 10; i++) {
        sparks.spawn(p.x, p.y + 1, p.z, (Math.random() - 0.5) * 4, 2 + Math.random() * 5, (Math.random() - 0.5) * 4,
          0.6 + Math.random() * 0.4, 0.35, 0.05, C_PICKUP, 1);
      }
    }
  } else if (ev.type === 'deliver') {
    const pts = Math.round((500 + ev.count * 150 + ev.remaining * 50) * G.mult);
    G.score += pts;
    sfx.deliver();
    const fast = ev.remaining > ev.limit * 0.45;
    toast('+' + pts.toLocaleString('es-ES') + (fast ? ' · ¡Entrega rapidísima!' : ' · ¡Entregados!'), 2, '#ffb347');
    const sp = ev.spot;
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 5;
      sparks.spawn(sp.x + Math.cos(a) * r, sp.y + 1, sp.z + Math.sin(a) * r,
        (Math.random() - 0.5) * 8, 8 + Math.random() * 12, (Math.random() - 0.5) * 8,
        1.2 + Math.random() * 0.8, 0.45, 0.2, CONFETTI[i % CONFETTI.length], 1);
    }
  } else if (ev.type === 'fail') {
    sfx.fail();
    updateHearts(true);
    if (ev.hearts <= 0) {
      gameOver('time');
      return;
    }
    toast(ev.wasDeliver ? 'Se acabó el tiempo: los pasajeros se bajan' : 'Los pasajeros se cansaron de esperar', 2.2, '#ff6b6b');
  } else if (ev.type === 'tick') {
    sfx.tick(ev.sec);
  }
}

function updateHearts(hit = false) {
  const spans = ui.hearts.children;
  for (let i = 0; i < spans.length; i++) spans[i].classList.toggle('lost', i >= missions.hearts);
  if (hit) {
    ui.hearts.classList.remove('hit');
    void ui.hearts.offsetWidth;
    ui.hearts.classList.add('hit');
  }
}

function updateMissionHud() {
  const st = missions.state;
  ui.mission.dataset.state = st;
  if (!missions.active) return;
  const pickup = st === 'pickup';
  const spot = missions.target;
  ui.mText.textContent = pickup ? 'Recoge a los pasajeros' : 'Lleva a los pasajeros';
  const n = pickup ? missions.station.people.length : missions.carrying;
  ui.mCount.textContent = (pickup ? n + ' esperando' : n + ' a bordo') + (spot.roof ? ' · en un tejado' : '');
  ui.mDist.textContent = Math.round(missions.distanceTo(train.position)) + ' m';
  const t = Math.max(0, Math.ceil(missions.time));
  ui.mTime.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  const low = missions.time <= 5;
  ui.mTime.classList.toggle('low', low);
  ui.mission.classList.toggle('low', low);
  ui.mBar.style.width = clamp((missions.time / missions.limit) * 100, 0, 100) + '%';
}

function updateMissionArrow() {
  const t = missions.target;
  if (!t) return;
  tmpL.set(t.x, t.y + 2, t.z).applyMatrix4(camera.matrixWorldInverse);
  const ang = Math.atan2(tmpL.x, -tmpL.z);
  ui.mArrow.style.transform = 'rotate(' + ang.toFixed(3) + 'rad)';
}

function crash() {
  G.mode = 'crash';
  G.crashT = 0;
  G.shake = 1.3;
  G.slowmo = 0.22;
  builder.setDanger(true);
  ui.warn.hidden = true;
  ui.toast.classList.remove('show');
  toastTimer = 0;
  train.crash(G.v);
  if (!G.attract) sfx.crash();
  const p = train.position;
  flash.position.set(p.x, p.y + 3, p.z);
  flash.intensity = 380;
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 4 + Math.random() * 10;
    fire.spawn(p.x, p.y + 2, p.z, Math.cos(a) * sp, Math.random() * 8, Math.sin(a) * sp,
      0.6 + Math.random() * 0.6, 1.5 + Math.random() * 1.5, 5 + Math.random() * 3, Math.random() < 0.5 ? C_FIRE : C_FIRE2, 0.6);
  }
  for (let i = 0; i < 160; i++) {
    sparks.spawn(p.x, p.y + 2, p.z, (Math.random() - 0.5) * 30, Math.random() * 22, (Math.random() - 0.5) * 30,
      0.6 + Math.random() * 0.8, 0.3, 0.05, C_FIRE2, 1);
  }
  for (let i = 0; i < 50; i++) {
    smoke.spawn(p.x, p.y + 2, p.z, (Math.random() - 0.5) * 8, 2 + Math.random() * 6, (Math.random() - 0.5) * 8,
      2.5 + Math.random() * 2, 3, 12, C_DARK, 0.7);
  }
}

function stepCrash(dt) {
  G.crashT += dt;
  G.slowmo = Math.min(1, G.slowmo + dt * 0.55);
  const sdt = dt * G.slowmo;
  train.updateCrash(sdt, world);
  flash.intensity *= Math.exp(-dt * 3);
  if (Math.random() < 0.5) {
    const p = train.position;
    smoke.spawn(p.x, p.y + 1.5, p.z, (Math.random() - 0.5) * 2, 3 + Math.random() * 2, (Math.random() - 0.5) * 2,
      3, 2, 9, C_DARK, 0.55);
    if (G.crashT < 1.6) {
      fire.spawn(p.x, p.y + 1.2, p.z, (Math.random() - 0.5) * 2, 2 + Math.random() * 3, (Math.random() - 0.5) * 2,
        0.6, 1.5, 3, C_FIRE, 0.8);
    }
  }
  if (G.crashT > 2.6) {
    if (G.attract) resetRun(true), (G.mode = 'menu');
    else gameOver();
  }
}

function gameOver(reason = 'crash') {
  G.mode = 'over';
  ui.toast.classList.remove('show');
  toastTimer = 0;
  ui.oTitle.textContent = reason === 'time' ? '¡Sin tiempo!' : '¡Choque!';
  ui.oReason.textContent = reason === 'time'
    ? 'Se acabaron las vidas: los pasajeros se cansaron de esperar.'
    : 'El tren se estrelló contra un rascacielos.';
  ui.oDeliv.textContent = missions.deliveries;
  ui.oPass.textContent = missions.passengers;
  const score = Math.floor(G.score);
  const isBest = score > G.best;
  if (isBest) {
    G.best = score;
    storageSet('vialibre.best', String(score));
  }
  ui.best.textContent = G.best.toLocaleString('es-ES');
  ui.oScore.textContent = score.toLocaleString('es-ES');
  ui.oDist.textContent = Math.floor(G.dist).toLocaleString('es-ES') + ' m';
  ui.oCoins.textContent = G.coins;
  ui.oAlt.textContent = Math.floor(G.maxAlt) + ' m';
  ui.newBest.hidden = !isBest;
  ui.over.hidden = false;
  ui.hud.hidden = true;
  ui.warn.hidden = true;
  setTouchButtons(false);
  $('againBtn').focus();
}

// ---------- Cámara ----------
function updateCamera(dt, snap = false) {
  const P = train.position;
  const F = train.forward(tmpF);
  F.y = 0;
  if (F.lengthSq() < 1e-6) F.set(0, 0, 1);
  F.normalize();
  const desired = tmpV;
  const look = tmpL;
  if (G.mode === 'menu') {
    const a = G.time * 0.1 + 0.6;
    desired.set(P.x + Math.sin(a) * 19, P.y + 7.5, P.z + Math.cos(a) * 19);
    look.set(P.x, P.y + 2.5, P.z).addScaledVector(F, 6);
  } else if (G.mode === 'crash' || G.mode === 'over') {
    desired.copy(camPos);
    desired.y = Math.max(desired.y, P.y + 6);
    look.copy(P);
    look.y += 1;
  } else {
    desired.copy(P).addScaledVector(F, -16);
    desired.y = P.y + 11.5;
    const minY = world.heightAt(desired.x, desired.z, 2, false) + 2.8;
    if (desired.y < minY) desired.y = minY;
    look.copy(P).addScaledVector(F, 18);
    look.y += 0.2;
    const hd = track.head;
    look.x += (hd.x - look.x) * 0.2;
    look.z += (hd.z - look.z) * 0.2;
    look.y += (hd.y + 1 - look.y) * 0.15;
  }
  if (snap) {
    camPos.copy(desired);
    camLook.copy(look);
  } else {
    const lp = G.mode === 'crash' ? 2 : 5;
    camPos.x = damp(camPos.x, desired.x, lp, dt);
    camPos.y = damp(camPos.y, desired.y, lp * 0.8, dt);
    camPos.z = damp(camPos.z, desired.z, lp, dt);
    camLook.x = damp(camLook.x, look.x, 8, dt);
    camLook.y = damp(camLook.y, look.y, 8, dt);
    camLook.z = damp(camLook.z, look.z, 8, dt);
  }
  camera.position.copy(camPos);
  if (G.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * G.shake;
    camera.position.y += (Math.random() - 0.5) * G.shake;
    camera.position.z += (Math.random() - 0.5) * G.shake;
    G.shake = Math.max(0, G.shake - dt * 1.2);
  }
  camera.lookAt(camLook);
  // en pantallas verticales se abre el campo de visión para ver los lados
  const portrait = clamp((1.2 - camera.aspect) * 22, 0, 18);
  const fovT = (G.mode === 'playing' ? clamp(60 + (G.v - START_SPEED) * 0.5, 60, 80) : 58) + portrait;
  camera.fov = snap ? fovT : damp(camera.fov, fovT, 2, dt);
  camera.updateProjectionMatrix();

  sky.position.copy(camera.position);
  // la sombra sigue al tren
  sun.target.position.copy(P);
  sun.position.copy(P).addScaledVector(sunDir, 260);
}

// ---------- HUD ----------
let hudT = 0;
function updateHud(dt) {
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.08;
  ui.score.textContent = Math.floor(G.score).toLocaleString('es-ES');
  ui.dist.textContent = Math.floor(G.dist).toLocaleString('es-ES');
  ui.coins.textContent = G.coins;
  ui.speed.textContent = Math.round(G.v * 3.6);
  const alt = Math.max(0, track.get(Math.round((G.s - 4) / DS)).y - CLEAR);
  ui.alt.textContent = Math.round(alt);
  ui.altFill.style.height = Math.min(100, (alt / 36) * 100) + '%';
  ui.mult.textContent = 'x' + G.mult;
  ui.mult.dataset.level = G.mult;
  ui.warn.hidden = !(G.danger && G.mode === 'playing');
  updateMissionHud();
}

// ---------- Menús ----------
function setTouchButtons(on) {
  ui.tl.hidden = ui.tr.hidden = !(on && touch);
}

function startGame() {
  sfx.init();
  G.mode = 'playing';
  resetRun(false);
  ui.menu.hidden = true;
  ui.over.hidden = true;
  ui.pause.hidden = true;
  ui.hud.hidden = false;
  setTouchButtons(true);
  sfx.whistle();
  fpsSamples = [];
}

function pauseGame() {
  if (G.mode !== 'playing') return;
  G.mode = 'paused';
  ui.pause.hidden = false;
  ui.warn.hidden = true;
  setTouchButtons(false);
  $('resumeBtn').focus();
}

function resumeGame() {
  if (G.mode !== 'paused') return;
  G.mode = 'playing';
  ui.pause.hidden = true;
  setTouchButtons(true);
  canvas.focus?.();
}

function toMenu() {
  missions.reset();
  ui.pause.hidden = true;
  ui.over.hidden = true;
  ui.hud.hidden = true;
  ui.warn.hidden = true;
  setTouchButtons(false);
  resetRun(true);
  G.mode = 'menu';
  ui.menu.hidden = false;
  $('playBtn').focus();
}

$('playBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', startGame);
$('menuBtn').addEventListener('click', toMenu);
$('resumeBtn').addEventListener('click', resumeGame);
$('quitBtn').addEventListener('click', toMenu);
$('pauseBtn').addEventListener('click', pauseGame);
ui.qualityBtn.addEventListener('click', () => {
  quality = quality === 'high' ? 'low' : 'high';
  storageSet('vialibre.quality', quality);
  applyQuality();
});
function toggleMute() {
  muted = !muted;
  sfx.setMuted(muted);
  storageSet('vialibre.muted', muted ? '1' : '0');
  ui.muteBtn.textContent = 'Sonido: ' + (muted ? 'No' : 'Sí');
  if (G.mode === 'playing') toast(muted ? 'Sonido desactivado' : 'Sonido activado', 1);
}
ui.muteBtn.addEventListener('click', toggleMute);

input.on('key', (code) => {
  if (code === 'Enter' || code === 'Space') {
    if (G.mode === 'menu' || G.mode === 'over') {
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') return; // el botón ya lo gestiona
      startGame();
    } else if (G.mode === 'paused') resumeGame();
  } else if (code === 'Escape' || code === 'KeyP') {
    if (G.mode === 'playing') pauseGame();
    else if (G.mode === 'paused') resumeGame();
  } else if (code === 'KeyM') toggleMute();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
});

// ---------- Bucle ----------
const FAR = new THREE.Vector3(1e6, 0, 1e6);

/** El cielo cambia de skyline a cordilleras según el bioma en el que está el tren. */
function updateSkyBiome(dt) {
  const p = train.position;
  const city = world.isCity(p.x, p.z) ? 1 : 0;
  world.biomes.ground(p.x, p.z);
  const u = skyMat.uniforms;
  u.uCityAmt.value = damp(u.uCityAmt.value, city, 0.6, dt);
  u.uMtnAmt.value = damp(u.uMtnAmt.value, world.biomes.m, 0.6, dt);
  // fuera de la ciudad el aire está más limpio: se ven las montañas a lo lejos
  scene.fog.density = damp(scene.fog.density, city ? 0.0036 : 0.0023, 0.5, dt);
}

/** Vapor de las alcantarillas cercanas a la cámara. */
function emitSteam(dt) {
  const cx = camera.position.x, cz = camera.position.z;
  for (const lc of world.loaded.values()) {
    for (const v of lc.vents) {
      const dx = v.x - cx, dz = v.z - cz;
      if (dx * dx + dz * dz > 170 * 170 || Math.random() > dt * 7) continue;
      smoke.spawn(v.x + (Math.random() - 0.5) * 0.4, v.y, v.z + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.8, 2.4 + Math.random() * 1.5, (Math.random() - 0.5) * 0.8,
        2.6 + Math.random(), 1.0, 5.5 + Math.random() * 2, C_STEAM, 0.32);
    }
  }
}

let last = performance.now();
let fpsSamples = [];

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  if (G.mode !== 'paused') G.time += dt;

  if (G.mode === 'playing' || G.mode === 'menu') stepRun(dt);
  else if (G.mode === 'crash') stepCrash(dt);

  if (G.mode !== 'paused') {
    const pdt = G.mode === 'crash' ? dt * G.slowmo : dt;
    smoke.update(pdt);
    sparks.update(pdt);
    fire.update(pdt);
    world.tick(G.time);
    world.update(train.position);
    if (G.mode === 'crash' || G.mode === 'over') traffic.update(dt, train.position, FAR, tmpF.set(0, 0, 1), false, 0);
    emitSteam(dt);
    updateSkyBiome(dt);
    const building = G.mode === 'playing' || G.mode === 'menu';
    builder.update(G.time, track.head, track, world, building ? sparks : null, building && track.blockedAt === null);
    updateCamera(dt);
  }
  sfx.update(dt, G.v, G.mode === 'playing');

  if (G.mode === 'playing') {
    G.playT += dt;
    updateHud(dt);
    updateMissionArrow();
    if (hintStep < HINTS.length) {
      hintT -= dt;
      if (hintT <= 0) {
        toast(HINTS[hintStep++], 2.6);
        hintT = 3.4;
      }
    }
    // si va muy lento en los primeros segundos, bajar la calidad automáticamente
    if (quality === 'high' && G.playT > 2 && G.playT < 9) {
      fpsSamples.push(dt);
      if (fpsSamples.length > 120) {
        const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
        if (avg > 1 / 32) {
          quality = 'low';
          applyQuality();
          toast('Calidad reducida para ir más fluido', 2);
        }
        fpsSamples = [];
      }
    }
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) ui.toast.classList.remove('show');
  }

  const scale = renderer.getDrawingBufferSize(tmpV).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  smoke.setScale(scale);
  sparks.setScale(scale);
  fire.setScale(scale);
  builder.prevUniforms.uScale.value = scale;

  if (QUALITY[quality].bloom && composer) composer.render();
  else renderer.render(scene, camera);
}

// ---------- Inicio ----------
applyQuality();
resetRun(true);
G.mode = 'menu';
ui.loading.hidden = true;
$('playBtn').focus();
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});

// acceso para pruebas automáticas: simula n pasos sin renderizar
function simulate(n, dt, steerFn) {
  for (let i = 0; i < n && (G.mode === 'playing' || G.mode === 'crash'); i++) {
    if (steerFn) input.forced = steerFn(G);
    if (G.mode === 'playing') stepRun(dt);
    else stepCrash(dt);
    world.update(train.position);
  }
  input.forced = undefined;
  updateCamera(1, true);
  return { mode: G.mode, dist: G.dist, y: train.position.y, v: G.v, coins: G.coins, score: G.score };
}
window.__game = { G, track, world, train, renderer, camera, missions, traffic, startGame, toMenu, simulate };
