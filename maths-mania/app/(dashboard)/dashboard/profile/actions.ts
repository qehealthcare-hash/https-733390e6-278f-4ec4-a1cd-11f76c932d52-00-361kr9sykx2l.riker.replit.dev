"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type ProfileUpdateState = {
  error?: string;
  ok?: boolean;
  message?: string;
};

export async function updateProfileAction(
  _prev: ProfileUpdateState,
  formData: FormData,
): Promise<ProfileUpdateState> {
  void _prev;
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Sign in required." };

  const fullName = String(formData.get("fullName") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const classOrTarget = String(formData.get("classOrTarget") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const whatsappOptIn = formData.get("whatsappOptIn") === "on";

  if (!fullName || fullName.length < 2) {
    return { error: "Please enter your full name." };
  }
  if (!classOrTarget) {
    return { error: "Please select what you are preparing for." };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "Database is not configured." };

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      city: city || null,
      state: state || null,
      class_or_target: classOrTarget,
      phone: phone || ctx.profile.phone,
      whatsapp_opt_in: whatsappOptIn,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.user.id);

  if (error) {
    console.error("[profile] update", error.message);
    return { error: "Could not save profile. Try again." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/profile");
  return { ok: true, message: "Profile updated." };
}
