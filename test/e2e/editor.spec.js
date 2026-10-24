import { test, expect } from '@playwright/test';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import fs from 'node:fs/promises';
import { unzipSync } from 'fflate';
async function fixture() {
  const doc=await PDFDocument.create();
  for(const angle of [0,90,180,270]) {
    const p=doc.addPage([640,440]);p.setRotation(degrees(angle));p.setCropBox(20,20,600,400);
    p.drawRectangle({x:20,y:20,width:300,height:200,color:rgb(.9,.1,.1)});
    p.drawRectangle({x:320,y:20,width:300,height:200,color:rgb(.1,.2,.9)});
    p.drawRectangle({x:20,y:220,width:300,height:200,color:rgb(.2,.8,.2)});
    p.drawRectangle({x:320,y:220,width:300,height:200,color:rgb(.9,.7,.1)});
    p.drawText(`Scan ${angle}`,{x:50,y:250,size:20});
  }
  return Buffer.from(await doc.save());
}
async function startCropping(page) {
  await expect(page.locator('#start-cropping')).toBeEnabled();
  await page.locator('#start-cropping').click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#export')).toBeEnabled();
}
async function upload(page) {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({name:'book.pdf',mimeType:'application/pdf',buffer:await fixture()});
  await startCropping(page);
  await expect(page.locator('#render-loading')).toBeHidden();
  await expect(page.locator('#export')).toBeEnabled();
  await page.locator('#page-sizing').selectOption('crop');
}
test('rotated scans export with the same visual crops and order as the preview',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await upload(page);
  const expected=[];
  for(let i=0;i<4;i++) {
    if(i) {await page.locator('#next').click();await expect(page.locator('#page-number')).toHaveValue(String(i+1));await expect(page.locator('#export')).toBeEnabled();}
    expected.push(...await page.evaluate(()=>{
      const c=document.querySelector('#pdf-canvas'),ctx=c.getContext('2d');
      return [.25,.75].map(x=>[.25,.75].map(y=>Array.from(ctx.getImageData(Math.floor(c.width*x),Math.floor(c.height*y),1,1).data).slice(0,3)));
    }));
  }
  const downloaded=page.waitForEvent('download');await page.locator('#export').click();const file=await downloaded;
  expect(file.suggestedFilename()).toBe('book-split.pdf');
  const bytes=await fs.readFile(await file.path());const pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBe(8);
  const actual=await page.evaluate(async(data)=>{
    const pdfjs=await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const task=pdfjs.getDocument({data:new Uint8Array(data)});
    const doc=await task.promise;
    const result=[];
    for(let i=1;i<=doc.numPages;i++) {
      const p=await doc.getPage(i),v=p.getViewport({scale:1}),c=document.createElement('canvas');c.width=v.width;c.height=v.height;
      const ctx=c.getContext('2d');await p.render({canvasContext:ctx,viewport:v}).promise;
      result.push([.25,.75].map(y=>Array.from(ctx.getImageData(Math.floor(c.width*.5),Math.floor(c.height*y),1,1).data).slice(0,3)));
    }
    await task.destroy();return result;
  },Array.from(bytes));
  expect(actual).toEqual(expected);expect(errors).toEqual([]);
});
test('frames resize, persist per scan, apply to all, and export in reverse order',async({page})=>{
  await upload(page);
  await page.locator('#page-sizing').selectOption('crop');
  await page.locator('#crop-x').fill('5');await page.locator('#crop-x').press('Tab');
  await page.locator('#crop-w').fill('40');await page.locator('#crop-w').press('Tab');
  const frame=page.locator('.crop-frame.left');await frame.focus();await page.keyboard.press('ArrowRight');
  await expect(page.locator('#crop-x')).toHaveValue('5.5');
  const box=await page.locator('.crop-frame.left .handle[data-handle="se"]').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x-25,box.y-25);await page.mouse.up();
  const width=await page.locator('#crop-w').inputValue();expect(Number(width)).toBeLessThan(40);
  await page.locator('#next').click();await expect(page.locator('#export')).toBeEnabled();await expect(page.locator('#crop-x')).toHaveValue('0');
  await page.locator('#previous').click();await expect(page.locator('#export')).toBeEnabled();await expect(page.locator('#crop-x')).toHaveValue('5.5');
  await expect(page.locator('#crop-w')).toHaveValue(width);
  await page.locator('#apply-all').click();await page.locator('#next').click();await expect(page.locator('#export')).toBeEnabled();await expect(page.locator('#crop-x')).toHaveValue('5.5');
  await page.locator('#reading-order').selectOption('rtl');
  const downloaded=page.waitForEvent('download');await page.locator('#export').click();const pdf=await PDFDocument.load(await fs.readFile(await (await downloaded).path()));
  expect(pdf.getPage(0).getWidth()).toBe(300);expect(pdf.getPage(1).getWidth()).toBeLessThan(240);
  await expect(page.locator('#export')).toBeEnabled();await page.locator('#reset').click();await expect(page.locator('#crop-x')).toHaveValue('0');await expect(page.locator('#crop-w')).toHaveValue('50');
  await page.screenshot({path:'/tmp/folio-editor.png',fullPage:true});
});
test('invalid files report an error without losing the open book; mobile fits',async({page})=>{
  await page.setViewportSize({width:390,height:844});await upload(page);
  await page.locator('#file-input').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a pdf')});
  await expect(page.locator('#notice')).toContainText('could not be opened');await expect(page.locator('#filename')).toHaveText('book.pdf');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/folio-mobile.png',fullPage:true});
});

