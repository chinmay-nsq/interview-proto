export interface TtsStreamHandlers {
  onAudioChunk: (chunk: ArrayBuffer) => void;
  onDone: () => void;
  onError?: (err: string) => void;
}

export interface TtsStream {
  stop: () => void;
}

// "Natural, Expressive, Patient, Empathetic" — Deepgram explicitly tags this one
// for interview-style conversation, warmer and less flat than the default.
const DEFAULT_VOICE = "aura-2-vesta-en";
export const TTS_SAMPLE_RATE = 24000;

/**
 * Streams TTS audio for `text` over a Deepgram WebSocket, delivering PCM16
 * chunks progressively via onAudioChunk (instead of waiting for the full clip).
 */
export function streamSpeech(
  token: string,
  text: string,
  { onAudioChunk, onDone, onError }: TtsStreamHandlers,
  voice: string = DEFAULT_VOICE
): TtsStream {
  const params = new URLSearchParams({
    model: voice,
    encoding: "linear16",
    sample_rate: String(TTS_SAMPLE_RATE),
  });

  // Short-lived JWTs (from /v1/auth/grant) use the "Bearer" subprotocol, not "token"
  // (which is for permanent API keys and returns 401 Invalid credentials for a JWT).
  const ws = new WebSocket(`wss://api.deepgram.com/v1/speak?${params}`, ["Bearer", token]);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "Speak", text }));
    ws.send(JSON.stringify({ type: "Flush" }));
  };

  ws.onmessage = (event) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data) as { type: string };
        if (msg.type === "Flushed") {
          ws.send(JSON.stringify({ type: "Close" }));
        }
      } catch {
        // ignore malformed control message
      }
    } else {
      onAudioChunk(event.data as ArrayBuffer);
    }
  };

  ws.onerror = (e) => {
    console.error("[TTS] WebSocket error", e);
    onError?.("Deepgram TTS WebSocket error");
  };

  ws.onclose = () => onDone();

  return {
    stop: () => {
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
  };
}
