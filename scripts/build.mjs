import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
const root=process.cwd();
const assets={};
for(const file of ['index.html','app.js','styles.css','viewer.html']) {try{assets[file]=await fs.readFile(path.join(root,'web',file),'utf8');}catch{}}
if(!assets['index.html'])throw new Error('No app interface was built.');
await fs.mkdir('dist/server',{recursive:true});
const source=`import {handleApi} from './src/api.mjs';
import {D1ApprovalStore} from './src/approval-store.mjs';
const assets=${JSON.stringify(assets)};
export default {async fetch(request,env){
const url=new URL(request.url);
if(url.pathname.startsWith('/api/'))return handleApi(request,{...env,PILOT_MODE:'rehearsal'},{approvalStore:new D1ApprovalStore(env.PILOT_DB)});
const name=({'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/viewer':'viewer.html'})[url.pathname];
if(!name||!assets[name])return new Response('Not found',{status:404});
if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
const type=name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
return new Response(request.method==='HEAD'?null:assets[name],{headers:{'content-type':type,'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control':'no-store'}});
}};`;
await build({stdin:{contents:source,resolveDir:root,sourcefile:'pilot-worker.mjs',loader:'js'},outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:false});
await fs.mkdir('dist/.openai',{recursive:true});
await fs.copyFile('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built the owner-private rehearsal preview. Live integration runs locally with server-side credentials.');
