import dotenv from "dotenv";

dotenv.config();

function required(name) {
  if (!process.env[name]) {
    throw new Error("Missing environment variable: " + name);
  }
  return process.env[name];
}

export const env = {
  port: parseInt(process.env.PORT || "4000", 10),
  appOrigin: process.env.APP_ORIGIN || "http://localhost:3000",
  supabaseUrl: required("SUPABASE_URL"),
  supabaseAnonKey: required("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY")
};
