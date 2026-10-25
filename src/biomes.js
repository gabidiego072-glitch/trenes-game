import { hash2, lerp, smoothstep } from './utils.js';

export const WATER = 1.6;      // nivel de los lagos en el campo
export const MOUNTAIN_H = 118; // altura máxima de las montañas

/**
 * Campos de ruido que deciden el bioma y la altura del terreno en cada punto.
 * - city: > 0.58 ciudad, el suelo es plano.
 * - mountain: 0..1, cuánto de montaña hay.
 */
export class Biomes {
  constructor(seed) {
    this.seed = seed;
    this.c = 0;  // resultados de la última muestra (sin crear objetos)
    this.m = 0;
    this.f = 0;
    this.water = false;
  }

  noise(x, z, salt) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const s = this.seed ^ salt;
    const h00 = hash2(xi, zi, s) / 4294967296, h10 = hash2(xi + 1, zi, s) / 4294967296;
    const h01 = hash2(xi, zi + 1, s) / 4294967296, h11 = hash2(xi + 1, zi + 1, s) / 4294967296;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    return lerp(lerp(h00, h10, u), lerp(h01, h11, u), v);
  }

  fbm(x, z, salt, oct) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.noise(x * f, z * f, salt + i * 17);
      n += a;
      a *= 0.5;
      f *= 2.03;
    }
    return s / n;
  }

  city(x, z) {
    const d = Math.hypot(x, z);
    return this.noise(x / 1500 + 7.3, z / 1500 - 3.1, 303) * 0.9 + 0.5 * Math.exp(-d / 900) + 0.02;
  }

  mountain(x, z) {
    return smoothstep(0.44, 0.6, this.noise(x / 1200 + 31.7, z / 1200 - 12.3, 404));
  }

  /** Altura del suelo en (x, z). Deja en this.c / this.m / this.f / this.water los datos del bioma. */
  ground(x, z) {
    const c = this.city(x, z);
    this.c = c;
    const f = smoothstep(0.5, 0.32, c);
    this.f = f;
    this.water = false;
    if (f <= 0) {
      this.m = 0;
      return 0;
    }
    const m = this.mountain(x, z);
    this.m = m;
    let h = -1.4 + 8.5 * this.fbm(x / 240, z / 240, 505, 3);
    if (m > 0) {
      const n = this.fbm(x / 650, z / 650, 606, 4);
      h += m * MOUNTAIN_H * Math.pow(Math.max(0, (n - 0.18) / 0.62), 1.3);
    }
    h *= f;
    if (f > 0.9 && h < WATER) {
      this.water = true;
      return WATER;
    }
    return h;
  }
}
