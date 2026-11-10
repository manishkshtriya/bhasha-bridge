// Bhasha Bridge in the browser.
//   Face to face: one phone, two people, each holds their own side's button.
//   Remote call:  a room shared by link; each person speaks and hears their own language.
import { Recorder } from './recorder.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const LANG = {
  'kn-IN': {
    cls: 'kn',
    native: 'ಕನ್ನಡ',
    name: 'Kannada',
    voices: { male: 'Kavin', female: 'Saanvi' },
    prompt: 'ಗುಂಡಿ ಒತ್ತಿ ಹಿಡಿದು ಕನ್ನಡದಲ್ಲಿ ಮಾತಾಡಿ',
    listening: 'ಕೇಳುತ್ತಿದ್ದೇನೆ…',
    retry: 'ಸರಿಯಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ, ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ',
  },
  'hi-IN': {
    cls: 'hi',
    native: 'हिन्दी',
    name: 'Hindi',
    voices: { male: 'Deepak', female: 'Nalini' },
    prompt: 'बटन दबाकर हिन्दी में बोलिए',
    listening: 'सुन रहा हूँ…',
    retry: 'ठीक से सुनाई नहीं दिया, फिर से बोलिए',
  },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const other = (l) => (l === 'kn-IN' ? 'hi-IN' : 'kn-IN');
const MAX_SECONDS = 28; // Gnani Prisma takes up to 30 s per clip
const MIN_SECONDS = 0.4;

const store = {
  get(k) {
    try {
      return localStorage.getItem(`bb.${k}`);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`bb.${k}`, v);
    } catch {
      // storage blocked
    }
  },
};

// ---------------------------------------------------------------- screens
function show(id) {
  for (const s of $$('.screen')) s.hidden = s.id !== id;
  scrollTo(0, 0);
}
for (const b of $$('[data-back]')) b.addEventListener('click', () => goHome());

function goHome() {
  if (call.ws) {
    call.ws.onclose = null;
    call.ws.close();
    call.ws = null;
  }
  history.replaceState(null, '', location.pathname);
  show('home');
}

let toastTimer;
function toast(text, kind = '') {
  const t = $('#toast');
  t.textContent = text;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------------------------------------------------------------- audio
const audio = { rec: null, out: null, queue: Promise.resolve() };

/** Ask for the mic and unlock playback. Must run inside a tap (iPhone rule). */
async function ensureAudio() {
  if (!audio.out) {
    audio.out = new AudioContext();
  }
  await audio.out.resume();
  if (!audio.rec) {
    const rec = new Recorder();
    await rec.open();
    audio.rec = rec;
  }
}

function micError(err) {
  return err && err.name === 'NotAllowedError'
    ? 'Allow the microphone to talk. Check the address bar.'
    : `Microphone problem: ${err?.message || err}`;
}

function play(b64) {
  const p = audio.queue.then(async () => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buf = await audio.out.decodeAudioData(bytes.buffer);
    await new Promise((res) => {
      const src = audio.out.createBufferSource();
      src.buffer = buf;
      src.connect(audio.out.destination);
      src.onended = res;
      src.start();
    });
  });
  audio.queue = p.catch(() => {});
  return p;
}

/** Hold-to-talk on any button. Returns the WAV on release via onClip. */
function holdToTalk(btn, { canStart, onStart, onClip, onTooShort }) {
  let holding = false;
  let raf = 0;
  let t0 = 0;
  const tick = () => {
    btn.style.setProperty('--lvl', audio.rec.level.toFixed(3));
    if ((performance.now() - t0) / 1000 >= MAX_SECONDS) return up();
    raf = requestAnimationFrame(tick);
  };
  const down = (e) => {
    if (holding || btn.disabled || !audio.rec || (canStart && !canStart())) return;
    e.preventDefault();
    if (e.pointerId !== undefined) btn.setPointerCapture?.(e.pointerId);
    holding = true;
    t0 = performance.now();
    btn.classList.add('rec');
    navigator.vibrate?.(12);
    audio.rec.start();
    onStart?.();
    raf = requestAnimationFrame(tick);
  };
  const up = () => {
    if (!holding) return;
    holding = false;
    cancelAnimationFrame(raf);
    btn.classList.remove('rec');
    btn.style.setProperty('--lvl', '0');
    const { wav, seconds } = audio.rec.stop();
    if (seconds < MIN_SECONDS) return onTooShort?.();
    onClip(wav);
  };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  return { down, up };
}

