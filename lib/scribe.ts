const SCRIBE_URL = "https://api.elevenlabs.io/v1/speech-to-text";

export type ScribeWord = { type: string; text: string; start: number; end: number };

export async function callScribe(wavBuffer: Buffer, apiKey: string): Promise<ScribeWord[]> {
  const form = new FormData();
  const bytes = new Uint8Array(wavBuffer.byteLength);
  bytes.set(wavBuffer);
  form.append("file", new Blob([bytes], { type: "audio/wav" }), "audio.wav");
  form.append("model_id", "scribe_v1");
  form.append("tag_audio_events", "true");
  form.append("timestamps_granularity", "word");

  const resp = await fetch(SCRIBE_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ElevenLabs Scribe respondió ${resp.status}: ${text.slice(0, 300)}`);
  }
  const json = await resp.json();
  const words = (json.words || []) as ScribeWord[];
  if (words.filter((w) => w.type === "word").length === 0) {
    throw new Error("La transcripción no encontró palabras (¿audio vacío?)");
  }
  return words;
}
