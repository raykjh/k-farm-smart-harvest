import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const revision=process.argv.find(v=>v.startsWith('--revision='))?.slice(11)??'';assert(!revision||/^v[2-9][0-9]*$/.test(revision));
const root=process.cwd(),folder=resolve('.data/video-capture-20261018/english-take-01'),render=resolve(folder,revision?'final-'+revision:'final');
const ffmpeg=resolve('.data/video-tools/.venv/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
const read=async(name:string)=>JSON.parse(await readFile(resolve(folder,name),'utf8'));
const voiceFolder=resolve('.data/video-capture-20261018/full-take-01/voice-v3');
const first=await read('first-evidence.json'),bulk=await read('bulk-evidence.json'),incident=await read('incident-evidence.json'),screens=await read('screens-evidence.json'),centers=await read('centers-evidence.json'),voice=await read(voiceFolder+'/voice.json');
const buildup=bulk;
for(const e of [first,bulk,incident,screens,centers])assert(e.complete&&e.preserved,e.stage+' must finish and preserve source data');
assert.equal(bulk.summary.registered,300);assert.equal(bulk.summary.planned,299);assert.equal(bulk.summary.pending.length,1);
assert(incident.result.changes.some((c:any)=>c.before.day===c.after.day&&c.before.equipment!==c.after.equipment),'Narration needs a date-preserving equipment substitution');
assert(incident.result.changes.some((c:any)=>c.before.day!==c.after.day),'Narration needs related work rescheduled');
assert.equal(incident.result.borrowedResources.length,0,'Narration says this case used only local resources');
await mkdir(render);await mkdir(resolve(render,'pieces'));await mkdir(resolve(render,'review-frames'));
const title=resolve(root,'docs/video-assets/kfarm-title-peninsula-v1.png');
const event=(e:any,name:string)=>{const found=e.events.find((x:any)=>x.name===name);assert(found,`Missing ${e.stage}/${name}`);return found.seconds;};
type Piece={file:string;start:number;sourceSeconds:number;seconds:number;still?:boolean;label:string};
const clip=(e:any,name:string,seconds:number,sourceSeconds=seconds,offset=0):Piece=>({file:e.rawVideo,start:Math.max(0,event(e,name)+offset),sourceSeconds,seconds,label:e.stage+'/'+name});
const still=(seconds:number):Piece=>({file:title,start:0,sourceSeconds:seconds,seconds,still:true,label:'Approved title image'});
// Every app frame comes from a real local browser recording. No business
// response, application label or cursor position is painted over or invented.
const chapters:Piece[][]=[
 [still(4),clip(centers,'demo-map',12,9,-1),clip(screens,'equipment',8,8)],
 [clip(first,'applicant',8,2,-1.5),clip(first,'parcel-selected',8,2.5,-2),clip(first,'approval-ready',12,2,-1.5),clip(first,'approved',10,2,-1.5)],
 [clip(buildup,'wave-72',2,2,-1),clip(buildup,'wave-144',2,2,-1),clip(buildup,'wave-216',2,2,-1),clip(bulk,'wave-264',2,2,-1),clip(bulk,'wave-300',2,2,-1),clip(centers,'janggye-fields',6,4),clip(centers,'cheoncheon-fields',6,4),clip(centers,'gyenam-fields',6,4)],
 [clip(incident,'schedule-before',5,2,-.8),clip(incident,'breakdown-input',7,2,-1),clip(incident,'replanned-result',10,3,-1),clip(incident,'persisted-after-refresh',6,4,-.5),clip(incident,'task-history',3,3)],
 [clip(screens,'labor',11,10),clip(screens,'field-history',12,10)],
 [clip(screens,'ai-resources',16,10),clip(screens,'ai-comparison',7,7),still(7)],
];
const durations=chapters.map(c=>c.reduce((n,p)=>n+p.seconds,0)),total=durations.reduce((a,b)=>a+b,0);assert.equal(total,174);
function run(args:string[],cwd=render){const p=spawnSync(ffmpeg,['-hide_banner','-nostdin',...args],{cwd,encoding:'utf8',windowsHide:true,maxBuffer:12*1024*1024});assert.equal(p.status,0,p.stderr.slice(-7000));return p.stderr;}
const fit='scale=1706:960:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:0:color=0x123B2D,setsar=1,format=yuv420p';
const files:string[]=[],edit:any[]=[];let index=0,timeline=0;
for(const [c,parts] of chapters.entries())for(const p of parts){
 const output=resolve(render,'pieces',String(++index).padStart(2,'0')+'.mp4');
 const input=p.still?['-loop','1','-framerate','25','-i',p.file]:['-ss',String(p.start),'-t',String(p.sourceSeconds),'-i',p.file];
 const filter=`setpts=${p.seconds/p.sourceSeconds}*(PTS-STARTPTS),fps=25,${fit},tpad=stop_mode=clone:stop_duration=1,trim=duration=${p.seconds},setpts=N/(25*TB)`;
 run(['-n',...input,'-an','-vf',filter,'-t',String(p.seconds),'-c:v','libx264','-preset','fast','-crf','19','-threads','3','-r','25','-pix_fmt','yuv420p',output]);
 files.push(output);edit.push({chapter:c+1,from:timeline,to:timeline+p.seconds,...p});timeline+=p.seconds;console.log(JSON.stringify({piece:index,chapter:c+1,seconds:p.seconds}));
}
await writeFile(resolve(render,'pieces.txt'),files.map(f=>`file '${f.replaceAll('\\','/')}'`).join('\n'),{flag:'wx'});
await writeFile(resolve(render,'edit-manifest.json'),JSON.stringify({total,durations,edit,registration:'UI',bulk:'Same registration API, controlled execution of the normal production worker functions, staff approvals submitted through the ordinary approval API; not 300 manual UI entries',incident:'UI with real AI; database persistence verified',sourceFailures:'See stage evidence and retained attempts. Failed output is never applied; source recordings and database evidence are preserved.'},null,2),{flag:'wx'});
const tempos=voice.chapters.map((v:any,i:number)=>v.seconds/(durations[i]-1.4));
assert(tempos.every((t:number)=>t>=.8&&t<=1.2),'Narration rate outside reviewed range');
const audioFilter=voice.chapters.map((v:any,i:number)=>`[${i}:a]atempo=${tempos[i]},adelay=700:all=1,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,asetpts=N/SR/TB,apad,atrim=duration=${durations[i]}[a${i}]`).join(';')+';'+voice.chapters.map((_:any,i:number)=>`[a${i}]`).join('')+'concat=n=6:v=0:a=1[a]';
run(['-n',...voice.chapters.flatMap((v:any)=>['-i',resolve(folder,voiceFolder,`chapter-${v.index}.wav`)]),'-filter_complex',audioFilter,'-map','[a]','-ar','48000','-ac','2','-c:a','pcm_s16le',resolve(render,'narration.wav')]);
function stamp(seconds:number,srt=false){const n=Math.round(seconds*(srt?1000:100)),unit=srt?1000:100;return `${String(Math.floor(n/unit/3600)).padStart(srt?2:1,'0')}:${String(Math.floor(n/unit/60)%60).padStart(2,'0')}:${String(Math.floor(n/unit)%60).padStart(2,'0')}${srt?',':'.'}${String(n%unit).padStart(srt?3:2,'0')}`;}
function splitWords(s:string,max:number){const out:string[]=[];let line='';for(const word of s.split(' ')){if(line&&line.length+word.length+1>max){out.push(line);line=word}else line+=(line?' ':'')+word;}if(line)out.push(line);return out;}
const headers=['01  SMALL FARMS, SHARED SUPPORT','02  REGISTER → AI PLAN → STAFF CONFIRMATION','03  4 CENTERS · 300 PARCELS · 2027 PLANNED SEASON','04  HARVESTER REPAIR · VERIFIED REPLANNING','05  PEOPLE, ATTENDANCE AND FIELD RECORDS','06  WHAT WORKS TODAY — AND WHAT COMES NEXT'];
const disclosure=['Policy proposal · Synthetic voice · Fictional applicants/resources · Concept title; app maps © VWorld / MOLIT','Actual application / actual AI · Entry slowed and processing wait omitted · Cadastre © VWorld / MOLIT','Time-compressed batch intake · Same API / constraints · Invalid AI output blocked; reviewed retry · Map © VWorld / MOLIT','Actual UI, AI and DB update · Processing wait omitted · No physical machine command','Planned demand is not confirmed attendance · No real texts, payroll or settlement','Supervised software pilot · National forecasting and automated settlement remain future work'];
let offset=0;const cues:{from:number;to:number;text:string}[]=[],events:string[]=[];
// Editorial progress captions use the verified cumulative intake checkpoints,
// not a replacement or fabricated application counter.
for(const part of edit){const wave=part.label.match(/^bulk\/wave-(72|144|216|264|300)$/);if(wave)events.push(`Dialogue: 1,${stamp(part.from)},${stamp(part.to)},Progress,,0,0,0,,Saved intake: ${wave[1]} / 300 parcels (4 centers)`);}
for(const [i,chapter] of voice.chapters.entries()){
 events.push(`Dialogue: 0,${stamp(offset)},${stamp(offset+durations[i])},Heading,,0,0,0,,${headers[i]}`);
 events.push(`Dialogue: 0,${stamp(offset)},${stamp(offset+durations[i])},Disclosure,,0,0,0,,${disclosure[i]}`);
 for(const segment of chapter.segments){const chunks=splitWords(segment.text,126);let consumed=0;const chars=chunks.reduce((n,s)=>n+s.length,0);for(const text of chunks){const from=offset+.7+(segment.start+(segment.end-segment.start)*consumed/chars)/tempos[i];consumed+=text.length;const to=offset+.7+(segment.start+(segment.end-segment.start)*consumed/chars)/tempos[i];const lines=splitWords(text,68);assert(lines.length<=2);cues.push({from,to,text:lines.join('\n')});events.push(`Dialogue: 1,${stamp(from)},${stamp(to)},Caption,,0,0,0,,${lines.join('\\N')}`);}}
 offset+=durations[i];
}
const ass=`[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,Segoe UI,32,&H00FFFFFF,&H00FFFFFF,&H00202C26,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,2,80,80,12,1\nStyle: Disclosure,Segoe UI,18,&H00B9CEBE,&H00FFFFFF,&H00202C26,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,40,40,966,1\nStyle: Heading,Segoe UI,23,&H00FFFFFF,&H00FFFFFF,&H00202C26,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,30,30,8,1\nStyle: Progress,Segoe UI,23,&H00B9E8C8,&H00FFFFFF,&H00202C26,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,9,30,30,8,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}\n`;
await writeFile(resolve(render,'captions.ass'),ass,{flag:'wx'});await writeFile(resolve(render,'captions-en.srt'),cues.map((c,i)=>`${i+1}\n${stamp(c.from,true)} --> ${stamp(c.to,true)}\n${c.text}\n`).join('\n'),{flag:'wx'});
const output=resolve(render,'kfarm-submission-en-male-174s.mp4');
const encode=run(['-n','-f','concat','-safe','0','-i','pieces.txt','-i','narration.wav','-map','0:v:0','-map','1:a:0','-vf','drawbox=x=0:y=0:w=iw:h=40:color=0x123B2D:t=fill,subtitles=captions.ass:charenc=UTF-8','-c:v','libx264','-preset','medium','-crf','18','-threads','3','-pix_fmt','yuv420p','-r','25','-c:a','aac','-b:a','160k','-ar','48000','-ac','2','-t',String(total),'-movflags','+faststart',output]);await writeFile(resolve(render,'encode.log'),encode,{flag:'wx'});
const verification=run(['-i',output,'-af','volumedetect','-f','null','NUL']);await writeFile(resolve(render,'verification.log'),verification,{flag:'wx'});
assert(verification.includes('00:02:54.00'));assert(verification.includes('1920x1080'));assert(verification.includes('25 fps'));assert(/frame=\s*4350\b/.test(verification),'Expected 4350 frames');assert(verification.includes('h264')&&verification.includes('aac'));
const timelineLog=run(['-i',output,'-map','0:a:0','-af','ashowinfo','-f','null','NUL']);const pts=[...timelineLog.matchAll(/\bn:\d+ pts:(\d+)/g)].map(m=>Number(m[1]));assert(pts.length>=8156&&pts[0]===0&&pts.every((p,i)=>i===0||p-pts[i-1]===1024),'Audio timestamp discontinuity');
for(const at of [1,8,20,28,34,44,56,65,78,87,94,105,116,127,137,148,159,164,169,173])run(['-n','-ss',String(at),'-i',output,'-frames:v','1',resolve(render,'review-frames',`${at}.png`)]);
const report={output,seconds:total,width:1920,height:1080,fps:25,frames:4350,audio:'AAC stereo 48 kHz',audioContinuous:true,bytes:(await stat(output)).size,sha256:createHash('sha256').update(await readFile(output)).digest('hex'),published:false,uiLocale:'en',properNames:'Korean source names retained',voice:voice.voice,narration:'Local synthetic, not a clone',actualUiSeconds:edit.filter(p=>!p.still).reduce((sum,p)=>sum+p.seconds,0),bulk:bulk.summary,incident:{changed:incident.result.changed,source:incident.result.source},editedForTime:true};await writeFile(resolve(render,'video.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));
