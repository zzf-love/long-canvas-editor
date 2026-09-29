import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createBackgroundServer,hashPage} from '../scripts/background-server.mjs';

const project={schemaVersion:1,id:'project',title:'Current hand edited artwork',width:790,updatedAt:'2026-09-19T00:00:00Z',assets:{},pages:[{id:'page-03',title:'Third',width:790,height:1180,sourceWidth:750,elements:[],guides:[],defs:''}]};
const patch={kind:'long-canvas-page-update',schemaVersion:1,targetProjectId:'project',pageId:'page-03',sourceWidth:750,title:'Scoped',assets:{},elements:[],removeElementIds:[]};

test('loopback bridge atomically mirrors, queues, backs up, deduplicates, checks conflicts/origin and survives restart',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'long-canvas-bridge-test-'));
  await fs.writeFile(path.join(dir,'editor.html'),'<html>Editor fixture</html>');
  let server=await createBackgroundServer({directory:dir,htmlFile:path.join(dir,'editor.html'),port:0});
  const start=()=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const stop=()=>new Promise(resolve=>server.close(resolve));
  await start();
  const api=async(route,body,extra={},method=body===undefined?'GET':'POST')=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`,{method,headers:{'X-Long-Canvas-Bridge':'1','X-Long-Canvas-Client':'test-client','Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {code:response.status,value:await response.json()};
  };
  try{
    assert.equal((await api('status')).value.snapshot,null);
    assert.equal((await api('snapshot')).code,409);
    const envelope={id:'revision-1',expectedPageHash:hashPage(project.pages[0]),patch};
    assert.equal((await api('updates',envelope)).code,409);
    assert.equal((await api('snapshot',project,{},'PUT')).code,200);
    assert.deepEqual((await api('snapshot')).value,project);
    assert.equal(Object.hasOwn((await api('status')).value.snapshot,'path'),false);
    assert.equal((await api('snapshot',{...project,pages:[null]}, {},'PUT')).code,400);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'current-project.json'))),project);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'backups/initial-browser-project.json'))),project);
    assert.equal((await api('snapshot',project,{'Origin':'https://evil.example'},'PUT')).code,403);
    const badHostCode=await new Promise((resolve,reject)=>{const request=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/status',headers:{Host:'evil.example','X-Long-Canvas-Bridge':'1'}},response=>{response.resume();resolve(response.statusCode)});request.on('error',reject);request.end()});
    assert.equal(badHostCode,403);
    assert.equal((await api('snapshot',project,{'X-Long-Canvas-Client':'other-client'},'PUT')).code,409);
    assert.equal((await api('updates',{...envelope,patch:project})).code,400);
    assert.equal((await api('updates',{...envelope,id:'../../escape'})).code,400);
    assert.equal((await api('updates',{...envelope,expectedPageHash:'0'.repeat(64)})).code,409);
    assert.equal((await api('updates',envelope)).code,201);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'backups/revision-1-before.json'))),project);
    assert.equal((await api('updates',envelope)).value.duplicate,true);
    assert.equal((await api('updates',{...envelope,patch:{...patch,title:'different'}})).code,409);
    assert.equal((await api('updates/next?projectId=project')).value.update.id,'revision-1');
    assert.equal((await api('updates/next?projectId=another')).code,409);
    await stop();server=await createBackgroundServer({directory:dir,htmlFile:path.join(dir,'editor.html'),port:0});await start();
    assert.equal((await api('updates/next?projectId=project')).value.update.id,'revision-1');
    assert.equal((await api('updates/revision-1/ack',{state:'applied'})).code,200);
    assert.equal((await api('updates/next?projectId=project')).value.update,null);
    assert.equal((await api('updates',envelope)).value.state,'applied');
    assert.equal((await api('updates/revision-1/ack',{state:'rejected'})).code,409);
    const latest={...project,updatedAt:'2026-09-19T00:01:00Z'};
    await api('snapshot',latest,{},'PUT');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'backups/initial-browser-project.json'))),project);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'current-project.json'))),latest);
    assert.equal((await fs.readdir(dir)).some(f=>f.endsWith('.tmp')),false);
    assert.equal((await api('status',undefined,{'X-Long-Canvas-Bridge':'0'})).code,403);
    assert.equal((await api('status',undefined,{'Sec-Fetch-Site':'cross-site'})).code,403);
    // The initial backup must not prevent recreating a missing live mirror after restart.
    await stop();await fs.rm(path.join(dir,'current-project.json'));
    server=await createBackgroundServer({directory:dir,htmlFile:path.join(dir,'editor.html'),port:0});await start();
    assert.equal((await api('snapshot',latest,{},'PUT')).code,200);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'backups/initial-browser-project.json'))),project);
  }finally{await stop();await fs.rm(dir,{recursive:true,force:true})}
});

test('unfinished uploads do not block the queue and private files are never statically served',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'long-canvas-isolation-'));
  const htmlFile=path.join(directory,'editor.html');
  await fs.writeFile(htmlFile,'<html>Standalone editor</html>');
  const server=await createBackgroundServer({directory,htmlFile,port:0});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,base=`http://127.0.0.1:${port}`;
  const headers={'X-Long-Canvas-Bridge':'1','X-Long-Canvas-Client':'client','Content-Type':'application/json'};
  const slow=http.request({hostname:'127.0.0.1',port,path:'/api/snapshot',method:'PUT',headers});
  slow.on('error',()=>{});
  try{
    slow.write('{');
    // Wait until the upload socket is connected before making the independent read.
    await new Promise(resolve=>{
      const connected=socket=>socket.connecting?socket.once('connect',resolve):resolve();
      if(slow.socket)connected(slow.socket);else slow.once('socket',connected);
    });
    const response=await fetch(`${base}/api/status`,{headers,signal:AbortSignal.timeout(2000)});
    assert.equal(response.status,200);
    for(const privatePath of ['/.env','/.local-data/current-project.json','/current-project.json','/updates/test.json','/../package.json']){
      assert.equal((await fetch(`${base}${privatePath}`)).status,404,privatePath);
    }
    const editor=await fetch(base);
    assert.equal(editor.headers.get('x-frame-options'),'DENY');
    assert.match(await editor.text(),/Standalone editor/);
    const wrongType=await fetch(`${base}/api/snapshot`,{method:'PUT',headers:{...headers,'Content-Type':'text/plain'},body:'{}'});
    assert.equal(wrongType.status,415);
    const tooLarge=await new Promise((resolve,reject)=>{
      const request=http.request({hostname:'127.0.0.1',port,path:'/api/snapshot',method:'PUT',headers:{...headers,'Content-Length':String(128*1024*1024+1)}},response=>{response.resume();resolve(response.statusCode)});
      request.on('error',reject);request.end();
    });
    assert.equal(tooLarge,413);
  }finally{
    slow.destroy();server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    await fs.rm(directory,{recursive:true,force:true});
  }
});

