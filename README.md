# Vannessa — ePA Builder (demo)

A live, interactive demo of **Vannessa**, a drag-and-drop control panel for a
clinical document pipeline: drop prior-authorization criteria PDFs, and a
five-stage board (Queue → Transcribe → Build → QA → Done) tracks each drug as
an AI agent transcribes the criteria verbatim, a document builder assembles the
.docx, and a QA gate decides whether it ships.

**This demo runs entirely in your browser.** It replays scripted batches
(mock mode) — the real backend is a local Python pipeline that drives the
Claude CLI, a docx builder, and a deterministic QA suite, and is not included
here. Flags, duplicate detection, rate-limit pauses, and failure states are all
simulated faithfully.

Built with zero dependencies: vanilla JS, hand-rolled SSE-style state handling,
CSS animation, and an illustrated SVG mascot.

- **Try it:** drop any PDF onto the board, or just press Start.
- Speed controls live in the demo badge (1× / 4×).
