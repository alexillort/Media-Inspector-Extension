# Media Inspector 1.1

Extensión Manifest V3 para Chrome y Microsoft Edge que inspecciona la pestaña actual y organiza recursos descargables por categoría:

- Videos directos: MP4, WebM, MOV, M4V y MKV.
- Flujos detectables: HLS (`.m3u8`) y DASH (`.mpd`), con lectura de variantes cuando el manifiesto lo permite.
- Imágenes: JPEG, PNG, WebP, AVIF, BMP e ICO, incluidos `srcset` y fondos CSS.
- GIF y SVG, incluidos SVG inline.
- Fuentes: WOFF2, WOFF, TTF, OTF y EOT.

La interfaz muestra miniaturas, dimensiones, resolución, bitrate o codec cuando la página expone esos datos. La opción **Solo mejor calidad** agrupa URLs similares y conserva la variante con mayor puntuación de resolución/bitrate.

## Novedades de la versión 1.1

- Preview real del primer fotograma para videos directos compatibles con el navegador.
- **Capturar todas** busca imágenes normales, `srcset`, carga diferida (`data-src`), originales enlazados, fondos CSS, Shadow DOM y recursos ya cargados.
- Filtros para ver todas las imágenes, únicamente las visibles, las grandes o las variantes originales/de alta resolución.
- Botón **↗** para abrir cualquier recurso compatible en otra pestaña.
- Botones flotantes de descarga sobre imágenes, videos y SVG dentro de la propia página. Se pueden activar o desactivar desde el popup.

## Instalación en Chrome

1. Descomprime `media-inspector-extension.zip`.
2. Abre `chrome://extensions`.
3. Activa **Modo de desarrollador**.
4. Pulsa **Cargar descomprimida**.
5. Selecciona la carpeta `media-inspector` que contiene `manifest.json`.
6. Fija **Media Inspector** en la barra del navegador.

## Instalación en Edge

1. Descomprime `media-inspector-extension.zip`.
2. Abre `edge://extensions`.
3. Activa **Modo para desarrolladores**.
4. Pulsa **Cargar desempaquetado**.
5. Selecciona la carpeta `media-inspector`.

Después de instalarla, abre o recarga la página que quieras analizar y pulsa el icono de la extensión.

Al actualizar desde una versión anterior, reemplaza la carpeta, pulsa **Recargar** en la tarjeta de la extensión y vuelve a cargar las páginas que ya estaban abiertas.

## Alcance y límites

- Descarga directamente archivos que la página expone mediante una URL accesible.
- En HLS/DASH, **Calidades** analiza variantes, pero esta versión no combina segmentos ni une pistas separadas de audio y video. El botón de descarga guarda el recurso que la página expone; un manifiesto puede descargarse como `.m3u8` o `.mpd`.
- No evade DRM, cifrado, autenticación ni controles de acceso.
- Las URLs `blob:` se detectan, pero no se descargan porque no son reutilizables fuera del contexto que las creó.
- Algunos servidores bloquean previews o descargas cuando la URL necesita una sesión, un encabezado temporal o una firma vencida.
- Por política y condiciones de servicio, la descarga está deshabilitada en YouTube. Para videos propios, utiliza YouTube Studio o las opciones oficiales.
- Descargar un recurso técnicamente accesible no modifica sus derechos de autor ni su licencia. Usa la extensión solo con contenido propio, autorizado o permitido por la ley aplicable.

## Privacidad

El análisis ocurre localmente en el navegador. La extensión no incluye analítica, anuncios ni servidores externos. El permiso para leer páginas y observar solicitudes se usa exclusivamente para identificar recursos de la pestaña actual.
