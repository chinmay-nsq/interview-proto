// Priority-ordered list of voices known to sound natural/female across platforms.
// Chrome/Edge on Windows: Microsoft Aria, Zira, Hazel, Jenny, Sonia
// Chrome on Mac: Samantha, Karen, Moira, Tessa, Victoria
// Chrome on Linux: Google UK English Female, Google US English
const PREFERRED_VOICES = [
  "microsoft aria online (natural)",
  "microsoft jenny online (natural)",
  "microsoft sonia online (natural)",
  "google uk english female",
  "samantha",
  "karen",
  "moira",
  "tessa",
  "victoria",
  "aria",
  "jenny",
  "sonia",
  "zira",
  "hazel",
  "susan",
  "allison",
  "ava",
  "kate",
  "emily",
  "emma",
  "alice",
  "female",
  "woman",
];

function getBestVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  const enVoices = voices.filter((v) => v.lang.startsWith("en"));
  if (!enVoices.length) return voices[0] ?? null;

  for (const keyword of PREFERRED_VOICES) {
    const match = enVoices.find((v) => v.name.toLowerCase().includes(keyword));
    if (match) return match;
  }
  return enVoices[0];
}

function waitForVoices(): Promise<void> {
  return new Promise((resolve) => {
    if (speechSynthesis.getVoices().length > 0) { resolve(); return; }
    speechSynthesis.onvoiceschanged = () => {
      speechSynthesis.onvoiceschanged = null;
      resolve();
    };
    // Fallback — some browsers never fire the event
    setTimeout(resolve, 1200);
  });
}

export async function browserSpeak(text: string, onStart?: () => void): Promise<void> {
  if (!("speechSynthesis" in window)) {
    onStart?.();
    return;
  }

  speechSynthesis.cancel();

  await waitForVoices();

  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);

    const voice = getBestVoice();
    if (voice) utter.voice = voice;

    // Natural cadence: slightly slower than default, gentle pitch lift
    utter.rate = 0.92;
    utter.pitch = 1.08;
    utter.volume = 1;

    utter.onstart = () => onStart?.();

    speechSynthesis.speak(utter);

    // Chrome bug: if the tab goes hidden, synthesis can pause indefinitely.
    // Resume it every 10s as a safeguard.
    const resumeTimer = setInterval(() => {
      if (speechSynthesis.paused) speechSynthesis.resume();
    }, 10_000);

    utter.onend = () => { clearInterval(resumeTimer); resolve(); };
    utter.onerror = () => { clearInterval(resumeTimer); resolve(); };
  });
}

export function browserSpeakStop() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
