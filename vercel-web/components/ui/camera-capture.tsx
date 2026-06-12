"use client";

import { useEffect, useRef, useState } from "react";

export function CameraCaptureModal({
  open,
  onClose,
  onCapture,
  facingMode
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  facingMode?: "user" | "environment";
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">(facingMode || "environment");

  useEffect(
    function () {
      if (!open) return undefined;
      let cancelled = false;
      setError("");
      setReady(false);
      setShot(null);

      async function start() {
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
          setError("This browser does not support camera capture.");
          return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: facing,
              width: { ideal: 1280 },
              height: { ideal: 960 }
            },
            audio: false
          });
          if (cancelled) {
            stream.getTracks().forEach(function (t) {
              t.stop();
            });
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
            setReady(true);
          }
        } catch (err: unknown) {
          const name = err instanceof DOMException ? err.name : "";
          const msg = err instanceof Error ? err.message : "";
          if (name === "NotAllowedError" || name === "PermissionDeniedError") {
            if (/policy|permissions-policy|feature-policy/i.test(msg)) {
              setError(
                "Camera is blocked by browser policy for this site. Use HTTPS and ensure pop-up/camera permissions are allowed."
              );
            } else {
              setError("Camera permission denied. Allow access in browser settings.");
            }
          } else if (name === "SecurityError" || /content security policy/i.test(msg)) {
            setError(
              "Camera preview blocked by security policy. Reload the page over HTTPS and try again."
            );
          } else if (name === "NotFoundError" || name === "OverconstrainedError") {
            setError("No suitable camera found on this device.");
          } else if (window.isSecureContext === false) {
            setError("Camera requires HTTPS. Open the CRM over https:// to use this.");
          } else {
            setError(err instanceof Error ? err.message : "Could not start camera.");
          }
        }
      }

      start();

      return function cleanup() {
        cancelled = true;
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(function (t) {
            t.stop();
          });
          streamRef.current = null;
        }
      };
    },
    [open, facing]
  );

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 960;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setShot(dataUrl);
  }

  function retake() {
    setShot(null);
  }

  function flipCamera() {
    setFacing(function (current) {
      return current === "user" ? "environment" : "user";
    });
  }

  async function confirm() {
    if (!shot) return;
    setBusy(true);
    try {
      const blob = await (await fetch(shot)).blob();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = new File([blob], "camera-" + stamp + ".jpg", { type: "image/jpeg" });
      onCapture(file);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={function () {
        if (!busy) onClose();
      }}
    >
      <div
        className="card modal-card modal-wide"
        role="dialog"
        aria-modal="true"
        onClick={function (e) {
          e.stopPropagation();
        }}
        style={{ maxWidth: 720 }}
      >
        <div className="modal-head">
          <h3>Capture photo</h3>
          <button className="button ghost" type="button" disabled={busy} onClick={onClose}>
            ×
          </button>
        </div>

        {error ? <div style={{ color: "var(--danger, #b91c1c)" }}>{error}</div> : null}

        <div
          style={{
            background: "#0f172a",
            borderRadius: 8,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 280
          }}
        >
          {!shot ? (
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: "100%", maxHeight: 480, display: "block" }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shot}
              alt="Captured preview"
              style={{ width: "100%", maxHeight: 480, display: "block" }}
            />
          )}
        </div>
        <canvas ref={canvasRef} style={{ display: "none" }} />

        <div
          className="button-row"
          style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}
        >
          <div className="button-row" style={{ gap: 8 }}>
            <button
              className="button ghost"
              type="button"
              onClick={flipCamera}
              disabled={busy || !ready}
            >
              {facing === "user" ? "Use rear camera" : "Use front camera"}
            </button>
          </div>
          <div className="button-row" style={{ gap: 8 }}>
            {!shot ? (
              <>
                <button className="button ghost" type="button" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="button primary"
                  type="button"
                  onClick={capture}
                  disabled={!ready}
                >
                  Capture
                </button>
              </>
            ) : (
              <>
                <button className="button ghost" type="button" onClick={retake} disabled={busy}>
                  Retake
                </button>
                <button
                  className="button primary"
                  type="button"
                  onClick={confirm}
                  disabled={busy}
                >
                  {busy ? "Uploading…" : "Use this photo"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
