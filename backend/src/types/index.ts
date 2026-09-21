export interface JobDescription {
  id: string;
  title: string;
  company: string;
  seniority: string;
  description: string;
  mustHaveSkills: string[];
}

export interface TranscriptTurn {
  role: "interviewer" | "candidate";
  text: string;
  isFollowUp?: boolean;
}

export type InterviewStatus = "in_progress" | "completed";

export interface InterviewSession {
  id: string;
  jdId: string;
  status: InterviewStatus;
  coreQuestions: string[];
  currentQuestionIndex: number;
  transcript: TranscriptTurn[];
  consecutiveGptCount: number;
  maxConsecutiveGpt: number;
  offTopicStreak: number;
  clarificationStreak: number;
  originalContentQuestion?: string;
}

export type FollowUpAction =
  | "CONTINUE_FOLLOW_UP"
  | "CLOSE_AND_TRANSITION"
  | "DIRECT_NEXT"
  | "SKILL_FAMILIARITY_CHECK"
  | "SKIP_SKILL";

export type AnswerType =
  | "clarification_request"
  | "partial_answer"
  | "complete_answer"
  | "off_topic"
  | "dont_know";

export interface FollowUpDecision {
  action: FollowUpAction;
  answerType: AnswerType;
  followUpApplicable: "yes" | "no";
  /** May contain the literal {{NEXT_QUESTION_PLACEHOLDER}} token for CLOSE_AND_TRANSITION. */
  question: string;
  questionClean: string;
  reasoning: string;
}

/** MQTT payload: candidate -> backend, published to interview/{id}/answer */
export interface AnswerMessage {
  answerText: string;
}

/** MQTT payload: backend -> candidate, published to interview/{id}/turn */
export interface TurnMessage {
  reaction: string;
  nextQuestion?: string;
  status: InterviewStatus;
}
