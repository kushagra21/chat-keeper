# Status and findings

Last updated 27 October 2026, version 0.1.0.

Live at <https://kushagra21.github.io/chat-keeper/>. Pushing to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/pages.yml`).

## What's built

- **Loading:** a zip, loose files or a folder, by picker or drag and drop. Media is read from the zip only when it's shown.
- **Parser:** iPhone and Android exports, in any date order (day/month, month/day or year first), 12- or 24-hour times, two-digit years. It also handles multi-line messages, captions, system lines, deleted, edited and omitted media, and call summaries.
- **Viewer:** chat bubbles with media in place, search, a filter by person, jump to date, "You are", a gallery, an Info panel and a lightbox. WhatsApp GIFs (`-GIF-….mp4`) loop silently.
- **Exports:**
  - **Zip archive:** offline `index.html`, every file in `media/`, the original text in `original/`, plus `manifest.json`, `SHA256SUMS.txt` and `README.txt`.
  - **Single `.html` page** with media embedded, up to 150 MB.
  - **PDF:** a print transcript of the whole chat or a date range, with photos and video stills inline and page numbers.
- **Privacy:** CSP `connect-src 'none'` on the site and in every archive. The sample chat is built into the page, so even it loads nothing.

## Verified

- 22 unit and integration tests pass (`npm test`): parser formats, SHA-256 against Node's crypto, and an export whose checksums match its contents.
- **Sample chat in the browser:** loading, "You are", search, show in chat, Info with SHA-256, and the gallery.
- **Exported archive in a browser:** media loads and the CSP raises no errors. `shasum -a 256 -c SHA256SUMS.txt` passes on it.
- **PDF:** headless Chrome printed the sample through the real Print / PDF flow. It came out as 3 pages with photos inline and "n / N" page numbers.
- **A real iPhone group export:** 250 messages, 5 people, 16 media files, about 6 MB.
  - Every attachment was matched and no dates went backwards.
  - System lines were read correctly, including ones sent under a person's name: "X created group", "added you", "security code changed".
  - `Voice call, 9 min • N joined` stays with the caller.
  - Stickers (`-STICKER-….webp`) and the GIF video displayed. The archive passed `shasum -c`, and the print layout had all images plus the GIF still.
- **Live site:** returns 200 for `/` and `/chat-keeper.html`, and the deployed page carries the CSP.

## Not verified yet

- **Android:** no real export tried; only test lines.
- **Other languages:** no non-English export tried. Localised system lines (group events in other languages) may show as messages from a person when they contain `": "`.
- **Large exports:** nothing of several GB, or with tens of thousands of messages (memory, chunked rendering, `content-visibility` scroll jumps).
- **Browsers:** not tried in Safari, Firefox or on phones. Safari may not print page numbers (`@page` margin boxes) and may not play `.opus` voice notes. Each has a download link.
- **Video:** no real video file through the PDF still-frame path; only the GIF.
- **Saving:** "Save archive" in a real browser, both the Chrome save picker that writes straight to disk and the plain download.
- **Opening archives from disk:** a downloaded archive opened from `file://` (the check used a local server).
- **Live site in a browser:** checked only with curl.

## Known rough edges

- **Missing checksum on early prints:** if a large export is printed within seconds of opening it, the PDF header can lack the SHA-256, because hashing is still running.
- **Jump to date or message** can land slightly off on long chats, because the size of parts not yet shown is estimated.
- **Names that contain `": "`** split in the wrong place (rare).
- **"You are" scroll position:** changing it on a long chat re-renders the chat and keeps your place only roughly.
- **CI warnings:** `actions/*@v4` target Node 20, which is being retired. Bump them when v5 versions are available.

## Ideas for next

1. Try a real Android export and a non-English export, then add their line shapes (names changed) to `src/parser.test.ts`.
2. Load test with a large chat (generate 50k messages) on desktop and on a phone.
3. Test Safari and Firefox print and playback; add a note in the app where something isn't supported.
4. A "PDF for records" option: one page per day, or a hash of every attachment listed at the end.
5. Search: ignore accents, step through matches with next/previous inside the chat.
6. Link to it from Album Importer's README.
