/**
 * Architectural boundary tests.
 *
 * These tests are deliberately structural — they read source files and
 * assert the layering contract documented in `docs/ARCHITECTURE.md`:
 *
 *   app/api/v1/**           — thin HTTP handlers. Allowed imports:
 *                              `@/services/*`, `@/lib/api/*`, `@/utils/*`,
 *                              `@/types/*`. May NOT import `@/database/*`
 *                              or `@/lib/api/supabase` directly.
 *   src/services/*          — domain orchestration. Allowed: validation,
 *                              business, repositories, utils, types. May
 *                              NOT import `@/lib/api/supabase` or legacy
 *                              `lib/api/services/*`.
 *   src/business/*          — pure functions. Allowed: types, utils,
 *                              other business helpers. May NOT import
 *                              `@/lib/api/supabase`, repositories,
 *                              services, or Next.js.
 *   src/database/*          — repositories. Allowed: supabase client,
 *                              base helpers, utils, types, BUSINESS pure
 *                              helpers (rare, but acceptable). May NOT
 *                              import services, validation, or Next.js.
 *
 * The legacy `lib/api/services/*` folder was deleted on 2026-05-26;
 * importing it anywhere is now a hard fail.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..", "..");

function walk(dir: string, exts = [".ts", ".tsx"]): string[] {
  const out: string[] = [];
  if (!safeIsDir(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".vercel") continue;
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

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function rel(file: string): string {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function collectImports(source: string): string[] {
  const out: string[] = [];
  const importRe = /(?:from|import)\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(source)) !== null) {
    out.push(match[1]);
  }
  return out;
}

function matchesAny(spec: string, patterns: RegExp[]): RegExp | null {
  for (const re of patterns) {
    if (re.test(spec)) return re;
  }
  return null;
}

interface Violation {
  file: string;
  importPath: string;
  rule: string;
}

function check(
  files: string[],
  forbidden: Array<{ rule: string; patterns: RegExp[] }>,
  /** Imports we explicitly allow even if a forbidden rule would match. */
  allow: RegExp[] = []
): Violation[] {
  const violations: Violation[] = [];
  for (const f of files) {
    const source = read(f);
    const imports = collectImports(source);
    for (const spec of imports) {
      if (matchesAny(spec, allow)) continue;
      for (const { rule, patterns } of forbidden) {
        if (matchesAny(spec, patterns)) {
          violations.push({ file: rel(f), importPath: spec, rule });
        }
      }
    }
  }
  return violations;
}

const apiRoutes = walk(path.join(ROOT, "app", "api"));
const services = walk(path.join(ROOT, "src", "services")).filter(
  (f) => !f.includes("__tests__")
);
const business = walk(path.join(ROOT, "src", "business")).filter(
  (f) => !f.includes("__tests__")
);
const repositories = walk(path.join(ROOT, "src", "database")).filter(
  (f) => !f.includes("__tests__")
);

