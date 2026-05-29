import { config } from "dotenv";
import { resolve } from "node:path";

// Load Supabase credentials from vercel-web/.env.local (repo convention).
config({ path: resolve(__dirname, "../../vercel-web/.env.local") });
// Optional local overrides for audit-only secrets.
config({ path: resolve(__dirname, ".env.local"), override: true });
