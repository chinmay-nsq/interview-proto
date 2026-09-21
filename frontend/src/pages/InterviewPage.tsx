import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useSpring, useTransform, Reorder } from "motion/react";
import { toast } from "sonner";
import { Video, MessageSquare, Check, CameraOff } from "lucide-react";
import { api } from "@/lib/api";
import { startSttSession, type SttSession } from "@/lib/deepgramStt";
import { startBrowserSttSession } from "@/lib/browserStt";
import { streamSpeech, TTS_SAMPLE_RATE } from "@/lib/cartesiaTts";
import { browserSpeak, browserSpeakStop } from "@/lib/browserTts";
import { createTtsPlayer, type TtsPlayer } from "@/lib/ttsPlayer";
import { connectInterviewMqtt, type InterviewMqttSession } from "@/lib/mqttClient";
import { createTurnVad, type TurnVadSession } from "@/lib/vad";
import type { TranscriptTurn, TurnMessage } from "@/lib/types";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "asking" | "listening" | "processing" | "done";
type Engine = "deepgram" | "browser";
type LayoutMode = "call" | "chat";
type TileId = "ai" | "camera";

interface ChatMessage {
  role: "interviewer" | "candidate";
  text: string;
  isReaction?: boolean;
}

/* ── Waveform bars shown while AI is speaking (compact, in the transcript) ── */
function SpeakingWave() {
  const bars = [0.4, 0.9, 0.6, 1, 0.7, 0.85, 0.5];
  return (
    <div className="flex items-center gap-0.75 h-5 px-0.5">
      {bars.map((base, i) => (
        <motion.span
          key={i}
          className="w-0.75 rounded-full bg-muted-foreground/50"
          animate={{ scaleY: [base * 0.4, base, base * 0.5, base * 0.9, base * 0.4] }}
          transition={{
            duration: 1.1 + i * 0.07,
            delay: i * 0.08,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          style={{ height: "18px", transformOrigin: "center" }}
        />
      ))}
    </div>
  );
}

/* ── Ripple rings shown behind the Done control while listening ────────── */
function MicRipple() {
  return (
    <span className="absolute inset-0 rounded-full pointer-events-none">
      {[0, 0.5, 1].map((delay) => (
        <motion.span
          key={delay}
          className="absolute inset-0 rounded-full border border-primary/25"
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.9, opacity: 0 }}
          transition={{ duration: 1.8, delay, repeat: Infinity, ease: "easeOut" }}
        />
      ))}
    </span>
  );
}

/* ── AI "presence" tile — deliberately no character/photo. Just an abstract ─
   gradient orb that breathes/pulses while the AI is speaking, so the left
   side of the call reads as "someone is there and talking" without any
   illustrated avatar. ────────────────────────────────────────────────────── */
function AiPresenceTile({ phase }: { phase: Phase }) {
  const isAsking = phase === "asking";
  const isListening = phase === "listening";
  return (
    <div className="relative flex-1 min-w-0 rounded-3xl border border-border bg-card overflow-hidden flex items-center justify-center">
      <div className="absolute inset-0 bg-linear-to-br from-primary/6 via-transparent to-transparent" />

      <AnimatePresence>
        {isAsking &&
          [0, 0.5, 1].map((delay) => (
            <motion.span
              key={delay}
              className="absolute rounded-full border border-primary/25"
              style={{ width: 160, height: 160 }}
              initial={{ scale: 0.8, opacity: 0.55 }}
              animate={{ scale: 2, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2.4, delay, repeat: Infinity, ease: "easeOut" }}
            />
          ))}
      </AnimatePresence>

      <motion.div
        className="relative size-36 sm:size-44 rounded-full"
        style={{ background: "linear-gradient(135deg, var(--gradient-from), var(--gradient-to))" }}
        animate={
          isAsking
            ? { scale: [1, 1.07, 1], opacity: 1 }
            : { scale: 1, opacity: isListening ? 0.55 : 0.8 }
        }
        transition={{ duration: 1.7, repeat: isAsking ? Infinity : 0, ease: "easeInOut" }}
      />

      <div className="absolute bottom-5 left-5 flex items-center gap-2">
        <PhaseDot phase={phase} tone="on-tile" />
        <span className="text-sm font-medium text-foreground/80">Interviewer</span>
      </div>
    </div>
  );
}

