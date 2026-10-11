// Produce a local review copy only. No Git, network, publication or DB writes.
// Revalidates the read-only audit manifest and fails closed on changed content.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile,lstat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,sep,dirname} from 'node:path';
import {internalPublicationDocument} from './public-source-policy';
const run=process.argv.find(a=>a.startsWith('--manifest='))?.slice(11);
const target=process.argv.find(a=>a.startsWith('--destination='))?.slice(14);
assert(run&&/^[a-z0-9-]{1,60}$/.test(run),'Audited manifest run required');
assert(target,'Explicit new local destination required');
const root=process.cwd(),destination=resolve(target);
assert(!existsSync(destination),'Destination already exists; no files overwritten');
assert(relative(destination,root).startsWith('..'),'Destination must not contain the working project');
const report=JSON.parse(await readFile(resolve('.data/publication',`${run}.json`),'utf8'));
const profile=report.profile??'review';assert(['review','public'].includes(profile),'Unknown source profile');
assert(report.status==='NO_PATTERN_MATCHES'&&report.published===false&&Array.isArray(report.findings)&&report.findings.length===0,'Unresolved source findings');
assert(Array.isArray(report.entries)&&report.entries.length>0&&report.entries.length<5000,'Invalid source inventory');
const held=new Set(['lib/demo-parcels.json','data/capacity/four-center-cadastre-2026-10-03.json','data/capacity/four-center-study-2026.json']);
const sourceDirectories=new Set(['app','components','lib','prisma','scripts','solver','tests','e2e','data','docs']);
const rootFiles=new Set(['LICENSE','README.md','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.env.example','.gitignore','compose.yaml','instrumentation.ts','proxy.ts','next-env.d.ts','postcss.config.mjs','tsconfig.json','playwright.config.ts','playwright.adjacent.config.ts','playwright.isolated.config.ts','vitest.config.ts','vitest.adjacent.config.ts','vitest.centers.config.ts','AI-BUDGET-V2.md']);
const staged:{path:string;bytes:Buffer;sha256:string}[]=[],seen=new Set<string>();
for(const entry of report.entries){
 const path=entry.path;assert(typeof path==='string'&&!path.includes('\\')&&!path.startsWith('/')&&!path.includes(':')&&!path.split('/').some(p=>p==='..'||p==='.'||!p),'Invalid path');
 assert(!seen.has(path),'Duplicate path');seen.add(path);
 if(held.has(path)||entry.review==='DATA_TERMS_REVIEW_REQUIRED')continue;
 if(profile==='public')assert(!internalPublicationDocument(path),'Internal handoff in public manifest');
 assert(entry.review==='SOURCE_CANDIDATE','Unreviewed item');
 assert(path.includes('/')?sourceDirectories.has(path.split('/')[0]):rootFiles.has(path),'Unapproved source root');
 assert(path==='.env.example'||path==='.gitignore'||!path.split('/').some(p=>p.startsWith('.')||['node_modules','__pycache__','coverage'].includes(p)||p.startsWith('test-results')),'Private/generated directory');
 assert(!/\.(?:log|dump|backup|sqlite\d?|db|pem|key|p12|pfx|pyc|tsbuildinfo)$/.test(path),'Private/generated file');
 const source=resolve(root,path);assert(source.startsWith(root+sep),'Source escapes project');
 let at=root;for(const part of path.split('/')){at=resolve(at,part);assert(!(await lstat(at)).isSymbolicLink(),'Source symlink/junction refused');}
 const bytes=await readFile(source),hash=createHash('sha256').update(bytes).digest('hex');
 assert(bytes.length===entry.bytes&&hash===entry.sha256,'Source changed after audit: '+path);
 staged.push({path,bytes,sha256:hash});
}
// All bytes are checked before creating the destination. Only previously read
// bytes are written, so an intervening edit cannot silently change the package.
await mkdir(dirname(destination),{recursive:true});await mkdir(destination);
for(const file of staged){const path=resolve(destination,file.path);assert(path.startsWith(destination+sep),'Destination escape');await mkdir(dirname(path),{recursive:true});await writeFile(path,file.bytes,{flag:'wx'});}
const result={at:new Date().toISOString(),manifest:run,profile,destination,published:false,sourceFiles:staged.length,bytes:staged.reduce((n,f)=>n+f.bytes.length,0),excludedProviderFiles:[...held],excludedInternalDocuments:report.excludedInternalDocuments??[],hashes:staged.map(({path,sha256})=>({path,sha256}))};
await writeFile(resolve('.data/publication',`${run}-export.json`),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({...result,hashes:undefined},null,2));
