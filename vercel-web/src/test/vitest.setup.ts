import { vi } from "vitest";

vi.mock("@/lib/api/supabase", () => import("@/test/supabaseClientsMock"));
vi.mock("@/database/clients", () => import("@/test/supabaseClientsMock"));
