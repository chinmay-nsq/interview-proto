import { Router } from "express";
import { randomUUID } from "crypto";
import { env } from "../config/env.js";
import { getInterview, getJobDescription, setInterview } from "../store/redisStore.js";
import { generateQuestions } from "../services/questionGeneration.js";
import { InterviewSession } from "../types/index.js";

export const interviewsRouter = Router();

const MAX_CONSECUTIVE_GPT = 2;

interviewsRouter.post("/", async (req, res) => {
  const { jdId } = req.body ?? {};
  if (typeof jdId !== "string") {
    res.status(400).json({ error: "jdId is required" });
    return;
  }

  const jd = await getJobDescription(jdId);
  if (!jd) {
    res.status(404).json({ error: "Job description not found" });
    return;
  }

  try {
    const coreQuestions = await generateQuestions(jd);
    if (coreQuestions.length === 0) {
      throw new Error("Question generation returned zero questions");
    }

    const session: InterviewSession = {
      id: randomUUID(),
      jdId,
      status: "in_progress",
      coreQuestions,
      currentQuestionIndex: 0,
      transcript: [{ role: "interviewer", text: coreQuestions[0] }],
      consecutiveGptCount: 0,
      maxConsecutiveGpt: MAX_CONSECUTIVE_GPT,
      offTopicStreak: 0,
      clarificationStreak: 0,
      originalContentQuestion: coreQuestions[0],
    };

    await setInterview(session);

    res.status(201).json({
      interviewId: session.id,
      firstQuestion: coreQuestions[0],
      mqttUrl: env.mqttPublicWsUrl,
    });
  } catch (err) {
    res.status(502).json({ error: `Failed to start interview: ${(err as Error).message}` });
  }
});

interviewsRouter.get("/:id", async (req, res) => {
  const session = await getInterview(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }
  res.json({ ...session, mqttUrl: env.mqttPublicWsUrl });
});
