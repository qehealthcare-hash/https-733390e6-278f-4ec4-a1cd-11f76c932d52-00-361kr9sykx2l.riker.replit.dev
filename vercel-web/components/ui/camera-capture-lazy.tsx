"use client";

import dynamic from "next/dynamic";

export const CameraCaptureModal = dynamic(
  function () {
    return import("@/components/ui/camera-capture").then(function (mod) {
      return mod.CameraCaptureModal;
    });
  },
  { ssr: false, loading: function () { return null; } }
);
