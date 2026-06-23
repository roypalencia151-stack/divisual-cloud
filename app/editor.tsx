"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

const PHASES = [
  { id: "prepare", label: "Analizando vídeo", icon: "1" },
  { id: "transcribe", label: "Transcribiendo audio", icon: "2" },
  { id: "cut", label: "Recortando fillers", icon: "3" },
  { id: "caption", label: "Generando subtítulos", icon: "4" },
  { id: "encode", label: "Renderizando vídeo final", icon: "5" },
  { id: "deliver", label: "Subiendo resultado", icon: "6" },
] as const;

type PhaseId = (typeof PHASES)[number]["id"];
type AppState = "idle" | "processing" | "success" | "error";

type LogLine = { kind: string; msg: string };

const MAX_MB = 30;
const MAX_SECONDS = 60;

export default function Editor() {
  const [state, setState] = useState<AppState>("idle");
  const [fileName, setFileName] = useState("");
  const [fileMeta, setFileMeta] = useState("");
  const [phaseStatus, setPhaseStatus] = useState<Record<PhaseId, "pending" | "active" | "done">>(
    Object.fromEntries(PHASES.map((p) => [p.id, "pending"])) as Record<PhaseId, "pending" | "active" | "done">
  );
  const [overallPct, setOverallPct] = useState(0);
  const [currentLabel, setCurrentLabel] = useState("Inicializando…");
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function appendLog(kind: string, msg: string) {
    setLogLines((prev) => [...prev.slice(-299), { kind, msg }]);
  }

  function resetPhases() {
    setPhaseStatus(Object.fromEntries(PHASES.map((p) => [p.id, "pending"])) as Record<PhaseId, "pending" | "active" | "done">);
  }

  function markPhase(id: PhaseId, status: "active" | "done") {
    setPhaseStatus((prev) => {
      const next = { ...prev };
      if (status === "active") {
        const idx = PHASES.findIndex((p) => p.id === id);
        PHASES.forEach((p, i) => {
          if (i < idx) next[p.id] = "done";
        });
        next[id] = "active";
      } else {
        next[id] = "done";
      }
      return next;
    });
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith("video/") && !/\.(mp4|mov)$/i.test(file.name)) {
      alert("Sube un MP4 o MOV.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      alert(`El vídeo pesa demasiado para la versión cloud (máx ${MAX_MB}MB). Para vídeos más pesados usa el dashboard local.`);
      return;
    }

    setFileName(file.name);
    setFileMeta(humanSize(file.size));
    setState("processing");
    resetPhases();
    setLogLines([]);
    setOverallPct(0);
    setElapsed(0);
    appendLog("info", `Subiendo ${file.name} (${humanSize(file.size)})…`);

    const start = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);

    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/blob-upload",
        onUploadProgress: ({ percentage }) => {
          setCurrentLabel(`Subiendo (${Math.round(percentage)}%)`);
        },
      });

      appendLog("done", "✔ Vídeo recibido. Arrancando edición…");
      await runEdit(blob.url, file.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error subiendo el vídeo";
      showError(msg);
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }

  async function runEdit(blobUrl: string, name: string) {
    const resp = await fetch("/api/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: blobUrl, filename: name }),
    });

    if (!resp.body) {
      showError("El servidor no devolvió stream de progreso.");
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        handleEvent(line);
      }
    }
    if (buf.trim()) handleEvent(buf);
  }

  function handleEvent(line: string) {
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      return;
    }

    if (evt.phase === "log") {
      appendLog(evt.kind || "info", evt.msg);
      return;
    }
    if (evt.phase === "error") {
      showError(evt.msg || "Falló el procesamiento.");
      return;
    }
    if (evt.phase === "done") {
      for (const p of PHASES) markPhase(p.id, "done");
      setOverallPct(100);
      setResultUrl(evt.url);
      setState("success");
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const def = PHASES.find((p) => p.id === evt.phase);
    if (!def) return;
    markPhase(def.id, "active");
    setCurrentLabel(evt.label || def.label);
    if (typeof evt.percent === "number") {
      const idx = PHASES.findIndex((p) => p.id === evt.phase);
      const base = (idx / PHASES.length) * 100;
      const span = 100 / PHASES.length;
      setOverallPct(Math.min(99, base + (evt.percent / 100) * span));
    }
    appendLog("phase", `→ ${evt.label || def.label}`);
  }

  function showError(msg: string) {
    setErrorMsg(msg);
    setState("error");
    if (timerRef.current) clearInterval(timerRef.current);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dropRef.current?.classList.remove("active");
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  }

  if (state === "idle") {
    return (
      <section>
        <div className="center" style={{ maxWidth: 560, margin: "0 auto" }}>
          <h1 className="font-display">
            Edita tu vídeo <span style={{ color: "var(--yellow)" }}>en automático.</span>
          </h1>
          <p className="lead mx-auto">
            Recorte de fillers, subtítulos quemados y color grade — directo desde el navegador, sin instalar nada.
          </p>
        </div>
        <div
          ref={dropRef}
          className="drop-zone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); dropRef.current?.classList.add("active"); }}
          onDragLeave={() => dropRef.current?.classList.remove("active")}
          onDrop={onDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/*"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <div className="drop-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FAC51C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div>
            <div className="drop-title">Suelta tu vídeo aquí</div>
            <div className="drop-sub">o haz click para elegir uno</div>
          </div>
          <div className="drop-meta">MP4 · MOV · hasta {MAX_MB}MB · hasta {MAX_SECONDS}s</div>
        </div>
        <div className="limits">
          <span>· Esta es la versión cloud, simplificada</span>
          <span>· Sin motion graphics con IA (eso vive en el dashboard local)</span>
        </div>
      </section>
    );
  }

  if (state === "processing") {
    return (
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <div className="font-mono" style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Editando</div>
            <h2 className="font-display" style={{ fontSize: 28, margin: "4px 0 0" }}>{fileName}</h2>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="font-mono" style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase" }}>Tamaño</div>
            <div className="font-mono" style={{ color: "var(--yellow)" }}>{fileMeta}</div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
            <div>
              <div className="font-mono" style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase" }}>Tiempo transcurrido</div>
              <div className="font-display" style={{ fontSize: 56, color: "var(--yellow)", marginTop: 8 }}>{formatDuration(elapsed)}</div>
            </div>
            <div>
              <div className="font-mono" style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase" }}>Estado</div>
              <div className="font-display" style={{ fontSize: 20, marginTop: 8 }}>{currentLabel}</div>
              <div className="progress-bar"><div style={{ width: `${overallPct}%` }} /></div>
              <div className="font-mono" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>{overallPct.toFixed(0)}%</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 32 }}>
          {PHASES.map((p) => (
            <div key={p.id} className={`phase-row ${phaseStatus[p.id]}`}>
              <div className="phase-icon">{phaseStatus[p.id] === "done" ? "✓" : p.icon}</div>
              <div className="phase-label">{p.label}</div>
              <div className="phase-meta">{phaseStatus[p.id] === "done" ? "" : phaseStatus[p.id] === "active" ? "···" : "○"}</div>
            </div>
          ))}
        </div>

        <div className="log">
          {logLines.map((l, i) => (
            <div key={i} className={`line ${l.kind === "tool" ? "" : l.kind}`}>{l.msg}</div>
          ))}
        </div>
      </section>
    );
  }

  if (state === "success") {
    return (
      <section className="center">
        <h2 className="font-display" style={{ fontSize: 40 }}>
          Tu vídeo está <span style={{ color: "var(--yellow)" }}>listo</span>.
        </h2>
        <p className="lead mx-auto">Descárgalo abajo — no se guarda en ningún sitio salvo el enlace temporal de Blob.</p>
        <div className="card" style={{ marginTop: 24 }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video className="result" src={resultUrl} controls playsInline />
        </div>
        <a className="btn btn-primary" href={resultUrl} download={`${fileName.replace(/\.[^.]+$/, "")}_final.mp4`}>
          ⬇ Descargar vídeo
        </a>
        <button className="btn-secondary" onClick={() => location.reload()}>Editar otro vídeo</button>
      </section>
    );
  }

  return (
    <section>
      <div className="error-box">
        <h3 className="font-display" style={{ fontSize: 24, marginBottom: 8 }}>Algo se rompió</h3>
        <p className="font-mono" style={{ color: "var(--text-soft)", fontSize: 13 }}>{errorMsg}</p>
        <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => location.reload()}>Volver a empezar</button>
      </div>
    </section>
  );
}

function formatDuration(sec: number) {
  if (sec < 60) return `0:${sec.toString().padStart(2, "0")}`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function humanSize(bytes: number) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bytes >= 1024 && i < u.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
