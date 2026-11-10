// Bhasha Bridge: a live call translator. Speak Kannada, the other person hears Hindi (and back).
//
//   phone A ──(WAV, Kannada)──▶ server ──▶ Gnani Prisma (speech → Kannada text)
//                                       ──▶ translate (Kannada → Hindi text)
//                                       ──▶ Gnani Timbre (Hindi text → Hindi speech) ──▶ phone B
//
// One WebSocket per person. A room holds up to 4 people; each hears everyone else in their own language.

import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { LANGUAGES, speak, transcribe } from './lib/gnani.js';
import { translate } from './lib/translate.js';
import { Rooms, newRoomCode } from './lib/rooms.js';

const MAX_CLIP_BYTES = 1_100_000; // ~30 s of 16 kHz mono WAV (Gnani's limit)

/** The speech pipeline; swappable in tests. */
export const pipeline = { transcribe, translate, speak };

export function createApp() {
  const app = express();
  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
  app.get('/api/languages', (_req, res) => res.json(LANGUAGES));
  app.get('/api/new-room', (_req, res) => res.json({ code: newRoomCode() }));
  app.get('/api/qr', async (req, res) => {
    const text = String(req.query.text || '').slice(0, 300);
    if (!text) return res.status(400).end();
    const svg = await QRCode.toString(text, { type: 'svg', margin: 0, color: { dark: '#0e0d14', light: '#0000' } });
    res.type('image/svg+xml').send(svg);
  });

  // Face-to-face mode: one phone, two people. One clip in, the translated voice back.
  app.post('/api/turn', express.raw({ type: () => true, limit: MAX_CLIP_BYTES }), async (req, res) => {
    const from = LANGUAGES[req.query.from] ? req.query.from : null;
    const to = LANGUAGES[req.query.to] ? req.query.to : null;
    if (!from || !to || !req.body?.length) return res.status(400).json({ error: 'Need from, to and a WAV clip' });
    const t0 = Date.now();
    try {
      const text = await pipeline.transcribe(Buffer.from(req.body), from);
      if (!text) return res.status(422).json({ error: "Didn't catch that, try again" });
      const translated = await pipeline.translate(text, from, to);
      const audio = await pipeline.speak(translated, to, req.query.gender === 'female' ? 'female' : 'male');
      res.json({ text, translated, audio: audio.toString('base64'), ms: Date.now() - t0 });
    } catch (e) {
      console.error(e);
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.get('/health', (_req, res) => res.json({ ok: true, gnani: !!process.env.GNANI_KEY, translate: !!process.env.GEMINI_KEY }));

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_CLIP_BYTES + 1024 });
  const rooms = new Rooms();

  const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  const broadcastPeers = (code) => {
    const list = rooms.peers(code).map((p) => ({ id: p.id, name: p.name, lang: p.lang }));
    for (const p of rooms.peers(code)) send(p.ws, { type: 'peers', you: p.id, peers: list });
  };

  wss.on('connection', (ws) => {
    let me = null;
    let code = null;
    let busy = false;

    ws.on('message', async (data, isBinary) => {
      let took = false; // this message holds the "busy" slot
      try {
        if (!isBinary) {
          const msg = JSON.parse(String(data));
          if (msg.type === 'join') {
            const lang = LANGUAGES[msg.lang] ? msg.lang : 'kn-IN';
            code = String(msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || newRoomCode();
            me = { id: randomUUID(), name: String(msg.name || 'Guest').slice(0, 24), lang, gender: msg.gender === 'female' ? 'female' : 'male', ws };
            rooms.join(code, me);
            send(ws, { type: 'joined', room: code, id: me.id });
            broadcastPeers(code);
          }
          return;
        }
        // A spoken clip (WAV) from this person.
        if (!me) return send(ws, { type: 'error', message: 'Join a room first' });
        if (busy) return send(ws, { type: 'error', message: 'Still translating your last line' });
        const listeners = rooms.listenersByLang(code, me.id);
        if (!listeners.size) return send(ws, { type: 'error', message: 'Nobody else is in the room yet' });
        busy = took = true;
        const id = randomUUID();
        const t0 = Date.now();
        for (const group of listeners.values()) for (const p of group) send(p.ws, { type: 'speaking', from: me.id, name: me.name });

        const text = await pipeline.transcribe(Buffer.from(data), me.lang);
        if (!text) {
          send(ws, { type: 'error', message: "Didn't catch that, try again" });
          for (const group of listeners.values()) for (const p of group) send(p.ws, { type: 'idle', from: me.id });
          return;
        }
        send(ws, { type: 'heard', id, text });

        // Each listening language gets its own translation and voice, in parallel.
        await Promise.all(
          [...listeners].map(async ([lang, group]) => {
            const translated = await pipeline.translate(text, me.lang, lang);
            const audio = await pipeline.speak(translated, lang, me.gender);
            const ms = Date.now() - t0;
            for (const p of group) {
              send(p.ws, { type: 'said', id, from: me.id, name: me.name, text, lang: me.lang, translated, toLang: lang, audio: audio.toString('base64'), ms });
            }
            send(ws, { type: 'delivered', id, translated, toLang: lang, ms });
          }),
        );
      } catch (e) {
        console.error(e);
        send(ws, { type: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        if (took) busy = false;
      }
    });

    ws.on('close', () => {
      if (!me) return;
      rooms.leave(code, me.id);
      broadcastPeers(code);
    });
  });

  return server;
}

// Start when run directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT) || 5050;
  createApp().listen(port, () => console.log(`Bhasha Bridge on http://localhost:${port}`));
}
