# Sheets Screenshot

A Chrome extension for capturing screenshots of Google Sheets, including full-page scroll capture and selected cell range capture.

## Features

- **Screenshot** - Capture the currently visible area of the spreadsheet
- **Area Screenshot** - Draw a rectangle to select a specific region to capture
- **Scroll Capture** - Automatically scroll and stitch together a full-length capture of tall spreadsheets
- **Capture Selection** - Capture the currently selected cell range, automatically scrolling if the selection exceeds the viewport

## Installation

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the extension directory
5. The extension icon will appear in your toolbar

### Generating Icons

The extension includes a utility to generate proper icons:

1. Open `generate-icons.html` in Chrome
2. Click each download link to save the icon files
3. Place the downloaded files in the `icons/` folder (replacing the existing placeholders)
4. Reload the extension in `chrome://extensions`

## Usage

Click the extension icon in the toolbar while viewing a Google Sheets spreadsheet. A popup will appear with four capture modes:

### Screenshot
Captures exactly what is currently visible in the spreadsheet viewport.

### Area Screenshot
Activates a crosshair cursor. Click and drag to select a rectangular area. The selected region is captured as an image.

### Scroll Capture
Automatically scrolls down through the spreadsheet, capturing each viewport and stitching the images together into one tall screenshot. Useful for capturing entire sheets that extend beyond the visible area.

### Capture Selection
Select a range of cells in Google Sheets first, then click this button. The extension reads the selected range from the Name Box, scrolls through it if necessary, and produces a stitched screenshot of just the selected cells.

## Preview Page

After any capture, a preview page opens in a new tab with the following controls:

- **Zoom in / out** - Adjust the image magnification
- **Reset zoom** - Return to the default zoom level
- **Copy** - Copy the image to the clipboard
- **Download** - Save the image as a PNG file

The preview supports mouse-wheel zooming and click-drag panning for easy inspection of large captures.

## Permissions

The extension requires the following permissions:

- `activeTab` / `host_permissions` - To capture the visible tab and interact with Google Sheets pages
- `scripting` - To inject content scripts for area selection and scroll logic
- `downloads` - To save captured images
- `tabs` - To open the preview page
- `storage` - To pass captured image data to the preview page

## Project Structure

```
extention/
  background.js      - Service worker handling capture commands and tab management
  content.js         - Content script for area selection, scroll capture, and selection capture
  content.css        - Styles for the area selection overlay
  popup.html/js      - Extension popup UI with capture mode buttons
  preview.html/js    - Full-page image preview with zoom, pan, copy, and download
  manifest.json      - Extension manifest (Manifest V3)
  icons/             - Extension icons (16, 48, 128 px)
  generate-icons.html - Utility page to generate proper PNG icons
```
