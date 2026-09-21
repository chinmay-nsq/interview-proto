import { MicVAD } from "@ricky0123/vad-web";
// Imported via Vite's asset pipeline (?url) rather than served from /public,
// because onnxruntime-web dynamically `import()`s its .mjs wasm-loader at
// runtime, and Vite's dev server refuses to let anything under /public be
// targeted by a JS import — only fetch()/addModule()-style requests are
// allowed there. These are copied into src/assets/vad/ (see that folder)
// rather than imported straight from node_modules because onnxruntime-web's
// package.json `exports` map doesn't expose its dist/ files as importable
// subpaths at all — copying them into our own source tree sidesteps that too.
import ortWasmUrl from "../assets/vad/ort-wasm-simd-threaded.wasm?url";
import ortWasmMjsUrl from "../assets/vad/ort-wasm-simd-threaded.mjs?url";

export interface TurnVadSession {
  start: () => void;
  pause: () => void;
  destroy: () => void;
}

interface CreateTurnVadOptions {
  /** The already-acquired mic stream (from getUserMedia) that STT is also using.
   * VAD reuses this instead of acquiring its own — see note below. */
  stream: MediaStream;
  /** Fires when the candidate has stopped talking (after redemptionMs of silence). */
  onSpeechEnd: () => void;
  /** Fires as soon as speech is detected — optional, for future UI feedback. */
  onSpeechStart?: () => void;
  onError?: (err: string) => void;
}

/**
 * Client-side, provider-independent end-of-turn detector (Silero VAD via
 * @ricky0123/vad-web), running entirely in the browser — no network round-trip,
 * no dependency on the STT connection. This is what decides WHEN the candidate
 * is done talking; Deepgram/browser STT is only responsible for WHAT they said.
 *
 * Model/runtime assets are served statically from /public/vad/ (see that folder
 * for what's copied from node_modules and why).
 */
export async function createTurnVad({
  stream,
  onSpeechEnd,
  onSpeechStart,
  onError,
}: CreateTurnVadOptions): Promise<TurnVadSession | null> {
  try {
    const vad = await MicVAD.new({
      // Worklet + ONNX model still come from /public — those are loaded via
      // audioWorklet.addModule()/fetch(), not a JS import, so they're not
      // subject to the restriction described above.
      baseAssetPath: "/vad/",
      model: "v5",
      startOnLoad: false,
      // By default MicVAD acquires its OWN independent mic stream via a fresh
      // getUserMedia() call — and re-acquires a new one on every resume. Running
      // that in parallel with the STT session's own persistent stream (same
      // physical device, two concurrent/repeatedly-reacquired captures) starved
      // the real STT audio pipeline in practice. Reuse the one stream instead;
      // never stop its tracks on pause since STT still needs it.
      getStream: async () => stream,
      pauseStream: async () => {},
      resumeStream: async () => stream,
      // Thinking-pause tolerance: how long the candidate can go silent mid-answer
      // before we treat the turn as actually over. This is the client-side
      // replacement for Deepgram's utterance_end_ms tuning.
      redemptionMs: 2200,
      ortConfig: (ort) => {
        // Avoids needing cross-origin-isolation (COOP/COEP) headers, which
        // multi-threaded WASM would otherwise require.
        ort.env.wasm.numThreads = 1;
        ort.env.logLevel = "error";
        ort.env.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortWasmMjsUrl };
      },
      onSpeechStart: () => onSpeechStart?.(),
      onSpeechEnd: () => onSpeechEnd(),
      onVADMisfire: () => {
        // Speech was detected but too short to count — ignore, keep listening.
      },
    });

    return {
      start: () => void vad.start(),
      pause: () => void vad.pause(),
      destroy: () => void vad.destroy(),
    };
  } catch (err) {
    onError?.((err as Error).message);
    return null;
  }
}
