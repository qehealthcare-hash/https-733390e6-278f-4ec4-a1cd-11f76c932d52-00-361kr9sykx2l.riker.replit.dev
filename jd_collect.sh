#!/bin/sh
set -eu
out="/tmp/jd_numbers.txt"
: > "$out"
i=0
while [ "$i" -lt 20 ]; do
  osascript -e 'tell application "Safari"' -e 'do JavaScript "window.__jdClickIndex = '"$i"'" in tab 2 of window 1' -e 'end tell' >/dev/null
  osascript -e 'set jsText to read (POSIX file "/Users/bhawinkadikar/Downloads/bhavin/jd_click_whatsapp_index.js")' -e 'tell application "Safari"' -e 'do JavaScript jsText in tab 2 of window 1' -e 'end tell' >/dev/null
  sleep 2
  printf "%s " "$i" >> "$out"
  osascript -e 'tell application "Safari"' -e 'URL of tab 2 of window 1' -e 'end tell' >> "$out"
  osascript -e 'tell application "Safari"' -e 'do JavaScript "history.back(); \"back\"" in tab 2 of window 1' -e 'end tell' >/dev/null
  sleep 2
  i=$((i + 1))
done
cat "$out"
