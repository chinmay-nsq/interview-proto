/**
 * Load test — 10 concurrent interviews, 3 answer rounds each.
 *
 * Interview creation is still REST; answer turns now go over MQTT
 * (interview/{id}/answer published, interview/{id}/turn awaited),
 * mirroring the frontend's actual turn-taking path.
 *
 * Usage:  node load-test.mjs [base_url] [mqtt_url] [concurrency] [rounds]
 * Default: node load-test.mjs http://localhost:4000 mqtt://localhost:1883 10 3
 *
 * Requires the backend + EMQX to be running, and the `mqtt` package installed
 * (already a backend dependency — run from inside backend/).
 */

import mqtt from "mqtt";

const BASE = process.argv[2] ?? "http://localhost:4000";
const MQTT_URL = process.argv[3] ?? "mqtt://localhost:1883";
const CONCURRENCY = Number(process.argv[4] ?? 10);
const ROUNDS = Number(process.argv[5] ?? 3);

const ANSWER_TIMEOUT_MS = 30_000;

// Realistic candidate answers — varied so GPT gives different follow-ups
const SAMPLE_ANSWERS = [
  "I have about four years of experience with React and TypeScript. I've built several large-scale SPAs and I'm comfortable with hooks, context, and performance optimisation using memo and useMemo.",
  "In my last role I led the migration from a monolithic Express app to microservices on Kubernetes. We reduced p99 latency by 40 percent over three months.",
  "For SQL I rely heavily on window functions and CTEs. I once rewrote a slow report query from 8 seconds down to 200ms by replacing subqueries with a single CTE chain.",
  "My approach to debugging is to reproduce first, then bisect. I use console profiling and distributed tracing — we used Datadog APM in production.",
  "I prioritise ruthlessly. I use a mix of impact-vs-effort scoring and daily standups to keep the team aligned when priorities shift.",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function json(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`); }
}

async function getJDs() {
  const res = await fetch(`${BASE}/api/jds`);
  if (!res.ok) throw new Error(`GET /api/jds → ${res.status}`);
  return json(res);
}

async function startInterview(jdId) {
  const res = await fetch(`${BASE}/api/interviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jdId }),
  });
  if (!res.ok) throw new Error(`POST /api/interviews → ${res.status}: ${await res.text()}`);
  return json(res);
}

/** Publishes an answer over MQTT and resolves with the next turn message. */
function submitAnswerOverMqtt(client, interviewId, answerText) {
  const turnTopic = `interview/${interviewId}/turn`;
  const answerTopic = `interview/${interviewId}/answer`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.removeListener("message", onMessage);
      reject(new Error(`Timed out waiting for ${turnTopic}`));
    }, ANSWER_TIMEOUT_MS);

    function onMessage(topic, payload) {
      if (topic !== turnTopic) return;
      clearTimeout(timer);
      client.removeListener("message", onMessage);
      try {
        resolve(JSON.parse(payload.toString()));
      } catch (err) {
        reject(new Error(`Malformed turn message: ${err.message}`));
      }
    }

    client.on("message", onMessage);
    client.subscribe(turnTopic, { qos: 1 }, (err) => {
      if (err) { clearTimeout(timer); reject(err); return; }
      client.publish(answerTopic, JSON.stringify({ answerText }), { qos: 1 });
    });
  });
}

// ── Single interview worker ───────────────────────────────────────────────────

