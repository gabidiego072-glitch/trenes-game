// Ajustes globales del juego. Todas las medidas en metros / segundos.

// Ciudad: cuadrícula de Manhattan. Las avenidas van de norte a sur (eje z) y las calles de este a oeste.
export const CELL_X = 72;        // distancia entre avenidas
export const CELL_Z = 44;        // distancia entre calles
export const AVENUE = 16;        // ancho de avenida (en x = i * CELL_X)
export const STREET = 11;        // ancho de calle (en z = j * CELL_Z)
export const SIDEWALK = 3;       // ancho de la acera
export const VIEW_DIST = 400;    // distancia hasta la que se carga la ciudad

// Vías
export const DS = 0.5;           // separación entre puntos de la vía
export const CLEAR = 0.35;       // altura del carril sobre la superficie
export const KMAX = 1 / 13;      // curvatura máxima (radio mínimo 13 m)
export const KRATE = 0.03;       // cuánto puede cambiar la curvatura por metro
export const LOOK = 60;          // metros que la vía "mira" hacia delante para empezar a subir
export const S_LOOK = 0.42;      // pendiente de subida planificada
export const S_UP = 0.95;        // pendiente máxima de emergencia
export const S_DOWN = 0.45;      // pendiente máxima de bajada
export const SMOOTH_W = 6;       // ventana de suavizado (en puntos)

// Tren
export const START_SPEED = 16;
export const MAX_SPEED = 46;
export const MIN_SPEED = 9;

// Puntuación
export const COIN_POINTS = 50;
export const GEM_POINTS = 500;
