"use client";

import Image from "next/image";

/**
 * Company logo — uses next/image with `unoptimized` for data: URIs and
 * remote Supabase signed URLs (dynamic hostnames).
 */
export function BrandLogo({ src, alt, className, width = 160, height = 48, priority = false }) {
  if (!src) return null;
  var remote = typeof src === "string" && (src.startsWith("http://") || src.startsWith("https://"));
  var dataUri = typeof src === "string" && src.startsWith("data:");
  return (
    <Image
      src={src}
      alt={alt || ""}
      className={className}
      width={width}
      height={height}
      priority={priority}
      unoptimized={dataUri || remote}
      style={{ width: "auto", height: "auto", maxWidth: "100%", maxHeight: height }}
    />
  );
}