async function runInterview(id, jdId) {
  const log = (msg) => console.log(`  [interview-${String(id).padStart(2, "0")}] ${msg}`);
  const timings = [];
  const errors = [];

  const t0 = Date.now();
  const client = mqtt.connect(MQTT_URL, { clientId: `load-test-${id}-${Date.now()}` });
  await new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });

  // 1. Start
  let interviewId;
  try {
    const t = Date.now();
    const data = await startInterview(jdId);
    timings.push({ step: "start", ms: Date.now() - t });
    interviewId = data.interviewId;
    log(`started  (${timings[0].ms}ms) — first Q: "${data.firstQuestion?.slice(0, 60)}…"`);
  } catch (err) {
    errors.push(`start: ${err.message}`);
    log(`FAILED to start — ${err.message}`);
    client.end(true);
    return { id, timings, errors, totalMs: Date.now() - t0, completed: false };
  }

  // 2. Answer rounds
  let round = 0;
  let done = false;
  while (round < ROUNDS && !done) {
    round++;
    const answer = pick(SAMPLE_ANSWERS);
    try {
      const t = Date.now();
      const data = await submitAnswerOverMqtt(client, interviewId, answer);
      const ms = Date.now() - t;
      timings.push({ step: `answer-${round}`, ms });
      log(`round ${round} (${ms}ms) — reaction: "${data.reaction?.slice(0, 50)}…" | next: "${data.nextQuestion?.slice(0, 50) ?? "(done)"}"`);
      if (data.status === "completed" || !data.nextQuestion) done = true;
    } catch (err) {
      errors.push(`answer-${round}: ${err.message}`);
      log(`round ${round} FAILED — ${err.message}`);
      // continue to next round rather than aborting the whole interview
    }
  }

  client.end(true);
  const totalMs = Date.now() - t0;
  log(`finished in ${totalMs}ms — ${round} rounds, ${errors.length} errors`);
  return { id, timings, errors, totalMs, completed: done };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"─".repeat(64)}`);
  console.log(` InterviewIQ Load Test`);
  console.log(` Target:      ${BASE}`);
  console.log(` MQTT:        ${MQTT_URL}`);
  console.log(` Concurrency: ${CONCURRENCY} simultaneous interviews`);
  console.log(` Rounds:      ${ROUNDS} answer rounds per interview`);
  console.log(`${"─".repeat(64)}\n`);

  // Fetch JDs first
  let jds;
  try {
    jds = await getJDs();
    console.log(`✓ Loaded ${jds.length} job description(s)\n`);
  } catch (err) {
    console.error(`✗ Cannot reach backend: ${err.message}`);
    console.error(`  Make sure "npm run dev" is running in backend/ and docker compose is up`);
    process.exit(1);
  }

  const wallStart = Date.now();

  // Fire all interviews concurrently
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) =>
      runInterview(i + 1, pick(jds).id)
    )
  );

  const wallMs = Date.now() - wallStart;

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log(`\n${"─".repeat(64)}`);
  console.log(` Results\n`);

  const passed = results.filter((r) => r.errors.length === 0);
  const failed = results.filter((r) => r.errors.length > 0);

  // Per-step timing breakdown
  const stepNames = ["start", ...Array.from({ length: ROUNDS }, (_, i) => `answer-${i + 1}`)];
  const table = stepNames.map((step) => {
    const ms = results.flatMap((r) => r.timings.filter((t) => t.step === step).map((t) => t.ms));
    if (!ms.length) return null;
    ms.sort((a, b) => a - b);
    return {
      step,
      count: ms.length,
      min: ms[0],
      p50: ms[Math.floor(ms.length * 0.5)],
      p90: ms[Math.floor(ms.length * 0.9)],
      p99: ms[Math.floor(ms.length * 0.99)] ?? ms.at(-1),
      max: ms.at(-1),
    };
  }).filter(Boolean);

  const pad = (s, n) => String(s).padStart(n);
  const header = `${"Step".padEnd(12)} ${"N".padStart(4)} ${"min".padStart(6)} ${"p50".padStart(6)} ${"p90".padStart(6)} ${"p99".padStart(6)} ${"max".padStart(6)}  (ms)`;
  console.log(header);
  console.log("─".repeat(header.length));
  for (const row of table) {
    console.log(
      `${row.step.padEnd(12)} ${pad(row.count, 4)} ${pad(row.min, 6)} ${pad(row.p50, 6)} ${pad(row.p90, 6)} ${pad(row.p99, 6)} ${pad(row.max, 6)}`
    );
  }

  // Individual totals
  console.log(`\n Interview totals (wall time per interview):`);
  for (const r of results) {
    const status = r.errors.length ? "✗ FAIL" : "✓ pass";
    console.log(`  ${status}  interview-${String(r.id).padStart(2, "0")}  ${r.totalMs}ms  ${r.errors.length ? r.errors.join(" | ") : ""}`);
  }

  // Overall
  console.log(`\n Overall:`);
  console.log(`  Passed:     ${passed.length} / ${CONCURRENCY}`);
  console.log(`  Failed:     ${failed.length} / ${CONCURRENCY}`);
  console.log(`  Wall time:  ${wallMs}ms  (all ${CONCURRENCY} interviews ran in parallel)`);
  console.log(`  Throughput: ${(CONCURRENCY / (wallMs / 1000)).toFixed(2)} interviews/sec`);

  if (failed.length) {
    console.log(`\n Failures:`);
    for (const r of failed) {
      console.log(`  interview-${r.id}: ${r.errors.join(" | ")}`);
    }
  }

  console.log(`${"─".repeat(64)}\n`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