// ---------------------------------------------------------------- home
const PAIRS = [
  ['ನಮಸ್ಕಾರ', 'नमस्ते', 'Hello'],
  ['ಊಟ ಆಯ್ತಾ?', 'खाना खाया?', 'Have you eaten?'],
  ['ಎಲ್ಲಿಗೆ ಹೋಗಬೇಕು?', 'कहाँ जाना है?', 'Where to?'],
  ['ಎಷ್ಟು ಆಯ್ತು?', 'कितना हुआ?', 'How much is it?'],
  ['ಧನ್ಯವಾದಗಳು', 'धन्यवाद', 'Thank you'],
];

/** The home screen: a Kannada phrase is written in turmeric, a thread draws across, and it lands in indigo Hindi. */
async function heroLoop() {
  const duo = $('#duo');
  for (let i = 0; ; i = (i + 1) % PAIRS.length) {
    while ($('#home').hidden) await sleep(400);
    const [kn, hi, en] = PAIRS[i];
    $('#heroKn').textContent = kn;
    $('#heroHi').textContent = hi;
    $('#gloss').textContent = `“${en}”`;
    duo.classList.remove('off');
    void duo.offsetWidth;
    duo.classList.add('on');
    await sleep(5200);
    duo.classList.add('off');
    await sleep(550);
    duo.classList.remove('on');
    await sleep(150);
  }
}
if (calm) $('#duo').classList.add('on');
else heroLoop();

$('[data-mode="face"]').addEventListener('click', async () => {
  try {
    await ensureAudio();
  } catch (e) {
    return toast(micError(e), 'err');
  }
  startFace();
});
$('[data-mode="call"]').addEventListener('click', () => openSetup(null));

// ---------------------------------------------------------------- face to face
const face = {
  top: 'hi-IN',
  bottom: 'kn-IN',
  gender: { 'kn-IN': store.get('face.kn') || 'male', 'hi-IN': store.get('face.hi') || 'male' },
  busy: false,
};

function startFace() {
  document.body.className = '';
  renderFace();
  show('face');
}

function renderFace() {
  for (const [pos, el] of [
    ['top', $('#halfTop')],
    ['bottom', $('#halfBottom')],
  ]) {
    const lang = face[pos];
    const L = LANG[lang];
    el.className = `half ${pos} ${L.cls}`;
    el.dataset.lang = lang;
    el.lang = L.cls;
    el.replaceChildren($('#halfTpl').content.cloneNode(true));
    const big = $('.big', el);
    big.textContent = L.prompt;
    big.classList.add('prompt');
    $('.lname', el).textContent = L.native;
    const orb = $('.orb', el);
    orb.classList.add('idlepulse');
    orb.setAttribute('aria-label', `Hold to talk in ${L.name}`);
    updateVoiceChip(el, lang);
    $('.vchip', el).addEventListener('click', () => {
      face.gender[lang] = face.gender[lang] === 'male' ? 'female' : 'male';
      store.set(`face.${L.cls}`, face.gender[lang]);
      updateVoiceChip(el, lang);
    });
    holdToTalk(orb, {
      canStart: () => !face.busy,
      onStart: () => {
        $('.small', el).textContent = L.listening;
      },
      onTooShort: () => {
        $('.small', el).textContent = 'Hold the button while you speak';
      },
      onClip: (wav) => faceTurn(lang, wav),
    });
  }
}

function updateVoiceChip(el, lang) {
  const to = LANG[other(lang)];
  $('.vchip', el).textContent = `Heard as ${to.voices[face.gender[lang]]} · tap to change`;
}

const halfFor = (lang) => (face.top === lang ? $('#halfTop') : $('#halfBottom'));

