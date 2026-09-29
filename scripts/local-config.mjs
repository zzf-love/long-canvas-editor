import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEnvFile} from 'node:process';

export const projectDirectory=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Resolve configuration against this checkout, never the caller's working directory.
// Node preserves existing environment variables, so shell overrides take precedence.
try{loadEnvFile(path.join(projectDirectory,'.env'))}catch(error){if(error.code!=='ENOENT')throw error}

export function localConfiguration(){
  const rawPort=process.env.LONG_CANVAS_PORT||'7911';
  if(!/^\d+$/.test(rawPort)||Number(rawPort)<1||Number(rawPort)>65535)throw new Error('LONG_CANVAS_PORT 必须是 1–65535 之间的端口号。');
  return {
    port:Number(rawPort),
    directory:path.resolve(projectDirectory,process.env.LONG_CANVAS_DATA_DIR||'.local-data'),
    htmlFile:path.join(projectDirectory,'release','long-canvas-editor.html'),
  };
}
