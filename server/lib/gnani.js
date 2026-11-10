// Gnani Vachana: the ears (Prisma speech-to-text) and the voice (Timbre text-to-speech).
// Docs: https://docs.gnani.ai/api/introduction/quick-start

const STT_URL = 'https://api.vachana.ai/stt/v3';
const TTS_URL = 'https://api.vachana.ai/api/v1/tts/inference';

/** Languages the bridge offers, with the Timbre v2.5 voice that speaks each one. */
export const LANGUAGES = {
  'kn-IN': { name: 'Kannada', native: 'ಕನ್ನಡ', voices: { male: 'Kavin', female: 'Saanvi' } },
  'hi-IN': { name: 'Hindi', native: 'हिन्दी', voices: { male: 'Deepak', female: 'Nalini' } },
};

function key() {
  const k = process.env.GNANI_KEY;
  if (!k) throw new Error('GNANI_KEY is not set');
  return k;
}

/**
 * Speech to text with Prisma v3.0. `audio` is a WAV buffer (max 30 s).
 * Returns the transcript ('' if nothing was said).
 */
export async function transcribe(audio, lang, fetchImpl = fetch) {
  const form = new FormData();
  form.append('audio_file', new Blob([audio], { type: 'audio/wav' }), 'clip.wav');
  form.append('model', 'prisma-v3.0');
  form.append('language_code', lang);
  const res = await fetchImpl(STT_URL, { method: 'POST', headers: { 'X-API-Key-ID': key() }, body: form });
  if (!res.ok) throw new Error(`Gnani STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  if (json.success === false) throw new Error(`Gnani STT failed: ${JSON.stringify(json).slice(0, 200)}`);
  return String(json.transcript ?? '').trim();
}

/** Text to speech with Timbre v2.5. Returns WAV bytes. */
export async function speak(text, lang, gender = 'male', fetchImpl = fetch) {
  const voice = LANGUAGES[lang]?.voices[gender] ?? LANGUAGES[lang]?.voices.male;
  if (!voice) throw new Error(`no voice for ${lang}`);
  const res = await fetchImpl(TTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key-ID': key() },
    body: JSON.stringify({
      text,
      voice,
      model: 'timbre-v2.5',
      language: lang,
      speed: 1.0,
      audio_config: { sample_rate: 24000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'wav' },
    }),
  });
  if (!res.ok) throw new Error(`Gnani TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}
