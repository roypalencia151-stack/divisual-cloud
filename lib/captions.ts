import type { Word } from "./cut";

// Subtítulos quemados estilo styles/client-style.md: frases cortas (2-5
// palabras), blanco normal, amarillo de marca para el momento de impacto,
// fade in/out suave, posición variable (alto/medio/bajo) sin tapar la cara.

function escapeAss(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")");
}

function formatAssTime(t: number): string {
  const clamped = Math.max(0, t);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.floor((clamped - Math.floor(clamped)) * 100);
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

function chunkWords(words: Word[]): Word[][] {
  const chunks: Word[][] = [];
  let cur: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    cur.push(w);
    const isEnd = /[.!?]$/.test(w.text);
    const isComma = /,$/.test(w.text) && cur.length >= 4;
    const nextGap = i + 1 < words.length ? words[i + 1].start - w.end : 999;
    const overLimit = cur.length >= 5;
    if (isEnd || isComma || nextGap > 0.35 || overLimit) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export function buildAss(words: Word[], totalDuration: number, width: number, height: number): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Normal,Arial,${Math.round(height * 0.045)},&H00FFFFFF,&H000000FF,&H64000000,&H00000000,0,0,0,0,100,100,0,0,1,0,2,2,40,40,40,1
Style: Accent,Arial,${Math.round(height * 0.05)},&H001CC5FA,&H000000FF,&H64000000,&H00000000,1,0,0,0,100,100,0,0,1,0,2,2,40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines: string[] = [];
  for (const chunk of chunkWords(words)) {
    const start = Math.max(0, chunk[0].start - 0.05);
    const end = Math.min(totalDuration, chunk[chunk.length - 1].end + 0.15);
    if (end <= start) continue;
    const text = escapeAss(chunk.map((w) => w.text).join(" "));
    const frac = start / Math.max(totalDuration, 0.01);
    const posY = frac < 0.15 ? height * 0.35 : frac > 0.82 ? height * 0.72 : height * 0.58;
    const hasLongWord = chunk.some((w) => w.text.replace(/[,.!?]/g, "").length >= 7);
    const isEdgeMoment = frac < 0.08 || frac > 0.85;
    const style = hasLongWord && isEdgeMoment ? "Accent" : "Normal";
    lines.push(
      `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},${style},,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${Math.round(posY)})\\fad(180,150)}${text}`
    );
  }

  return header + lines.join("\n") + "\n";
}
