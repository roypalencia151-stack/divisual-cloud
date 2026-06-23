export type Word = { type: string; text: string; start: number; end: number };
export type Segment = { start: number; end: number };

// Subconjunto deliberadamente simple de la heurística del pipeline local
// (dashboard/scripts antiguos) — fillers explícitos + silencios largos.
const CUT_FILLERS = ["eh", "em", "um", "uh", "ehm", "mmm", "hmm"];
const START_FILLERS = ["bueno", "pues", "vale", "vamos", "venga", "bien", "a", "ver"];

export function computeCutSegments(words: Word[], totalDuration: number): Segment[] {
  const onlyWords = words.filter((w) => w.type === "word");
  const segments: Segment[] = [];
  let curStart = 0.05;
  let lastEnd = 0;

  const flush = (endT: number) => {
    if (endT > curStart + 0.4) segments.push({ start: curStart, end: endT });
  };

  for (let i = 0; i < onlyWords.length; i++) {
    const w = onlyWords[i];
    const txt = w.text.toLowerCase().replace(/[,.!?¡¿]/g, "").trim();
    const isFiller = CUT_FILLERS.includes(txt);
    const isStartFiller = i === 0 && START_FILLERS.includes(txt);
    const gapBefore = i > 0 ? w.start - onlyWords[i - 1].end : 0;
    const longSilenceBefore = gapBefore > 0.5;

    if (isFiller || isStartFiller) {
      flush(lastEnd + 0.05);
      curStart = w.end + 0.02;
    } else if (longSilenceBefore && i > 0) {
      flush(onlyWords[i - 1].end + 0.08);
      curStart = Math.max(w.start - 0.08, onlyWords[i - 1].end + 0.05);
    }
    lastEnd = w.end;
  }
  flush(totalDuration - 0.05);

  if (segments.length === 0) segments.push({ start: 0.05, end: Math.max(0.5, totalDuration - 0.05) });
  return segments;
}

export function totalCutDuration(segments: Segment[]): number {
  return segments.reduce((a, s) => a + (s.end - s.start), 0);
}

/** Reescala los timestamps de las palabras a la línea de tiempo post-recorte. Descarta las que cayeron en un corte. */
export function remapWords(words: Word[], segments: Segment[]): Word[] {
  const edl: { srcStart: number; srcEnd: number; outStart: number }[] = [];
  let outOffset = 0;
  for (const s of segments) {
    edl.push({ srcStart: s.start, srcEnd: s.end, outStart: outOffset });
    outOffset += s.end - s.start;
  }
  const mapTime = (t: number): number | null => {
    for (const r of edl) {
      if (r.srcStart <= t && t < r.srcEnd) return t - r.srcStart + r.outStart;
    }
    return null;
  };
  const out: Word[] = [];
  for (const w of words) {
    if (w.type !== "word") continue;
    const ns = mapTime(w.start);
    const ne = mapTime(w.end);
    if (ns === null || ne === null) continue;
    out.push({ ...w, start: ns, end: ne });
  }
  return out;
}
