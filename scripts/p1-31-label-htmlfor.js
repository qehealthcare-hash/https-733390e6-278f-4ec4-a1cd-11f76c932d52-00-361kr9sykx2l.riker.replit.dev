#!/usr/bin/env node
/**
 * P1-31 — pair each <label> with the next form control and inject htmlFor/id.
 *
 * Strategy (conservative, JSX-aware lite):
 *  - Tokenize each file by lines.
 *  - For every line containing an unparenthesized <label> opening tag that does
 *    NOT already have htmlFor=, scan ahead up to 8 non-empty lines for the next
 *    form-control opening tag (<input, <select, <textarea, <Input, etc.).
 *  - If the target already has an id="X" attribute, reuse X.
 *    Otherwise synthesize a stable id from a per-file counter + slug of label
 *    text content (best-effort) and inject id="..." into the target opening tag.
 *  - Inject htmlFor="..." into the label opening tag.
 *  - Do not rewrite labels that wrap their control (parent-label pattern); skip
 *    if the same line closes </label> (i.e. inline labels like <label>X</label>
 *    with no sibling control on the next line is fine — we still try to pair).
 */
const fs = require("fs");
const path = require("path");

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(f));
    else if (/^page\.(js|jsx|tsx)$/.test(e.name)) out.push(f);
  }
  return out;
}

const FORM_CTRL = /<(input|select|textarea|Input|Select|Textarea|TextField)\b/;

function slug(s) {
  return String(s || "")
    .replace(/[{}<>/]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 24) || "field";
}

function processFile(file) {
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  const base = path.basename(path.dirname(file)); // e.g. "patients"
  let counter = 0;
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Find every <label ...> opening tag that lacks htmlFor.
    const labelRe = /<label\b([^>]*)>/g;
    let m;
    let newLine = line;
    let offsetShift = 0;
    while ((m = labelRe.exec(line))) {
      const attrs = m[1];
      if (/\bhtmlFor=/.test(attrs)) continue;

      // Extract label text — best-effort. Could be on same line or wrapped.
      const after = line.slice(m.index + m[0].length);
      const closeIdx = after.indexOf("</label>");
      let labelText;
      if (closeIdx >= 0) {
        labelText = after.slice(0, closeIdx);
      } else {
        labelText = lines[i + 1] || "";
      }
      const baseId = `${base}-${slug(labelText)}-${++counter}`;

      // Search ahead for the next form control.
      let targetIdx = -1;
      let targetMatch = null;
      const sameLineCtrl = FORM_CTRL.exec(line.slice(m.index + m[0].length));
      if (sameLineCtrl) {
        // Find absolute index in current (possibly modified) line.
        const absMatch = (newLine.match(FORM_CTRL) || [])[0];
        if (absMatch) {
          targetIdx = i;
          targetMatch = sameLineCtrl;
        }
      }
      if (targetIdx === -1) {
        for (let k = i + 1; k < Math.min(i + 9, lines.length); k++) {
          const mm = FORM_CTRL.exec(lines[k]);
          if (mm) {
            targetIdx = k;
            targetMatch = mm;
            break;
          }
        }
      }
      if (targetIdx === -1) continue;

      // Check existing id="..." on the target opening tag (could span lines).
      // Gather tag text from targetMatch to the next '>'.
      const tagBuf = [];
      let endLine = targetIdx;
      for (let k = targetIdx; k < Math.min(targetIdx + 12, lines.length); k++) {
        tagBuf.push(lines[k]);
        if (lines[k].includes(">")) { endLine = k; break; }
      }
      const tagSrc = tagBuf.join("\n");
      const existingId = tagSrc.match(/\bid=\{?["'`]?([A-Za-z0-9_\-]+)["'`]?\}?/);
      const chosenId = existingId ? existingId[1] : baseId;

      // Inject htmlFor on label.
      const labelStart = m.index + offsetShift;
      const labelEnd = labelStart + m[0].length;
      const replacement = `<label htmlFor="${chosenId}"${attrs}>`;
      newLine = newLine.slice(0, labelStart) + replacement + newLine.slice(labelEnd);
      offsetShift += replacement.length - m[0].length;
      changed = true;

      // Inject id on target if missing.
      if (!existingId) {
        const tgtIdx = targetIdx === i ? -1 : targetIdx;
        if (tgtIdx === -1) {
          // Same line — already mutated newLine; need to inject id into the control tag.
          newLine = newLine.replace(FORM_CTRL, (s) => `${s} id="${chosenId}"`);
        } else {
          lines[targetIdx] = lines[targetIdx].replace(FORM_CTRL, (s) => `${s} id="${chosenId}"`);
        }
      }
    }
    if (newLine !== line) lines[i] = newLine;
  }

  if (changed) fs.writeFileSync(file, lines.join("\n"));
  return changed;
}

const root = process.argv[2] || "vercel-web/app";
const files = walk(root);
let total = 0;
for (const f of files) if (processFile(f)) total++;
console.log("Modified", total, "files");
