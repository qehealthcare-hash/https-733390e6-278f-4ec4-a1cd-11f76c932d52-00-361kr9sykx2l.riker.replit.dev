import type { Metadata } from "next";
import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata: Metadata = {
  title: "Certificate verification",
  description:
    "Verify the authenticity of a Maths Mania merit-list certificate by entering the 12-character verification code.",
};

export default function VerifyPage() {
  return (
    <ComingSoon
      milestone="Milestone 14"
      title="Certificate verification"
      subhead="Enter the 12-character code printed on any Maths Mania merit certificate to confirm the rank, score and exam name. Issued only to top 10% rankers; verifiable forever."
    />
  );
}