test('adding a second PDF retains the first and exports both in a ZIP',async({page})=>{
  await upload(page);
  const doc=await PDFDocument.create(),p=doc.addPage([400,200]);p.drawText('Second book');
  await page.locator('#file-input').setInputFiles({name:'second.pdf',mimeType:'application/pdf',buffer:Buffer.from(await doc.save())});
  await expect(page.locator('#file-list li')).toHaveCount(2);
  await startCropping(page);await page.locator('#file-select').selectOption('1');
  await expect(page.locator('#filename')).toHaveText('second.pdf');await expect(page.locator('#export')).toBeEnabled();
  const downloaded=page.waitForEvent('download');await page.locator('#export').click();const file=await downloaded;
  expect(file.suggestedFilename()).toBe('folio-split-books.zip');
  const zip=unzipSync(await fs.readFile(await file.path()));
  expect(Object.keys(zip)).toEqual(['book-split.pdf','second-split.pdf']);
  expect((await PDFDocument.load(zip['second-split.pdf'])).getPageCount()).toBe(2);
  expect((await PDFDocument.load(zip['book-split.pdf'])).getPageCount()).toBe(8);
});
test('scanned image content survives custom crop export',async({page})=>{
  await page.goto('/');
  const image=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=600;c.height=400;const ctx=c.getContext('2d');
    ctx.fillStyle='#f5efda';ctx.fillRect(0,0,600,400);ctx.fillStyle='#253b34';
    ctx.font='30px Georgia';ctx.fillText('A scanned book',40,100);ctx.fillText('The next page',340,100);
    ctx.fillStyle='#d89b64';ctx.fillRect(30,150,220,180);ctx.fillStyle='#75966b';ctx.fillRect(340,150,220,180);
    return c.toDataURL('image/png');
  });
  const source=await PDFDocument.create(),imagePage=source.addPage([600,400]);const png=await source.embedPng(image);imagePage.drawImage(png,{x:0,y:0,width:600,height:400});
  await page.locator('#file-input').setInputFiles({name:'scan.pdf',mimeType:'application/pdf',buffer:Buffer.from(await source.save())});
  await startCropping(page);
  await page.locator('#page-sizing').selectOption('crop');
  await page.locator('#crop-x').fill('5');await page.locator('#crop-x').press('Tab');
  await page.locator('#crop-y').fill('10');await page.locator('#crop-y').press('Tab');
  await page.locator('#crop-w').fill('40');await page.locator('#crop-w').press('Tab');
  await page.locator('#crop-h').fill('80');await page.locator('#crop-h').press('Tab');
  const downloaded=page.waitForEvent('download');await page.locator('#export').click();const file=await downloaded;
  const output=await PDFDocument.load(await fs.readFile(await file.path()));expect(output.getPage(0).getSize()).toEqual({width:240,height:320});
  await expect(page.locator('#notice')).toContainText('2 individual pages');
});

