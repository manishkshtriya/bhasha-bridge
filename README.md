# Bhasha Bridge

**ನೀವು ಕನ್ನಡದಲ್ಲಿ ಮಾತಾಡಿ ⟶ वो हिन्दी में सुनें**

A live call translator for India. Two people who don't share a language join the same room. Each one holds a button and speaks in their own language, and the other person hears it in theirs, spoken in a natural Indian voice.

## The problem

A Kannada-speaking auto driver and a Hindi-speaking passenger, a Bengaluru shop owner and a customer from Bihar, a grandmother in Mysuru and her new relatives in Lucknow: millions of conversations in India break down every day because two people don't share a language. Text translation apps make people type and read in the middle of a conversation. Bhasha Bridge lets them just talk.

## How it works

```
 Speaker (Kannada)                         Server                                 Listener (Hindi)
 ─────────────────                         ──────                                 ────────────────
 hold to talk → 16 kHz WAV ──WebSocket──▶  Gnani Prisma v3.0  (speech → Kannada text)
                                           translate          (Kannada → Hindi text)
                                           Gnani Timbre v2.5  (Hindi text → voice)  ──WebSocket──▶  plays Hindi voice
 sees what it heard + what they heard ◀──                                                          + sees both lines
```

1. The browser records only while the talk button is held, downsamples to 16 kHz mono WAV and sends it over a WebSocket.
2. **Gnani Prisma v3.0** (`POST /stt/v3`) turns the clip into text in the speaker's language (`kn-IN` or `hi-IN`).
3. The text is translated into each listener's language. Gnani does not offer a translation API, so this one text step uses Gemini with a prompt tuned for natural spoken phrasing rather than formal written language.
4. **Gnani Timbre v2.5** (`POST /api/v1/tts/inference`) speaks the translation with a native voice: Kavin / Saanvi for Kannada, Deepak / Nalini for Hindi. Each person picks the voice the others will hear them in.
5. Everyone in the room sees the original line and the translation, with how long the round trip took.

A room holds up to 4 people. If a room has both Kannada and Hindi listeners, each language is translated and voiced in parallel.

## Run it

Needs Node 20 or newer.

```bash
cd server
cp .env.example .env      # add GNANI_KEY and GEMINI_KEY
npm install
npm start                 # http://localhost:5000
```

Open the page on two phones (or two browser windows), start a call on one, and join with the room code or the Invite link on the other. Microphone access needs `https` or `localhost`.

Tests (no keys needed, Gnani and translation are stubbed):

```bash
npm test
```

## Deploy

`render.yaml` deploys the server as a Render web service. Create a Blueprint from this repo and set `GNANI_KEY` and `GEMINI_KEY` when asked.

## Project layout

```
server/
  server.js          HTTP + WebSocket rooms, the speak → hear pipeline
  lib/gnani.js       Gnani Prisma (STT) and Timbre (TTS) clients
  lib/translate.js   spoken-style translation step
  lib/rooms.js       room membership, grouping listeners by language
  public/            the web app (no build step)
  test/              node:test suite
```

## What's next

- More Indian languages: adding one is a new entry in the language and voice table in `lib/gnani.js`.
- Streaming STT so translation starts while the person is still talking.
- A phone-call bridge, so one side can be on a regular phone call.

Built by Manish M P.
