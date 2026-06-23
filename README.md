# Divisual Cloud

Versión simplificada del pipeline de edición, pensada para correr 100% en
Vercel (sin ffmpeg local, sin Claude Code, sin acceso a tu Escritorio).

Pipeline real (no es una demo): transcribe con ElevenLabs Scribe, detecta
fillers y silencios, corta, quema subtítulos (ASS) con el acento de marca
`#FAC51C`, aplica el color grade de `styles/client-style.md`, y entrega un
MP4 descargable — todo en un único pase de ffmpeg con progreso en vivo.

**Límites de esta versión** (por las restricciones reales de un entorno
serverless): vídeos de hasta 30MB y 60 segundos, sin motion graphics con IA
(eso vive en el dashboard local de `dashboard/`), sin entrega a una carpeta
local (se descarga desde el navegador).

## Desplegar en Vercel — pasos que solo tú puedes hacer

1. Entra a **vercel.com**, inicia sesión con tu cuenta de GitHub.
2. **Add New → Project** → importa el repo `roypalencia151-stack/divisual-cloud`.
3. Antes de darle "Deploy", entra a **Storage → Create Database → Blob** y
   crea un store. Al conectarlo al proyecto, Vercel añade sola la variable
   `BLOB_READ_WRITE_TOKEN` — no hay que copiar nada a mano.
4. En **Settings → Environment Variables**, añade:
   - `ELEVENLABS_API_KEY` = la misma key que ya usas en el proyecto local
     (la tienes en el `.env` de la raíz del kit).
5. Dale **Deploy**.

Cada `git push` a `main` vuelve a desplegar solo.

## Desarrollo local (opcional)

```bash
cp .env.example .env.local   # rellena ELEVENLABS_API_KEY
bun install
bun run dev
# http://localhost:3000
```

(`BLOB_READ_WRITE_TOKEN` local: créate un store en el dashboard de Vercel y
copia el token ahí si quieres probar la subida en local también.)

## Por qué es distinto del dashboard local

| | Local (`dashboard/`) | Cloud (este proyecto) |
|---|---|---|
| Motor | Claude Code (agente completo) | ffmpeg + Scribe API directos |
| Motion graphics | HTML/CSS + Puppeteer, adaptados por IA | Subtítulos ASS quemados, plantilla fija |
| Duración soportada | Sin límite práctico | Hasta 60s |
| Entrega | Copia a `Desktop/videoss/` | Descarga desde el navegador |
| Dónde corre | Tu PC | Función serverless de Vercel |
