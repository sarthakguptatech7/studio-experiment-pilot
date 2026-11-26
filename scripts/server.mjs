import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {handleApi} from '../src/api.mjs';
import {makeLiveEvidence} from './live-evidence.mjs';
import {LocalApprovalStore} from './local-approval-store.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=path.join(root,'data');
await fs.mkdir(data,{recursive:true,mode:0o700});
let secret=process.env.PILOT_SIGNING_SECRET;
if(!secret) {
  try {secret=await fs.readFile(path.join(data,'signing-secret'),'utf8');}
  catch {secret=randomBytes(48).toString('hex');await fs.writeFile(path.join(data,'signing-secret'),secret,{mode:0o600,flag:'wx'});}
}
const env={...process.env,PILOT_SIGNING_SECRET:secret};
const port=Number(process.env.PORT||process.env.PILOT_PORT||8789);
const host=process.env.PILOT_BIND_HOST||(process.env.PORT?'0.0.0.0':'127.0.0.1');
const mimes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const record=async event=>fs.appendFile(path.join(data,'audit.jsonl'),JSON.stringify(event)+'\n',{mode:0o600});
const liveEvidence=makeLiveEvidence({env,record});
const approvalStore=new LocalApprovalStore(path.join(data,'approvals.sqlite3'));

const server=http.createServer(async(req,res)=>{
  try {
    const hostHeader=req.headers.host||`127.0.0.1:${port}`;
    const hostname=hostHeader.split(':')[0];
    const preview=Boolean(process.env.PORT);
    if(!preview && !['127.0.0.1','localhost','[::1]'].includes(hostname)) {res.writeHead(403);res.end('Host rejected.');return;}
    const url=new URL(req.url,`http://${hostHeader}`);
    if(url.pathname.startsWith('/api/')) {
      const chunks=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>64000){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
      const headers=new Headers();for(const [key,value]of Object.entries(req.headers)) if(typeof value==='string') headers.set(key,value);
      // A preview proxy may terminate HTTPS, but the Origin must still match its Host.
      const origin=headers.get('origin');
      if(preview&&origin){try{if(new URL(origin).host===hostHeader)env.PILOT_PUBLIC_ORIGIN=origin;}catch{}}
      const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
      const result=await handleApi(request,env,{record,liveEvidence,approvalStore});
      res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Method not allowed');return;}
    const file=({'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/viewer':'viewer.html'})[url.pathname];
    if(!file){res.writeHead(404);res.end('Not found');return;}
    const content=await fs.readFile(path.join(root,'web',file));
    res.writeHead(200,{'content-type':mimes[path.extname(file)]||'text/plain','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
    res.end(req.method==='HEAD'?undefined:content);
  } catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'Local server request failed.'}));}
});
server.listen(port,host,()=>console.log(`Studio Experiment Pilot listening on http://${host}:${port} (${env.PILOT_MODE||'rehearsal'})`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
