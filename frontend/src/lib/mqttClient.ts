import mqtt, { type MqttClient } from "mqtt";
import type { TurnMessage } from "./types";

export interface InterviewMqttSession {
  publishAnswer: (answerText: string) => void;
  disconnect: () => void;
}

export function connectInterviewMqtt(
  mqttUrl: string,
  interviewId: string,
  onTurn: (turn: TurnMessage) => void,
  onError?: (err: string) => void
): InterviewMqttSession {
  const turnTopic = `interview/${interviewId}/turn`;
  const answerTopic = `interview/${interviewId}/answer`;

  const client: MqttClient = mqtt.connect(mqttUrl, { reconnectPeriod: 2000 });

  client.on("connect", () => {
    client.subscribe(turnTopic, { qos: 1 }, (err) => {
      if (err) onError?.(`Failed to subscribe to ${turnTopic}: ${err.message}`);
    });
  });

  client.on("message", (topic, payload) => {
    if (topic !== turnTopic) return;
    try {
      onTurn(JSON.parse(payload.toString()) as TurnMessage);
    } catch {
      onError?.("Malformed turn message from server");
    }
  });

  client.on("error", (err) => onError?.(err.message));

  return {
    publishAnswer: (answerText: string) => {
      client.publish(answerTopic, JSON.stringify({ answerText }), { qos: 1 });
    },
    disconnect: () => client.end(true),
  };
}
