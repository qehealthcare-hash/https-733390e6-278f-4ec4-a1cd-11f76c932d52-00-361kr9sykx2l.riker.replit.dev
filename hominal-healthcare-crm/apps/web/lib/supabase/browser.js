import { createClient } from "@supabase/supabase-js";

let browserClient = null;
const FALLBACK_SUPABASE_URL = "https://hkyjxdmkqkydnrafhpgn.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhreWp4ZG1rcWt5ZG5yYWZocGduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NTI1MTcsImV4cCI6MjA5MjUyODUxN30.JXGZCH9FTQLYGp98a3Fqxp9YK1_-qB7dVt1vBLLbzWI";

export function getBrowserSupabase() {
  if (!browserClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;
    browserClient = createClient(
      supabaseUrl,
      supabaseAnonKey
    );
  }
  return browserClient;
}
