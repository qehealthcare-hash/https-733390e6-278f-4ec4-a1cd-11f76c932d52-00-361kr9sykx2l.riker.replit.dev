import type { Metadata } from "next";
import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with Maths Mania — WhatsApp, email, or contact form. Usually replies within 24 hours.",
};

export default function ContactPage() {
  return (
    <ComingSoon
      milestone="Milestone 16"
      title="Get in touch"
      subhead="Contact form, WhatsApp click-to-chat, email link, and the standard response-time SLA will live here. The WhatsApp number in the footer already works."
    />
  );
}
