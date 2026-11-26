import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('MCP exposes proposal and analysis but no approval or arbitrary execution tools',()=>{const result=spawnSync(process.execPath,['scripts/mcp.mjs'],{input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n',encoding:'utf8'});assert.equal(result.status,0);const names=JSON.parse(result.stdout).result.tools.map(x=>x.name);assert.deepEqual(names,['propose_experiment','inspect_proposal','assess_evidence','workflow_boundaries']);assert.ok(!names.some(x=>/approve|execute|shell|rollout/.test(x)));});
