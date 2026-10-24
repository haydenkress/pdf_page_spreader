import jbig2 from 'pdfjs-dist/wasm/jbig2.wasm?url';
import openjpeg from 'pdfjs-dist/wasm/openjpeg.wasm?url';

// Route decoding assets through the main thread so the very same renderer works
// with Vite's hashed asset URLs and with an offline, standalone HTML document.
const decoders = { 'jbig2.wasm': jbig2, 'openjpeg.wasm': openjpeg };
class DecoderDataFactory {
  async fetch({ kind, filename }) {
    const url = kind === 'wasmUrl' && decoders[filename];
    if (!url) throw new Error(`PDF resource is not bundled: ${kind}/${filename}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load the PDF image decoder: ${filename}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
export const pdfOptions = {
  isEvalSupported: false,
  useWorkerFetch: false,
  BinaryDataFactory: DecoderDataFactory,
};