test('CLI exports JSON through the bridge from any working directory and never overwrites a file',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'long-canvas-cli-'));
  const htmlFile=path.join(directory,'editor.html');
  await fs.writeFile(htmlFile,'<html>Editor</html>');
  const server=await createBackgroundServer({directory,htmlFile,port:0});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const cli=fileURLToPath(new URL('../scripts/background-update.mjs',import.meta.url));
  const run=(...args)=>promisify(execFile)(process.execPath,[cli,...args],{cwd:directory,env:{...process.env,LONG_CANVAS_PORT:String(port)}});
  try{
    await fetch(`http://127.0.0.1:${port}/api/snapshot`,{method:'PUT',headers:{'X-Long-Canvas-Bridge':'1','X-Long-Canvas-Client':'client','Content-Type':'application/json'},body:JSON.stringify(project)});
    await run('snapshot','copy.json');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'copy.json'),'utf8')),project);
    await assert.rejects(run('snapshot','copy.json'),/EEXIST/);
    await assert.rejects(run('snapshot','not-json.html'),/\.json/);
    await fs.symlink(path.join(directory,'editor.html'),path.join(directory,'link.json'));
    await assert.rejects(run('snapshot','link.json'),/EEXIST/);
    assert.equal(await fs.readFile(htmlFile,'utf8'),'<html>Editor</html>');
    await fs.writeFile(path.join(directory,'patch.json'),JSON.stringify(patch));
    const submission=JSON.parse((await run('submit','patch.json','copy.json','cli-update')).stdout);
    assert.equal(submission.state,'queued');
  }finally{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    await fs.rm(directory,{recursive:true,force:true});
  }
});
