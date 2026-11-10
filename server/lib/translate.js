// Translation between the two speakers' languages. Gnani handles speech; the text in between
// is translated with Gemini (free tier), kept spoken and natural rather than bookish.

import { LANGUAGES } from './gnani.js';

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

export async function translate(text, from, to, fetchImpl = fetch) {
  if (!text || from === to) return text;
  const key = process.env.GEMINI_KEY;
  if (!key) throw new Error('GEMINI_KEY is not set');
  const src = LANGUAGES[from]?.name ?? from;
  const dst = LANGUAGES[to]?.name ?? to;
  const prompt =
    `Translate this spoken ${src} into natural, everyday spoken ${dst}, the way a person would say it on a phone call. ` +
    `Keep names, numbers and English words that people normally say in English. ` +
    `Write ${dst} in its own script. Reply with the translation only, nothing else.\n\n${text}`;
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
    }),
  });
  if (!res.ok) throw new Error(`translate ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const out = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  if (!out) throw new Error('translate: empty reply');
  return out;
}
