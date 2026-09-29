import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hashPage} from './background-server.mjs';
import {localConfiguration} from './local-config.mjs';

const {port}=localConfiguration(),base=`http://127.0.0.1:${port}`;
const headers={'X-Long-Canvas-Bridge':'1','Content-Type':'application/json'};
const [command,patchFile,baseFile,idArgument]=process.argv.slice(2);
async function call(route,body){
  const response=await fetch(`${base}/api/${route}`,{method:body?'POST':'GET',headers,redirect:'error',signal:AbortSignal.timeout(30000),...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
}
function jsonPath(filename){
  if(path.extname(filename).toLowerCase()!=='.json')throw new Error('取稿和更新文件必须使用 .json 扩展名。');
  return path.resolve(filename);
}
async function readJSON(filename){
  const file=jsonPath(filename),stat=await fs.stat(file);
  if(!stat.isFile()||stat.size>128*1024*1024)throw new Error('请选择不超过128 MB的JSON文件。');
  return JSON.parse(await fs.readFile(file,'utf8'));
}
try{
  if(command==='status')console.log(JSON.stringify(await call('status'),null,2));
  else if(command==='submit'&&patchFile&&baseFile){
    // Explicit base file is mandatory: never silently bless a newer user edit as the design's base.
    const patch=await readJSON(patchFile);
    const baseProject=await readJSON(baseFile);
    if(!patch||!baseProject||patch.kind!=='long-canvas-page-update'||patch.targetProjectId!==baseProject.id||!Array.isArray(baseProject.pages))throw new Error('更新与取稿工程不匹配。');
    const page=baseProject.pages.find(p=>p.id===patch.pageId);if(!page)throw new Error('取稿工程缺少目标分屏。');
    const id=idArgument||randomUUID();
    console.log(JSON.stringify(await call('updates',{id,expectedPageHash:hashPage(page),patch}),null,2));
  }else if(command==='snapshot'&&patchFile){
    const destination=jsonPath(patchFile);
    const snapshot=await call('snapshot');
    // A new JSON file only: never overwrite a hand-edited project or follow an
    // existing destination symlink. The server never accepts local file paths.
    await fs.writeFile(destination,JSON.stringify(snapshot),{flag:'wx',mode:0o600});
    console.log(`已保存当前编辑器快照：${destination}`);
  }else throw new Error('用法：node scripts/background-update.mjs status | snapshot <取稿副本.json> | submit <分屏更新.json> <取稿副本.json> [唯一更新ID]');
}catch(error){console.error(error.message);process.exitCode=1}
