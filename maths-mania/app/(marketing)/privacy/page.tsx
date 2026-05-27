import type { Metadata } from "next";
import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Maths Mania collects, uses, and stores your data. Compliant with India's DPDP Act 2023.",
};

export default function PrivacyPage() {
  return (
    <ComingSoon
      milestone="Milestone 16"
      title="Privacy Policy"
      subhead="DPDP Act 2023 compliant policy with an explicit clause on exam attempts (24-month retention) and anti-cheat telemetry during live exams. Drafting in milestone 16."
    />
  );
}
