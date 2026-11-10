import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApp, pipeline } from '../server.js';
import { Rooms, newRoomCode } from '../lib/rooms.js';
import { speak, transcribe } from '../lib/gnani.js';
import { translate } from '../lib/translate.js';

process.env.GNANI_KEY = 'test-gnani';
process.env.GEMINI_KEY = 'test-gemini';

const open = (url) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox = [];
    const waiters = [];
    ws.on('message', (d) => {
      const msg = JSON.parse(String(d));
      const i = waiters.findIndex((w) => w.type === msg.type);
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
      else inbox.push(msg);
    });
    ws.next = (type) =>
      new Promise((res) => {
        const i = inbox.findIndex((m) => m.type === type);
        if (i >= 0) res(inbox.splice(i, 1)[0]);
        else waiters.push({ type, resolve: res });
      });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });

test('a Kannada speaker is heard in Hindi by the other person', async () => {
  pipeline.transcribe = async (_audio, lang) => (lang === 'kn-IN' ? 'ನಮಸ್ಕಾರ, ಹೇಗಿದ್ದೀರಾ?' : '');
  pipeline.translate = async (text, from, to) => `[${from}->${to}] नमस्ते, आप कैसे हैं?`;
  pipeline.speak = async (text, lang) => Buffer.from(`WAV:${lang}:${text}`);

  const server = createApp().listen(0);
  const url = `ws://localhost:${server.address().port}/ws`;
  const a = await open(url);
  const b = await open(url);
  a.send(JSON.stringify({ type: 'join', room: 'test1', name: 'Manish', lang: 'kn-IN' }));
  assert.equal((await a.next('joined')).room, 'TEST1');
  b.send(JSON.stringify({ type: 'join', room: 'TEST1', name: 'Ravi', lang: 'hi-IN' }));
  await b.next('joined');
  const peers = await b.next('peers');
  assert.equal(peers.peers.length, 2);

  a.send(Buffer.from('RIFF....fake wav'));
  assert.equal((await b.next('speaking')).name, 'Manish');
  assert.equal((await a.next('heard')).text, 'ನಮಸ್ಕಾರ, ಹೇಗಿದ್ದೀರಾ?');
  const said = await b.next('said');
  assert.equal(said.text, 'ನಮಸ್ಕಾರ, ಹೇಗಿದ್ದೀರಾ?');
  assert.equal(said.translated, '[kn-IN->hi-IN] नमस्ते, आप कैसे हैं?');
  assert.equal(said.toLang, 'hi-IN');
  assert.match(Buffer.from(said.audio, 'base64').toString(), /^WAV:hi-IN:/);
  assert.equal((await a.next('delivered')).toLang, 'hi-IN');

  a.close();
  b.close();
  server.close();
});

test('speaking alone in a room gives a clear message', async () => {
  const server = createApp().listen(0);
  const a = await open(`ws://localhost:${server.address().port}/ws`);
  a.send(JSON.stringify({ type: 'join', room: 'solo', name: 'A', lang: 'kn-IN' }));
  await a.next('joined');
  a.send(Buffer.from('wav'));
  assert.match((await a.next('error')).message, /Nobody else/);
  a.close();
  server.close();
});

test('rooms group listeners by language and cap size', () => {
  const r = new Rooms(3);
  r.join('X', { id: '1', lang: 'kn-IN' });
  r.join('X', { id: '2', lang: 'hi-IN' });
  r.join('X', { id: '3', lang: 'hi-IN' });
  assert.throws(() => r.join('X', { id: '4', lang: 'kn-IN' }), /full/);
  const g = r.listenersByLang('X', '1');
  assert.deepEqual([...g.keys()], ['hi-IN']);
  assert.equal(g.get('hi-IN').length, 2);
  r.leave('X', '1');
  r.leave('X', '2');
  r.leave('X', '3');
  assert.equal(r.peers('X').length, 0);
  assert.match(newRoomCode(), /^[A-Z2-9]{5}$/);
});

test('Gnani STT and TTS requests use the documented formats', async () => {
  let call;
  const fake = async (url, init) => {
    call = { url, init };
    if (url.includes('/stt/')) return new Response(JSON.stringify({ success: true, transcript: ' ನಮಸ್ಕಾರ ' }));
    return new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'Content-Type': 'audio/wav' } });
  };
  assert.equal(await transcribe(Buffer.from('x'), 'kn-IN', fake), 'ನಮಸ್ಕಾರ');
  assert.equal(call.url, 'https://api.vachana.ai/stt/v3');
  assert.equal(call.init.headers['X-API-Key-ID'], 'test-gnani');
  assert.equal(call.init.body.get('model'), 'prisma-v3.0');
  assert.equal(call.init.body.get('language_code'), 'kn-IN');

  const wav = await speak('नमस्ते', 'hi-IN', 'female', fake);
  assert.equal(wav.toString(), 'RIFF');
  const body = JSON.parse(call.init.body);
  assert.equal(call.url, 'https://api.vachana.ai/api/v1/tts/inference');
  assert.equal(body.model, 'timbre-v2.5');
  assert.equal(body.voice, 'Nalini');
  assert.equal(body.language, 'hi-IN');
});

test('translation asks for natural spoken target language and returns only the text', async () => {
  let sent;
  const fake = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: ' नमस्ते ' }] } }] }));
  };
  assert.equal(await translate('ನಮಸ್ಕಾರ', 'kn-IN', 'hi-IN', fake), 'नमस्ते');
  assert.match(sent.contents[0].parts[0].text, /spoken Kannada into natural, everyday spoken Hindi/);
  assert.equal(await translate('same', 'hi-IN', 'hi-IN', fake), 'same');
});

test('face-to-face turn: one clip in, translated voice back', async () => {
  const saved = { ...pipeline };
  pipeline.transcribe = async (_buf, lang) => (lang === 'hi-IN' ? 'नमस्ते' : '');
  pipeline.translate = async (text, from, to) => `${text}:${from}>${to}`;
  pipeline.speak = async (_t, _l, gender) => Buffer.from(gender);
  const server = createApp().listen(0);
  const base = `http://localhost:${server.address().port}`;
  try {
    const ok = await fetch(`${base}/api/turn?from=hi-IN&to=kn-IN&gender=female`, { method: 'POST', body: new Uint8Array(100) });
    const body = await ok.json();
    assert.equal(body.text, 'नमस्ते');
    assert.equal(body.translated, 'नमस्ते:hi-IN>kn-IN');
    assert.equal(Buffer.from(body.audio, 'base64').toString(), 'female');

    const silent = await fetch(`${base}/api/turn?from=kn-IN&to=hi-IN`, { method: 'POST', body: new Uint8Array(100) });
    assert.equal(silent.status, 422);
    const bad = await fetch(`${base}/api/turn?from=xx&to=hi-IN`, { method: 'POST', body: new Uint8Array(100) });
    assert.equal(bad.status, 400);

    const qr = await fetch(`${base}/api/qr?text=${encodeURIComponent('https://example.com/?room=AB12C')}`);
    assert.match(await qr.text(), /<svg/);
  } finally {
    Object.assign(pipeline, saved);
    server.close();
  }
});
