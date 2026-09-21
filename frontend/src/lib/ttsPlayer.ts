export interface TtsPlayer {
  /** Decodes and schedules one PCM16 chunk for playback, starting as early as possible. */
  playChunk: (pcmChunk: ArrayBuffer) => void;
  /** Resolves once all scheduled chunks have finished playing. */
  finish: () => Promise<void>;
  stop: () => void;
}

export function createTtsPlayer(sampleRate = 24000): TtsPlayer {
  const audioContext = new AudioContext();
  let nextStartTime = 0;
  let sources: AudioBufferSourceNode[] = [];
  let leftoverByte: number | null = null;

  function toAudioBuffer(chunk: ArrayBuffer): AudioBuffer {
    let bytes = new Uint8Array(chunk);

    // PCM16 chunks must have an even byte length; if a previous chunk left a
    // stray trailing byte, stitch it onto the front of this one.
    if (leftoverByte !== null) {
      const stitched = new Uint8Array(bytes.length + 1);
      stitched[0] = leftoverByte;
      stitched.set(bytes, 1);
      bytes = stitched;
      leftoverByte = null;
    }
    if (bytes.length % 2 !== 0) {
      leftoverByte = bytes[bytes.length - 1];
      bytes = bytes.slice(0, bytes.length - 1);
    }

    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const buffer = audioContext.createBuffer(1, float32.length, sampleRate);
    buffer.copyToChannel(float32, 0);
    return buffer;
  }

  function playChunk(chunk: ArrayBuffer) {
    if (chunk.byteLength < 2 && leftoverByte === null) return;
    const buffer = toAudioBuffer(chunk);
    if (buffer.length === 0) return;

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    const startAt = Math.max(audioContext.currentTime, nextStartTime);
    source.start(startAt);
    nextStartTime = startAt + buffer.duration;

    sources.push(source);
    source.onended = () => {
      sources = sources.filter((s) => s !== source);
    };
  }

  function finish(): Promise<void> {
    const remainingMs = Math.max(0, (nextStartTime - audioContext.currentTime) * 1000);
    return new Promise((resolve) => setTimeout(resolve, remainingMs + 30));
  }

  function stop() {
    sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    });
    sources = [];
    nextStartTime = 0;
    leftoverByte = null;
  }

  return { playChunk, finish, stop };
}
