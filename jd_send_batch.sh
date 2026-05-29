#!/bin/zsh
set -u

MSG='Hi%0A%0ADr%20Bhawin%20kadikar%0AFrom%20%3A%20Hominal%20healthcare%20pvt%20ltd%0AVisit%20us%20at%20%3A%20hominalhealthcare.com%0A%0ARegarding%20your%20inquiry%2C%20I%20am%20here%20for%20helping%20you%20for%20patient%20care%20assistance.%0ALet%20me%20know%20how%20can%20we%20help%20you%3F%0A%0AThank%20you.%0AHominal%20healthcare%20pvt%20ltd%0AA%2F407%2C%20Shivalik%20Yash%2C%0APallav%20cross%20road%2C%0ANaranpura'
LIMIT="${1:-10}"

for n in $(seq 1 "$LIMIT"); do
  click=$(osascript \
    -e 'set clickJS to read (POSIX file "/Users/bhawinkadikar/Downloads/bhavin/jd_click_next_whatsapp.js")' \
    -e 'tell application "Safari" to do JavaScript clickJS in tab 4 of window 1')
  echo "$n $click"
  [[ "$click" == NO_BUTTON* ]] && break

  sleep 2
  url=$(osascript \
    -e 'tell application "Safari" to set tabCount to count tabs of window 1' \
    -e 'tell application "Safari" to get URL of tab tabCount of window 1')
  phone="${url#*phone=}"
  phone="${phone%%&*}"
  if [[ "$phone" == "$url" || -z "$phone" ]]; then
    echo "$n NO_PHONE $url"
    continue
  fi

  osascript \
    -e "set msg to \"$MSG\"" \
    -e "open location \"whatsapp://send?phone=$phone&text=\" & msg"
  sleep 3
  osascript \
    -e 'tell application "System Events" to set frontmost of process "WhatsApp" to true' \
    -e 'delay 0.4' \
    -e 'tell application "System Events" to key code 36'
  echo "$n SENT $phone"
  sleep 1.2
  osascript \
    -e 'tell application "Safari" to set tabCount to count tabs of window 1' \
    -e 'tell application "Safari" to close tab tabCount of window 1'
done
