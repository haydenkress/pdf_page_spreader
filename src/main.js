import './style.css';
import { pdfOptions } from './pdf-assets.js';
import * as pdfjs from 'pdfjs-dist';
import { zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { defaultCrops, copyCrops, constrainCrop, splitPdf, parseRanges, splitPageSize, resizeCrop } from './pdf.js';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const $ = id => document.getElementById(id);
const state = { stage: 'upload', files: [], fileIndex: -1, doc: null, docTask: null, bytes: null, name: '', page: 0, crops: [], views: [], side: 'left', rendering: false, exporting: false, loading: false, renderId: 0 };
let renderTask;
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error',error);
  $('notice').hidden = !message;
}
function navigation() {
  $('previous').disabled = state.page === 0 || state.rendering || state.exporting;
  $('next').disabled = !state.doc || state.page === state.doc.numPages-1 || state.rendering || state.exporting;
  $('page-number').value = state.page+1;
  $('page-number').disabled = state.rendering || state.exporting;
  $('export').disabled = state.rendering || state.exporting || !state.doc;
  rangeSummary();
  $('crop-overlay').style.pointerEvents = state.rendering || state.exporting ? 'none' : '';
}
function selectSide(side) {
  state.side = side;
  for (const s of ['left','right']) {
    $(`select-${s}`).classList.toggle('active',s===side);
    $(`select-${s}`).setAttribute('aria-pressed',String(s===side));
  }
  updateFrames();
}
function updateFrames() {
  if (!state.doc) return;
  const crops = state.crops[state.page];
  for (const side of ['left','right']) {
    const rect = crops[side];
    const frame = document.querySelector(`.crop-frame.${side}`);
    frame.style.left = `${rect.x*100}%`;
    frame.style.top = `${rect.y*100}%`;
    frame.style.width = `${rect.w*100}%`;
    frame.style.height = `${rect.h*100}%`;
    frame.style.transform = `rotate(${rect.angle||0}deg)`;
    frame.classList.toggle('selected',state.side===side);
    frame.setAttribute('aria-label',`${side} page crop. Use arrow keys to move, Shift and arrow keys to resize. Use the tilt handle or tilt controls to straighten.`);
    const source = $('pdf-canvas'), target = $(`${side}-preview`);
    const w=source.width*rect.w,h=source.height*rect.h;
    let targetSize=null;
    try {const selected=parseRanges($('page-range').value,state.doc.numPages), first=Math.min(...selected);
      if(Number.isFinite(first)) targetSize=splitPageSize(state.views[first],state.rotations[first],$('page-sizing').value);
    } catch {}
    const ratio=targetSize ? targetSize[0]/targetSize[1] : w/h;
    target.width = Math.max(1,Math.min(600,Math.round(180*ratio))); target.height = 180;
    const ctx=target.getContext('2d'),scale=Math.min(target.width/w,target.height/h);
    ctx.fillStyle='#fff';ctx.fillRect(0,0,target.width,target.height);
    ctx.save();ctx.beginPath();ctx.rect((target.width-w*scale)/2,(target.height-h*scale)/2,w*scale,h*scale);ctx.clip();
    ctx.translate(target.width/2,target.height/2);ctx.scale(scale,scale);ctx.rotate(-(rect.angle||0)*Math.PI/180);
    ctx.translate(-(rect.x+rect.w/2)*source.width,-(rect.y+rect.h/2)*source.height);ctx.drawImage(source,0,0);ctx.restore();
  }
  $('crop-angle').value=crops[state.side].angle||0;
  $('crop-angle-number').value=Number((crops[state.side].angle||0).toFixed(1));
  for (const key of ['x','y','w','h']) $(`crop-${key}`).value = Number((crops[state.side][key]*100).toFixed(1));
}
for (const side of ['left','right']) {
  const frame = document.createElement('div');
  frame.className = `crop-frame ${side}`;
  frame.dataset.side = side;
  frame.tabIndex = 0;
  frame.setAttribute('role','group');
  frame.innerHTML = `<span class="crop-label">${side.toUpperCase()} PAGE</span><button type="button" class="rotation-handle" data-handle="rotate" aria-label="Rotate ${side} page crop" title="Drag to tilt; arrow keys adjust; Home resets"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6"/></svg></button>${['nw','ne','sw','se'].map(h=>`<span class="handle" data-handle="${h}" aria-hidden="true"></span>`).join('')}`;
  $('crop-overlay').append(frame);
  frame.addEventListener('focus',() => selectSide(side));
  const rotationHandle=frame.querySelector('.rotation-handle');
  rotationHandle.addEventListener('focus',()=>selectSide(side));
  rotationHandle.addEventListener('keydown',event=>{
    if(state.rendering||state.exporting||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const rect=state.crops[state.page][side],delta=event.shiftKey?1:.1;
    const angle=event.key==='Home'?0:(rect.angle||0)+(['ArrowRight','ArrowDown'].includes(event.key)?delta:-delta);
    state.crops[state.page][side]=constrainCrop({...rect,angle});updateFrames();
  });
  frame.addEventListener('keydown',event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) || state.rendering || state.exporting) return;
    event.preventDefault();
    const rect = {...state.crops[state.page][side]}, delta = event.altKey ? .001 : .005;
    if (event.shiftKey) {
      if (event.key === 'ArrowLeft') rect.w-=delta;
      if (event.key === 'ArrowRight') rect.w+=delta;
      if (event.key === 'ArrowUp') rect.h-=delta;
      if (event.key === 'ArrowDown') rect.h+=delta;
    } else {
      if (event.key === 'ArrowLeft') rect.x-=delta;
      if (event.key === 'ArrowRight') rect.x=Math.min(1-rect.w,rect.x+delta);
      if (event.key === 'ArrowUp') rect.y-=delta;
      if (event.key === 'ArrowDown') rect.y=Math.min(1-rect.h,rect.y+delta);
    }
    state.crops[state.page][side] = constrainCrop(rect); updateFrames();
  });
}
let drag = null;
$('crop-overlay').addEventListener('pointerdown',event => {
  const frame = event.target.closest('.crop-frame');
  if (!frame || state.rendering || state.exporting || event.button !== 0) return;
  event.preventDefault();
  selectSide(frame.dataset.side);
  (event.target.closest('.rotation-handle')||frame).focus({preventScroll:true});
  drag = { id:event.pointerId, side:frame.dataset.side, startX:event.clientX, startY:event.clientY, rect:{...state.crops[state.page][frame.dataset.side]}, handle:event.target.closest('[data-handle]')?.dataset.handle, bounds:$('crop-overlay').getBoundingClientRect() };
  drag.centerX=drag.bounds.left+(drag.rect.x+drag.rect.w/2)*drag.bounds.width;
  drag.centerY=drag.bounds.top+(drag.rect.y+drag.rect.h/2)*drag.bounds.height;
  drag.startAngle=Math.atan2(event.clientY-drag.centerY,event.clientX-drag.centerX);
  $('crop-overlay').setPointerCapture(event.pointerId);
});
$('crop-overlay').addEventListener('pointermove',event => {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = (event.clientX-drag.startX)/drag.bounds.width, dy = (event.clientY-drag.startY)/drag.bounds.height;
  const original = drag.rect, rect = {...original};
  if (!drag.handle) {
    rect.x = Math.max(0,Math.min(1-rect.w,rect.x+dx));
    rect.y = Math.max(0,Math.min(1-rect.h,rect.y+dy));
  } else if(drag.handle==='rotate') {
    const angle=Math.atan2(event.clientY-drag.centerY,event.clientX-drag.centerX)-drag.startAngle;
    rect.angle=Math.round(((original.angle||0)+Math.atan2(Math.sin(angle),Math.cos(angle))*180/Math.PI)*10)/10;
  } else {
    Object.assign(rect,resizeCrop(original,drag.handle,dx,dy,drag.bounds.width,drag.bounds.height));
  }
  state.crops[state.page][drag.side] = constrainCrop(rect); updateFrames();
});
for (const type of ['pointerup','pointercancel','lostpointercapture']) $('crop-overlay').addEventListener(type,()=>{drag=null;});
for (const side of ['left','right']) $(`select-${side}`).onclick = () => selectSide(side);
for (const key of ['x','y','w','h']) $(`crop-${key}`).addEventListener('change',event => {
  const value = event.target.valueAsNumber;
  if (Number.isFinite(value)) state.crops[state.page][state.side] = constrainCrop({...state.crops[state.page][state.side],[key]:value/100});
  updateFrames();
});
for(const id of ['crop-angle','crop-angle-number']) $(id).addEventListener(id==='crop-angle'?'input':'change',event=>{
  const angle=event.target.valueAsNumber;
  if(Number.isFinite(angle))state.crops[state.page][state.side]=constrainCrop({...state.crops[state.page][state.side],angle});
  updateFrames();
});
$('reset-angle').onclick=()=>{state.crops[state.page][state.side].angle=0;updateFrames();};
async function renderPage() {
  const id = ++state.renderId;
  if (renderTask) { renderTask.cancel(); try { await renderTask.promise; } catch {} }
  state.rendering = true; navigation(); $('render-loading').hidden = false;
  try {
    const page = await state.doc.getPage(state.page+1);
    if (id !== state.renderId) return;
    const base = page.getViewport({scale:1});
    const viewport = page.getViewport({scale:Math.min(2,1600/base.width,1600/base.height)});
    const canvas = $('pdf-canvas'); canvas.width=viewport.width; canvas.height=viewport.height;
    $('page-surface').style.maxWidth = `${Math.min(1000,600*base.width/base.height)}px`;
    renderTask = page.render({canvasContext:canvas.getContext('2d'),viewport});
    await renderTask.promise;
    if (id === state.renderId) updateFrames();
  } catch (error) { if (error.name !== 'RenderingCancelledException') notice(`Could not render this scan: ${error.message}`,true); }
  finally { if (id === state.renderId) { state.rendering=false; $('render-loading').hidden=true; navigation(); } }
}
async function openFile(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return false;
  let task;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // PDF.js transfers its copy to the worker; retain the original for export.
    task = pdfjs.getDocument({data:bytes.slice(),...pdfOptions});
    task.onPassword = () => task.destroy();
    const doc = await task.promise;
    await PDFDocument.load(bytes);
    const views=[],rotations=[];
    for(let i=1;i<=doc.numPages;i++) {const page=await doc.getPage(i);views.push(page.view);rotations.push(page.rotate);}
    state.files.push({doc,docTask:task,bytes,name:file.name,page:0,crops:Array.from({length:doc.numPages},defaultCrops),views,rotations});
    refreshFiles();return true;
  } catch {if(task) await task.destroy();return false;}
}
function showUpload() {
  saveCurrent();state.stage='upload';
  $('editor').hidden=true;$('drop-zone').hidden=false;
  refreshFiles();
}
$('open-file').onclick=()=>{if(!state.loading&&!state.exporting) $('file-input').click();};
$('replace-file').onclick=()=>{if(!state.loading&&!state.exporting&&!state.rendering){notice('');showUpload();$('open-file').focus();}};
$('start-cropping').onclick=async()=>{
  if(!state.files.length||state.loading||state.rendering) return;
  notice('');state.stage='crop';$('editor').hidden=false;$('drop-zone').hidden=true;$('file-review').hidden=true;$('empty-guide').hidden=true;
  await activateFile(state.fileIndex>=0?state.fileIndex:0);
  $('file-select').focus();
};
$('file-input').onchange = event => openFiles(Array.from(event.target.files));
for (const type of ['dragenter','dragover']) document.addEventListener(type,event => {event.preventDefault();$('drop-zone').classList.add('dragging');});
document.addEventListener('dragleave',event => {if (!event.relatedTarget) $('drop-zone').classList.remove('dragging');});
document.addEventListener('drop',event => {event.preventDefault();$('drop-zone').classList.remove('dragging');openFiles(Array.from(event.dataTransfer.files));});
async function navigate(page) {
  if (!state.doc || state.rendering || state.exporting || state.loading) return;
  state.page = Math.max(0,Math.min(state.doc.numPages-1,page)); await renderPage();
}
$('previous').onclick = () => navigate(state.page-1);
$('next').onclick = () => navigate(state.page+1);
$('page-number').onchange = event => { const page=event.target.valueAsNumber; if (Number.isInteger(page)) navigate(page-1); else navigation(); };
$('apply-all').onclick = () => {
  const crops = state.crops[state.page]; state.crops = state.crops.map(()=>copyCrops(crops));
  notice(`Both frames applied to all ${state.doc.numPages} scans. You can still adjust each scan individually.`);
};
$('reset').onclick = () => {state.crops[state.page]=defaultCrops();updateFrames();notice('This scan has been reset to equal halves.');};
function saveCurrent() {
  if (state.fileIndex >= 0) Object.assign(state.files[state.fileIndex],{page:state.page,crops:state.crops});
}
function refreshFiles() {
  $('file-select').replaceChildren(...state.files.map((file,i)=>{
    const option=document.createElement('option');option.value=i;option.textContent=file.name;return option;
  }));
  $('file-select').value=state.fileIndex;
  $('export').innerHTML=state.files.length>1 ? 'Split & download all (ZIP) ↓' : 'Split & download PDF ↓';
  $('file-review').hidden=state.stage!=='upload'||!state.files.length;
  $('empty-guide').hidden=state.stage!=='upload'||!!state.files.length;
  const scans=state.files.reduce((sum,file)=>sum+file.doc.numPages,0);
  $('review-summary').textContent=`${state.files.length} PDF${state.files.length===1?'':'s'} · ${scans} scans · ready for your review`;
  $('start-cropping').disabled=state.loading||!state.files.length;
  $('file-list').replaceChildren(...state.files.map((file,i)=>{
    const item=document.createElement('li'),badge=document.createElement('span'),details=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('span'),remove=document.createElement('button');
    badge.className='pdf-badge';badge.textContent='PDF';details.className='review-file-details';name.textContent=file.name;
    meta.textContent=`${file.doc.numPages} scans · ${(file.bytes.length/1024/1024).toFixed(1)} MB`;
    details.append(name,meta);remove.className='subtle';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove ${file.name}`);remove.disabled=state.loading;
    remove.onclick=()=>removeFile(i);item.append(badge,details,remove);return item;
  }));
}
function rangeSummary() {
  if (!state.doc) return;
  try {
    const selected=parseRanges($('page-range').value,state.doc.numPages);
    $('page-range').setCustomValidity('');
    $('range-summary').textContent=`This file: ${selected.size} of ${state.doc.numPages} scans split → ${state.doc.numPages+selected.size} pages. Current scan: ${selected.has(state.page)?'split':'kept unchanged'}.`;
    $('crop-overlay').hidden=!selected.has(state.page);
  } catch(error) {
    $('page-range').setCustomValidity(error.message);$('range-summary').textContent=error.message;
    $('export').disabled=true;
  }
}
$('page-range').oninput=()=>{navigation();updateFrames();};
$('page-sizing').onchange=()=>{updateFrames();};
async function openFiles(files) {
  if(state.loading||state.exporting||state.rendering||!files.length) return;
  showUpload();state.loading=true;document.body.classList.add('busy');
  $('drop-zone').setAttribute('aria-busy','true');$('open-file').disabled=true;refreshFiles();
  const failed=[];
  try {
    for(const [i,file] of files.entries()) {
      notice(`Opening PDF ${i+1} of ${files.length}: ${file.name}…`);
      if(!await openFile(file)) failed.push(file.name);
    }
    if(failed.length) notice(`These files could not be opened: ${failed.join(', ')}. They may be damaged, encrypted, or not PDFs. Other files remain available.`,true);
    else notice('');
  } finally {
    state.loading=false;document.body.classList.remove('busy');$('drop-zone').setAttribute('aria-busy','false');$('open-file').disabled=false;$('file-input').value='';refreshFiles();
  }
}
async function activateFile(index) {
  if(state.loading || state.exporting || state.rendering) { $('file-select').value=state.fileIndex;return; }
  saveCurrent();state.fileIndex=index;
  Object.assign(state,state.files[index]);
  $('filename').textContent=state.name;
  $('document-meta').textContent=`${state.doc.numPages} scans · ${(state.bytes.length/1024/1024).toFixed(1)} MB`;
  $('page-count').textContent=`of ${state.doc.numPages}`;$('page-number').max=state.doc.numPages;
  refreshFiles();await renderPage();
}
$('file-select').onchange=event=>activateFile(Number(event.target.value));
async function removeFile(index) {
  if(state.loading||state.exporting||state.rendering) return;
  saveCurrent();const [removed]=state.files.splice(index,1);
  if(index===state.fileIndex) {state.fileIndex=-1;state.doc=null;}
  else if(index<state.fileIndex) state.fileIndex--;
  await removed.docTask.destroy();refreshFiles();
  if(!state.files.length) {showUpload();notice('');}
  else if(state.stage==='crop'&&state.fileIndex<0) await activateFile(0);
}
$('remove-file').onclick=()=>removeFile(state.fileIndex);
$('apply-batch').onclick=()=>{
  const crops=copyCrops(state.crops[state.page]);saveCurrent();
  for(const file of state.files) file.crops=file.crops.map(()=>copyCrops(crops));
  state.crops=state.files[state.fileIndex].crops;updateFrames();
  notice(`Both frames applied to every scan in all ${state.files.length} files. Ranges determine which scans are split.`);
};
function download(bytes,name,type) {
  const url=URL.createObjectURL(new Blob([bytes],{type}));const link=document.createElement('a');link.href=url;link.download=name;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
$('export').onclick = async () => {
  if (!state.doc || state.rendering || state.exporting || state.loading) return;
  const range=$('page-range').value;
  try{for(const file of state.files) parseRanges(range,file.doc.numPages);}catch(error){notice(error.message,true);return;}
  saveCurrent();state.exporting=true;document.body.classList.add('busy');navigation();$('replace-file').disabled=true;
  try {
    const outputs=Object.create(null);let inputSize=0,outputSize=0,pages=0;
    for(const [index,file] of state.files.entries()) {
      const bytes=await splitPdf(file.bytes,file.crops,file.views,$('reading-order').value,(n,total)=>notice(`File ${index+1}/${state.files.length}: ${file.name} — processing scan ${n} of ${total}…`),range,{sizing:$('page-sizing').value});
      const base=file.name.replace(/[\\/]/g,'_').replace(/\.pdf$/i,'')+'-split.pdf';
      let name=base,suffix=2;
      while(Object.hasOwn(outputs,name)) name=`${suffix++}-${base}`;
      outputs[name]=bytes;inputSize+=file.bytes.length;outputSize+=bytes.length;pages+=file.doc.numPages+parseRanges(range,file.doc.numPages).size;
    }
    if(state.files.length===1) {const [name,bytes]=Object.entries(outputs)[0];download(bytes,name,'application/pdf');}
    else download(zipSync(outputs,{level:0}),'folio-split-books.zip','application/zip');
    notice(`Download started: ${state.files.length} file(s), ${pages} individual pages. PDFs: ${(inputSize/1024/1024).toFixed(2)} MB → ${(outputSize/1024/1024).toFixed(2)} MB (${Math.round(outputSize/inputSize*100)}% of original). Original scan quality preserved.`);
  } catch(error) {notice(`Could not export: ${error.message}`,true);}
  finally {state.exporting=false;document.body.classList.remove('busy');navigation();$('replace-file').disabled=false;}
};
