using terms from application "Safari"
	set outputText to ""
	repeat with n from 0 to 19
		set indexScript to "window.__jdClickIndex = " & (n as text)
		tell application "Safari"
			do JavaScript indexScript in tab 2 of window 1
		end tell
		set clickScript to read (POSIX file "/Users/bhawinkadikar/Downloads/bhavin/jd_click_whatsapp_index.js")
		tell application "Safari"
			set clickResult to do JavaScript clickScript in tab 2 of window 1
		end tell
		delay 2
		tell application "Safari"
			set currentUrl to URL of tab 2 of window 1
		end tell
		set outputText to outputText & (n as text) & " " & clickResult & " " & currentUrl & linefeed
		tell application "Safari"
			do JavaScript "history.back(); 'back'" in tab 2 of window 1
		end tell
		delay 2
	end repeat
	return outputText
end using terms from
