#!/usr/bin/env node
/**
 * Obtain a Supabase access token for integration-smoke.mjs.
 * Uses SUPABASE_SERVICE_ROLE_KEY to ensure admin@hominalhealthcare.com exists,
 * sets a temporary password, signs in, prints access_token to stdout.
 *
 * Usage:
 *   export SUPABASE_URL=https://xxx.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   export SUPABASE_ANON_KEY=...
 *   node scripts/smoke-login.mjs
 */

const url = process.env.SUPABASE_URL || "https://hkyjxdmkqkydnrafhpgn.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const anonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";
const email = process.env.CRM_EMAIL || "admin@hominalhealthcare.com";
const password =
  process.env.CRM_PASSWORD ||
  `Smoke-${Date.now().toString(36)}!9`;

if (!serviceKey || !anonKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are required.");
  process.exit(1);
}

const adminHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json"
};

async function admin(path, init = {}) {
  const res = await fetch(`${url}/auth/v1/admin${path}`, {
    ...init,
    headers: { ...adminHeaders, ...(init.headers || {}) }
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function findUserByEmail(targetEmail) {
  const list = await admin(`/users?per_page=200`);
  const users = list.body?.users || [];
  const match = users.find(
    (u) => String(u.email || "").toLowerCase() === targetEmail.toLowerCase()
  );
  return match?.id || null;
}

async function main() {
  let userId = await findUserByEmail(email);

  if (!userId) {
    const created = await admin("/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: "Admin" }
      })
    });
    if (created.status >= 400) {
      console.error("create user failed:", created.status, created.body);
      process.exit(1);
    }
    userId = created.body?.id;
  } else {
    const updated = await admin(`/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify({ password, email_confirm: true })
    });
    if (updated.status >= 400) {
      console.error("reset password failed:", updated.status, updated.body);
      process.exit(1);
    }
  }

  const signIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
  const session = await signIn.json().catch(() => ({}));
  if (!session.access_token) {
    console.error("sign-in failed:", signIn.status, session);
    process.exit(1);
  }
  process.stdout.write(session.access_token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
