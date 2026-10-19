import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=process.cwd();
const folder=resolve('.data/video-capture-20261018');
const ffmpeg=resolve('.data/video-tools/.venv/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
const capture=JSON.parse(await readFile(resolve(folder,'capture.json'),'utf8'));
const voice=JSON.parse(await readFile(resolve(folder,'voice.json'),'utf8'));
const renderFolder=resolve(folder,'sample-final');
await mkdir(renderFolder);
const output=resolve(renderFolder,'kfarm-sample-20s.mp4');
assert.equal(await stat(output).then(()=>true,()=>false),false,'Sample exists; do not overwrite');
const tempo=0.87,offset=0.5;
const breaks=[
 'K-Farm connects small farms\\Nthrough local centers.',
 'NVIDIA Nemotron, through Nebius Token Factory,\\Nhelps plan crops, equipment, and labor.',
 'Staff review the plan and confirm it.',
 'This is a recording test\\Nusing fictional applicants and resources.',
];
function stamp(s:number){const n=Math.round(s*100);return `${Math.floor(n/360000)}:${String(Math.floor(n/6000)%60).padStart(2,'0')}:${String(Math.floor(n/100)%60).padStart(2,'0')}.${String(n%100).padStart(2,'0')}`;}
const captions=`[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Segoe UI,32,&H00FFFFFF,&H00FFFFFF,&H00202C26,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,2,100,100,12,1
Style: Disclosure,Segoe UI,18,&H00B9CEBE,&H00FFFFFF,&H00202C26,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,100,100,968,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:20.00,Disclosure,,0,0,0,,RECORDING TEST  |  Synthetic narration  |  No AI call in this clip  |  Map: VWorld / MOLIT
${voice.segments.map((s:any,i:number)=>`Dialogue: 1,${stamp(offset+s.start/tempo)},${stamp(offset+s.end/tempo)},Caption,,0,0,0,,${breaks[i]}`).join('\n')}
`;
await writeFile(resolve(renderFolder,'sample-captions.ass'),captions,{flag:'wx'});
// Native 1920x1080 recording is fitted inside a 1080p output with a separate caption band.
// The original title image is reused; the application pixels and data are not replaced.
const appStart=Math.max(3,capture.sampleStartsAfter);
const fit='scale=1706:960:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:0:color=0x123B2D,setsar=1,fps=25,format=yuv420p';
const filter=`[0:v]trim=duration=3,setpts=PTS-STARTPTS,${fit}[title];[1:v]trim=start=${appStart}:duration=17,setpts=PTS-STARTPTS,${fit}[app];[title][app]concat=n=2:v=1:a=0,tpad=stop_mode=clone:stop_duration=0.12,trim=duration=20,setpts=N/(25*TB),subtitles=sample-captions.ass:charenc=UTF-8[v];[2:a]atempo=${tempo},adelay=500:all=1,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,asetpts=N/SR/TB,apad,atrim=duration=20[a]`;
function run(args:string[]){const r=spawnSync(ffmpeg,['-hide_banner','-nostdin',...args],{cwd:renderFolder,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr.slice(-5000));return r.stderr;}
const log=run(['-n','-loop','1','-framerate','25','-i',resolve(root,'docs/video-assets/kfarm-title-peninsula-v1.png'),'-i',capture.rawVideo,'-i',resolve(folder,'voice-raw.wav'),'-filter_complex',filter,'-map','[v]','-map','[a]','-t','20','-c:v','libx264','-crf','18','-preset','medium','-pix_fmt','yuv420p','-r','25','-c:a','aac','-b:a','160k','-ar','48000','-ac','2','-movflags','+faststart',output]);
await writeFile(resolve(renderFolder,'encode.log'),log,{flag:'wx'});
await mkdir(resolve(renderFolder,'review-frames'));
for(const at of [1,4,7,11,15,19])run(['-n','-ss',String(at),'-i',output,'-frames:v','1',resolve(renderFolder,'review-frames',`${at}.png`)]);
const verify=run(['-i',output,'-af','volumedetect','-f','null','NUL']);
await writeFile(resolve(renderFolder,'media-verification.log'),verify,{flag:'wx'});
assert(verify.includes('00:00:20.00'),'Expected exact 20-second duration');
assert(verify.includes('1920x1080'));assert(verify.includes('25 fps'));assert(verify.includes('h264'));assert(verify.includes('aac'));
assert(verify.includes('frame=  500'),'Expected all 500 frames');
const sampleCounts=[...verify.matchAll(/n_samples: (\d+)/g)].map(match=>Number(match[1]));
assert(Math.max(...sampleCounts)>=1920000,'Audio must contain 20 seconds of decoded stereo samples');
const timeline=run(['-i',output,'-map','0:a:0','-af','ashowinfo','-f','null','NUL']);
const pts=[...timeline.matchAll(/\bn:\d+ pts:(\d+)/g)].map(m=>Number(m[1]));
assert(pts.length>=937&&pts[0]===0&&pts.every((p,i)=>i===0||p-pts[i-1]===1024),'AAC presentation timestamps must be continuous');
await writeFile(resolve(renderFolder,'audio-timeline-check.json'),JSON.stringify({frames:pts.length,first:pts[0],last:pts.at(-1),step:1024,rate:48000,continuous:true}),{flag:'wx'});
run(['-n','-i',output,'-map','0:a:0','-c:a','pcm_s16le',resolve(renderFolder,'voice-preview.wav')]);
const result={at:new Date().toISOString(),output,seconds:20,width:1920,height:1080,fps:25,video:'H.264',audio:'AAC stereo 48 kHz',titleSeconds:3,realApplicationSeconds:17,appStart,voice:{model:voice.model,voice:voice.voice,tempo,rawSpeechSeconds:voice.rawSeconds,source:voice.modelSource},sourceCapture:'1920x1080 native; fitted into 1706x960 picture area with separate caption band',paidCalls:0,registrationSubmissions:0,sha256:createHash('sha256').update(await readFile(output)).digest('hex'),bytes:(await stat(output)).size};
await writeFile(resolve(renderFolder,'sample.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