/* ── Candidate's own camera — live local preview only. The stream is never
   recorded, saved, or sent anywhere; it's bound straight to a <video> element
   client-side and torn down (tracks stopped) when the interview ends. ────── */
function CameraTile({
  videoRef,
  hasVideo,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  hasVideo: boolean;
}) {
  return (
    <div className="relative flex-1 min-w-0 rounded-3xl border border-border bg-muted overflow-hidden flex items-center justify-center">
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
        />
      ) : (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <CameraOff className="size-8" strokeWidth={1.5} />
          <span className="text-sm">Camera unavailable</span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-black/45 to-transparent pointer-events-none" />
      <span className="absolute bottom-5 left-5 text-sm font-medium text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
        You
      </span>
    </div>
  );
}

/* ── Animated dot that signals a phase ─────────────────────────────────── */
function PhaseDot({ phase, tone = "default" }: { phase: Phase; tone?: "default" | "on-tile" }) {
  const idleClass = tone === "on-tile" ? "border-foreground/25 border-t-foreground/70" : "border-muted-foreground/20 border-t-muted-foreground";
  const barClass = tone === "on-tile" ? "bg-foreground/70" : "bg-muted-foreground";
  return (
    <AnimatePresence mode="wait">
      {phase === "listening" && (
        <motion.span
          key="listening"
          className="size-1.5 rounded-full bg-primary"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
        />
      )}
      {phase === "processing" && (
        <motion.span
          key="processing"
          className={`size-3.5 rounded-full border-[1.5px] ${idleClass}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, rotate: 360 }}
          exit={{ opacity: 0 }}
          transition={{ rotate: { duration: 0.8, repeat: Infinity, ease: "linear" }, opacity: { duration: 0.2 } }}
        />
      )}
      {phase === "asking" && (
        <motion.div
          key="asking"
          className="flex gap-0.75 items-end h-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className={`w-0.5 rounded-full ${barClass}`}
              animate={{ height: ["4px", "10px", "4px"] }}
              transition={{ duration: 0.7, delay: i * 0.15, repeat: Infinity, ease: "easeInOut" }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Animated caption text that types in word by word ──────────────────── */
function LiveCaptionText({ text }: { text: string }) {
  const spring = useSpring(0, { stiffness: 200, damping: 30 });
  const opacity = useTransform(spring, [0, 1], [0.5, 1]);

  useEffect(() => {
    spring.set(0);
    requestAnimationFrame(() => spring.set(1));
  }, [text, spring]);

  if (!text) return <p className="text-sm text-muted-foreground">Listening… start speaking</p>;
  return (
    <motion.p className="text-sm text-foreground leading-relaxed" style={{ opacity }}>
      {text}
    </motion.p>
  );
}

/* ── Shared transcript content (message bubbles + speaking/processing rows) ─
   Both layouts (call/chat) render this inside their own scroll container. ── */
function TranscriptMessages({
  messages,
  isAsking,
  isProcessing,
}: {
  messages: ChatMessage[];
  isAsking: boolean;
  isProcessing: boolean;
}) {
  return (
    <>
      <AnimatePresence initial={false}>
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.8 }}
            className={`flex ${msg.role === "candidate" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "interviewer" && !msg.isReaction && (
              <div className="flex gap-2.5 max-w-[90%]">
                <motion.div
                  className="size-7 rounded-full bg-primary shrink-0 flex items-center justify-center mt-0.5"
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 28, delay: 0.05 }}
                >
                  <span className="text-[10px] font-semibold text-primary-foreground leading-none">AI</span>
                </motion.div>
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1 font-medium tracking-wide">Interviewer</p>
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed text-foreground">
                    {msg.text}
                  </div>
                </div>
              </div>
            )}

            {msg.isReaction && (
              <div className="flex gap-2.5 max-w-[90%]">
                <div className="size-7 rounded-full bg-primary shrink-0 flex items-center justify-center mt-0.5">
                  <span className="text-[10px] font-semibold text-primary-foreground leading-none">AI</span>
                </div>
                <div className="rounded-2xl rounded-tl-sm border border-border px-4 py-2.5 text-sm leading-relaxed text-muted-foreground italic">
                  {msg.text}
                </div>
              </div>
            )}

            {msg.role === "candidate" && (
              <div className="max-w-[90%]">
                <p className="text-[11px] text-muted-foreground mb-1 font-medium tracking-wide text-right">You</p>
                <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed">
                  {msg.text}
                </div>
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {isAsking && (
          <motion.div
            key="speaking"
            className="flex gap-2.5"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <div className="size-7 rounded-full bg-primary shrink-0 flex items-center justify-center">
              <span className="text-[10px] font-semibold text-primary-foreground leading-none">AI</span>
            </div>
            <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center">
              <SpeakingWave />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isProcessing && (
          <motion.div
            key="processing"
            className="flex gap-2.5"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="size-7 rounded-full bg-foreground/10 border border-border shrink-0 flex items-center justify-center">
              <motion.span
                className="size-3.5 rounded-full border-[1.5px] border-muted-foreground/30 border-t-muted-foreground"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
              />
            </div>
            <div className="bg-muted/50 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center">
              <span className="text-sm text-muted-foreground">Thinking…</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ── Done control — a compact icon button, not a big centered stack. Two
   placements depending on layout: floating over the call stage, or inline
   at the end of the caption row in chat mode. ──────────────────────────── */
function DoneButton({ onDone, size = 44 }: { onDone: () => void; size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <MicRipple />
      <Button
        onClick={onDone}
        size="icon"
        className="relative rounded-full size-full"
        aria-label="Done — submit answer now"
      >
        <Check className="size-4.5" strokeWidth={2.5} />
      </Button>
    </div>
  );
}

export default function InterviewPage() {
  const { interviewId } = useParams<{ interviewId: string }>();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [liveCaption, setLiveCaption] = useState("");
  const [engine, setEngine] = useState<Engine>("deepgram");
  const [hasVideo, setHasVideo] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("call");
  const [tileOrder, setTileOrder] = useState<TileId[]>(["ai", "camera"]);

  const engineRef = useRef<Engine>("deepgram");
  const micStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ttsPlayerRef = useRef<TtsPlayer | null>(null);
  const sttSessionRef = useRef<SttSession | null>(null);
  const turnVadRef = useRef<TurnVadSession | null>(null);
  const mqttSessionRef = useRef<InterviewMqttSession | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const accumulatedRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const submitAnswerRef = useRef<(text: string) => void>(() => {});
  const handleTurnRef = useRef<(turn: TurnMessage) => void>(() => {});

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { engineRef.current = engine; }, [engine]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, liveCaption]);

  // Runs after the <video> element actually mounts (it's conditionally
  // rendered on hasVideo), which is why this can't just happen inline where
  // hasVideo gets set — the ref would still be null at that point.
  useEffect(() => {
    if (hasVideo && videoRef.current && micStreamRef.current) {
      videoRef.current.srcObject = micStreamRef.current;
    }
  }, [hasVideo]);

  const stopStt = useCallback(() => {
    sttSessionRef.current?.stop();
    sttSessionRef.current = null;
  }, []);

  const pauseTurnVad = useCallback(() => {
    turnVadRef.current?.pause();
  }, []);

  const stopTts = useCallback(() => {
    if (engineRef.current === "browser") browserSpeakStop();
    else ttsPlayerRef.current?.stop();
  }, []);

  // `speechText` is what's spoken (may include a reaction/transition prefix);
  // `displayText` is what shows up in the chat bubble. The bubble is deliberately
  // NOT shown until audio actually starts playing — showing it earlier (e.g. as
  // soon as the turn arrives) means the candidate reads the question well before
  // they hear it, since minting a TTS token + starting synthesis takes real time.
  const speakAndListen = useCallback(async (speechText: string, displayText: string) => {
    setPhase("asking");
    let shown = false;
    const showText = () => {
      if (shown) return;
      shown = true;
      setMessages((prev) => [...prev, { role: "interviewer", text: displayText }]);
    };

    if (engineRef.current === "browser") {
      try { await browserSpeak(speechText, showText); } catch { /* ignore */ }
      finally { showText(); }
    } else {
      try {
        const { token } = await api.getCartesiaToken();
        await new Promise<void>((resolve) => {
          streamSpeech(token, speechText, {
            onAudioChunk: (chunk) => {
              showText();
              ttsPlayerRef.current!.playChunk(chunk);
            },
            onDone: async () => {
              showText();
              await ttsPlayerRef.current!.finish();
              resolve();
            },
            onError: () => {
              showText();
              toast.error("TTS failed — read the question above.");
              resolve();
            },
          });
        });
      } catch {
        showText();
        toast.error("TTS failed — read the question above.");
      }
    }
    enterListening();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTurn = useCallback((turn: TurnMessage) => {
    if (turn.status === "completed" || !turn.nextQuestion) {
      const closing = turn.reaction || "That wraps up our interview. Well done!";
      void speakAndListen(closing, closing);
      setPhase("done");
      return;
    }

    // Speak the transition/reaction and the next question as one continuous
    // utterance (matches the ported prompt's intent: ack + closure + bridge
    // flow directly into the next question) — the reaction itself isn't
    // shown as a separate text bubble, only heard; the bubble shows just the
    // next question, and only once its audio actually starts.
    const toSpeak = turn.reaction ? `${turn.reaction} ${turn.nextQuestion}` : turn.nextQuestion!;
    void speakAndListen(toSpeak, turn.nextQuestion!);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakAndListen]);

  useEffect(() => { handleTurnRef.current = handleTurn; }, [handleTurn]);

  const submitAnswer = useCallback((answerText: string) => {
    const trimmed = answerText.trim();
    if (!trimmed) {
      toast.error("No answer captured — speak first, then click Done.");
      return;
    }
    setMessages((prev) => [...prev, { role: "candidate", text: trimmed }]);
    setLiveCaption("");
    setPhase("processing");

    if (!mqttSessionRef.current) {
      toast.error("Not connected — cannot submit answer.");
      setPhase("listening");
      return;
    }
    mqttSessionRef.current.publishAnswer(trimmed);
  }, []);

  useEffect(() => { submitAnswerRef.current = submitAnswer; }, [submitAnswer]);

  const enterListening = useCallback(async () => {
    if (phaseRef.current === "processing" || phaseRef.current === "done") return;

    accumulatedRef.current = "";
    setLiveCaption("");
    setPhase("listening");
    stopStt();

    const stream = micStreamRef.current;
    if (!stream) return;

    const cbs = {
      onInterimTranscript: (text: string) => { accumulatedRef.current = text; setLiveCaption(text); },
      onFinalTranscript: (text: string) => { accumulatedRef.current = text; setLiveCaption(text); },
      onError: (err: string) => toast.error(`STT: ${err}`),
    };

    if (engineRef.current === "browser") {
      sttSessionRef.current = startBrowserSttSession(stream, cbs);
    } else {
      try {
        const { access_token } = await api.getDeepgramToken();
        sttSessionRef.current = startSttSession(stream, { token: access_token, ...cbs });
      } catch {
        toast.error("Failed to get STT token");
      }
    }

    // End-of-turn is decided by the client-side VAD (provider-independent —
    // works the same regardless of which STT engine transcribed the audio).
    turnVadRef.current?.start();
  }, [stopStt]);

  const handleDone = useCallback(() => {
    if (phaseRef.current !== "listening") return;
    stopStt();
    pauseTurnVad();
    submitAnswerRef.current(accumulatedRef.current);
  }, [stopStt, pauseTurnVad]);

  const handleEngineToggle = useCallback((next: Engine) => {
    if (next === engineRef.current) return;
    stopStt();
    stopTts();
    setEngine(next);
    if (phaseRef.current === "listening") {
      setTimeout(() => void enterListening(), 60);
    }
  }, [stopStt, stopTts, enterListening]);

  useEffect(() => {
    if (!interviewId) return;
    ttsPlayerRef.current = createTtsPlayer(TTS_SAMPLE_RATE);
    setMessages([]);
    let cancelled = false;

    async function init() {
      // Camera is best-effort: ask for mic + camera together, but if the
      // candidate has no webcam or denies it, fall back to audio-only rather
      // than blocking the interview — the camera tile just shows "unavailable".
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: "user" },
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          toast.error("Microphone access denied.");
          return;
        }
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      micStreamRef.current = stream;
      // Local preview only — this stream is never recorded, saved, or sent to
      // any API; it's just bound to the <video> element for the candidate's
      // own eyes. Actually attaching it happens in the effect below, once the
      // <video> element has mounted (it's conditionally rendered on hasVideo,
      // so the ref isn't populated yet on this very line).
      setHasVideo(stream.getVideoTracks().length > 0);

      // Created once (model load is expensive) and started/paused per-turn via
      // enterListening/pauseTurnVad rather than recreated each turn. Reuses the
      // same mic stream as STT (see vad.ts) instead of acquiring its own.
      turnVadRef.current = await createTurnVad({
        stream: micStreamRef.current,
        onSpeechEnd: () => {
          if (phaseRef.current !== "listening") return;
          sttSessionRef.current?.finalize?.();
          stopStt();
          pauseTurnVad();
          submitAnswerRef.current(accumulatedRef.current);
        },
        onError: (err) => toast.error(`VAD: ${err} — falling back to manual "Done" button.`),
      });
      if (cancelled) { turnVadRef.current?.destroy(); return; }

      try {
        const session = await api.getInterview(interviewId!);
        if (cancelled) return;

        mqttSessionRef.current = connectInterviewMqtt(
          session.mqttUrl,
          interviewId!,
          (turn) => handleTurnRef.current(turn),
          (err) => toast.error(`Connection: ${err}`)
        );

        const firstQ =
          session.transcript.find((t: TranscriptTurn) => t.role === "interviewer")?.text
          ?? session.coreQuestions[0]
          ?? "Tell me about yourself.";
        await speakAndListen(firstQ, firstQ);
      } catch {
        toast.error("Failed to load interview session.");
      }
    }

    void init();
    return () => {
      cancelled = true;
      sttSessionRef.current?.stop();
      turnVadRef.current?.destroy();
      turnVadRef.current = null;
      ttsPlayerRef.current?.stop();
      browserSpeakStop();
      mqttSessionRef.current?.disconnect();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId]);

  const isListening = phase === "listening";
  const isAsking = phase === "asking";
  const isProcessing = phase === "processing";

  const phaseLabel = {
    idle: "Starting",
    asking: "Speaking",
    listening: "Listening",
    processing: "Processing",
    done: "Complete",
  }[phase];

  const doneScreen = (
    <motion.div
      key="done-screen"
      initial={{ opacity: 0, scale: 0.95, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      className="rounded-2xl border border-border bg-card card-shadow p-6 text-center flex flex-col items-center gap-4"
    >
      <motion.div
        className="size-12 rounded-full bg-muted flex items-center justify-center"
        initial={{ scale: 0, rotate: -30 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 22, delay: 0.1 }}
      >
        <Check className="size-5 text-foreground" strokeWidth={2.5} />
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <p className="text-base font-semibold text-foreground">Interview complete</p>
        <p className="text-sm text-muted-foreground mt-1">You answered all the questions. Great practice!</p>
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
        <Button onClick={() => navigate("/")} className="h-9 px-6 rounded-full text-sm">
          Back to roles
        </Button>
      </motion.div>
    </motion.div>
  );

  return (
    <div className="h-screen w-full bg-background flex flex-col overflow-hidden">

      {/* Nav */}
      <nav className="border-b border-border bg-background/90 backdrop-blur-xl z-10 shrink-0">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          {/* Back */}
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150 shrink-0"
          >
            <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.5 2 4.5 8l6 6" />
            </svg>
            Roles
          </button>

          {/* Phase pill */}
          <motion.div className="flex items-center gap-2 px-3 h-7 rounded-full bg-muted shrink-0" layout>
            <PhaseDot phase={phase} />
            <AnimatePresence mode="wait">
              <motion.span
                key={phaseLabel}
                className="text-xs text-muted-foreground font-medium"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
              >
                {phaseLabel}
              </motion.span>
            </AnimatePresence>
          </motion.div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Layout toggle */}
            <div className="flex items-center rounded-full border border-border bg-muted p-0.5 gap-0.5">
              <button
                onClick={() => setLayoutMode("call")}
                aria-label="Call view"
                title="Call view"
                className={`size-6 flex items-center justify-center rounded-full transition-all duration-200 ${
                  layoutMode === "call"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Video className="size-3.5" strokeWidth={2} />
              </button>
              <button
                onClick={() => setLayoutMode("chat")}
                aria-label="Chat view"
                title="Chat view"
                className={`size-6 flex items-center justify-center rounded-full transition-all duration-200 ${
                  layoutMode === "chat"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MessageSquare className="size-3.5" strokeWidth={2} />
              </button>
            </div>

            {/* Engine toggle */}
            <div className="flex items-center rounded-full border border-border bg-muted p-0.5 gap-0.5">
              {(["deepgram", "browser"] as Engine[]).map((e) => (
                <button
                  key={e}
                  onClick={() => handleEngineToggle(e)}
                  className={`px-3 h-6 rounded-full text-[11px] font-medium transition-all duration-200 capitalize ${
                    engine === e
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {e === "browser" ? "Built-in" : "Cloud"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {layoutMode === "call" ? (
        /* ══ Call layout: presence + camera tiles, transcript sidebar ══ */
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 p-4">

          {/* Call stage — tiles are drag-reorderable, Meet/Teams-style */}
          <div className="relative flex-1 min-h-0 flex flex-col sm:flex-row gap-4">
            <Reorder.Group
              as="div"
              axis="x"
              values={tileOrder}
              onReorder={setTileOrder}
              className="flex-1 min-h-0 flex flex-col sm:flex-row gap-4"
            >
              {tileOrder.map((id) => (
                <Reorder.Item
                  as="div"
                  key={id}
                  value={id}
                  whileDrag={{ scale: 1.02, zIndex: 20 }}
                  className="flex-1 min-h-0 flex cursor-grab active:cursor-grabbing"
                >
                  {id === "ai" ? (
                    <AiPresenceTile phase={phase} />
                  ) : (
                    <CameraTile videoRef={videoRef} hasVideo={hasVideo} />
                  )}
                </Reorder.Item>
              ))}
            </Reorder.Group>

            {/* Floating Done control, overlaying the bottom of the stage */}
            <AnimatePresence>
              {isListening && (
                <motion.div
                  key="done-floating"
                  className="absolute inset-x-0 bottom-5 flex justify-center pointer-events-none px-4"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ type: "spring", stiffness: 380, damping: 30, delay: 0.05 }}
                >
                  <div className="pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-2 rounded-full bg-card/95 backdrop-blur-md border border-border card-shadow-hover">
                    <span className="text-xs text-muted-foreground">Auto-submits when you stop talking</span>
                    <DoneButton onDone={handleDone} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Transcript sidebar */}
          <aside className="w-full lg:w-95 shrink-0 flex flex-col gap-4 min-h-0">
            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pb-1 scrollbar-none chat-fade-mask rounded-2xl border border-border bg-card p-4"
            >
              <TranscriptMessages messages={messages} isAsking={isAsking} isProcessing={isProcessing} />
            </div>

            <AnimatePresence>
              {isListening && (
                <motion.div
                  key="caption"
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 400, damping: 34 }}
                  className="shrink-0 rounded-2xl border border-border bg-muted/30 px-4 py-3 min-h-14 flex items-start gap-2.5"
                >
                  <motion.span
                    className="size-1.5 rounded-full bg-primary mt-1.5 shrink-0"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <LiveCaptionText text={liveCaption} />
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>{phase === "done" && doneScreen}</AnimatePresence>
          </aside>
        </div>
      ) : (
        /* ══ Chat layout: original centered single-column transcript ══ */
        <div className="flex-1 min-h-0 max-w-3xl w-full mx-auto px-6 py-6 flex flex-col gap-4">
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pb-1 scrollbar-none chat-fade-mask"
          >
            <TranscriptMessages messages={messages} isAsking={isAsking} isProcessing={isProcessing} />
          </div>

          <div className="flex flex-col gap-3 shrink-0">
            <AnimatePresence>
              {isListening && (
                <motion.div
                  key="caption"
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 400, damping: 34 }}
                  className="rounded-2xl border border-border bg-muted/30 px-4 py-3 min-h-14 flex items-center gap-3"
                >
                  <motion.span
                    className="size-1.5 rounded-full bg-primary mt-0.5 shrink-0"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <div className="flex-1 min-w-0">
                    <LiveCaptionText text={liveCaption} />
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">
                    Auto-submits when done
                  </span>
                  <DoneButton onDone={handleDone} size={38} />
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>{phase === "done" && doneScreen}</AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
