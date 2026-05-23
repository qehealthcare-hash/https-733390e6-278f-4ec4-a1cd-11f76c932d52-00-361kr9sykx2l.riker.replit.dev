"use client";

import { useEffect, useState } from "react";
import { getDocumentSignedUrl, isImageDocument, isPdfDocument } from "@/lib/uploads";

function badgeStyle(kind) {
  if (kind === "pdf") {
    return { background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" };
  }
  if (kind === "image") {
    return { background: "#dbeafe", color: "#1e3a8a", border: "1px solid #bfdbfe" };
  }
  return { background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0" };
}

function kindOf(doc) {
  if (isPdfDocument(doc)) return "pdf";
  if (isImageDocument(doc)) return "image";
  return "file";
}

/**
 * Renders a single document row with file name, kind chip, View / Download,
 * and an inline image preview when the file is a picture.
 */
export function DocumentCard(props) {
  var doc = props.doc;
  var session = props.session;
  var [previewUrl, setPreviewUrl] = useState("");
  var [openingType, setOpeningType] = useState("");
  var [error, setError] = useState("");
  var kind = kindOf(doc);

  useEffect(
    function () {
      var cancelled = false;
      setPreviewUrl("");
      if (kind !== "image") return undefined;
      getDocumentSignedUrl(doc, session, { expiresIn: 600 })
        .then(function (data) {
          if (!cancelled && data && data.signedUrl) setPreviewUrl(data.signedUrl);
        })
        .catch(function () {});
      return function () {
        cancelled = true;
      };
    },
    [doc, session, kind]
  );

  async function openInNewTab(asDownload) {
    setError("");
    setOpeningType(asDownload ? "download" : "view");
    try {
      var data = await getDocumentSignedUrl(doc, session, {
        expiresIn: 600,
        download: asDownload
      });
      if (data && data.signedUrl) {
        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      } else {
        setError("Unable to open this document");
      }
    } catch (err) {
      setError(err.message || "Unable to open this document");
    } finally {
      setOpeningType("");
    }
  }

  var chip = badgeStyle(kind);
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
          {props.onRemove ? (
            <button
              type="button"
              className="button danger ghost"
              style={{ background: "transparent", color: "#b91c1c", borderColor: "#fecaca" }}
              onClick={props.onRemove}
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
          <img
            src={previewUrl}
            alt={doc.file_name || "preview"}
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

export function DocumentList(props) {
  var docs = Array.isArray(props.docs) ? props.docs : [];
  if (!docs.length) {
    return (
      <div className="mini-muted" style={{ padding: 8 }}>
        No files attached yet.
      </div>
    );
  }
  return (
    <div className="document-list">
      {docs.map(function (doc, index) {
        return (
          <DocumentCard
            key={doc.path || index}
            doc={doc}
            session={props.session}
            onRemove={props.onRemove ? function () { props.onRemove(doc, index); } : null}
          />
        );
      })}
    </div>
  );
}
