#!/usr/bin/env node
/**
 * WCAG contrast check for key Maths Mania token pairs (approximate sRGB).
 * Run: node scripts/a11y-contrast.mjs
 */

const PAIRS = [
  { name: "Body text on surface", fg: "#1c1917", bg: "#ffffff", min: 4.5 },
  { name: "Muted text on surface", fg: "#57534e", bg: "#ffffff", min: 4.5 },
  { name: "Faint text on surface", fg: "#57534e", bg: "#fafaf8", min: 4.5 },
  { name: "Primary button label", fg: "#ffffff", bg: "#c94a3a", min: 4.5 },
  { name: "Error on error bg", fg: "#b91c1c", bg: "#fef2f2", min: 4.5 },
  { name: "Success on success bg", fg: "#15803d", bg: "#f0fdf4", min: 4.5 },
];

function luminance(hex) {
  const rgb = hex
    .replace("#", "")
    .match(/.{2}/g)
    .map((h) => {
      const c = parseInt(h, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

let failed = 0;
console.log("\nContrast audit (WCAG AA body text ≥ 4.5:1)\n");
for (const { name, fg, bg, min } of PAIRS) {
  const ratio = contrast(fg, bg);
  const ok = ratio >= min;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "✓" : "✗"} ${name.padEnd(28)} ${ratio.toFixed(2)}:1 (need ${min})`,
  );
}
console.log("");
if (failed > 0) process.exit(1);
