import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { CertificatePrint } from "@/components/certificates/certificate-print";
import { CertificateDownloadButton } from "@/components/certificates/certificate-download-button";
import { requireAuth } from "@/lib/auth/session";
import { getCertificateForUser } from "@/lib/exams/certificates";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Your certificate", robots: { index: false } };
}

export default async function CertificateDetailPage({ params }: Props) {
  const { id } = await params;
  const { user } = await requireAuth({ requireOnboarded: true });
  const cert = await getCertificateForUser(id, user.id);
  if (!cert) notFound();

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Heading as="h1" size="h2">
          Your certificate
        </Heading>
        <div className="flex flex-wrap gap-2">
          <CertificateDownloadButton />
          <Button asChild variant="outline" size="md">
            <Link href="/dashboard/certificates">All certificates</Link>
          </Button>
        </div>
      </div>

      <CertificatePrint cert={cert} />
    </>
  );
}
