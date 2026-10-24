import { PDFDocument, degrees, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from 'pdf-lib';

export const defaultCrops = () => ({ left: { x: 0, y: 0, w: .5, h: 1 }, right: { x: .5, y: 0, w: .5, h: 1 } });
export const copyCrops = crops => structuredClone(crops);
export function constrainCrop(crop) {
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const x = Math.max(0, Math.min(.99, finite(crop.x, 0)));
  const y = Math.max(0, Math.min(.99, finite(crop.y, 0)));
  return { x, y, w: Math.max(.01, Math.min(1 - x, finite(crop.w, .5))), h: Math.max(.01, Math.min(1 - y, finite(crop.h, 1))) };
}
export function cropBounds(view, rotation, crop) {
  const [x0, y0, x1, y1] = view, w = x1-x0, h = y1-y0;
  const point = (u,v) => {
    switch (rotation) {
      case 90: return [x0+v*w, y0+u*h];
      case 180: return [x0+(1-u)*w, y0+v*h];
      case 270: return [x0+(1-v)*w, y0+(1-u)*h];
      default: return [x0+u*w, y0+(1-v)*h];
    }
  };
  const a = point(crop.x,crop.y), b = point(crop.x+crop.w,crop.y+crop.h);
  return { left: Math.min(a[0],b[0]), bottom: Math.min(a[1],b[1]), right: Math.max(a[0],b[0]), top: Math.max(a[1],b[1]) };
}
// Blank selects all scans. Open ends are intersected with each document's length.
export function parseRanges(text, count) {
  if (!text.trim()) return new Set(Array.from({length:count},(_,i)=>i));
  const selected = new Set();
  for (const part of text.split(',')) {
    const value = part.trim();
    const match = /^(?:(\d+)|(\d*)\s*-\s*(\d*))$/.exec(value);
    if (!match || (!match[1] && !match[2] && !match[3])) throw new Error('Use ranges like 3-8, -8, 8-, or 1, 3-8.');
    const start = Number(match[1] || match[2] || 1);
    const end = Number(match[1] || match[3] || count);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < 1 || (match[2] && match[3] && start > end)) throw new Error('Page numbers must be positive, with the start no larger than the end.');
    for(let n=start;n<=Math.min(end,count);n++) selected.add(n-1);
  }
  return selected;
}
export function splitPageSize(view, rotation, sizing = 'uniform') {
  if(sizing === 'crop') return null;
  if(sizing === 'a4') return [595.276,841.89];
  if(sizing === 'letter') return [612,792];
  const w=view[2]-view[0],h=view[3]-view[1];
  return rotation % 180 ? [h/2,w] : [w/2,h];
}
export async function splitPdf(bytes, crops, pageViews, order = 'ltr', onProgress = () => {}, range = '', { sizing = 'uniform' } = {}) {
  const source = await PDFDocument.load(bytes);
  const result = await PDFDocument.create();
  const selected = parseRanges(range,source.getPageCount());
  if (!selected.size) return bytes.slice();
  const first=Math.min(...selected);
  const targetSize=splitPageSize(pageViews[first],source.getPage(first).getRotation().angle,sizing);
  // One copier for the entire document retains shared image/font resources.
  const copied = await result.copyPages(source,source.getPageIndices());
  for (let i=0;i<source.getPageCount();i++) {
    if (!selected.has(i)) {
      result.addPage(copied[i]);
    } else {
      const rotation = ((source.getPage(i).getRotation().angle % 360) + 360) % 360;
      const view = pageViews[i];
      // Embed once in the SAME context. Both output pages reference this one form
      // and its original image streams; cropping never re-encodes the scans.
      const embedded = await result.embedPage(copied[i], {left:view[0],bottom:view[1],right:view[2],top:view[3]});
      for (const side of order === 'rtl' ? ['right','left'] : ['left','right']) {
        const bounds = cropBounds(view, rotation, crops[i][side]);
        const w = bounds.right-bounds.left, h = bounds.top-bounds.bottom;
        const dx=bounds.left-view[0],dy=bounds.bottom-view[1];
        const [cropW,cropH]=rotation % 180 ? [h,w] : [w,h];
        const [targetW,targetH]=targetSize || [cropW,cropH];
        const scale=Math.min(targetW/cropW,targetH/cropH);
        const offsetX=(targetW-cropW*scale)/2,offsetY=(targetH-cropH*scale)/2;
        const page = result.addPage([targetW,targetH]);
        const position = rotation === 90 ? {x:-dy,y:w+dx} : rotation === 180 ? {x:w+dx,y:h+dy} : rotation === 270 ? {x:h+dy,y:-dx} : {x:-dx,y:-dy};
        // Clip the crop before fitting it to the page, so the opposite book
        // page cannot bleed into the new white margins.
        page.pushOperators(pushGraphicsState(),rectangle(offsetX,offsetY,cropW*scale,cropH*scale),clip(),endPath());
        page.drawPage(embedded, { x:offsetX+position.x*scale,y:offsetY+position.y*scale,xScale:scale,yScale:scale,rotate: degrees(-rotation) });
        page.pushOperators(popGraphicsState());
      }
    }
    onProgress(i+1,source.getPageCount());
    await new Promise(resolve => setTimeout(resolve,0));
  }
  result.setCreator('Folio — PDF Page Spreader');
  return result.save({useObjectStreams:true});
}