function write(el, text, lang) {
  el.classList.remove('prompt', 'write');
  el.textContent = text;
  if (lang) el.lang = LANG[lang].cls;
  void el.offsetWidth;
  el.classList.add('write');
}

async function faceTurn(from, wav) {
  const to = other(from);
  const mine = halfFor(from);
  const theirs = halfFor(to);
  face.busy = true;
  $('.orb', mine).classList.add('work');
  $('.small', mine).textContent = LANG[from].listening;
  mine.classList.remove('heard');
  try {
    const res = await fetch(`/api/turn?from=${from}&to=${to}&gender=${face.gender[from]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: wav,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Server error ${res.status}`), { status: res.status });

    // your words settle on your side, then the ink bleeds across and is written in their language
    write($('.small', mine), `${data.text} · ${(data.ms / 1000).toFixed(1)}s`, from);
    theirs.classList.add('hearing', 'heard');
    const voice = play(data.audio);
    await sleep(calm ? 0 : 350);
    write($('.big', theirs), data.translated, to);
    $('.small', theirs).textContent = `“${data.text}”`;
    $('.small', theirs).lang = LANG[from].cls;
    await voice.catch(() => toast("Couldn't play the voice", 'err'));
  } catch (e) {
    $('.small', mine).textContent = e.status === 422 ? LANG[from].retry : '';
    if (e.status !== 422) toast(e.message, 'err');
  } finally {
    theirs.classList.remove('hearing');
    face.busy = false;
    $('.orb', mine).classList.remove('work');
  }
}

$('#swap').addEventListener('click', () => {
  [face.top, face.bottom] = [face.bottom, face.top];
  renderFace();
});

// ---------------------------------------------------------------- call: setup
const call = { lang: store.get('lang') || 'kn-IN', gender: store.get('gender') || 'male', ws: null, me: null, room: '', peers: [], busy: false };
let invite = null; // { room, from, lang } when arriving from a link

function pickLang(lang) {
  call.lang = lang;
  for (const t of $$('.tile')) {
    const on = t.dataset.lang === lang;
    t.classList.toggle('on', on);
    t.setAttribute('aria-checked', String(on));
  }
  const heard = LANG[other(lang)].voices;
  $('#vMale').textContent = heard.male;
  $('#vFemale').textContent = heard.female;
  document.body.className = `lang-${LANG[lang].cls}`;
}
function pickGender(g) {
  call.gender = g;
  for (const v of $$('.voice')) {
    const on = v.dataset.gender === g;
    v.classList.toggle('on', on);
    v.setAttribute('aria-checked', String(on));
  }
}
for (const t of $$('.tile')) t.addEventListener('click', () => pickLang(t.dataset.lang));
for (const v of $$('.voice')) v.addEventListener('click', () => pickGender(v.dataset.gender));

function openSetup(inv) {
  invite = inv;
  $('#name').value = store.get('name') || '';
  if (inv) {
    $('#invited').hidden = false;
    $('#invited').innerHTML = '';
    const b = document.createElement('b');
    b.textContent = inv.from || 'Someone';
    $('#invited').append(b, ` invited you to a call. They speak ${LANG[inv.lang]?.name ?? 'another language'}.`);
    $('#setupTitle').textContent = 'Join the call';
    $('#setupGo').textContent = 'Join the call';
    pickLang(inv.lang ? other(inv.lang) : call.lang);
  } else {
    $('#invited').hidden = true;
    $('#setupTitle').textContent = "Who's calling?";
    $('#setupGo').textContent = 'Start the call';
    pickLang(call.lang);
  }
  pickGender(call.gender);
  show('setup');
}

$('#setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const go = $('#setupGo');
  go.disabled = true;
  try {
    await ensureAudio();
  } catch (err) {
    go.disabled = false;
    return toast(micError(err), 'err');
  }
  const name = $('#name').value.trim() || 'Guest';
  store.set('name', name);
  store.set('lang', call.lang);
  store.set('gender', call.gender);
  connect(name, invite?.room || '');
  go.disabled = false;
});

