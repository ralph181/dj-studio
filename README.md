# DJ Intelligence Studio (web app)

A web app that runs entirely in the browser. It works on Windows and Android as an installed app, and offline once installed.
Your music never leaves your device: tracks are analyzed locally and stored in the browser's own storage.

## Put it online (one time, free)
The app is a static folder, so any HTTPS host works. Installing needs HTTPS.
- Netlify Drop: open https://app.netlify.com/drop and drag this whole folder onto the page.
- GitHub Pages, Cloudflare Pages or Vercel also work. Upload the folder contents as-is.

## Install
- Windows: open the site in Microsoft Edge or Chrome, then use the Install button in the app header
  (or the install icon in the address bar). It gets its own window, Start menu entry and taskbar icon,
  and can be set as an "Open with" app for audio files.
- Android: open the site in Chrome, then tap Install in the app header (or menu > Add to Home screen > Install).
  It appears in the app drawer like any other app.

## Real .exe / .apk (optional)
After the site is online, paste its address into https://www.pwabuilder.com. It packages the same app as a
Windows (MSIX) installer and an Android (APK/AAB) package, including a Play Store build.

## What it does
- Imports audio and video (drag and drop, or Import). MP3, WAV, FLAC, M4A, AAC, OGG, OPUS, MP4, MOV, WEBM.
- Analyzes BPM, Camelot key, energy, mixability, loudness, intro/outro length, sound profile and waveform.
  Confidence dots show when a tempo or key is uncertain, and one tap fixes it (1/2 BPM, 2x BPM, key picker).
- Two decks with waveform, intro/outro zones, 4 cue points per track, live level meters, tempo sync.
- Match engine: BPM (including half and double time), Camelot key moves (same, +/-1, relative, diagonal, energy boost),
  energy flow for the chosen session mode, sound similarity and room to blend. Every transition shows where to start the blend.
- Playlists section: generate a playlist in order of compatibility, reorder, remove tracks, rename, regenerate.
  Download as .txt, M3U8 or CSV, or all playlists in one .txt.
- Star tracks, filter by Camelot key, "Matches for A" filter, remove tracks one by one.
- Shortcuts: Space plays deck A (Shift+Space deck B), 1-4 set or jump to cues, Up/Down move through the library.
- Imports M3U/M3U8 and Rekordbox/VirtualDJ XML playlists by matching file names. It never reads or writes DJ software databases.

## Files
index.html, styles.css, app.js, worker.js (analysis engine), sw.js (offline), manifest.webmanifest, icons/
Run locally for testing: `python3 -m http.server 8000` in this folder, then open http://localhost:8000

## New: genres, web lookups and AI (all optional)

- **Genres.** Each track gets a genre from its ID3 tag, MusicBrainz or Apple Music search (artist and title text only), or the AI. Genre now feeds the match score, so an afro house to techno jump is flagged as a "genre shift".
- **Discover tab.** Finds tracks you do not own that fit deck A, a playlist or your whole library. Without a key it uses genre data from the web. With a Claude API key it gives BPM, key, energy and a reason, checks each track on Apple Music (preview and link), shows an estimated fit score, and has Beatport and YouTube search links plus a downloadable wishlist.
- **AI re-rank** (Next up) and **AI set notes** (playlist name, set story, blend notes, optional reorder). Notes are included in the .txt export.
- **Free AI option.** Choose Google Gemini in the sparkle settings and paste a free key from aistudio.google.com. Claude is the paid alternative and adds web search.
- **Setup.** Tap the sparkle button, pick a provider, paste your API key, press Test connection. The key stays in this browser. Use a key with a spending limit. Everything works offline without a key.
- BPM, key and energy for suggested tracks are AI estimates. Check by ear before you buy.

## Built-in AI (no key for your users)

The AI key must never sit in the app's JavaScript, because anyone can read it. Instead a small Netlify Function (`netlify/functions/ai.js`) holds the key on the server and the app calls that.

1. Get a free Gemini key at aistudio.google.com.
2. Deploy this folder with Netlify so the function is included: connect a GitHub repo containing these files, or run `npm i -g netlify-cli` then `netlify deploy --prod --dir .`. Plain drag and drop of the folder may not publish functions.
3. In Netlify: Site configuration > Environment variables, add `GEMINI_API_KEY`. Redeploy.
4. Open the app, tap the sparkle button. "Built-in AI, free, no key needed" is now the default.

Optional variables: `GEMINI_MODEL` (default gemini-2.5-flash) and `AI_LIMIT_PER_10_MIN` (default 20 requests per person). All users share Google's free quota. If the function is missing, the app falls back to asking for a personal key.
