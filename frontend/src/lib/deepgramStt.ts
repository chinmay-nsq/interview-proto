export interface SttSession {
  finalize?: () => void;
  stop: () => void;
}

interface StartSttSessionOptions {
  token: string;
  onInterimTranscript: (text: string) => void;
  onFinalTranscript: (text: string) => void;
  onError?: (err: string) => void;
}

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
}

interface DeepgramResultsMessage {
  type: "Results";
  is_final?: boolean;
  channel?: { alternatives?: { transcript?: string; words?: DeepgramWord[] }[] };
}

type DeepgramMessage = DeepgramResultsMessage | { type: string };

/**
 * Pure transcription client — streams mic audio to Deepgram, reports interim/
 * final text. End-of-turn detection is NOT this module's job; that's handled
 * client-side by lib/vad.ts (Silero VAD), which is faster and doesn't depend
 * on this connection staying healthy. See vad.ts for why.
 */
export function startSttSession(
  stream: MediaStream,
  { token, onInterimTranscript, onFinalTranscript, onError }: StartSttSessionOptions
): SttSession {
  const params = new URLSearchParams({
    model: "nova-3",
    encoding: "linear16",
    sample_rate: "16000",
    interim_results: "true",
    smart_format: "true",
    language: "en",
  });

  // Browsers can't set an Authorization header on a WebSocket handshake — Deepgram
  // accepts the token via the Sec-WebSocket-Protocol subprotocol instead. Short-lived
  // JWTs (from /v1/auth/grant) must use the "Bearer" subprotocol — "token" is only
  // for permanent API keys and returns 401 Invalid credentials for a JWT.
  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["Bearer", token]);

  let accumulatedFinal = "";

  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (e) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const float32 = e.inputBuffer.getChannelData(0);
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
    }
    ws.send(int16.buffer);
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  ws.onopen = () => {
    console.log("[STT] WebSocket open");
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as DeepgramMessage;

      if (msg.type === "Results") {
        const results = msg as DeepgramResultsMessage;
        const text = results.channel?.alternatives?.[0]?.transcript ?? "";

        if (results.is_final) {
          if (text) accumulatedFinal += (accumulatedFinal ? " " : "") + text;
          onFinalTranscript(accumulatedFinal);
        } else if (text) {
          onInterimTranscript(accumulatedFinal + (accumulatedFinal ? " " : "") + text);
        } else {
          onInterimTranscript(accumulatedFinal);
        }
      }
    } catch {
      // non-JSON binary frame — ignore
    }
  };

  ws.onerror = (e) => {
    console.error("[STT] WebSocket error", e);
    onError?.("Deepgram STT WebSocket error");
  };

  ws.onclose = (e) => {
    console.log("[STT] WebSocket closed", e.code, e.reason);
    teardown();
  };

  let tornDown = false;
  function teardown() {
    if (tornDown) return;
    tornDown = true;
    processor.disconnect();
    source.disconnect();
    if (audioContext.state !== "closed") void audioContext.close();
  }

  function finalize() {
    console.log("[STT] manual finalize called");
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "Finalize" }));
    }
  }

  function stop() {
    teardown();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "CloseStream" }));
      ws.close();
    } else if (ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }

  return { finalize, stop };
}
