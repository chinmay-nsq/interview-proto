import mqtt, { type MqttClient } from "mqtt";
import { randomUUID } from "crypto";
import { env } from "../config/env.js";
import type { AnswerMessage, TurnMessage } from "../types/index.js";

const SHARED_GROUP = "interview-workers";
const ANSWER_FILTER = `$share/${SHARED_GROUP}/interview/+/answer`;
const ANSWER_TOPIC_RE = /^interview\/([^/]+)\/answer$/;

let client: MqttClient | null = null;

export function startMqttSubscriber(): Promise<void> {
  return new Promise((resolve, reject) => {
    client = mqtt.connect(env.mqttUrl, {
      clientId: `backend-${randomUUID()}`,
      reconnectPeriod: 2000,
    });

    let settled = false;

    client.on("connect", () => {
      client!.subscribe(ANSWER_FILTER, { qos: 1 }, (err) => {
        if (err) {
          console.error("[mqtt] failed to subscribe", err);
          if (!settled) { settled = true; reject(err); }
          return;
        }
        console.log(`[mqtt] connected to ${env.mqttUrl}, subscribed to ${ANSWER_FILTER}`);
        if (!settled) { settled = true; resolve(); }
      });
    });

    client.on("message", (topic, payload) => {
      const match = topic.match(ANSWER_TOPIC_RE);
      if (!match) return;
      const interviewId = match[1];

      let body: Partial<AnswerMessage>;
      try {
        body = JSON.parse(payload.toString());
      } catch {
        console.warn(`[mqtt] malformed answer payload on ${topic}`);
        return;
      }
      if (typeof body.answerText !== "string" || !body.answerText.trim()) return;

      // Import lazily to avoid a load-order cycle with interviewTurnHandler.ts
      // (which imports publishTurn from this module).
      void import("./interviewTurnHandler.js").then(({ handleAnswerMessage }) =>
        handleAnswerMessage(interviewId, body.answerText as string)
      ).catch((err) => console.error(`[mqtt] handleAnswerMessage failed for ${interviewId}`, err));
    });

    client.on("error", (err) => {
      console.error("[mqtt] client error", err);
      if (!settled) { settled = true; reject(err); }
    });
  });
}

export function publishTurn(interviewId: string, turn: TurnMessage): void {
  if (!client) {
    console.error("[mqtt] publishTurn called before client was started");
    return;
  }
  client.publish(`interview/${interviewId}/turn`, JSON.stringify(turn), { qos: 1 });
}
