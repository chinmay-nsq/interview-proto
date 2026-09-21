import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { seedJobDescriptions } from "../data/seedJobDescriptions.js";
import type { InterviewSession, JobDescription } from "../types/index.js";

const redis = new Redis(env.redisUrl);

const JDS_HASH_KEY = "jds";
const interviewKey = (id: string) => `interview:${id}`;

redis.on("error", (err) => console.error("[redis] client error", err));

export async function seedIfEmpty(): Promise<void> {
  const existing = await redis.hlen(JDS_HASH_KEY);
  if (existing > 0) return;
  const entries = seedJobDescriptions.flatMap((jd) => [jd.id, JSON.stringify(jd)]);
  await redis.hset(JDS_HASH_KEY, ...entries);
}

export async function listJobDescriptions(): Promise<JobDescription[]> {
  const all = await redis.hgetall(JDS_HASH_KEY);
  return Object.values(all).map((json) => JSON.parse(json) as JobDescription);
}

export async function getJobDescription(id: string): Promise<JobDescription | null> {
  const json = await redis.hget(JDS_HASH_KEY, id);
  return json ? (JSON.parse(json) as JobDescription) : null;
}

export async function createJobDescription(jd: JobDescription): Promise<void> {
  await redis.hset(JDS_HASH_KEY, jd.id, JSON.stringify(jd));
}

export async function getInterview(id: string): Promise<InterviewSession | null> {
  const json = await redis.get(interviewKey(id));
  return json ? (JSON.parse(json) as InterviewSession) : null;
}

export async function setInterview(session: InterviewSession): Promise<void> {
  await redis.set(interviewKey(session.id), JSON.stringify(session));
}
