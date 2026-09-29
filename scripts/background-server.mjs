import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {localConfiguration} from './local-config.mjs';

const MAX_BYTES=128*1024*1024;
export function canonicalJSON(value){
  if(Array.isArray(value))return `[${value.map(canonicalJSON).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonicalJSON(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hashPage=page=>createHash('sha256').update(canonicalJSON(page)).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
async function atomicJSON(file,value){
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temporary=`${file}.${randomUUID()}.tmp`;
  const handle=await fs.open(temporary,'wx',0o600);
  try{
    try{await handle.writeFile(JSON.stringify(value));await handle.sync()}finally{await handle.close()}
    await fs.rename(temporary,file);
  }catch(error){await fs.rm(temporary,{force:true});throw error}
}
async function readJSON(file){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}}
async function bodyJSON(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))fail('API 只接受 application/json。',415);
  const declaredLength=Number(req.headers['content-length']||0);
  if(declaredLength>MAX_BYTES)fail('请求超过128 MB。',413);
  const chunks=[];let bytes=0;
  const deadline=setTimeout(()=>req.destroy(Object.assign(new Error('读取请求超时。'),{status:408})),30000);
  try{for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_BYTES)fail('请求超过128 MB。',413);chunks.push(chunk)}}finally{clearTimeout(deadline)}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{fail('请求不是有效JSON。')}
}
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function checkProject(project){
  if(!object(project)||project.schemaVersion!==1||project.width!==790||typeof project.id!=='string'||!Array.isArray(project.pages)||!project.pages.length||!object(project.assets))fail('不是790px工程快照。');
  if(project.pages.some(p=>!object(p)||typeof p.id!=='string'||p.width!==790||!Array.isArray(p.elements)))fail('工程分屏格式无效。');
}
function checkEnvelope(value){
  if(!object(value)||typeof value.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)||typeof value.expectedPageHash!=='string'||!/^[a-f0-9]{64}$/.test(value.expectedPageHash))fail('更新ID或分屏校验值无效。');
  const p=value.patch;
  if(!object(p)||p.kind!=='long-canvas-page-update'||p.schemaVersion!==1||typeof p.targetProjectId!=='string'||typeof p.pageId!=='string'||!Array.isArray(p.elements)||!Array.isArray(p.removeElementIds)||!object(p.assets))fail('后台仅接受 long-canvas-page-update 分屏局部更新。');
  return {id:value.id,expectedPageHash:value.expectedPageHash,patch:p};
}

/** Only the editor HTML and explicit JSON API are exposed; the CLI binds to loopback. */
export async function createBackgroundServer({directory,htmlFile,port=7911}){
  await fs.mkdir(path.join(directory,'updates'),{recursive:true,mode:0o700});
  let serial=Promise.resolve(),lease=null;
  const snapshotFile=path.join(directory,'current-project.json');
  let currentSnapshot=await readJSON(snapshotFile),recordCache=null;
  const updateFile=id=>path.join(directory,'updates',`${id}.json`);
  const records=async()=>{
    if(recordCache)return recordCache;
    const names=(await fs.readdir(path.join(directory,'updates'))).filter(n=>/^[a-zA-Z0-9_-]+\.json$/.test(n));
    recordCache=(await Promise.all(names.map(n=>readJSON(path.join(directory,'updates',n))))).filter(Boolean).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
    return recordCache;
  };
  const claim=req=>{
    const client=req.headers['x-long-canvas-client'];
    if(typeof client!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(client))fail('缺少编辑器会话标识。',403);
    if(lease&&lease.client!==client&&Date.now()-lease.seen<10000)fail('另一个编辑器窗口正在同步，请只保留一个编辑窗口。',409);
    lease={client,seen:Date.now()};
  };
  const server=http.createServer(async(req,res)=>{
    const actualPort=server.address()?.port||port;
    const host=`127.0.0.1:${actualPort}`, origin=`http://${host}`;
    const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))};
    const respondError=error=>{if(!res.headersSent&&!res.destroyed)json(error.status||500,{error:error.status?error.message:'本机同步写入失败，请检查数据目录。'});else res.destroy()};
    let url,payload;
    try{
        if(req.headers.host!==host)fail('仅支持127.0.0.1本机访问。',403);
        if(req.headers.origin&&req.headers.origin!==origin)fail('拒绝跨站来源。',403);
        if(req.headers['sec-fetch-site']==='cross-site')fail('拒绝跨站来源。',403);
        url=new URL(req.url,origin);
        if(url.pathname.startsWith('/api/')){
          if(req.headers['x-long-canvas-bridge']!=='1')fail('缺少本机API标识。',403);
          // Read bounded request bodies before entering the state queue. A stalled
          // upload must not prevent status reads, heartbeats or other completed requests.
          if(req.method==='POST'||req.method==='PUT')payload=await bodyJSON(req);
        }
    }catch(error){respondError(error);return}
    const job=async()=>{
      if(res.destroyed)return;
      try {
        if(url.pathname==='/'||url.pathname==='/editor.html'){
          if(req.method!=='GET'&&req.method!=='HEAD')fail('方法不支持。',405);
          const stat=await fs.stat(htmlFile);
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});
          if(req.method==='HEAD')res.end();else createReadStream(htmlFile).on('error',()=>res.destroy()).pipe(res);
          return;
        }
        if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return}
        if(!url.pathname.startsWith('/api/'))fail('未找到。',404);
        if(url.pathname==='/api/status'&&req.method==='GET'){
          const current=currentSnapshot,updates=await records();
          return json(200,{connected:true,snapshot:current?{projectId:current.id,updatedAt:current.updatedAt,pages:current.pages.map(p=>({id:p.id,title:p.title,height:p.height,hash:hashPage(p)}))}:null,updates:updates.slice(-30).map(({id,state,createdAt,error,patch})=>({id,state,createdAt,error,title:patch.title,pageId:patch.pageId}))});
        }
        if(url.pathname==='/api/snapshot'&&req.method==='GET'){
          if(!currentSnapshot)fail('请先在编辑器等待“文件已同步”。',409);
          return json(200,currentSnapshot);
        }
        if(url.pathname==='/api/heartbeat'&&req.method==='GET'){claim(req);return json(200,{connected:true})}
        if(url.pathname==='/api/snapshot'&&req.method==='PUT'){
          checkProject(payload);claim(req);const project=payload;
          const previous=currentSnapshot;
          // Keep the first pre-bridge state, plus the old project's last snapshot on project switch.
          if(!previous&&!await readJSON(path.join(directory,'backups','initial-browser-project.json')))await atomicJSON(path.join(directory,'backups','initial-browser-project.json'),project);
          else if(previous&&previous.id!==project.id)await atomicJSON(path.join(directory,'backups',`project-switch-${Date.now()}.json`),previous);
          await atomicJSON(snapshotFile,project);
          currentSnapshot=project;
          return json(200,{saved:true,projectId:project.id,updatedAt:project.updatedAt});
        }
        if(url.pathname==='/api/updates'&&req.method==='POST'){
          const envelope=checkEnvelope(payload);
          const existing=(await records()).find(r=>r.id===envelope.id);
          if(existing){
            if(canonicalJSON({id:existing.id,expectedPageHash:existing.expectedPageHash,patch:existing.patch})!==canonicalJSON(envelope))fail('此更新ID已用于其他内容。',409);
            return json(200,{id:existing.id,state:existing.state,duplicate:true});
          }
          const current=currentSnapshot;
          if(!current||current.id!==envelope.patch.targetProjectId)fail('当前编辑器没有同步对应工程，不能排入更新。',409);
          const page=current.pages.find(p=>p.id===envelope.patch.pageId);
          if(!page||hashPage(page)!==envelope.expectedPageHash)fail('当前分屏与取稿快照不一致，请重新取稿后修改。',409);
          await atomicJSON(path.join(directory,'backups',`${envelope.id}-before.json`),current);
          const record={...envelope,state:'queued',createdAt:new Date().toISOString()};
          await atomicJSON(updateFile(envelope.id),record);
          recordCache.push(record);
          return json(201,{id:envelope.id,state:'queued'});
        }
        if(url.pathname==='/api/updates/next'&&req.method==='GET'){
          claim(req);const projectId=url.searchParams.get('projectId');
          const current=currentSnapshot;
          if(!current||current.id!==projectId)fail('请先同步当前工程快照。',409);
          const next=(await records()).find(v=>v.state==='queued'&&v.patch.targetProjectId===projectId);
          return json(200,{update:next?{id:next.id,expectedPageHash:next.expectedPageHash,patch:next.patch}:null});
        }
        const match=/^\/api\/updates\/([a-zA-Z0-9_-]{1,100})\/ack$/.exec(url.pathname);
        if(match&&req.method==='POST'){
          claim(req);const value=payload,record=(await records()).find(r=>r.id===match[1]);
          if(!record)fail('找不到此更新。',404);
          if(!object(value)||!['applied','rejected'].includes(value.state))fail('更新状态无效。');
          if(record.state!=='queued'&&record.state!==value.state)fail('更新已经完成，不能更改结果。',409);
          const next={...record,state:value.state,...(value.error?{error:String(value.error).slice(0,1000)}:{}),finishedAt:new Date().toISOString()};
          await atomicJSON(updateFile(match[1]),next);
          recordCache=recordCache.map(r=>r.id===next.id?next:r);
          return json(200,{id:record.id,state:value.state});
        }
        fail('未找到。',404);
      }catch(error){respondError(error)}
    };
    // Serialize completed requests to keep snapshots and queue transitions atomic.
    serial=serial.then(job,job);
  });
  server.headersTimeout=10000;
  server.requestTimeout=30000;
  server.keepAliveTimeout=5000;
  return server;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options=localConfiguration();
  await fs.access(options.htmlFile);
  const server=await createBackgroundServer(options);
  server.on('error',error=>{console.error(`本机服务无法启动：${error.message}`);process.exitCode=1});
  server.listen(options.port,'127.0.0.1',()=>console.log(`Long Canvas Editor http://127.0.0.1:${options.port}`));
}
