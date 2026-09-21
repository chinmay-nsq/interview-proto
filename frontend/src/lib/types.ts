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
  mqttUrl: string;
}

export interface StartInterviewResponse {
  interviewId: string;
  firstQuestion: string;
  mqttUrl: string;
}

/** MQTT payload received on interview/{id}/turn */
export interface TurnMessage {
  reaction: string;
  nextQuestion?: string;
  status: InterviewStatus;
}

export interface DeepgramTokenResponse {
  access_token: string;
  expires_in: number;
}

export interface CartesiaTokenResponse {
  token: string;
}
