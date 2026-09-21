export interface SttSession {
  stop: () => void;
}

interface BrowserSttOptions {
  onInterimTranscript: (text: string) => void;
  onFinalTranscript: (text: string) => void;
  onError?: (err: string) => void;
}

export function startBrowserSttSession(
  _stream: MediaStream,
  { onInterimTranscript, onFinalTranscript, onError }: BrowserSttOptions
): SttSession {
  const SR = (window as unknown as { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;

  if (!SR) {
    onError?.("SpeechRecognition is not supported in this browser. Use Chrome or Edge.");
    return { stop: () => {} };
  }

  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";

  let accumulated = "";
  let stopped = false;

  rec.onresult = (event: SpeechRecognitionEvent) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        accumulated += result[0].transcript;
        onFinalTranscript(accumulated);
      } else {
        interim += result[0].transcript;
        onInterimTranscript(accumulated + interim);
      }
    }
  };

  rec.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (stopped) return;
    if (event.error === "no-speech" || event.error === "aborted") return;
    onError?.(`Speech recognition error: ${event.error}`);
  };

  rec.start();

  function stop() {
    if (stopped) return;
    stopped = true;
    try { rec.stop(); } catch { /* already stopped */ }
  }

  return { stop };
}
