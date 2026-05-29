/**
 * Maths Mania exam load test (§14.7).
 *
 * Prerequisites:
 *   1. Live exam window open (status live, registered users).
 *   2. node scripts/loadtest-prepare.mjs  → writes scripts/.loadtest-env.json
 *   3. k6 installed (https://k6.io)
 *
 * Run:
 *   k6 run scripts/loadtest.js \
 *     -e BASE_URL=http://localhost:3000 \
 *     -e EXAM_ID=<uuid> \
 *     -e AUTH_TOKENS=<jwt1>,<jwt2>,... \
 *     -e QUESTION_IDS=<q1>,<q2>,...
 *
 * Or: k6 run --env-file scripts/.loadtest-env.json scripts/loadtest.js
 *
 * Target: p95 < 400ms at 500 concurrent VUs (staging/production infra).
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";

const tokens = new SharedArray("tokens", () => {
  const raw = __ENV.AUTH_TOKENS || __ENV.AUTH_TOKEN || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
});

const questionIds = new SharedArray("questions", () => {
  const raw = __ENV.QUESTION_IDS || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
});

const maxVUs = Number(__ENV.LOAD_TEST_MAX_VUS || 500);

export const options = {
  scenarios: {
    exam_storm: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: Math.min(100, maxVUs) },
        { duration: "2m", target: maxVUs },
        { duration: "5m", target: maxVUs },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<400"],
    checks: ["rate>0.95"],
  },
};

export function setup() {
  const base = __ENV.BASE_URL;
  const examId = __ENV.EXAM_ID;
  if (!base || !examId) {
    throw new Error("Set BASE_URL and EXAM_ID");
  }
  if (tokens.length === 0) {
    throw new Error("Set AUTH_TOKENS (comma-separated JWTs)");
  }
  if (questionIds.length === 0) {
    throw new Error("Set QUESTION_IDS (comma-separated UUIDs)");
  }
  return { base, examId };
}

export default function (data) {
  const token = tokens[(__VU - 1) % tokens.length];
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const startRes = http.post(
    `${data.base}/api/exams/attempt/start`,
    JSON.stringify({ examId: data.examId }),
    { headers, tags: { name: "start_attempt" } },
  );

  const startOk = check(startRes, {
    "start status 200": (r) => r.status === 200,
  });

  if (!startOk) {
    sleep(2);
    return;
  }

  let attemptId;
  try {
    attemptId = startRes.json("attemptId");
  } catch {
    sleep(2);
    return;
  }

  const questionId =
    questionIds[Math.floor(Math.random() * questionIds.length)];

  const answerRes = http.post(
    `${data.base}/api/exams/attempt/answer`,
    JSON.stringify({
      attemptId,
      questionId,
      selectedIdx: Math.floor(Math.random() * 4),
      markedForReview: false,
      timeSpentSec: 5,
    }),
    { headers, tags: { name: "save_answer" } },
  );

  check(answerRes, {
    "answer status 200": (r) => r.status === 200,
  });

  sleep(5);
}
