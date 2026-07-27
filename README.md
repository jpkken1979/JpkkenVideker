# JpkkenVideker

JpkkenVideker es una aplicación de escritorio para guardar vídeo o audio desde URLs
compatibles con [yt-dlp](https://github.com/yt-dlp/yt-dlp). Está construida con
Tauri 2, Rust, React y TypeScript. La interfaz y el procesamiento se ejecutan
localmente: no hay cuentas, servidor intermedio ni telemetría.

## Funciones

- Análisis previo con título, autor, duración, miniatura y calidades.
- Vídeo MP4/MKV/WebM o audio MP3/M4A/Opus.
- Subtítulos, metadatos, capítulos y carátula opcionales.
- Cola con progreso, velocidad, ETA, cancelación, errores e historial local.
- Playlists opcionales y acceso mediante la sesión local del navegador.
- Reanudación de archivos parciales y archivo local para evitar duplicados.
- Diagnóstico en español y reparación adaptativa para fallos de red o compatibilidad.
- Runtime Deno para los reproductores JavaScript modernos compatibles con yt-dlp.
- Actualización semanal opcional de yt-dlp con SHA-256, validación y restauración.
- Tema oscuro/claro, carpeta de destino configurable y diseño adaptable.
- `yt-dlp`, FFmpeg, FFprobe y Deno empaquetados en el instalador.

## Desarrollo en Windows

Requisitos: Node.js 22+, Rust estable, Microsoft C++ Build Tools y WebView2.

```powershell
npm install
npm run sidecars
npm run tauri dev
```

La interfaz también se puede revisar en un navegador con datos de demostración:

```powershell
npm run dev
```

## Comprobación y compilación

```powershell
npm run check
npm run tauri build
```

El instalador NSIS se genera dentro de
`src-tauri/target/release/bundle/nsis/`.

## Uso responsable

JpkkenVideker no evita DRM, CAPTCHA, pagos ni protecciones de acceso. Descarga únicamente contenido
propio, de dominio público o que tengas autorización expresa para guardar.
El usuario es responsable de respetar los derechos de autor, las condiciones
del sitio y la legislación aplicable.

## Licencias

El código de JpkkenVideker se distribuye bajo MIT. Los ejecutables auxiliares conservan
sus propias licencias; consulta [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
