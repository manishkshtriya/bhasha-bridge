// Records the mic while the talk button is held and returns a 16 kHz mono WAV, the format
// Gnani Prisma takes directly (max 30 s). Works the same on iPhone Safari and Chrome.

const TARGET_RATE = 16000;

export class Recorder {
  async open() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.recording = false;
    this.level = 0;
    this.node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < data.length; i += 8) sum += data[i] * data[i];
      this.level = Math.min(1, Math.sqrt(sum / (data.length / 8)) * 4);
      if (this.recording) this.chunks.push(new Float32Array(data));
    };
    this.source.connect(this.node);
    this.node.connect(this.ctx.destination); // needed for the processor to run; it outputs silence
  }

  start() {
    void this.ctx.resume();
    this.chunks = [];
    this.recording = true;
    this.startedAt = performance.now();
  }

  /** Stop and return { wav: ArrayBuffer, seconds }. */
  stop() {
    this.recording = false;
    const length = this.chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(length);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    const pcm = downsample(all, this.ctx.sampleRate, TARGET_RATE);
    return { wav: encodeWav(pcm, TARGET_RATE), seconds: pcm.length / TARGET_RATE };
  }
}

export function downsample(input, from, to) {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // average the samples that fall in this output slot (a simple low-pass)
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}
