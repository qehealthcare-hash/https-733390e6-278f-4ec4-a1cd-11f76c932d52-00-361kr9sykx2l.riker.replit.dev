"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Modal that lets the operator capture a photo using the device camera.
 *
 * Works on:
 *   - Desktop (getUserMedia → live <video> preview → canvas capture)
 *   - Mobile (same API; iOS/Android Safari ≥14 and Chrome support it)
 *
 * Falls back to a graceful error message when the page is not served over
 * HTTPS or the user denies permission.
 *
 * Props:
 *   open        — boolean
 *   onClose()   — called when modal dismisses without a capture
 *   onCapture(file: File) — called once with a JPEG File on confirm
 *   facingMode  — 'user' | 'environment'  (default 'environment' — rear)
 */
export function CameraCaptureModal({ open, onClose, onCapture, facingMode }) {
  var videoRef = useRef(null);
  var canvasRef = useRef(null);
  var streamRef = useRef(null);
  var [error, setError] = useState("");
  var [ready, setReady] = useState(false);
  var [shot, setShot] = useState(null);
  var [busy, setBusy] = useState(false);
  var [facing, setFacing] = useState(facingMode || "environment");

  useEffect(
    function () {
      if (!open) return undefined;
      var cancelled = false;
      setError("");
      setReady(false);
      setShot(null);

      async function start() {
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
          setError("This browser does not support camera capture.");
          return;
        }
        try {
          var stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: facing,
              width: { ideal: 1280 },
              height: { ideal: 960 }
            },
            audio: false
          });
          if (cancelled) {
            stream.getTracks().forEach(function (t) { t.stop(); });
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
            setReady(true);
          }
        } catch (err) {
          var name = err?.name || "";
          if (name === "NotAllowedError" || name === "PermissionDeniedError") {
            setError("Camera permission denied. Allow access in browser settings.");
          } else if (name === "NotFoundError" || name === "OverconstrainedError") {
            setError("No suitable camera found on this device.");
          } else if (window.isSecureContext === false) {
            setError("Camera requires HTTPS. Open the CRM over https:// to use this.");
          } else {
            setError(err?.message || "Could not start camera.");
          }
        }
      }

      start();

      return function cleanup() {
        cancelled = true;
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(function (t) { t.stop(); });
          streamRef.current = null;
        }
      };
    },
    [open, facing]
  );

  function capture() {
    var video = videoRef.current;
    var canvas = canvasRef.current;
    if (!video || !canvas) return;
    var w = video.videoWidth || 1280;
    var h = video.videoHeight || 960;
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    var dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setShot(dataUrl);
  }

  function retake() {
    setShot(null);
  }

  function flipCamera() {
    setFacing(function (current) { return current === "user" ? "environment" : "user"; });
  }

  async function confirm() {
    if (!shot) return;
    setBusy(true);
    try {
      var blob = await (await fetch(shot)).blob();
      var stamp = new Date().toISOString().replace(/[:.]/g, "-");
      var file = new File([blob], "camera-" + stamp + ".jpg", { type: "image/jpeg" });
      onCapture(file);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={function () { if (!busy) onClose(); }}>
      <div
        className="card modal-card modal-wide"
        onClick={function (e) { e.stopPropagation(); }}
        style={{ maxWidth: 720 }}
      >
        <div className="modal-head">
          <h3>Capture photo</h3>
          <button className="button ghost" type="button" disabled={busy} onClick={onClose}>×</button>
        </div>

        {error ? (
          <div style={{ color: "var(--danger, #b91c1c)" }}>{error}</div>
        ) : null}

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

        <div className="button-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div className="button-row" style={{ gap: 8 }}>
            <button className="button ghost" type="button" onClick={flipCamera} disabled={busy || !ready}>
              {facing === "user" ? "Use rear camera" : "Use front camera"}
            </button>
          </div>
          <div className="button-row" style={{ gap: 8 }}>
            {!shot ? (
              <>
                <button className="button ghost" type="button" onClick={onClose}>Cancel</button>
                <button className="button primary" type="button" onClick={capture} disabled={!ready}>
                  Capture
                </button>
              </>
            ) : (
              <>
                <button className="button ghost" type="button" onClick={retake} disabled={busy}>
                  Retake
                </button>
                <button className="button primary" type="button" onClick={confirm} disabled={busy}>
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
