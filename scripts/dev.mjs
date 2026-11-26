import {spawn} from 'node:child_process';
// Optional, explicit local development wrapper. It is never exposed via HTTP/MCP.
const wrapper=process.env.PILOT_LOCAL_FLAGSMITH_WRAPPER;
const python=process.env.PILOT_LOCAL_PYTHON;
const runtimeEnv={...process.env};
const cli=process.argv.slice(2);
for(let i=0;i<cli.length;i++){
  if(cli[i]==='--port'){const port=Number(cli[++i]);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid preview port.');runtimeEnv.PORT=String(port);}
  else if(cli[i]==='--host'){const host=cli[++i];if(!['127.0.0.1','localhost','0.0.0.0'].includes(host))throw new Error('Invalid preview host.');runtimeEnv.PILOT_BIND_HOST=host;}
  else if(cli[i]!=='--strictPort')throw new Error('Unknown development option.');
}
const command=wrapper&&python?python:process.execPath;
const args=wrapper&&python?[wrapper,process.execPath,'scripts/server.mjs']:['scripts/server.mjs'];
const child=spawn(command,args,{stdio:'inherit',env:runtimeEnv});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
