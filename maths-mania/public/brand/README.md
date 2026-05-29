# Brand assets — drop zone

> ⚠️ These files must be exported manually. The build degrades gracefully if any of them are missing (the inline `<Logo />` component renders a credible π-mark + Fraunces wordmark fallback).

| File                       | Source                                  | Size       |
| -------------------------- | --------------------------------------- | ---------- |
| `logo-mark.svg`            | Standalone π mark                       | 40 × 40    |
| `logo-wordmark.svg`        | "Maths Mania" lockup                    | flexible   |
| `logo-avatar.png`          | YouTube round avatar (high-res export)  | 800 × 800  |
| `logo-instagram.jpg`       | Instagram profile photo                 | square     |
| `logo-facebook.jpg`        | Facebook profile photo                  | square     |
| `banner.jpg`               | YouTube banner                          | 2560 × 1440 |
| `og-image.png`             | Open Graph / Twitter share card         | 1200 × 630 |
| `favicon.ico`              | Browser tab icon                        | multi      |
| `apple-touch-icon.png`     | iOS home-screen icon                    | 180 × 180  |

## How to export the YouTube channel avatar at high res

1. Open <https://www.youtube.com/channel/UCbPBJROEaXpSryqgrcybufA>.
2. Right-click the round profile image → **Open image in new tab**.
3. In the URL bar, find the size suffix (e.g. `=s48-c-k-c0x00ffffff-no-rj`).
4. Replace `s48` with `s800`. Reload.
5. Save the resulting image as `public/brand/logo-avatar.png`.

## How to export the YouTube channel banner

1. From the channel page, open the browser DevTools (⌘⌥I / F12).
2. In the Elements panel, find the `<img>` whose `src` contains `yt3.googleusercontent.com` and `banner`.
3. Copy the URL, replace any `=w...` size param with `=w2560` for high-res, paste in a new tab.
4. Save as `public/brand/banner.jpg`.

## Reels & shorts (`public/social/reel-01.jpg` … `reel-09.jpg`)

From Instagram, screenshot or save 6–9 best-performing reel thumbnails into `public/social/`.
The YouTube Data API will fetch shorts/video thumbnails automatically once the API key is set.
