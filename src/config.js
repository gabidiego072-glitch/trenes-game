// Ajustes globales del juego. Todas las medidas en metros / segundos.

// Ciudad
export const CELL = 50;          // tamaño de cada manzana (de centro de calle a centro de calle)
export const ROAD = 12;          // ancho de la calzada
export const SIDEWALK = 2.5;     // ancho de la acera
export const LOT_INSET = ROAD / 2 + SIDEWALK; // del borde de la celda al solar edificable
export const VIEW_CELLS = 7;     // radio de celdas cargadas alrededor del tren

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
