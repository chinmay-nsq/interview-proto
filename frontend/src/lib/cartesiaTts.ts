export interface TtsStreamHandlers {
  onAudioChunk: (chunk: ArrayBuffer) => void;
  onDone: () => void;
  onError?: (err: string) => void;
}

export interface TtsStream {
  stop: () => void;
}

const CARTESIA_VERSION = "2025-11-04";
export const TTS_SAMPLE_RATE = 24000;

// "Skylar - Friendly Guide" — approachable American female, warm and natural for
// customer-facing/interview-style conversation (chosen over the more clipped
// "Decisive Agent" default for a more human-like tone).
const DEFAULT_VOICE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";
const FALLBACK_MODEL = "sonic-2";
const PRIMARY_MODEL = "sonic-3.5";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Streams TTS audio for `text` over Cartesia's WebSocket, delivering PCM16
 * chunks progressively via onAudioChunk (matches deepgramTts.ts's interface).
 */
export function streamSpeech(
  token: string,
  text: string,
  { onAudioChunk, onDone, onError }: TtsStreamHandlers,
  voiceId: string = DEFAULT_VOICE_ID
): TtsStream {
  const params = new URLSearchParams({
    cartesia_version: CARTESIA_VERSION,
    access_token: token,
  });

  const ws = new WebSocket(`wss://api.cartesia.ai/tts/websocket?${params}`);
  let usedFallback = false;

  function sendRequest(model: string) {
    ws.send(
      JSON.stringify({
        model_id: model,
        transcript: text,
        voice: { mode: "id", id: voiceId },
        output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: TTS_SAMPLE_RATE },
        context_id: `ctx-${Date.now()}`,
        language: "en",
      })
    );
  }

  ws.onopen = () => sendRequest(PRIMARY_MODEL);

  ws.onmessage = (event) => {
    let msg: { type: string; data?: string; done?: boolean; error_code?: string; message?: string };
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    if (msg.type === "chunk" && msg.data) {
      onAudioChunk(base64ToArrayBuffer(msg.data));
    } else if (msg.type === "done") {
      ws.close();
    } else if (msg.type === "error") {
      // sonic-3.5 unavailable on this key — retry once with sonic-2.
      if (!usedFallback && /model/i.test(msg.message ?? "")) {
        usedFallback = true;
        sendRequest(FALLBACK_MODEL);
        return;
      }
      onError?.(`Cartesia TTS error: ${msg.message ?? msg.error_code ?? "unknown"}`);
      ws.close();
    }
  };

  ws.onerror = (e) => {
    console.error("[TTS] Cartesia WebSocket error", e);
    onError?.("Cartesia TTS WebSocket error");
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
