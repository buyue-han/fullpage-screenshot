# Full Page Screenshot

A Chrome extension that captures full-page, visible-area, and region-select screenshots with one click.

## Features

- **Full Page Screenshot** – Automatically scrolls and stitches the entire webpage into a single high-resolution image.
- **Visible Area Screenshot** – Captures only the current viewport instantly.
- **Region Select Screenshot** – Drag to select any area on the page for a precise capture.
- **Smart Stitching** – Hides fixed/sticky elements (e.g., navbars) during scrolling to avoid duplicates, then restores them at the correct position in the final image.
- **Auto Download** – Saves screenshots as PNG with timestamps.
- **Save As** – Re-save the last screenshot via a file dialog.
- **Rate-Limit Handling** – Automatically retries when hitting Chrome's capture API limits.

## Installation

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (toggle at top right).
3. Click **Load unpacked**.
4. Select the `fullpage-screenshot` folder.

## Usage

1. Click the extension icon in the toolbar.
2. Choose one of the screenshot modes:
   - 🗺️ Capture entire webpage
   - 👁️ Capture visible area
   - ✂️ Select region to capture
3. The image will be downloaded automatically.

## Tech Stack

- Manifest V3
- Vanilla JavaScript
- Canvas API for image stitching
- Chrome Extension APIs (`tabs`, `scripting`, `downloads`, `captureVisibleTab`)

## License

MIT
