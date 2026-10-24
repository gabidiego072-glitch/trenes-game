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

- **Pasa por encima:** la vía mira unos 60 m por delante y empieza a subir con tiempo para pasar por encima de cualquier edificio normal.
- **Altura = puntos:** sobre los tejados ganas puntos x2; por encima de 18 m, x3.
- **Monedas y gemas:** están en las calles, en los parques, sobre los lagos y en los tejados. Las gemas azules valen 10 veces más.
- **Rascacielos con luces rojas:** son demasiado altos para subirlos. Si la vía entra en uno, se corta y el tren choca. La vista previa punteada se vuelve roja cuando vas hacia uno.
- La velocidad sube con la distancia. Las subidas frenan el tren y las bajadas lo aceleran.

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
- `src/world.js`: ciudad procedural e infinita por manzanas (edificios con retranqueos, depósitos de agua, parques, lagos, rascacielos y monedas). Usa mallas instanciadas para dibujar miles de objetos con pocas llamadas.
- `src/materials.js`: ventanas, calles, pasos de cebra y cielo generados por shader, sin texturas.
- `src/train.js`: locomotora de vapor, ténder y vagones con ruedas y bielas animadas, inclinación en las curvas y física del choque.
- `src/effects.js`: humo, chispas, fuego y el dron constructor con la vista previa de la vía.
- `src/audio.js`: todos los sonidos sintetizados con Web Audio (sin archivos de audio).
- `src/main.js`: bucle de juego, cámara, puntuación, menús y modo demostración (en el menú juega una IA).

La calidad (sombras, resolución y resplandor) se elige en el menú y baja sola si el juego va lento.
