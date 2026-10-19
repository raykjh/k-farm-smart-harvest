// Read-only publication-candidate inventory. It does NOT publish, copy source,
// change licenses, or certify absence of secrets. Findings never print values.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {lstat,readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {parseEnv} from 'node:util';
import {internalPublicationDocument,PUBLIC_SOURCE_ROOT_FILES} from './public-source-policy';
const root=process.cwd(),run=process.argv.find(a=>a.startsWith('--run='))?.slice(6);
const profile=process.argv.find(a=>a.startsWith('--profile='))?.slice(10)??'review';
assert(['review','public'].includes(profile),'Unknown source profile');
assert(run&&/^[a-z0-9-]{1,60}$/.test(run),'Unique report name required');
const folder=resolve('.data/publication');await mkdir(folder,{recursive:true});
const dirs=['app','components','lib','prisma','scripts','solver','tests','e2e','data','docs'];
const roots=[...PUBLIC_SOURCE_ROOT_FILES];
const ignoredDirs=new Set(['node_modules','.git','.next','.data','.local','.venv','__pycache__','.pytest_cache','coverage','playwright-report','blob-report']);
const permittedExtensions=new Set(['.ts','.tsx','.js','.mjs','.cjs','.json','.yaml','.yml','.md','.txt','.css','.py','.prisma','.sql','.toml']);
const thirdPartyData=new Set(['data/capacity/four-center-cadastre-2026-10-03.json','data/capacity/four-center-study-2026.json','lib/demo-parcels.json']);
const entries:any[]=[],findings:any[]=[],excludedInternalDocuments:string[]=[],env:Record<string,string>={};
for(const name of ['.env','.env.local'])if(existsSync(name))Object.assign(env,parseEnv(await readFile(name,'utf8')));
const secrets=Object.entries(env).filter(([name,value])=>/(?:API_KEY|SERVICE_KEY|SECRET|TOKEN|PASSWORD)$/.test(name)&&value.trim().length>=8);
// Optional known private contacts are supplied only to this process, never
// embedded in public source or written to the report.
const privateContacts=(process.env.KFARM_PRIVATE_CONTACTS??'').split(',').map(v=>v.trim()).filter(v=>v.length>=6).map((value,i)=>['private-contact-'+(i+1),value]);
const patternRules=[
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
 ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
 ['bearer-token-literal',/Bearer\s+[A-Za-z0-9_-]{40,}(?:\.[A-Za-z0-9_-]+){0,2}/g],
] as const;
const finding=(path:string,content:string,index:number,rule:string)=>findings.push({path,line:content.slice(0,index).split('\n').length,rule});
async function inspect(path:string){
 const stat=await lstat(path),rel=relative(root,path).replaceAll('\\','/');
 if(stat.isSymbolicLink())throw Error('Refusing a junction/symlink in source inventory: '+rel);
 if(stat.isDirectory()){
  if(ignoredDirs.has(rel.split('/').at(-1)!)||rel.split('/').at(-1)!.startsWith('test-results'))return;
  for(const child of (await readdir(path)).sort())await inspect(resolve(path,child));return;
 }
 if(profile==='public'&&internalPublicationDocument(rel)){excludedInternalDocuments.push(rel);return;}
 if(/(?:^|\/)\.env(?:\.|$)/.test(rel)&&rel!=='.env.example')throw Error('Real environment file under source root: '+rel);
 if(/\.(?:log|dump|backup|sqlite\d?|db|pem|key|p12|pfx|pyc|tsbuildinfo)$/.test(rel))return;
 const file=await readFile(path),content=file.toString('utf8');
 const text=permittedExtensions.has(extname(path))||['LICENSE','Dockerfile','.gitignore','.dockerignore','.env.example'].includes(rel.split('/').at(-1)!);
 if(!text)throw Error('Unreviewed source file type: '+rel);
 for(const [name,value] of secrets){const index=content.indexOf(value);if(index>=0)finding(rel,content,index,'current-secret:'+name);}
 for(const [name,value] of privateContacts){const index=content.indexOf(value);if(index>=0)finding(rel,content,index,name);}
 for(const [name,pattern] of patternRules)for(const match of content.matchAll(pattern))finding(rel,content,match.index,name);
 entries.push({path:rel,bytes:stat.size,sha256:createHash('sha256').update(file).digest('hex'),review:thirdPartyData.has(rel)?'DATA_TERMS_REVIEW_REQUIRED':'SOURCE_CANDIDATE'});
}
for(const name of [...dirs,...roots])if(existsSync(resolve(root,name)))await inspect(resolve(root,name));
entries.sort((a,b)=>a.path.localeCompare(b.path));
const publicEntries=entries;
const report={at:new Date().toISOString(),run,profile,status:findings.length?'REVIEW_FINDINGS':'NO_PATTERN_MATCHES',published:false,excludedInternalDocuments,
 candidateCount:publicEntries.length,bytes:publicEntries.reduce((n,e)=>n+e.bytes,0),checkedCurrentSecretNames:secrets.map(([n])=>n),privateContactChecks:privateContacts.length,findings,
 dataReviewRequired:publicEntries.filter(e=>e.review==='DATA_TERMS_REVIEW_REQUIRED').map(e=>e.path),entries:publicEntries,
 exclusions:['Actual .env files','Operating DB / backups / recovery material','Dependencies / build output','Raw AI requests/responses / screenshots / videos','Historical root handoffs not needed for reproduction'],
 limitations:['Pattern scan, not security certification.','No Git history exists here; any later history/attachments require separate review.','Public-data API access does not itself prove redistribution rights.','Source list is a review candidate, not approval to publish.']};
await writeFile(resolve(folder,`${run}.json`),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({...report,entries:undefined},null,2));
