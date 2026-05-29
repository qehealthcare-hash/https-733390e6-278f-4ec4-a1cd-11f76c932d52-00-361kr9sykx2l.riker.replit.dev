on run argv
  set startIndex to (item 1 of argv) as integer
  set endIndex to (item 2 of argv) as integer
  set safariTab to (item 3 of argv) as integer
  set msg to "Hi%0A%0ADr%20Bhawin%20kadikar%0AFrom%20%3A%20Hominal%20healthcare%20pvt%20ltd%0AVisit%20us%20at%20%3A%20hominalhealthcare.com%0A%0ARegarding%20your%20inquiry%2C%20I%20am%20here%20for%20helping%20you%20for%20patient%20care%20assistance.%0ALet%20me%20know%20how%20can%20we%20help%20you%3F%0A%0AThank%20you.%0AHominal%20healthcare%20pvt%20ltd%0AA%2F407%2C%20Shivalik%20Yash%2C%0APallav%20cross%20road%2C%0ANaranpura"
  set report to ""
  repeat with idx from startIndex to endIndex
    set js to "(() => {let bs=[...document.querySelectorAll('button')].filter(b=>(b.innerText||b.getAttribute('aria-label')||'').includes('Send WhatsApp')); let b=bs[" & idx & "]; if(!b)return 'NO_BUTTON'; b.click(); return 'CLICKED_BUTTON_" & idx & "';})()"
    tell application "Safari"
      set targetTab to item safariTab of tabs of window 1
      set clickResult to do JavaScript (js as string) in targetTab
    end tell
    if clickResult is "NO_BUTTON" then
      set report to report & idx & ": NO_BUTTON" & linefeed
      exit repeat
    end if
    delay 2
    tell application "Safari" to set u to URL of last tab of window 1
    set text item delimiters of AppleScript to "phone="
    if (count of text items of u) > 1 then
      set restUrl to text item 2 of u
      set text item delimiters of AppleScript to "&"
      set phone to text item 1 of restUrl
      open location "whatsapp://send?phone=" & phone & "&text=" & msg
      delay 3
      tell application "WhatsApp" to activate
      delay 0.4
      tell application "System Events" to key code 36
      set report to report & idx & ": SENT " & phone & linefeed
      delay 1.2
      tell application "Safari" to close last tab of window 1
    else
      set report to report & idx & ": NO_PHONE " & u & linefeed
    end if
  end repeat
  return report
end run
