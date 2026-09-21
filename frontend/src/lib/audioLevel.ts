export interface AudioLevelDetector {
  stop: () => void;
}

interface StartAudioLevelDetectorOptions {
  stream: MediaStream;
  onAboveThreshold: () => void;
  threshold?: number;
  sustainedMs?: number;
  checkIntervalMs?: number;
}

export function startAudioLevelDetector({
  stream,
  onAboveThreshold,
  threshold = 0.05,
  sustainedMs = 200,
  checkIntervalMs = 50,
}: StartAudioLevelDetectorOptions): AudioLevelDetector {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const buffer = new Float32Array(analyser.fftSize);
  let aboveSinceMs: number | null = null;
  let fired = false;

  const intervalId = setInterval(() => {
    if (fired) return;

    analyser.getFloatTimeDomainData(buffer);
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      sumSquares += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSquares / buffer.length);

    if (rms > threshold) {
      if (aboveSinceMs === null) {
        aboveSinceMs = Date.now();
      } else if (Date.now() - aboveSinceMs >= sustainedMs) {
        fired = true;
        onAboveThreshold();
      }
    } else {
      aboveSinceMs = null;
    }
  }, checkIntervalMs);

  return {
    stop: () => {
      clearInterval(intervalId);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close();
    },
  };
}
