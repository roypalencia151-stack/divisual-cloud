import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";

import { capResolution, probeVideo, runFfmpeg, runFfmpegWithProgress } from "@/lib/ffmpeg";
import { callScribe } from "@/lib/scribe";
import { computeCutSegments, remapWords, totalCutDuration } from "@/lib/cut";
import { buildAss } from "@/lib/captions";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SECONDS = 60;

type Sender = (evt: Record<string, unknown>) => void;

export async function POST(request: Request) {
  const { url, filename } = (await request.json()) as { url?: string; filename?: string };
  if (!url) {
    return new Response(JSON.stringify({ phase: "error", msg: "Falta la URL del vídeo subido" }) + "\n", { status: 400 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send: Sender = (evt) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(evt) + "\n"));
        } catch {
          /* cliente ya se desconectó */
        }
      };
      const log = (kind: string, msg: string) => send({ phase: "log", kind, msg });

      const jobId = randomUUID();
      const dir = join(tmpdir(), `divisual_${jobId}`);

      try {
        await mkdir(dir, { recursive: true });

        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          throw new Error("ELEVENLABS_API_KEY no está configurada en las variables de entorno de Vercel");
        }

        // ── Fase 1: descargar + analizar ──────────────────────────────────
        send({ phase: "prepare", label: "Descargando y analizando el vídeo" });
        log("info", `Descargando vídeo desde Blob…`);
        const videoResp = await fetch(url);
        if (!videoResp.ok) throw new Error(`No se pudo descargar el vídeo subido (${videoResp.status})`);
        const inputPath = join(dir, "input.mp4");
        await writeFile(inputPath, Buffer.from(await videoResp.arrayBuffer()));

        const meta = await probeVideo(inputPath);
        log("info", `Resolución ${meta.w}×${meta.h} · duración ${meta.duration.toFixed(1)}s`);
        if (meta.duration > MAX_SECONDS) {
          throw new Error(`El vídeo dura ${meta.duration.toFixed(0)}s — el límite de la versión cloud es ${MAX_SECONDS}s. Usa el dashboard local para vídeos más largos.`);
        }
        if (!meta.hasAudio) {
          throw new Error("El vídeo no tiene pista de audio — no se puede transcribir ni recortar.");
        }
        const { w: outW, h: outH } = capResolution(meta.w, meta.h, 1280);

        // ── Fase 2: transcripción ──────────────────────────────────────────
        send({ phase: "transcribe", label: "Extrayendo audio y transcribiendo" });
        const audioPath = join(dir, "audio.wav");
        await runFfmpeg(["-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", audioPath]);
        log("info", "Subiendo audio a ElevenLabs Scribe…");
        const audioBuf = await readFile(audioPath);
        const words = await callScribe(audioBuf, apiKey);
        const wordCount = words.filter((w) => w.type === "word").length;
        log("done", `✔ Transcripción recibida (${wordCount} palabras)`);

        // ── Fase 3: detección de cortes ─────────────────────────────────────
        send({ phase: "cut", label: "Detectando fillers y silencios" });
        const segments = computeCutSegments(words, meta.duration);
        const cutDuration = totalCutDuration(segments);
        log("info", `${segments.length} segmentos · ${meta.duration.toFixed(1)}s → ${cutDuration.toFixed(1)}s`);
        const remapped = remapWords(words, segments);

        // ── Fase 4: subtítulos ───────────────────────────────────────────────
        send({ phase: "caption", label: "Generando subtítulos quemados" });
        const assPath = join(dir, "captions.ass");
        await writeFile(assPath, buildAss(remapped, cutDuration, outW, outH));
        log("info", `Subtítulos: ${remapped.length} palabras posicionadas`);

        // ── Fase 5: render final (recorte + color grade + subtítulos, un solo pase) ──
        send({ phase: "encode", label: "Renderizando vídeo final" });
        const outputPath = join(dir, "output.mp4");
        const filterParts: string[] = [];
        segments.forEach((s, i) => {
          filterParts.push(`[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`);
          filterParts.push(`[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS[a${i}]`);
        });
        const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join("");
        filterParts.push(`${concatInputs}concat=n=${segments.length}:v=1:a=1[vcat][acat]`);
        filterParts.push(
          `[vcat]scale=${outW}:${outH},eq=contrast=1.15:brightness=0.02:saturation=1.21,unsharp=5:5:0.48:3:3:0,subtitles=${assPath}[vout]`
        );
        const filterComplex = filterParts.join(";");

        await runFfmpegWithProgress(
          [
            "-i", inputPath,
            "-filter_complex", filterComplex,
            "-map", "[vout]", "-map", "[acat]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            outputPath,
          ],
          cutDuration,
          (pct) => send({ phase: "encode", label: "Renderizando vídeo final", percent: pct })
        );
        log("done", "✔ Render completo");

        // ── Fase 6: entrega ───────────────────────────────────────────────────
        send({ phase: "deliver", label: "Subiendo resultado" });
        const finalBuf = await readFile(outputPath);
        const stem = (filename || "video").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
        const blob = await put(`results/${stem}_${jobId.slice(0, 8)}_final.mp4`, finalBuf, {
          access: "public",
          contentType: "video/mp4",
        });
        log("done", `✔ Listo: ${blob.url}`);

        send({ phase: "done", url: blob.url });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ phase: "error", msg });
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
