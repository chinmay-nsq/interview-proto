import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  openaiApiKey: required("OPENAI_API_KEY"),
  deepgramApiKey: required("DEEPGRAM_API_KEY"),
  cartesiaApiKey: required("CARTESIA_API_KEY"),
  mqttUrl: process.env.MQTT_URL ?? "mqtt://localhost:1883",
  mqttPublicWsUrl: process.env.MQTT_PUBLIC_WS_URL ?? "ws://localhost:8083/mqtt",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  port: process.env.PORT ? Number(process.env.PORT) : 4000,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
};
