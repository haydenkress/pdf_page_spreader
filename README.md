# Folio — PDF Page Spreader

A private, browser-based tool for splitting butterfly book scans: each PDF scan becomes two individually cropped PDF pages.

## Run

Use Node.js 22.13+ (Node 24 recommended).

```sh
npm ci
npm run dev
```

Open the address Vite prints. In the Codex cloud environment the checkout is `/workspace/pdf_page_spreader`; if the default npm cache is not writable, use `npm ci --cache /workspace/.npm-cache`.

For a production build, run `npm run build`. The generated `dist/` directory can be deployed to a static web host. `npm run preview` serves that build locally for verification.

## Split a book

1. Drag one or more PDFs into the large upload box, or use **Choose PDF files** to open Finder or your device’s file picker. PDFs appear in a review list; add more or remove files until the list is ready, then click **Start cropping**. Nothing moves to the crop editor automatically. Use the editor’s file selector to preview each book. **Add or manage PDFs** returns to the list while retaining your crop edits.
2. Drag the green **left page** and amber **right page** frames. Drag a corner to resize, or enter exact positions and dimensions as percentages of the visible scan.
3. Navigate between scans. Each scan retains its own frames, including PDFs with mixed page sizes and rotations.
4. Use **Apply both frames to all scans** for the active book, or **Apply these frames to every file** for the entire batch, then adjust individual scans as needed. This replaces all previous crop settings. **Reset this scan** restores only the current scan to equal halves.
5. Enter inclusive scan ranges such as `3-8`, `-8` (1 through 8), `8-` (8 through the end), or `1, 3-8, 12-`. Blank means all scans. The same expression applies to every file and is limited to each file’s length. Scans outside the range remain in order and unchanged; selected scans become two pages. A range beyond the end selects nothing.
6. Choose left-to-right or right-to-left reading order. One input downloads as a PDF; multiple inputs download together as a ZIP of separate PDFs.

You can focus a crop frame with Tab. Arrow keys move it; Shift + arrow keys resize it; Alt makes adjustments smaller.

PDF processing happens entirely in the browser using locally bundled PDF.js and pdf-lib. There is no upload service, external font service, analytics, or required API key. Export reuses the original PDF content and scanned images without rasterizing the pages again. The original file is unchanged.

## Checks

```sh
npm test              # crop geometry and PDF export tests
npm run test:e2e      # real Chromium upload/edit/download tests
npm run build        # production bundle
```

Browser tests use `/usr/bin/chromium` when available. Else install Playwright's Chromium with `npx playwright install chromium`, or set `CHROMIUM_PATH` to a system Chromium executable. Tests start their own Vite server and create their own sample PDFs, including rotated, offset-crop, and image-based pages.

## Limits

- Password-protected PDFs must be unlocked before importing.
- Files and crop settings are held in memory. Refreshing or removing a PDF discards its edits; very large PDFs depend on available browser memory.
- This is rectangular cropping and splitting, without OCR, deskewing, curved-page correction, or automatic gutter detection.
- The export creates new pages. Interactive annotations, bookmarks, forms, and document metadata are not carried over. Existing text content is retained where it is part of the PDF page content.
- Cropping is **not secure redaction**. Underlying content outside the visible crop can remain embedded in the exported file.

## Standalone browser version

`npm run build:standalone` creates `standalone/folio.html`, with all code, styles, and the PDF worker embedded. Download this file and open it in a modern browser to use the app without a server or npm installation. This version uses the same editor and export code as the normal build.


## File size and scan quality

Each original scan is embedded once and reused by both output pages. Image and font resources shared across scans are copied once per document. Scanned images retain their original compression and resolution; they are not recompressed or rasterized. ZIP export stores PDFs without extra compression to avoid unnecessary CPU and memory use.

A representative size regression with three pages sharing a 1.2 MB scan image exports six pages at **100.17% of the original size**, instead of duplicating the image data. Exact sizes vary: PDF structures, page content streams, and extra page records introduce overhead, especially in very small PDFs. Output cannot be guaranteed byte-for-byte the original size. The completion message reports actual original and output PDF sizes. If no scans match, the original PDF bytes are returned untouched.

## Publish after testing

The downloadable standalone HTML allows testing before anything is hosted. Hosting the web app does not upload visitors’ PDFs; processing remains local in their browsers.

### GitHub Pages

1. Push this project to `haydenkress/pdf_page_spreader` on `main`.
2. Open the repository’s **Settings → Pages** and choose **GitHub Actions** as the source.
3. In **Actions**, run **Test and publish Folio to GitHub Pages** (or push another commit to `main`). The workflow runs the unit tests, Chromium browser tests, and production build, then publishes `dist/`.
4. Use the URL shown by the deployment job. The expected URL is `https://haydenkress.github.io/pdf_page_spreader/`, but it is not live until the deployment succeeds.

Vite uses relative asset paths, so the app works under the repository subdirectory as well as at a domain root. No API keys or repository-stored deployment credentials are required; GitHub Actions uses its scoped deployment token. Repository or organization policy must permit Pages.

### Vercel

Import the GitHub repository into Vercel, select the **Vite** framework, and deploy. The included `vercel.json` specifies `npm ci`, `npm run build`, and the `dist` output directory. No environment variables are required. Vercel provides the deployment URL after a successful build.


## Irregular hand-scanned books

Use **Split page size → Uniform** (the default) to give every split page in a book the same dimensions: half the width and the full height of its first selected scan, after accounting for rotation. Use **A4** or **US Letter** to give split pages across every book the same standard dimensions. Each crop is fitted proportionally and centered, with white padding as needed. Content is never stretched, clipped further, or rasterized to achieve this. Output thumbnails show the padding.

For scans that drift, first set a good pair of frames and apply them to the book or batch. Then move or resize frames on individual scans to follow the page edges; output dimensions stay fixed. **Match each crop’s dimensions** restores tight pages with no uniform-size padding. Scans outside the split range retain their original dimensions.

JBIG2 and JPEG 2000 image decoders are bundled locally, including in the standalone HTML. No CDN is needed to preview scans using these formats. Third-party notices are supplied in `public/THIRD_PARTY_NOTICES.txt` and embedded in the standalone document.
