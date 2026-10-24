import './style.css';
import { pdfOptions } from './pdf-assets.js';
import * as pdfjs from 'pdfjs-dist';
import { zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { defaultCrops, copyCrops, constrainCrop, splitPdf, parseRanges, splitPageSize } from './pdf.js';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const $ = id => document.getElementById(id);
const state = { files: [], fileIndex: -1, doc: null, docTask: null, bytes: null, name: '', page: 0, crops: [], views: [], side: 'left', rendering: false, exporting: false, loading: false, renderId: 0 };
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
    frame.classList.toggle('selected',state.side===side);
    frame.setAttribute('aria-label',`${side} page crop. Use arrow keys to move, Shift and arrow keys to resize.`);
    const source = $('pdf-canvas'), target = $(`${side}-preview`);
    const w = Math.max(1,Math.round(source.width*rect.w)), h = Math.max(1,Math.round(source.height*rect.h));
    let targetSize=null;
    try {const selected=parseRanges($('page-range').value,state.doc.numPages), first=Math.min(...selected);
      if(Number.isFinite(first)) targetSize=splitPageSize(state.views[first],state.rotations[first],$('page-sizing').value);
    } catch {}
    const ratio=targetSize ? targetSize[0]/targetSize[1] : w/h;
    target.width = Math.max(1,Math.min(600,Math.round(180*ratio))); target.height = 180;
    const ctx=target.getContext('2d'),scale=Math.min(target.width/w,target.height/h);
    ctx.fillStyle='#fff';ctx.fillRect(0,0,target.width,target.height);
    ctx.drawImage(source,source.width*rect.x,source.height*rect.y,w,h,(target.width-w*scale)/2,(target.height-h*scale)/2,w*scale,h*scale);
  }
  for (const key of ['x','y','w','h']) $(`crop-${key}`).value = Number((crops[state.side][key]*100).toFixed(1));
}
for (const side of ['left','right']) {
  const frame = document.createElement('div');
  frame.className = `crop-frame ${side}`;
  frame.dataset.side = side;
  frame.tabIndex = 0;
  frame.setAttribute('role','group');
  frame.innerHTML = `<span class="crop-label">${side.toUpperCase()} PAGE</span>${['nw','ne','sw','se'].map(h=>`<span class="handle" data-handle="${h}" aria-hidden="true"></span>`).join('')}`;
  $('crop-overlay').append(frame);
  frame.addEventListener('focus',() => selectSide(side));
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
  frame.focus({preventScroll:true});
  drag = { id:event.pointerId, side:frame.dataset.side, startX:event.clientX, startY:event.clientY, rect:{...state.crops[state.page][frame.dataset.side]}, handle:event.target.dataset.handle, bounds:$('crop-overlay').getBoundingClientRect() };
  $('crop-overlay').setPointerCapture(event.pointerId);
});
$('crop-overlay').addEventListener('pointermove',event => {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = (event.clientX-drag.startX)/drag.bounds.width, dy = (event.clientY-drag.startY)/drag.bounds.height;
  const original = drag.rect, rect = {...original};
  if (!drag.handle) {
    rect.x = Math.max(0,Math.min(1-rect.w,rect.x+dx));
    rect.y = Math.max(0,Math.min(1-rect.h,rect.y+dy));
  } else {
    if (drag.handle.includes('w')) { rect.x=Math.max(0,Math.min(original.x+original.w-.01,original.x+dx)); rect.w=original.x+original.w-rect.x; }
    if (drag.handle.includes('e')) rect.w=Math.max(.01,Math.min(1-original.x,original.w+dx));
    if (drag.handle.includes('n')) { rect.y=Math.max(0,Math.min(original.y+original.h-.01,original.y+dy)); rect.h=original.y+original.h-rect.y; }
    if (drag.handle.includes('s')) rect.h=Math.max(.01,Math.min(1-original.y,original.h+dy));
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
  if (!file || state.loading || state.exporting) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { notice('Please choose a PDF file.',true); return; }
  state.loading=true; document.body.classList.add('busy'); notice('Opening your PDF…');
  $('open-file').disabled=true; $('replace-file').disabled=true;
  let newDoc, newTask;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Keep a separate copy: PDF.js transfers ownership of its data to the worker.
    const task = newTask = pdfjs.getDocument({data:bytes.slice(),...pdfOptions});
    task.onPassword = () => task.destroy();
    try { newDoc = await task.promise; } catch (error) {
      throw new Error(error.name === 'PasswordException' || /destroyed/i.test(error.message) ? 'Password-protected PDFs are not supported. Open an unlocked copy instead.' : 'This PDF could not be opened. It may be damaged or encrypted.');
    }
    // pdf-lib must also be able to read the file before editing is offered.
    await PDFDocument.load(bytes);
    const views=[],rotations=[];
    for (let i=1;i<=newDoc.numPages;i++) { const page=await newDoc.getPage(i);views.push(page.view);rotations.push(page.rotate); }
    if (renderTask) { renderTask.cancel(); try { await renderTask.promise; } catch {} }
    saveCurrent();
    Object.assign(state,{doc:newDoc,docTask:task,bytes,name:file.name,page:0,crops:Array.from({length:newDoc.numPages},defaultCrops),views,rotations,side:'left'});
    state.files.push({doc:state.doc,docTask:task,bytes,name:file.name,page:0,crops:state.crops,views,rotations});
    state.fileIndex=state.files.length-1;
    refreshFiles();
    newDoc=null; newTask=null;
    $('filename').textContent = file.name;
    $('document-meta').textContent = `${state.doc.numPages} scans · ${state.doc.numPages*2} output pages · ${(file.size/1024/1024).toFixed(1)} MB`;
    $('page-count').textContent = `of ${state.doc.numPages}`; $('page-number').max=state.doc.numPages;
    $('editor').hidden=false; $('empty-guide').hidden=true; $('drop-zone').hidden=true;
    notice(''); selectSide('left'); await renderPage(); return true;
  } catch (error) { if (newTask) await newTask.destroy(); notice(`${file.name}: ${error.message}`,true); return false; }
  finally { state.loading=false; document.body.classList.remove('busy'); $('open-file').disabled=false; $('replace-file').disabled=false; $('file-input').value=''; }
}
$('open-file').onclick = $('replace-file').onclick = () => { if (!state.exporting && !state.loading) $('file-input').click(); };
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
  if(state.loading || state.exporting) return;
  const failed=[];
  for(const file of files) if(!await openFile(file)) failed.push(file.name);
  if(failed.length) notice(`These files could not be opened: ${failed.join(', ')}. They may be damaged, encrypted, or not PDFs. Other files remain available.`,true);
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
$('remove-file').onclick=async()=>{
  if(state.loading || state.exporting || state.rendering) return;
  const [removed]=state.files.splice(state.fileIndex,1);state.fileIndex=-1;
  if(renderTask) {renderTask.cancel();try{await renderTask.promise;}catch{}}
  await removed.docTask.destroy();
  if(state.files.length) await activateFile(0);
  else { state.doc=null;$('editor').hidden=true;$('drop-zone').hidden=false;$('empty-guide').hidden=false;notice(''); }
};
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
