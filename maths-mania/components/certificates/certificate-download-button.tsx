"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CertificateDownloadButton() {
  return (
    <Button
      type="button"
      variant="primary"
      size="md"
      onClick={() => window.print()}
    >
      <Printer className="size-4" aria-hidden />
      Print / Save PDF
    </Button>
  );
}