describe("architecture: layering boundaries", () => {
  it("legacy lib/api/services/* directory is fully deleted", () => {
    expect(safeIsDir(path.join(ROOT, "lib", "api", "services"))).toBe(false);
  });

  it("app/api routes do not import Supabase, repositories, or legacy services", () => {
    const violations = check(apiRoutes, [
      {
        rule: "app/api → @/lib/api/supabase",
        patterns: [/^@\/lib\/api\/supabase$/]
      },
      {
        rule: "app/api → @/database/*",
        patterns: [/^@\/database\//]
      },
      {
        rule: "app/api → @/lib/api/services/* (deleted)",
        patterns: [/^@\/lib\/api\/services\//]
      }
    ]);
    if (violations.length > 0) {
      console.error(JSON.stringify(violations, null, 2));
    }
    expect(violations).toEqual([]);
  });

  it("src/services/* never imports Supabase directly", () => {
    const violations = check(services, [
      {
        rule: "src/services → @/lib/api/supabase",
        patterns: [/^@\/lib\/api\/supabase$/, /^\.\.\/.*lib\/api\/supabase$/]
      },
      {
        rule: "src/services → @/lib/api/services/* (deleted)",
        patterns: [/^@\/lib\/api\/services\//]
      }
    ]);
    if (violations.length > 0) {
      console.error(JSON.stringify(violations, null, 2));
    }
    expect(violations).toEqual([]);
  });

  it("src/business/* is pure — no Supabase, no repos, no services, no Next", () => {
    const violations = check(business, [
      {
        rule: "src/business → @/lib/api/supabase",
        patterns: [/^@\/lib\/api\/supabase$/]
      },
      {
        rule: "src/business → @/database/*",
        patterns: [/^@\/database\//]
      },
      {
        rule: "src/business → @/services/*",
        patterns: [/^@\/services\//]
      },
      {
        rule: "src/business → @/lib/api/* (HTTP layer)",
        patterns: [/^@\/lib\/api\//]
      },
      {
        rule: "src/business → next/* (must be framework-free)",
        patterns: [/^next\b/]
      }
    ]);
    if (violations.length > 0) {
      console.error(JSON.stringify(violations, null, 2));
    }
    expect(violations).toEqual([]);
  });

  it("src/database/* does not import services, validation, or Next", () => {
    const violations = check(repositories, [
      {
        rule: "src/database → @/services/*",
        patterns: [/^@\/services\//]
      },
      {
        rule: "src/database → @/validation/*",
        patterns: [/^@\/validation\//]
      },
      {
        rule: "src/database → @/lib/api/security (HTTP layer)",
        patterns: [/^@\/lib\/api\/security$/]
      },
      {
        rule: "src/database → next/*",
        patterns: [/^next\b/]
      }
    ]);
    if (violations.length > 0) {
      console.error(JSON.stringify(violations, null, 2));
    }
    expect(violations).toEqual([]);
  });
});

describe("architecture: every domain has a service that returns ApiResult", () => {
  it("every src/services/*Service.ts file exports a service object", () => {
    const expectedSuffix = "Service.ts";
    const serviceFiles = services.filter(
      (f) => f.endsWith(expectedSuffix) && !f.includes("__tests__")
    );
    expect(serviceFiles.length).toBeGreaterThan(10);

    const missing: string[] = [];
    for (const file of serviceFiles) {
      const source = read(file);
      // Look for `export const <name>Service =` matching the filename.
      const basename = path.basename(file, ".ts");
      const re = new RegExp(`export\\s+const\\s+${basename}\\s*=`);
      if (!re.test(source)) {
        missing.push(rel(file));
      }
    }
    if (missing.length > 0) {
      console.error("Services missing canonical export:", missing);
    }
    expect(missing).toEqual([]);
  });
});

describe("architecture: Supabase client import boundary", () => {
  const allowedSupabaseJs = new Set([
    "src/database/supabaseClient.ts",
    "src/database/clients.ts",
    "src/database/baseRepository.ts",
    "lib/supabase/browser.ts"
  ]);

  it("only database layer and browser entry import @supabase/supabase-js", () => {
    const scanRoots = [
      path.join(ROOT, "app"),
      path.join(ROOT, "components"),
      path.join(ROOT, "lib"),
      path.join(ROOT, "src")
    ];
    const violations: { file: string; importPath: string }[] = [];
    for (const root of scanRoots) {
      for (const file of walk(root)) {
        const r = rel(file);
        if (r.includes("__tests__") || r.includes("node_modules")) continue;
        if (allowedSupabaseJs.has(r)) continue;
        const imports = collectImports(read(file));
        for (const spec of imports) {
          if (spec === "@supabase/supabase-js") {
            violations.push({ file: r, importPath: spec });
          }
        }
      }
    }
    if (violations.length > 0) {
      console.error(JSON.stringify(violations, null, 2));
    }
    expect(violations).toEqual([]);
  });
});

describe("architecture: api-client import boundary", () => {
  const allowedApiClient = new Set([
    "lib/api-client.ts",
    "lib/uploads.ts",
    "lib/offline-queue.ts"
  ]);

  function isUnderClients(relPath: string): boolean {
    return relPath.startsWith("lib/clients/");
  }

  function importsRestrictedApiClientHelpers(source: string): boolean {
    const blocks =
      source.match(/import\s+(?:type\s+)?\{[^}]+\}\s+from\s+["']@\/lib\/api-client["']/g) || [];
    return blocks.some(function (block) {
      return /\b(?:request|requestWithOfflineFallback)\b/.test(block);
    });
  }

  it("app and UI do not import request helpers from api-client directly", () => {
    const scanRoots = [path.join(ROOT, "app"), path.join(ROOT, "components"), path.join(ROOT, "lib")];
    const violations: string[] = [];
    for (const root of scanRoots) {
      for (const file of walk(root)) {
        const r = rel(file);
        if (r.includes("__tests__") || r.includes("node_modules")) continue;
        if (allowedApiClient.has(r) || isUnderClients(r)) continue;
        const source = read(file);
        if (importsRestrictedApiClientHelpers(source)) {
          violations.push(r);
        }
      }
    }
    if (violations.length > 0) {
      console.error(JSON.stringify(violations, null, 2));
    }
    expect(violations).toEqual([]);
  });
});

describe("architecture: barrel exports stay in sync", () => {
  it("src/services/index.ts re-exports every <name>Service", () => {
    const barrel = read(path.join(ROOT, "src", "services", "index.ts"));
    const serviceFiles = services.filter(
      (f) => /Service\.ts$/.test(f) && !f.includes("__tests__")
    );
    const missing: string[] = [];
    for (const file of serviceFiles) {
      const name = path.basename(file, ".ts");
      if (!barrel.includes(name)) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it("src/database/index.ts re-exports every <name>Repository", () => {
    const barrel = read(path.join(ROOT, "src", "database", "index.ts"));
    const repoFiles = repositories.filter(
      (f) => /Repository\.ts$/.test(f) && !f.includes("__tests__")
    );
    const missing: string[] = [];
    for (const file of repoFiles) {
      const name = path.basename(file, ".ts");
      if (!barrel.includes(name)) missing.push(name);
    }
    expect(missing).toEqual([]);
  });
});
