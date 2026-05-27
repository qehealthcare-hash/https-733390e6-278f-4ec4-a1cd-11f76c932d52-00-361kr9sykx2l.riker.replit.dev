import type { Metadata } from "next";
import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata: Metadata = {
  title: "Free Resources — Notes, Formula Sheets, Cheatsheets",
  description:
    "Downloadable formula sheets, banking quant cheatsheets, SSC previous-year analysis, and Vedic maths starter notes — all free.",
};

export default function ResourcesPage() {
  return (
    <ComingSoon
      milestone="Milestone 6"
      title="Notes that don't waste your time"
      subhead="Curated PDF cheatsheets, formula tables, previous-year exam analysis and quick-revision notes. Free, with a soft email gate (skippable) so we can email new resources as we publish them."
      features={[
        "Class 10 formula sheet (Algebra · Trig · Geometry · Mensuration)",
        "Banking quant cheatsheet (Simplification · DI · Ratios)",
        "SSC CGL previous-year topic analysis",
        "Vedic maths starter — 12 essential tricks",
      ]}
    />
  );
}