test('batch ranges preserve other pages and shared crops persist across files',async({page})=>{
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(['a.pdf','b.pdf'].map(name=>({name,mimeType:'application/pdf',buffer:Buffer.alloc(0)})));
  await expect(page.locator('#notice')).toContainText('could not be opened');
  const buffer=await fixture();
  await page.locator('#file-input').setInputFiles(['a.pdf','b.pdf'].map(name=>({name,mimeType:'application/pdf',buffer})));
  await expect(page.locator('#file-select option')).toHaveCount(2);await startCropping(page);
  await page.locator('#page-sizing').selectOption('crop');
  await page.locator('#crop-w').fill('40');await page.locator('#crop-w').press('Tab');await page.locator('#apply-batch').click();
  await page.locator('#file-select').selectOption('0');await expect(page.locator('#export')).toBeEnabled();await expect(page.locator('#crop-w')).toHaveValue('40');
  await page.locator('#page-range').fill('2-3');await expect(page.locator('#range-summary')).toContainText('2 of 4 scans split → 6 pages');
  await expect(page.locator('#crop-overlay')).toBeHidden();
  const downloaded=page.waitForEvent('download');await page.locator('#export').click();const zip=unzipSync(await fs.readFile(await (await downloaded).path()));
  for(const bytes of Object.values(zip)){
    const pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBe(6);
    expect(pdf.getPage(0).getSize()).toEqual({width:640,height:440});
    expect(pdf.getPage(1).getWidth()).toBe(160);
  }
  await page.locator('#page-range').fill('8-3');await expect(page.locator('#export')).toBeDisabled();
  await page.locator('#page-range').fill('-2');await expect(page.locator('#export')).toBeEnabled();
  await page.locator('#remove-file').click();await expect(page.locator('#file-select option')).toHaveCount(1);
});
test('large scan images are shared: splitting stays near original file size',async({page})=>{
  await page.goto('/');
  const image=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=1600;c.height=1000;const ctx=c.getContext('2d');const image=ctx.createImageData(c.width,c.height);
    let seed=42;for(let i=0;i<image.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;image.data[i]=seed&255;image.data[i+1]=(seed>>>8)&255;image.data[i+2]=(seed>>>16)&255;image.data[i+3]=255;}
    ctx.putImageData(image,0,0);return c.toDataURL('image/jpeg',.88);
  });
  const source=await PDFDocument.create(),jpg=await source.embedJpg(image);
  for(let i=0;i<3;i++){const p=source.addPage([800,500]);p.drawImage(jpg,{x:0,y:0,width:800,height:500});}
  const input=await source.save();
  await page.locator('#file-input').setInputFiles({name:'large-scans.pdf',mimeType:'application/pdf',buffer:Buffer.from(input)});
  await startCropping(page);
  const downloaded=page.waitForEvent('download');await page.locator('#export').click();const output=await fs.readFile(await (await downloaded).path());
  expect((await PDFDocument.load(output)).getPageCount()).toBe(6);
  expect(output.length/input.length).toBeLessThan(1.02);
  console.log(`Lossless scan-size regression: ${input.length} → ${output.length} bytes (${(output.length/input.length*100).toFixed(2)}%).`);
});

