"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext, needsOnboarding } from "@/lib/auth/session";

export type OnboardingState = {
  error?: string;
};

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect("/login");
  }

  const fullName = String(formData.get("fullName") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const classOrTarget = String(formData.get("classOrTarget") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const whatsappOptIn = formData.get("whatsappOptIn") === "on";
  const next = String(formData.get("next") ?? "/dashboard").trim();

  if (!fullName || fullName.length < 2) {
    return { error: "Please enter your full name." };
  }
  if (!classOrTarget) {
    return { error: "Please select what you are preparing for." };
  }

  const supabase = await createClient();
  if (!supabase) {
    return { error: "Database is not configured." };
  }

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
    console.error("[onboarding]", error.message);
    return { error: "Could not save profile. Try again." };
  }

  revalidatePath("/dashboard");
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  redirect(safeNext);
}

export async function skipOnboardingIfComplete() {
  const ctx = await getAuthContext();
  if (ctx && !needsOnboarding(ctx.profile)) {
    redirect("/dashboard");
  }
}
