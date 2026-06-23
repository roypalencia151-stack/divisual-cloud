import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { spawn } from "node:child_process";

export const FFMPEG = ffmpegInstaller.path;
export const FFPROBE = ffprobeInstaller.path;

export type VideoMeta = { w: number; h: number; duration: number; hasAudio: boolean };

export function runFfprobeRaw(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE, args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(err.slice(-400) || `ffprobe exit ${code}`))));
  });
}

export async function probeVideo(path: string): Promise<VideoMeta> {
  const json = await runFfprobeRaw(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]);
  const data = JSON.parse(json);
  const vStream = data.streams?.find((s: any) => s.codec_type === "video");
  const aStream = data.streams?.find((s: any) => s.codec_type === "audio");
  if (!vStream) throw new Error("El archivo no tiene una pista de vídeo válida");
  const w = parseInt(vStream.width, 10);
  const h = parseInt(vStream.height, 10);
  const duration = parseFloat(data.format?.duration || vStream.duration || "0");
  return { w, h, duration, hasAudio: !!aStream };
}

export function capResolution(w: number, h: number, max = 1280): { w: number; h: number } {
  if (w <= max && h <= max) return { w: evenify(w), h: evenify(h) };
  const scale = max / Math.max(w, h);
  return { w: evenify(Math.round(w * scale)), h: evenify(Math.round(h * scale)) };
}

function evenify(n: number): number {
  return n % 2 === 0 ? n : n - 1;
}

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-y", ...args]);
    let stderrTail = "";
    proc.stderr.on("data", (d) => {
      stderrTail += d.toString();
      if (stderrTail.length > 6000) stderrTail = stderrTail.slice(-6000);
    });
    proc.on("error", reject);
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(stderrTail.slice(-600) || `ffmpeg exit ${code}`))));
  });
}

export function runFfmpegWithProgress(
  args: string[],
  totalDurationSec: number,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-y", "-progress", "pipe:1", "-nostats", ...args]);
    let buf = "";
    let stderrTail = "";
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const m = line.match(/^out_time_(?:ms|us)=(\d+)/);
        if (m && totalDurationSec > 0) {
          const sec = parseInt(m[1], 10) / 1_000_000;
          onProgress(Math.min(99, (sec / totalDurationSec) * 100));
        }
      }
    });
    proc.stderr.on("data", (d) => {
      stderrTail += d.toString();
      if (stderrTail.length > 6000) stderrTail = stderrTail.slice(-6000);
    });
    proc.on("error", reject);
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(stderrTail.slice(-600) || `ffmpeg exit ${code}`))));
  });
}
