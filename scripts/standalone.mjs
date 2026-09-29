import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let html=await fs.readFile(path.join(root,'dist/index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)];
for(const match of scripts){const js=await fs.readFile(path.join(root,'dist',match[1].replace(/^\//,'')),'utf8');html=html.replace(match[0],()=>`<script type="module">${js.replace(/<\/script/gi,'<\\/script')}</script>`);}
const styles=[...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)];
for(const match of styles){const css=await fs.readFile(path.join(root,'dist',match[1].replace(/^\//,'')),'utf8');html=html.replace(match[0],()=>`<style>${css}</style>`);}
const seed=JSON.stringify(JSON.parse(await fs.readFile(path.join(root,'public/seed-project.json'),'utf8')));
html=html.replace('</head>',()=>`<script>window.__LONG_CANVAS_SEED__=${seed.replace(/</g,'\\u003c')};</script></head>`);
const licenseParts=[`Long Canvas Editor\n${await fs.readFile(path.join(root,'LICENSE'),'utf8')}`];
for(const dependency of ['react','react-dom','scheduler','lucide-react']){
  licenseParts.push(`${dependency}\n${await fs.readFile(path.join(root,'node_modules',dependency,'LICENSE'),'utf8')}`);
}
const licenses=licenseParts.join('\n\n========================================\n\n');
// Keep full notices with the portable file even when bundling strips comments.
html=html.replace('</head>',()=>`<script type="text/plain" id="third-party-licenses">${licenses.replace(/</g,'&lt;')}</script></head>`);
await fs.mkdir(path.join(root,'release'),{recursive:true});
const target=path.join(root,'release','long-canvas-editor.html');
await fs.writeFile(target,html);
await fs.writeFile(path.join(root,'release','example-project.json'),seed);
await fs.writeFile(path.join(root,'release','THIRD_PARTY_LICENSES.txt'),licenses);
console.log(`Standalone editor saved (${(Buffer.byteLength(html)/1048576).toFixed(1)} MB), including all artwork and editable layers.`);
