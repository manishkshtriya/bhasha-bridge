// Bhasha Bridge in the browser: join a room, hold to talk, hear the other person in your language.
import { Recorder } from './recorder.js';

const $ = (id) => document.getElementById(id);
const LANG = {
  'kn-IN': { native: 'ಕನ್ನಡ', name: 'Kannada', cls: 'kn' },
  'hi-IN': { native: 'हिन्दी', name: 'Hindi', cls: 'hi' },
};
const MAX_SECONDS = 28; // Gnani Prisma takes up to 30 s per clip

const state = { lang: 'kn-IN', gender: 'male', me: null, ws: null, peers: [], rec: null, player: null, queue: Promise.resolve() };

// ---- join screen ----
const params = new URLSearchParams(location.search);
if (params.get('room')) $('room').value = params.get('room');
try {
  $('name').value = localStorage.getItem('bb.name') || '';
  const saved = localStorage.getItem('bb.lang');
  if (saved && LANG[saved]) pick('lang', saved);
} catch {
  // storage blocked
}

function pick(kind, value) {
  for (const b of document.querySelectorAll(`.${kind === 'lang' ? 'lang' : 'gender'}`)) {
    const on = b.dataset[kind] === value;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  state[kind] = value;
}
for (const b of document.querySelectorAll('.lang')) b.addEventListener('click', () => pick('lang', b.dataset.lang));
for (const b of document.querySelectorAll('.gender')) b.addEventListener('click', () => pick('gender', b.dataset.gender));

$('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter ?? $('joinForm').querySelector('.primary');
  btn.disabled = true;
  btn.textContent = 'Starting…';
  try {
    // Ask for the mic and unlock audio playback now, on this tap (iPhone needs both from a tap).
    state.rec = new Recorder();
    await state.rec.open();
    state.player = new AudioContext();
    await state.player.resume();
    const name = $('name').value.trim() || 'Guest';
    try {
      localStorage.setItem('bb.name', name);
      localStorage.setItem('bb.lang', state.lang);
    } catch {
      // storage blocked
    }
    connect(name, $('room').value.trim());
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Start the call';
    alertBox(err && err.name === 'NotAllowedError' ? 'Microphone permission is needed to talk. Allow it and try again.' : String(err.message || err));
  }
});

function alertBox(text) {
  let el = document.querySelector('.joinerr');
  if (!el) {
    el = document.createElement('p');
    el.className = 'joinerr';
    el.setAttribute('role', 'alert');
    $('joinForm').append(el);
  }
  el.textContent = text;
}

// ---- connection ----
function connect(name, room) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  state.ws = ws;
  ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'join', room, name, lang: state.lang, gender: state.gender })));
  ws.addEventListener('message', (ev) => onMessage(JSON.parse(ev.data)));
  ws.addEventListener('close', () => setStatus('Disconnected. Refresh the page to rejoin.', 'err'));
}

function onMessage(msg) {
  switch (msg.type) {
    case 'joined': {
      state.me = msg.id;
      $('roomCode').textContent = msg.room;
      history.replaceState(null, '', `?room=${msg.room}`);
      $('join').hidden = true;
      $('call').hidden = false;
      document.body.dataset.lang = LANG[state.lang].cls;
      break;
    }
    case 'peers':
      state.peers = msg.peers;
      renderPeers();
      break;
    case 'speaking':
      setStatus(`${msg.name} is speaking…`, 'busy');
      break;
    case 'idle':
      setStatus('');
      break;
    case 'heard':
      addLine({ id: msg.id, mine: true, text: msg.text, lang: state.lang, pending: true });
      setStatus('Translating…', 'busy');
      break;
    case 'delivered':
      fillTranslation(msg.id, msg.translated, msg.toLang, msg.ms);
      setStatus('');
      break;
    case 'said':
      addLine({ id: msg.id, mine: false, name: msg.name, text: msg.text, lang: msg.lang, translated: msg.translated, toLang: msg.toLang, ms: msg.ms });
      setStatus('');
      play(msg.audio);
      break;
    case 'error':
      setStatus(msg.message, 'err');
      break;
  }
}

function renderPeers() {
  const ul = $('peers');
  ul.replaceChildren(
    ...state.peers.map((p) => {
      const li = document.createElement('li');
      li.className = `peer ${LANG[p.lang]?.cls ?? ''}`;
      li.innerHTML = `<b></b><span></span>`;
      li.querySelector('b').textContent = p.id === state.me ? `${p.name} (you)` : p.name;
      li.querySelector('span').textContent = LANG[p.lang]?.native ?? p.lang;
      return li;
    }),
  );
  const alone = state.peers.length < 2;
  $('talk').disabled = alone;
  $('talkLabel').textContent = alone ? 'Waiting for someone…' : 'Hold to talk';
  if (!alone) $('empty').textContent = 'Hold the button, speak, then let go.';
}

