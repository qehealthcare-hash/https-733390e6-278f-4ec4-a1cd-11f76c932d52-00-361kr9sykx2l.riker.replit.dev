on run argv
  set idx to item 1 of argv
  set jdUrl to "https://wap.justdial.com/analytics/enquiries?el=0&nh=0&docid=079PXX79.XX79.171128125010.S3C7&ep=leads&hide_header=1&jdbusiness=1&m=1&old=1&source=77&wkwebview=1&tab=enquiries&ln=en"
  set msg to "Hi%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20Dr%20Bhawin%20kadikar%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20From%20%3A%20Hominal%20healthcare%20pvt%20ltd%20Visit%20us%20at%20%3A%20hominalhealthcare.com%20Regarding%20your%20Here%20I%20am%20for%20helping%20you%20for%20patient%20care%20assistance%20.%20Let%20me%20know%20%20How%20can%20we%20help%20you%3F%20%20Thank%20you.%20%20Hominal%20healthcare%20pvt%20ltd%20%20A%2F407%20%2C%20Shivalik%20Yash%20%2C%20%20Pallav%20cross%20road%20%2C%20%20Naranpura"

  tell application "Safari"
    do JavaScript ("window.__jdClickIndex = " & idx) in tab 2 of window 1
  end tell

  set jsText to read (POSIX file "/Users/bhawinkadikar/Downloads/bhavin/jd_click_whatsapp_index.js")
  tell application "Safari"
    do JavaScript jsText in tab 2 of window 1
  end tell

  delay 2
  tell application "Safari" to set u to URL of tab 2 of window 1

  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to "phone="
  set parts to text items of u
  if (count of parts) < 2 then
    set AppleScript's text item delimiters to oldDelims
    return "NO_PHONE:" & u
  end if

  set ppart to item 2 of parts
  set AppleScript's text item delimiters to "&"
  set phone to item 1 of text items of ppart
  set AppleScript's text item delimiters to oldDelims

  open location "whatsapp://send?phone=" & phone & "&text=" & msg
  delay 5
  tell application "System Events" to keystroke return
  delay 1
  tell application "Safari" to set URL of tab 2 of window 1 to jdUrl
  return phone
end run
