# Open Media Grabber

Extensión Manifest V3 para Chrome/Edge que detecta URLs de medios en la pestaña actual y permite descargar:

- MP4 / WebM / MOV y audio directo.
- HLS `.m3u8` sin cifrado, seleccionando automáticamente la variante de mayor `BANDWIDTH` y uniendo los segmentos localmente.

## Instalación

### Chrome
1. Abre `chrome://extensions`.
2. Activa **Modo desarrollador**.
3. Pulsa **Cargar descomprimida**.
4. Selecciona esta carpeta.

### Edge
1. Abre `edge://extensions`.
2. Activa **Modo para desarrolladores**.
3. Pulsa **Cargar desempaquetado**.
4. Selecciona esta carpeta.

## Uso
1. Abre una web con un video.
2. Reproduce el video durante unos segundos.
3. Abre el icono de la extensión.
4. Selecciona el recurso y pulsa **Descargar**.

## Limitaciones de esta primera versión
- No intenta descifrar DRM ni HLS cifrado.
- HLS se combina en memoria; videos extremadamente grandes pueden consumir mucha RAM.
- Algunos sitios generan URLs temporales, blobs/MSE o requieren cabeceras especiales. Esos casos requieren una segunda capa de captura.
- Un stream HLS MPEG-TS se guarda como `.ts`; uno fMP4 con `EXT-X-MAP` se guarda como `.mp4`.

## Licencia sugerida
MIT. Puedes usar, modificar y distribuir el código sin límites artificiales.
