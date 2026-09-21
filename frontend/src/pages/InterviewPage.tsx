import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useSpring, useTransform } from "motion/react";
import { toast } from "sonner";
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

interface ChatMessage {
  role: "interviewer" | "candidate";
  text: string;
  isReaction?: boolean;
}

/* ── Waveform bars shown while AI is speaking ──────────────────────────── */
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

/* ── Ripple rings shown on the Done button while listening ─────────────── */
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

/* ── Animated dot that signals a phase ─────────────────────────────────── */
function PhaseDot({ phase }: { phase: Phase }) {
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
          className="size-3.5 rounded-full border-[1.5px] border-muted-foreground/20 border-t-muted-foreground"
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
              className="w-0.5 rounded-full bg-muted-foreground"
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

export default function InterviewPage() {
  const { interviewId } = useParams<{ interviewId: string }>();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [liveCaption, setLiveCaption] = useState("");
  const [engine, setEngine] = useState<Engine>("deepgram");

  const engineRef = useRef<Engine>("deepgram");
  const micStreamRef = useRef<MediaStream | null>(null);
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
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        micStreamRef.current = stream;
      } catch {
        toast.error("Microphone access denied.");
        return;
      }

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

  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* Nav */}
      <nav className="border-b border-border bg-background/90 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          {/* Back */}
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150"
          >
            <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.5 2 4.5 8l6 6" />
            </svg>
            Roles
          </button>

          {/* Phase pill */}
          <motion.div
            className="flex items-center gap-2 px-3 h-7 rounded-full bg-muted"
            layout
          >
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
      </nav>

      {/* Main */}
      <div className="flex-1 max-w-3xl w-full mx-auto px-6 pt-6 pb-8 flex flex-col gap-4">

        {/* ── Message list ── */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto flex flex-col gap-3 pb-1 scrollbar-none chat-fade-mask"
          style={{ maxHeight: "calc(100vh - 300px)" }}
        >
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 380,
                  damping: 32,
                  mass: 0.8,
                }}
                className={`flex ${msg.role === "candidate" ? "justify-end" : "justify-start"}`}
              >
                {/* Interviewer question */}
                {msg.role === "interviewer" && !msg.isReaction && (
                  <div className="flex gap-2.5 max-w-[80%]">
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

                {/* Reaction */}
                {msg.isReaction && (
                  <div className="flex gap-2.5 max-w-[80%]">
                    <div className="size-7 rounded-full bg-primary shrink-0 flex items-center justify-center mt-0.5">
                      <span className="text-[10px] font-semibold text-primary-foreground leading-none">AI</span>
                    </div>
                    <div className="rounded-2xl rounded-tl-sm border border-border px-4 py-2.5 text-sm leading-relaxed text-muted-foreground italic">
                      {msg.text}
                    </div>
                  </div>
                )}

                {/* Candidate */}
                {msg.role === "candidate" && (
                  <div className="max-w-[80%]">
                    <p className="text-[11px] text-muted-foreground mb-1 font-medium tracking-wide text-right">You</p>
                    <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed">
                      {msg.text}
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* AI speaking typing indicator */}
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

          {/* Processing indicator in chat stream */}
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
        </div>

        {/* ── Bottom controls ── */}
        <div className="flex flex-col gap-3">

          {/* Live caption box */}
          <AnimatePresence>
            {isListening && (
              <motion.div
                key="caption"
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 34 }}
                className="rounded-2xl border border-border bg-muted/30 px-4 py-3 min-h-14 flex items-start gap-2.5"
              >
                {/* Animated mic dot */}
                <motion.span
                  className="size-1.5 rounded-full bg-primary mt-1.5 shrink-0"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                />
                <LiveCaptionText text={liveCaption} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Done button with ripple */}
          <AnimatePresence>
            {isListening && (
              <motion.div
                key="done-btn"
                className="flex flex-col items-center gap-2"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ type: "spring", stiffness: 380, damping: 30, delay: 0.05 }}
              >
                <div className="relative">
                  <MicRipple />
                  <Button
                    onClick={handleDone}
                    className="relative h-11 px-8 rounded-full text-sm font-medium"
                  >
                    Done
                  </Button>
                </div>
                <motion.p
                  className="text-xs text-muted-foreground"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  We'll auto-submit when you stop speaking — or click when you're done
                </motion.p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Done screen */}
          <AnimatePresence>
            {phase === "done" && (
              <motion.div
                key="done-screen"
                initial={{ opacity: 0, scale: 0.95, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
                className="rounded-2xl border border-border bg-card card-shadow p-8 text-center flex flex-col items-center gap-4"
              >
                <motion.div
                  className="size-12 rounded-full bg-muted flex items-center justify-center"
                  initial={{ scale: 0, rotate: -30 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22, delay: 0.1 }}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="size-5 text-foreground">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                  </svg>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <p className="text-base font-semibold text-foreground">Interview complete</p>
                  <p className="text-sm text-muted-foreground mt-1">You answered all the questions. Great practice!</p>
                </motion.div>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
                  <Button
                    onClick={() => navigate("/")}
                    className="h-9 px-6 rounded-full text-sm"
                  >
                    Back to roles
                  </Button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