test('range field has readable text, a focus-hidden example, and preserves entered ranges',async({page})=>{
  await upload(page);const input=page.locator('#page-range');
  await expect(input).toHaveAttribute('placeholder','e.g., 2-10, -10, or 10-');
  await input.focus();expect(await input.evaluate(el=>getComputedStyle(el,'::placeholder').color)).toBe('rgba(0, 0, 0, 0)');
  await input.fill('2-3');expect(await input.evaluate(el=>getComputedStyle(el).color)).toBe('rgb(38, 61, 52)');
  await page.locator('#page-sizing').focus();await input.focus();await expect(input).toHaveValue('2-3');
});
test('uniform export pads asymmetric crops without revealing neighboring content',async({page})=>{
  await page.goto('/');const source=await PDFDocument.create();
  const p=source.addPage([600,400]);p.drawRectangle({x:0,y:0,width:600,height:400,color:rgb(.9,.1,.1)});
  await page.locator('#file-input').setInputFiles({name:'uneven.pdf',mimeType:'application/pdf',buffer:Buffer.from(await source.save())});
  await startCropping(page);await expect(page.locator('#page-sizing')).toHaveValue('uniform');
  await page.locator('#crop-x').fill('10');await page.locator('#crop-x').press('Tab');await page.locator('#crop-w').fill('20');await page.locator('#crop-w').press('Tab');
  const downloaded=page.waitForEvent('download');await page.locator('#export').click();const output=await fs.readFile(await (await downloaded).path());
  const pdf=await PDFDocument.load(output);for(const p of pdf.getPages())expect(p.getSize()).toEqual({width:300,height:400});
  const colors=await page.evaluate(async(bytes)=>{
    const pdfjs=await import('/node_modules/pdfjs-dist/build/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const task=pdfjs.getDocument({data:new Uint8Array(bytes)}),doc=await task.promise,p=await doc.getPage(1),v=p.getViewport({scale:1});
    const c=document.createElement('canvas');c.width=v.width;c.height=v.height;const ctx=c.getContext('2d');await p.render({canvasContext:ctx,viewport:v}).promise;
    const colors=[10,150,290].map(x=>Array.from(ctx.getImageData(x,200,1,1).data).slice(0,3));await task.destroy();return colors;
  },Array.from(output));
  expect(colors[0]).toEqual([255,255,255]);expect(colors[2]).toEqual([255,255,255]);expect(colors[1][0]).toBeGreaterThan(200);expect(colors[1][1]).toBeLessThan(50);
});
test('bundled JBIG2 and JPEG 2000 decoders are available to the renderer',async({page})=>{
  await page.goto('/');
  const decoders=await page.evaluate(async()=>{
    const {pdfOptions}=await import('/src/pdf-assets.js');const factory=new pdfOptions.BinaryDataFactory();const result=[];
    for(const filename of ['jbig2.wasm','openjpeg.wasm']){const bytes=await factory.fetch({kind:'wasmUrl',filename});result.push(WebAssembly.validate(bytes));}
    return result;
  });expect(decoders).toEqual([true,true]);
});

test('files accumulate in a review list and require confirmation before cropping',async({page})=>{
  await page.goto('/');
  expect((await page.locator('#drop-zone').boundingBox()).height).toBeGreaterThanOrEqual(300);
  const buffer=await fixture();
  await page.locator('#file-input').setInputFiles({name:'first.pdf',mimeType:'application/pdf',buffer});
  await expect(page.locator('#file-list li')).toHaveCount(1);await expect(page.locator('#editor')).toBeHidden();
  const data=await page.evaluateHandle(bytes=>{
    const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],'dropped.pdf',{type:'application/pdf'}));return transfer;
  },Array.from(buffer));
  await page.locator('#drop-zone').dispatchEvent('drop',{dataTransfer:data});await data.dispose();
  await expect(page.locator('#file-list li')).toHaveCount(2);await expect(page.locator('#editor')).toBeHidden();
  await page.getByRole('button',{name:'Remove first.pdf',exact:true}).click();
  await expect(page.locator('#file-list li')).toHaveCount(1);await expect(page.locator('#file-list')).toContainText('dropped.pdf');
  await page.screenshot({path:'/tmp/folio-file-review.png',fullPage:true});
  await startCropping(page);await expect(page.locator('#filename')).toHaveText('dropped.pdf');
  await page.locator('#crop-w').fill('40');await page.locator('#crop-w').press('Tab');
  await page.locator('#replace-file').click();await expect(page.locator('#editor')).toBeHidden();
  await page.locator('#file-input').setInputFiles({name:'third.pdf',mimeType:'application/pdf',buffer});
  await expect(page.locator('#file-list li')).toHaveCount(2);await startCropping(page);
  await expect(page.locator('#filename')).toHaveText('dropped.pdf');await expect(page.locator('#crop-w')).toHaveValue('40');
});
test('mobile review handles multi-select and removing every file',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  const awaitBuffer=await fixture();
  const chooser=page.waitForEvent('filechooser');await page.locator('#open-file').click();
  await (await chooser).setFiles(['a.pdf','b.pdf'].map(name=>({name,mimeType:'application/pdf',buffer:awaitBuffer})));
  await expect(page.locator('#file-list li')).toHaveCount(2);await expect(page.locator('#editor')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/folio-file-review-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Remove a.pdf',exact:true}).click();await page.getByRole('button',{name:'Remove b.pdf',exact:true}).click();
  await expect(page.locator('#file-review')).toBeHidden();await expect(page.locator('#start-cropping')).toBeDisabled();
  await expect(page.locator('#drop-zone')).toBeVisible();await expect(page.locator('#editor')).toBeHidden();
});
