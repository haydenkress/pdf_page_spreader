import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const result = await build({
  entryPoints:['src/main.js'], bundle:true, minify:true, format:'esm', target:'es2022',
  outfile:'standalone/app.js', write:false,
  plugins:[{
    name:'inline-pdf-worker',
    setup(build) {
      build.onResolve({filter:/\.wasm\?url$/},args=>({path:resolve('node_modules',args.path.replace(/\?url$/,'')),namespace:'wasm'}));
      build.onLoad({filter:/.*/,namespace:'wasm'},async(args)=>({
        contents:`export default ${JSON.stringify('data:application/wasm;base64,'+(await readFile(args.path)).toString('base64'))};`,loader:'js'
      }));
      build.onResolve({filter:/pdf\.worker\.min\.mjs\?url$/},args=>({path:args.path,namespace:'worker'}));
      build.onLoad({filter:/.*/,namespace:'worker'},async()=>{
        const worker=await readFile(resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),'utf8');
        return {contents:`export default URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'}));`,loader:'js'};
      });
    }
  }],
});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text.replace(/<\/script/gi,'<\\/script');
const css=result.outputFiles.find(f=>f.path.endsWith('.css')).text;
const notices=(await readFile('public/THIRD_PARTY_NOTICES.txt','utf8')).replaceAll('-->','-- >');
const template=(await readFile('index.html','utf8')).replace('</body>',`<!-- Third-party notices\n${notices}\n--></body>`);
const html=template.replace('</head>',`<style>${css}</style></head>`).replace('<script type="module" src="/src/main.js"></script>',()=>`<script type="module">${js}</script>`).replace('href="./"','href="#"');
await mkdir('standalone',{recursive:true});await writeFile('standalone/folio.html',html);
console.log('Created standalone/folio.html — open directly in a modern browser.');
