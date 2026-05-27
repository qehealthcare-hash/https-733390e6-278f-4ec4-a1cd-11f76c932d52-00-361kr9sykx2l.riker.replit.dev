import type { Metadata } from "next";
import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms governing the use of Maths Mania content, free resources, and the live exam platform.",
};

export default function TermsPage() {
  return (
    <ComingSoon
      milestone="Milestone 16"
      title="Terms of Service"
      subhead="Standard terms tuned for an Indian edtech business — including exam rules, anti-cheat consequences, refund policy (for future paid courses), and the tie-breaking rule used in merit list computation."
    />
  );
}
