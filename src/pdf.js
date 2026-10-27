import { PDFDocument, degrees, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from 'pdf-lib';

export const defaultCrops = () => ({ left: { x: 0, y: 0, w: .5, h: 1, angle: 0 }, right: { x: .5, y: 0, w: .5, h: 1, angle: 0 } });
export const copyCrops = crops => structuredClone(crops);
export function constrainCrop(crop) {
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const x = Math.max(0, Math.min(.99, finite(crop.x, 0)));
  const y = Math.max(0, Math.min(.99, finite(crop.y, 0)));
  return { x, y, w: Math.max(.01, Math.min(1 - x, finite(crop.w, .5))), h: Math.max(.01, Math.min(1 - y, finite(crop.h, 1))), angle: Math.max(-15,Math.min(15,finite(crop.angle,0))) };
}
// Angles are clockwise in the scan preview; export removes that tilt.
export function resizeCrop(crop, handle, dx, dy, width, height) {
  const theta=(crop.angle||0)*Math.PI/180,cos=Math.cos(theta),sin=Math.sin(theta);
  const localX=cos*dx*width+sin*dy*height,localY=-sin*dx*width+cos*dy*height;
  let left=-crop.w*width/2,right=-left,top=-crop.h*height/2,bottom=-top;
  if(handle.includes('w')) left=Math.min(right-.01*width,left+localX);
  if(handle.includes('e')) right=Math.max(left+.01*width,right+localX);
  if(handle.includes('n')) top=Math.min(bottom-.01*height,top+localY);
  if(handle.includes('s')) bottom=Math.max(top+.01*height,bottom+localY);
  const cx=(left+right)/2,cy=(top+bottom)/2,w=(right-left)/width,h=(bottom-top)/height;
  return constrainCrop({...crop,x:crop.x+crop.w/2+(cos*cx-sin*cy)/width-w/2,y:crop.y+crop.h/2+(sin*cx+cos*cy)/height-h/2,w,h});
}
export function cropPlacement(view, rotation, crop, targetSize) {
  const sourceW=view[2]-view[0],sourceH=view[3]-view[1];
  const [visualW,visualH]=rotation%180?[sourceH,sourceW]:[sourceW,sourceH];
  const cropW=crop.w*visualW,cropH=crop.h*visualH;
  const [width,height]=targetSize||[cropW,cropH];
  const scale=Math.min(width/cropW,height/cropH),offsetX=(width-cropW*scale)/2,offsetY=(height-cropH*scale)/2;
  const cx=(crop.x+crop.w/2)*visualW,cy=(crop.y+crop.h/2)*visualH;
  // Position of the embedded scan's PDF origin in visual (top-down) coordinates.
  const [vx,vy]=rotation===90?[0,0]:rotation===180?[sourceW,0]:rotation===270?[sourceH,sourceW]:[0,sourceH];
  const angle=crop.angle||0,theta=angle*Math.PI/180,cos=Math.cos(theta),sin=Math.sin(theta);
  const localX=cos*(vx-cx)+sin*(vy-cy)+cropW/2;
  const localY=-sin*(vx-cx)+cos*(vy-cy)+cropH/2;
  return {width,height,scale,offsetX,offsetY,cropW,cropH,x:offsetX+scale*localX,y:offsetY+scale*(cropH-localY),rotation:angle-rotation};
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
        const placement=cropPlacement(view,rotation,crops[i][side],targetSize);
        const {width,height,scale,offsetX,offsetY,cropW,cropH,x,y}=placement;
        const page=result.addPage([width,height]);
        // Deskew the original shared scan within an upright, clipped rectangle.
        // White page margins remain outside; neighboring content cannot bleed in.
        page.pushOperators(pushGraphicsState(),rectangle(offsetX,offsetY,cropW*scale,cropH*scale),clip(),endPath());
        page.drawPage(embedded,{x,y,xScale:scale,yScale:scale,rotate:degrees(placement.rotation)});
        page.pushOperators(popGraphicsState());
      }
    }
    onProgress(i+1,source.getPageCount());
    await new Promise(resolve => setTimeout(resolve,0));
  }
  result.setCreator('Folio — PDF Page Spreader');
  return result.save({useObjectStreams:true});
}
