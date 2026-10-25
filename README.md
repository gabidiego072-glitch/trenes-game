# Vía Libre 🚂

**Tú no conduces el tren. Tú construyes las vías.**

Juego 3D para el navegador en tercera persona. El tren avanza solo y tú decides, en tiempo real, por dónde van las vías que se van construyendo delante de él. Si llevas la vía contra un edificio, sube sola por encima y el tren cruza la ciudad por los tejados.

## Cómo se juega

| Acción | Teclado | Móvil |
| --- | --- | --- |
| Llevar la vía a la izquierda / derecha | `←` `→` o `A` `D` | Botones o tocar los lados de la pantalla |
| Pausa | `P` o `Esc` | Botón de pausa |
| Silenciar | `M` | Menú |
| Empezar / reintentar | `Enter` o `Espacio` | Botón *Jugar* |

- **Lleva pasajeros:** la flecha de arriba señala la estación. Pasa por el haz verde para recoger a la gente y llévala al haz ámbar antes de que acabe la cuenta atrás. Cuanto antes llegues, más puntos. Algunas estaciones están en los tejados. Si se acaba el tiempo pierdes una vida; con 3 vidas perdidas, se acaba la partida. Cada entrega da algo menos de tiempo para la siguiente.
- **Pasa por encima:** la vía mira unos 60 m por delante y empieza a subir con tiempo para pasar por encima de cualquier edificio normal.
- **Altura = puntos:** sobre los tejados ganas puntos x2; por encima de 18 m, x3.
- **Monedas y gemas:** están en las calles, en los parques, sobre los lagos y en los tejados. Las gemas azules valen 10 veces más.
- **Rascacielos con luces rojas:** son demasiado altos para subirlos. Si la vía entra en uno, se corta y el tren choca. La vista previa punteada se vuelve roja cuando vas hacia uno.
- La velocidad sube con la distancia. Las subidas frenan el tren y las bajadas lo aceleran.

## Modo bar

Desde el menú, **Modo bar** (o la tecla `B`): trabajas de camarero en primera persona dentro del vagón restaurante mientras el tren recorre la ciudad, el campo y las montañas por su cuenta.

- Los clientes entran, se sientan y piden. El pedido sale en su bocadillo y en las **comandas** de la derecha (con el número de asiento).
- **Hamburguesa:** carne a la plancha hasta que el indicador se ponga verde, pan de la cesta a la tabla, la carne encima y los ingredientes que pida (queso, lechuga, tomate, cebolla). Pulsa la tabla con las manos libres para cogerla.
- **Perrito:** pan de perrito, salchicha hecha y las salsas pedidas (kétchup, mostaza).
- **Refresco:** vaso, hielo si lo pide (antes del refresco) y el grifo del sabor.
- **Patatas:** freidora hasta la luz verde y sal si la piden.
- Pulsa sobre el cliente o su sitio de la barra para servir. Si te equivocas te lo dice ("¡Le falta queso!", "¡Lo pedí sin hielo!") y pierde paciencia. Crudo o quemado, también.
- **Soltar** (botón, tecla `Q` o clic derecho): tira lo que llevas en la mano o, con las manos libres, vacía la tabla.
- Al terminar de comer, el cliente deja el plato sucio y el dinero. Pulsa su sitio para cobrar y recoger: hasta que no lo limpies, no se sienta nadie más ahí.
- Cuanto antes completes el pedido, más propina. El turno dura 4 minutos; con 3 clientes enfadados se cierra el bar.
- Ratón: mira moviendo el cursor o arrastrando; también con `←` `→`. Móvil: arrastra para mirar y toca para usar.

## El mundo

- **Ciudad estilo Nueva York:** cuadrícula de Manhattan con avenidas de sentido único, Midtown con rascacielos gigantes y carteles de neón, edificios de ladrillo con escaleras de incendios y depósitos de agua, casas de piedra rojiza, parques, taxis amarillos y vapor saliendo de la calzada.
- **Llanuras:** campos de cultivo, granjas con granero y silo, balas de heno, lagos y aerogeneradores (con baliza roja: no se pueden saltar).
- **Montañas:** relieve de hasta unos 130 m con pinares, rocas, cabañas, nieve en las cumbres y antenas en algunas cimas. La vía sube por las laderas y cruza los valles con viaductos.

## Ejecutarlo

No necesita compilación ni dependencias: Three.js se carga desde un CDN.

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

(Hace falta un servidor local porque los módulos ES no funcionan abriendo el archivo con `file://`.)

### Publicarlo en GitHub Pages

En el repositorio: **Settings → Pages → Build and deployment → Deploy from a branch**, elige la rama `main` y la carpeta `/ (root)`. En un par de minutos estará en `https://<usuario>.github.io/trenes-game/`.

## Cómo está hecho

- `src/track.js`: el corazón del juego. Construye la vía punto a punto (cada 0,5 m) a partir de tu dirección. La altura se calcula sola: mira hacia delante, sube con antelación, tiene un margen de emergencia y un suavizado que nunca baja de la altura mínima (así la vía no atraviesa edificios).
- `src/biomes.js` y `src/terrain.js`: biomas, relieve y la malla del suelo que sigue al tren.
- `src/traffic.js`: taxis y coches.
- `src/world.js`: mundo procedural e infinito por manzanas (edificios con retranqueos, depósitos de agua, parques, lagos, rascacielos y monedas). Usa mallas instanciadas para dibujar miles de objetos con pocas llamadas.
- `src/materials.js`: ventanas, calles, pasos de cebra y cielo generados por shader, sin texturas.
- `src/train.js`: locomotora de vapor, ténder y vagones con ruedas y bielas animadas, inclinación en las curvas y física del choque.
- `src/effects.js`: humo, chispas, fuego y el dron constructor con la vista previa de la vía.
- `src/audio.js`: todos los sonidos sintetizados con Web Audio (sin archivos de audio).
- `src/missions.js`: estaciones, pasajeros, cuenta atrás y vidas.
- `src/bar/`: modo bar (vagón restaurante, clientes con cara y gestos, comida y bebida).
- `src/main.js`: bucle de juego, cámara, puntuación, menús y modo demostración (en el menú juega una IA).

La calidad (sombras, resolución y resplandor) se elige en el menú y baja sola si el juego va lento.