// ---- transcript ----
function addLine({ id, mine, name, text, lang, translated, toLang, pending, ms }) {
  $('empty')?.remove();
  let el = document.querySelector(`[data-id="${id}"]`);
  if (!el) {
    el = document.createElement('article');
    el.dataset.id = id;
    el.className = `line ${mine ? 'mine' : 'theirs'} ${LANG[lang]?.cls ?? ''}`;
    el.innerHTML = `<header></header><p class="orig"></p><p class="trans"></p>`;
    $('log').append(el);
  }
  el.querySelector('header').textContent = mine ? 'You said' : `${name} said`;
  el.querySelector('.orig').textContent = text;
  el.querySelector('.orig').lang = lang.slice(0, 2);
  const tr = el.querySelector('.trans');
  if (pending) {
    tr.textContent = 'translating…';
    tr.classList.add('pending');
  } else {
    tr.classList.remove('pending');
    tr.textContent = translated;
    tr.lang = toLang.slice(0, 2);
    tr.className = `trans ${LANG[toLang]?.cls ?? ''}`;
    if (ms) el.querySelector('header').textContent += ` · ${(ms / 1000).toFixed(1)}s`;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function fillTranslation(id, translated, toLang, ms) {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) return;
  const tr = el.querySelector('.trans');
  tr.classList.remove('pending');
  tr.textContent = translated;
  tr.lang = toLang.slice(0, 2);
  tr.className = `trans ${LANG[toLang]?.cls ?? ''}`;
  el.querySelector('header').textContent = `You said · they heard it in ${LANG[toLang]?.name ?? toLang} · ${(ms / 1000).toFixed(1)}s`;
}

function setStatus(text, kind = '') {
  const s = $('status');
  s.textContent = text;
  s.className = `status ${kind}`;
}

// ---- playback: incoming translated speech, one after another ----
function play(b64) {
  state.queue = state.queue.then(async () => {
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const buf = await state.player.decodeAudioData(bytes.buffer);
      await new Promise((res) => {
        const src = state.player.createBufferSource();
        src.buffer = buf;
        src.connect(state.player.destination);
        src.onended = res;
        src.start();
        document.body.classList.add('hearing');
      });
    } catch (e) {
      setStatus(`Couldn't play the audio (${e.message || e})`, 'err');
    } finally {
      document.body.classList.remove('hearing');
    }
  });
}

// ---- hold to talk ----
let holding = false;
let timerId;
const talk = $('talk');

function down(e) {
  if (talk.disabled || holding) return;
  e.preventDefault();
  holding = true;
  talk.classList.add('rec');
  $('talkLabel').textContent = 'Listening… let go to send';
  state.rec.start();
  const t0 = performance.now();
  timerId = setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    $('timer').textContent = `${s.toFixed(0)}s`;
    talk.style.setProperty('--lvl', state.rec.level.toFixed(2));
    if (s >= MAX_SECONDS) up();
  }, 100);
}

function up() {
  if (!holding) return;
  holding = false;
  clearInterval(timerId);
  talk.classList.remove('rec');
  talk.style.setProperty('--lvl', '0');
  $('timer').textContent = '';
  $('talkLabel').textContent = 'Hold to talk';
  const { wav, seconds } = state.rec.stop();
  if (seconds < 0.4) return setStatus('Hold the button a little longer while you speak.', 'err');
  state.ws.send(wav);
  setStatus('Sending…', 'busy');
}

talk.addEventListener('pointerdown', down);
addEventListener('pointerup', up);
addEventListener('pointercancel', up);
talk.addEventListener('contextmenu', (e) => e.preventDefault());
// keyboard: hold Space
addEventListener('keydown', (e) => e.code === 'Space' && !e.repeat && !$('call').hidden && down(e));
addEventListener('keyup', (e) => e.code === 'Space' && up());

// ---- invite ----
$('share').addEventListener('click', async () => {
  const url = location.href;
  const text = `Join my Bhasha Bridge call: speak your language, I'll hear mine. Room ${$('roomCode').textContent}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Bhasha Bridge', text, url });
    else {
      await navigator.clipboard.writeText(url);
      setStatus('Invite link copied.', 'ok');
    }
  } catch {
    // share sheet closed
  }
});
