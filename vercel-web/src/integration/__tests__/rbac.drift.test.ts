/**
 * RBAC drift guard. (M2-H1, M2-M2)
 *
 * Reads every `app/api/v1/**` route handler and finds every literal
 * role string passed to `requireRole(actor, [...])`. Asserts that each
 * one is a member of `CANONICAL_ROLES` from `@/business/rbac`.
 *
 * This catches the exact class of bug that Module 2 audit found:
 *
 *   - `BILLING_READ_ROLES` contained `"Viewer"`, a role that has never
 *     existed in `hh_roles`. The wider `AppRole = ... | string` escape
 *     hatch let it sail past TypeScript.
 *
 *   - Several routes referenced `"Account"` instead of `"Accountant"`
 *     before the C2 migration reconciled the DB names.
 *
 * Why this is a separate, runtime-style test (not just a TS check):
 * many route files spell roles as INLINE literals
 *   `requireRole(actor, ["Admin", "Manager"])`
 * not as named constants. TypeScript catches the named-constant case
 * because the constants are typed `readonly Role[]`, but inline
 * literals are inferred as `string[]` until they reach `requireRole`,
 * which is where the literal narrowing actually happens. A grep test
 * is the simplest "always catches" backstop.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { CANONICAL_ROLES, isCanonicalRole } from "@/business/rbac";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const API_ROOT = path.join(ROOT, "app", "api", "v1");

function walk(dir: string, exts = [".ts", ".tsx"]): string[] {
  const out: string[] = [];
  if (!safeIsDir(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...walk(full, exts));
    } else if (exts.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

interface Violation {
  file: string;
  role: string;
  context: string;
}

/**
 * Extract every literal string used in a `requireRole(actor, [...])`
 * call. Spread constants (`[...USER_ADMIN_ROLES]`) are intentionally
 * ignored — TypeScript guarantees those at compile time.
 */
function extractLiteralRoles(source: string): Array<{ role: string; context: string }> {
  const out: Array<{ role: string; context: string }> = [];
  // Match `requireRole(actor, [ ... ])` ignoring whitespace/newlines.
  const callRe = /requireRole\s*\(\s*\w+\s*,\s*\[([\s\S]*?)\]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(source)) !== null) {
    const inside = match[1];
    // Pull double- or single-quoted strings out of the brackets.
    const strRe = /["']([^"']+)["']/g;
    let strMatch: RegExpExecArray | null;
    while ((strMatch = strRe.exec(inside)) !== null) {
      out.push({ role: strMatch[1], context: match[0].replace(/\s+/g, " ") });
    }
  }
  return out;
}

describe("RBAC drift guard: app/api/v1/** requireRole literals", () => {
  const apiFiles = walk(API_ROOT);

  it("at least 50 route files exist (sanity check)", () => {
    expect(apiFiles.length).toBeGreaterThan(50);
  });

  it("every inline role string is a member of CANONICAL_ROLES", () => {
    const violations: Violation[] = [];
    for (const file of apiFiles) {
      const source = readFileSync(file, "utf8");
      const literals = extractLiteralRoles(source);
      for (const { role, context } of literals) {
        if (!isCanonicalRole(role)) {
          violations.push({
            file: path.relative(ROOT, file).replace(/\\/g, "/"),
            role,
            context
          });
        }
      }
    }
    if (violations.length > 0) {
      // Print a readable failure so the next dev sees what to do.
      const summary = violations
        .map(
          (v) =>
            `  ${v.file}\n    role: ${JSON.stringify(v.role)}\n    in:   ${v.context}`
        )
        .join("\n");
      console.error(
        `\nFound ${violations.length} non-canonical role literal(s) in requireRole calls.\n` +
          `Allowed: ${CANONICAL_ROLES.join(", ")}.\n\n${summary}\n`
      );
    }
    expect(violations).toEqual([]);
  });
});
