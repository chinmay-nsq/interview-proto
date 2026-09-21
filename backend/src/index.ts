import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { jobDescriptionsRouter } from "./routes/jobDescriptions.js";
import { interviewsRouter } from "./routes/interviews.js";
import { tokensRouter } from "./routes/tokens.js";
import { seedIfEmpty } from "./store/redisStore.js";
import { startMqttSubscriber } from "./services/mqtt.js";

const app = express();

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

app.use("/api/jds", jobDescriptionsRouter);
app.use("/api/interviews", interviewsRouter);
app.use("/api/tokens", tokensRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

async function main() {
  await seedIfEmpty();

  app.listen(env.port, () => {
    console.log(`Backend listening on http://localhost:${env.port}`);
  });

  await startMqttSubscriber();
}

main().catch((err) => {
  console.error("Failed to start backend", err);
  process.exit(1);
});
