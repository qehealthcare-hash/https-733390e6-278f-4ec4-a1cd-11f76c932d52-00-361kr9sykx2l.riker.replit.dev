"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Image from "next/image";
import {
  getDocumentSignedUrl,
  isImageDocument,
  isPdfDocument,
  type StoredDocument
} from "@/lib/uploads";
import type { ApiSession } from "@/lib/clients/types";
import { useConfirm } from "@/components/ui/confirm-dialog";

function badgeStyle(kind: string): CSSProperties {
  if (kind === "pdf") {
    return { background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" };
  }
  if (kind === "image") {
    return { background: "#dbeafe", color: "#1e3a8a", border: "1px solid #bfdbfe" };
  }
  return { background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0" };
}

function kindOf(doc: StoredDocument) {
  if (isPdfDocument(doc)) return "pdf";
  if (isImageDocument(doc)) return "image";
  return "file";
}

export function DocumentCard({
  doc,
  session,
  onRemove
}: {
  doc: StoredDocument;
  session: ApiSession;
  onRemove?: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [openingType, setOpeningType] = useState("");
  const [error, setError] = useState("");
  const confirm = useConfirm();
  const kind = kindOf(doc);

  async function handleRemoveClick() {
    if (!onRemove) return;
    const label = doc.file_name || doc.path || "this file";
    const ok = await confirm({
      title: "Remove this document?",
      description: `"${label}" will be detached from the form. You can re-upload it before saving.`,
      confirmLabel: "Remove",
      tone: "danger"
    });
    if (ok) onRemove();
  }

  useEffect(
    function () {
      let cancelled = false;
      setPreviewUrl("");
      if (kind !== "image") return undefined;
      getDocumentSignedUrl(doc, session, { expiresIn: 600 })
        .then(function (data) {
          if (!cancelled && data?.signedUrl) setPreviewUrl(data.signedUrl);
        })
        .catch(function () {});
      return function () {
        cancelled = true;
      };
    },
    [doc, session, kind]
  );

  async function openInNewTab(asDownload: boolean) {
    setError("");
    setOpeningType(asDownload ? "download" : "view");
    try {
      const data = await getDocumentSignedUrl(doc, session, {
        expiresIn: 600,
        download: asDownload
      });
      if (data?.signedUrl) {
        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      } else {
        setError("Unable to open this document");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to open this document");
    } finally {
      setOpeningType("");
    }
  }

  const chip = badgeStyle(kind);
  return (
    <div className="document-item" style={{ alignItems: "flex-start", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          width: "100%",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap"
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 0 }}>
          <span
            style={{
              ...chip,
              padding: "2px 6px",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase"
            }}
          >
            {kind}
          </span>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {doc.file_name || doc.path}
          </div>
        </div>
        <div className="button-row" style={{ gap: 6 }}>
          <button
            type="button"
            className="button secondary"
            disabled={!!openingType}
            onClick={function () {
              openInNewTab(false);
            }}
          >
            {openingType === "view" ? "Opening…" : "View"}
          </button>
          <button
            type="button"
            className="button ghost"
            disabled={!!openingType}
            onClick={function () {
              openInNewTab(true);
            }}
          >
            {openingType === "download" ? "…" : "Download"}
          </button>
          {onRemove ? (
            <button
              type="button"
              className="button danger ghost"
              style={{ background: "transparent", color: "#b91c1c", borderColor: "#fecaca" }}
              onClick={function () {
                void handleRemoveClick();
              }}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
      {previewUrl ? (
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer noopener"
          style={{
            marginTop: 8,
            display: "inline-block",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            overflow: "hidden",
            background: "#f8fafc"
          }}
        >
          <Image
            src={previewUrl}
            alt={doc.file_name || "preview"}
            width={220}
            height={160}
            unoptimized
            style={{
              maxWidth: 220,
              maxHeight: 160,
              display: "block",
              objectFit: "cover"
            }}
          />
        </a>
      ) : null}
      {error ? <small style={{ color: "#b91c1c" }}>{error}</small> : null}
    </div>
  );
}

export function DocumentList({
  docs,
  session,
  onRemove
}: {
  docs?: StoredDocument[];
  session: ApiSession;
  onRemove?: (doc: StoredDocument, index: number) => void;
}) {
  const list = Array.isArray(docs) ? docs : [];
  if (!list.length) {
    return (
      <div className="mini-muted" style={{ padding: 8 }}>
        No files attached yet.
      </div>
    );
  }
  return (
    <div className="document-list">
      {list.map(function (doc, index) {
        return (
          <DocumentCard
            key={doc.path || String(index)}
            doc={doc}
            session={session}
            onRemove={
              onRemove
                ? function () {
                    onRemove(doc, index);
                  }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
