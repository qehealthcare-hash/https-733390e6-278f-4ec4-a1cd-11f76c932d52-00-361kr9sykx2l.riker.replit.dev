/**
 * Lightweight load smoke — no auth. Hits public exam infra endpoints.
 *
 *   k6 run scripts/loadtest-smoke.js -e BASE_URL=http://localhost:3000
 */
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 30,
  duration: "1m",
  thresholds: {
    http_req_duration: ["p(95)<500"],
    checks: ["rate>0.99"],
  },
};

export default function () {
  const base = __ENV.BASE_URL || "http://localhost:3000";

  const timeRes = http.get(`${base}/api/exams/server-time`, {
    tags: { name: "server_time" },
  });
  check(timeRes, { "server time 200": (r) => r.status === 200 });

  const homeRes = http.get(`${base}/`, { tags: { name: "home" } });
  check(homeRes, { "home 200": (r) => r.status === 200 });

  const examsRes = http.get(`${base}/exams`, { tags: { name: "exams_hub" } });
  check(examsRes, { "exams 200": (r) => r.status === 200 });

  sleep(1);
}