// ---------------------------------------------------------------- call: connection
function connect(name, room) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  call.ws = ws;
  call.name = name;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room, name, lang: call.lang, gender: call.gender }));
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onclose = () => {
    setStatus('Disconnected. Go back and join again.', 'err');
    $('#talk').disabled = true;
  };
}

function inviteUrl() {
  const u = new URL(location.origin + location.pathname);
  u.searchParams.set('room', call.room);
  u.searchParams.set('from', call.name);
  u.searchParams.set('l', LANG[call.lang].cls);
  return u.toString();
}

function onMessage(msg) {
  switch (msg.type) {
    case 'joined': {
      call.me = msg.id;
      call.room = msg.room;
      $('#roomCode').textContent = msg.room;
      $('#log').replaceChildren($('#empty') ?? emptyEl());
      history.replaceState(null, '', `?room=${msg.room}`);
      show('call');
      break;
    }
    case 'peers': {
      const before = new Set(call.peers.map((p) => p.id));
      const after = new Set(msg.peers.map((p) => p.id));
      for (const p of msg.peers) if (call.peers.length && !before.has(p.id)) toast(`${p.name} joined`);
      for (const p of call.peers) if (!after.has(p.id)) toast(`${p.name} left`);
      call.peers = msg.peers;
      renderPeople();
      if (msg.peers.length > 1 && $('#invite').open) $('#invite').close();
      // First one in: show how to bring the other person in.
      if (msg.peers.length === 1 && !invite && !$('#invite').open && !call.invitedOnce) {
        call.invitedOnce = true;
        openInvite();
      }
      break;
    }
    case 'speaking':
      markTalking(msg.from, true);
      setStatus(`${msg.name} is speaking…`, 'busy');
      break;
    case 'idle':
      markTalking(msg.from, false);
      setStatus('');
      break;
    case 'heard':
      addCard({ id: msg.id, mine: true, text: msg.text, lang: call.lang, pending: true });
      setStatus('Translating…', 'busy');
      break;
    case 'delivered':
      fillMine(msg.id, msg.translated, msg.toLang, msg.ms);
      setStatus('');
      call.busy = false;
      $('#talk').classList.remove('work');
      break;
    case 'said':
      markTalking(msg.from, false);
      addCard({ id: msg.id, mine: false, name: msg.name, text: msg.text, lang: msg.lang, translated: msg.translated, toLang: msg.toLang, ms: msg.ms, audio: msg.audio });
      setStatus('');
      play(msg.audio).catch(() => toast("Couldn't play the voice", 'err'));
      break;
    case 'error':
      call.busy = false;
      $('#talk').classList.remove('work');
      setStatus(msg.message, 'err');
      break;
  }
}

function emptyEl() {
  const d = document.createElement('div');
  d.className = 'empty';
  d.id = 'empty';
  d.innerHTML = '<div class="waiting"><i></i><i></i><i></i></div><p id="emptyText"></p>';
  return d;
}

function renderPeople() {
  $('#people').replaceChildren(
    ...call.peers.map((p) => {
      const li = document.createElement('li');
      li.className = `person ${LANG[p.lang]?.cls ?? ''}`;
      li.dataset.id = p.id;
      li.innerHTML = '<span class="avatar"></span><span><b></b><small></small></span>';
      $('.avatar', li).textContent = (p.name[0] || '?').toUpperCase();
      $('b', li).textContent = p.id === call.me ? `${p.name} (you)` : p.name;
      $('small', li).textContent = LANG[p.lang]?.native ?? p.lang;
      return li;
    }),
  );
  const alone = call.peers.length < 2;
  $('#talk').disabled = alone;
  $('#talk').classList.toggle('idlepulse', !alone);
  $('#talkHint').textContent = alone ? 'Invite someone to start' : 'Hold to talk · or hold Space';
  const et = $('#emptyText');
  if (et) {
    et.textContent = alone
      ? 'Waiting for the other person to join…'
      : `You're connected. Hold the button, speak ${LANG[call.lang].name}, let go.`;
    $('.waiting', $('#empty')).hidden = !alone;
  }
}

