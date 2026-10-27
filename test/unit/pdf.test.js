import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { defaultCrops, copyCrops, constrainCrop, cropBounds, splitPdf, parseRanges, resizeCrop } from '../../src/pdf.js';

test('crop normalization keeps rectangles inside the scan', () => {
  assert.deepEqual(constrainCrop({x:-1,y:2,w:5,h:-1}),{x:0,y:.99,w:1,h:.01,angle:0});
  const rect = constrainCrop({x:NaN,y:Infinity,w:NaN,h:Infinity});
  assert.deepEqual(rect,{x:0,y:0,w:.5,h:1,angle:0});
  const original = defaultCrops(), copy=copyCrops(original); copy.left.x=.1;
  assert.equal(original.left.x,0);
});
test('visual crops map to PDF coordinates with rotation and crop-box offsets', () => {
  const c = defaultCrops().left;
  assert.deepEqual(cropBounds([10,20,410,220],0,c),{left:10,bottom:20,right:210,top:220});
  assert.deepEqual(cropBounds([10,20,410,220],90,c),{left:10,bottom:20,right:410,top:120});
  assert.deepEqual(cropBounds([10,20,410,220],180,c),{left:210,bottom:20,right:410,top:220});
  assert.deepEqual(cropBounds([10,20,410,220],270,c),{left:10,bottom:120,right:410,top:220});
});
test('export splits every scan with its individual crop and flattens rotation',async()=>{
  const source=await PDFDocument.create();
  for(const angle of [0,90,180,270]) {
    const page=source.addPage([600,400]);page.setRotation(degrees(angle));page.setCropBox(20,30,560,340);
    page.drawRectangle({x:0,y:0,width:600,height:400,color:rgb(.8,.2,.1)});
  }
  const crops=Array.from({length:4},defaultCrops);
  crops[1].left={x:.1,y:.1,w:.3,h:.8};
  const progress=[];
  const bytes=await splitPdf(await source.save(),crops,Array(4).fill([20,30,580,370]),'ltr',n=>progress.push(n),'',{sizing:'crop'});
  const output=await PDFDocument.load(bytes);
  assert.equal(output.getPageCount(),8);
  assert.deepEqual(progress,[1,2,3,4]);
  assert.deepEqual(output.getPage(0).getSize(),{width:280,height:340});
  assert.ok(Math.abs(output.getPage(2).getWidth()-102)<.0001);
  assert.ok(Math.abs(output.getPage(2).getHeight()-448)<.0001);
  for(const page of output.getPages()) assert.equal(page.getRotation().angle,0);
  const reversed=await PDFDocument.load(await splitPdf(await source.save(),crops,Array(4).fill([20,30,580,370]),'rtl',()=>{},'',{sizing:'crop'}));
  assert.equal(reversed.getPage(2).getWidth(),170);
});

test('inclusive ranges support open ends, comma lists, and different document lengths',()=>{
  const pages=(text,count=10)=>[...parseRanges(text,count)].sort((a,b)=>a-b).map(i=>i+1);
  assert.deepEqual(pages('3-8'),[3,4,5,6,7,8]);
  assert.deepEqual(pages('-8'),[1,2,3,4,5,6,7,8]);
  assert.deepEqual(pages('8-'),[8,9,10]);
  assert.deepEqual(pages('1, 3-5,4-8',6),[1,3,4,5,6]);
  assert.deepEqual(pages('8-',4),[]);
  assert.deepEqual(pages('',3),[1,2,3]);
  for(const text of ['8-3','0','-','1,','3.5','hello','0-3']) assert.throws(()=>parseRanges(text,10));
});
test('unselected scans remain in order and an empty selection returns original bytes',async()=>{
  const doc=await PDFDocument.create();for(let i=0;i<4;i++){const p=doc.addPage([600+i*10,400]);p.drawText(String(i));}
  const original=await doc.save(),crops=Array.from({length:4},defaultCrops),views=Array.from({length:4},(_,i)=>[0,0,600+i*10,400]);
  const output=await PDFDocument.load(await splitPdf(original,crops,views,'ltr',()=>{},'2-3'));
  assert.equal(output.getPageCount(),6);assert.equal(output.getPage(0).getWidth(),600);assert.equal(output.getPage(1).getWidth(),305);assert.equal(output.getPage(5).getWidth(),630);
  assert.deepEqual(await splitPdf(original,crops,views,'ltr',()=>{},'8-'),original);
});

test('uniform pages fit varied crops and rotations onto one shared page size',async()=>{
  const source=await PDFDocument.create();
  for(const [i,angle] of [0,90,180].entries()){const p=source.addPage([600+i*20,400]);p.setRotation(degrees(angle));p.drawText('Test');}
  const crops=Array.from({length:3},defaultCrops);crops[0].left={x:.1,y:.1,w:.2,h:.8};crops[1].right={x:.3,y:0,w:.7,h:1};
  const bytes=await source.save(),views=[[0,0,600,400],[0,0,620,400],[0,0,640,400]];
  for(const [sizing,size] of [['uniform',[300,400]],['a4',[595.276,841.89]],['letter',[612,792]]]){
    const output=await PDFDocument.load(await splitPdf(bytes,crops,views,'ltr',()=>{},'',{sizing}));
    for(const p of output.getPages())assert.deepEqual([p.getWidth(),p.getHeight()],size);
  }
});

test('tilt is bounded and rotated resizing holds the opposite corner in place',()=>{
  assert.equal(constrainCrop({...defaultCrops().left,angle:99}).angle,15);
  assert.equal(constrainCrop({...defaultCrops().left,angle:-99}).angle,-15);
  const original={x:.25,y:.2,w:.3,h:.5,angle:7};
  const nw=c=>{const a=c.angle*Math.PI/180,cx=(c.x+c.w/2)*800,cy=(c.y+c.h/2)*500;return [cx-Math.cos(a)*c.w*800/2+Math.sin(a)*c.h*500/2,cy-Math.sin(a)*c.w*800/2-Math.cos(a)*c.h*500/2];};
  const resized=resizeCrop(original,'se',.03,.02,800,500);
  assert.ok(resized.w>original.w);assert.equal(resized.angle,7);
  nw(original).forEach((v,i)=>assert.ok(Math.abs(v-nw(resized)[i])<1e-8));
});
