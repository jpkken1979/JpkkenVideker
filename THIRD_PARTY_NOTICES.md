# Avisos de terceros

JpkkenVideker distribuye herramientas de línea de comandos como procesos separados:

- **yt-dlp** — The Unlicense y licencias de sus dependencias empaquetadas.
  Código fuente y avisos: <https://github.com/yt-dlp/yt-dlp>
- **FFmpeg / FFprobe (yt-dlp FFmpeg Builds, variante GPL)** — GNU General
  Public License y licencias de las bibliotecas incluidas. Código fuente,
  configuración de compilación y avisos: <https://github.com/yt-dlp/FFmpeg-Builds>
  y <https://ffmpeg.org/>
- **Deno** — MIT. Runtime JavaScript usado por yt-dlp para extractores que lo
  requieren. Código fuente y avisos: <https://github.com/denoland/deno>

Estos componentes no están modificados por JpkkenVideker. Sus versiones se obtienen de
las publicaciones oficiales durante la preparación del instalador. El script
`scripts/fetch-sidecars.ps1` conserva esa procedencia y verifica hashes cuando
el proveedor los publica.