function markTalking(id, on) {
  $(`.person[data-id="${id}"]`)?.classList.toggle('talking', on);
}

function setStatus(text, kind = '') {
  const s = $('#status');
  s.textContent = text;
  s.className = `status ${kind}`;
}

function addCard({ id, mine, name, text, lang, translated, toLang, pending, ms, audio: b64 }) {
  $('#empty')?.remove();
  const el = document.createElement('article');
  el.dataset.id = id;
  el.className = `card ${mine ? 'mine' : 'theirs'} ${LANG[lang]?.cls ?? ''}`;
  el.innerHTML = '<header><span class="who"></span><span class="speed"></span></header><p class="orig"></p><p class="trans"></p>';
  $('.who', el).textContent = mine ? 'You' : name;
  const orig = $('.orig', el);
  orig.textContent = text;
  orig.lang = LANG[lang]?.cls ?? '';
  orig.className = `orig ${LANG[lang]?.cls ?? ''}`;
  const tr = $('.trans', el);
  if (pending) {
    tr.textContent = 'translating…';
    tr.classList.add('pending');
  } else {
    setTrans(tr, translated, toLang);
    tr.classList.add('write');
    $('.speed', el).textContent = `· ${(ms / 1000).toFixed(1)}s`;
    if (b64) {
      const r = document.createElement('button');
      r.className = 'replay';
      r.type = 'button';
      r.textContent = '▶ Play again';
      r.addEventListener('click', () => play(b64));
      $('header', el).append(r);
    }
  }
  $('#log').append(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function setTrans(tr, translated, toLang) {
  tr.classList.remove('pending');
  tr.textContent = translated;
  tr.lang = LANG[toLang]?.cls ?? '';
  tr.className = `trans ${LANG[toLang]?.cls ?? ''}`;
}

function fillMine(id, translated, toLang, ms) {
  const el = $(`.card[data-id="${id}"]`);
  if (!el) return;
  const tr = $('.trans', el);
  setTrans(tr, translated, toLang);
  tr.classList.add('write');
  $('.who', el).textContent = `You → they heard ${LANG[toLang]?.name ?? toLang}`;
  $('.speed', el).textContent = `· ${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------- call: talking
const talk = holdToTalk($('#talk'), {
  canStart: () => !call.busy && call.peers.length > 1,
  onStart: () => setStatus('Listening… let go to send', 'busy'),
  onTooShort: () => setStatus('Hold the button while you speak.', 'err'),
  onClip: (wav) => {
    call.busy = true;
    $('#talk').classList.add('work');
    call.ws.send(wav);
    setStatus('Sending…', 'busy');
  },
});
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && !$('#call').hidden && document.activeElement?.tagName !== 'INPUT') talk.down(e);
});
addEventListener('keyup', (e) => e.code === 'Space' && talk.up());

$('#leave').addEventListener('click', goHome);

// ---------------------------------------------------------------- invite
function openInvite() {
  const url = inviteUrl();
  $('#qr').src = `/api/qr?text=${encodeURIComponent(url)}`;
  $('#inviteCode').textContent = call.room;
  const msg = `Let's talk on Bhasha Bridge. I'll speak ${LANG[call.lang].name}, you'll hear it in your language. Tap to join: ${url}`;
  $('#waShare').href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  $('#moreShare').hidden = !navigator.share;
  $('#moreShare').onclick = () => navigator.share({ title: 'Bhasha Bridge', text: msg, url }).catch(() => {});
  $('#invite').showModal();
}
$('#inviteBtn').addEventListener('click', openInvite);
$('#copyLink').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(inviteUrl());
    toast('Link copied');
  } catch {
    toast(inviteUrl());
  }
});
$('#invite').addEventListener('click', (e) => {
  if (e.target === $('#invite')) $('#invite').close(); // tap outside
});

// ---------------------------------------------------------------- start
const params = new URLSearchParams(location.search);
if (params.get('room')) {
  const l = { kn: 'kn-IN', hi: 'hi-IN' }[params.get('l')] ?? null;
  openSetup({ room: params.get('room'), from: params.get('from'), lang: l });
}
