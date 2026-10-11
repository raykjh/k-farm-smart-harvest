// Source-backed sequence; regional dates require a locally checked anchor.
export const guidelineVersion='crop-guidelines-2026-09-11-v2';
export type CropCode=import('./crop-registry').LegacyCropCode;
export type CatalogContext={version:string;year:number;dataOrigin:'DEMO';sourceBatchId:string};
type Step={code:string;name:string;timing:string;kind:'PROCESS'|'INSPECTION'|'CONDITIONAL'|'REPEAT';anchor?:'planting'|'heading';offset?:[number,number]};
const step=(code:string,name:string,timing:string,kind:Step['kind']='PROCESS',anchor?:Step['anchor'],offset?:[number,number]):Step=>({code,name,timing,kind,anchor,offset});
export const cropGuidelines:Record<CropCode,{name:string;source:string;steps:Step[]}>= {
 rice:{name:'논 이앙재배',source:'https://www.rda.go.kr/board/board.do?dataNo=100000812510&mode=view&prgId=day_farmprmninfoEntry',steps:[
 step('seed','종자·육묘 확보','모내기 전'),step('nursery','육묘 관리','이앙일에서 육묘기간 역산'),step('soil','논 준비·밑거름·써레질','모내기 전'),step('plant','모내기','지역·품종 적기','PROCESS','planting',[0,0]),step('establish','활착·잡초·물 관리','이앙 후 반복','INSPECTION'),step('drain','중간 물떼기 판단','이삭패기 약 40~30일 전','CONDITIONAL','heading',[-40,-30]),step('fertilize','이삭거름 판단','이삭패기 약 25~15일 전','CONDITIONAL','heading',[-25,-15]),step('heading','이삭패기·등숙 관찰','실제 이삭패는 시점부터','INSPECTION','heading',[0,0]),step('harvest','성숙 확인·벼 수확','실제 성숙·기상·논 상태 확인'),step('finish','건조·선별·반출','수확 직후 연계')]},
 potato:{name:'봄감자',source:'https://www.rda.go.kr/board/board.do?dataNo=100000807551&mode=view&prgId=day_farmprmninfoEntry',steps:[
 step('seed','씨감자 확보·싹틔우기','파종 전'),step('soil','밭 준비·밑거름·두둑','파종 전'),step('plant','감자 파종','지역 지온·늦서리 검토','PROCESS','planting',[0,0]),step('emerge','출아·서리 피해 확인','출아 기간','INSPECTION'),step('hill','제초·북주기 판단','꽃 피기 전, 재배방식 확인','CONDITIONAL'),step('care','수분·병해충 관찰','생육·덩이줄기 비대기','INSPECTION'),step('treat','필요 시 시비·방제','처방·예찰 결과에 따라','CONDITIONAL'),step('harvest','성숙 확인·굴취·수거','봄재배는 장마 전 수확 목표, 고랭지 별도 확인'),step('finish','선별·반출·저장','수확 직후 연계')]},
 pepper:{name:'노지 붉은 고추',source:'https://www.rda.go.kr/board/board.do?boardId=farmlcltinfo&dataNo=100000771497&mode=updateCnt&prgId=day_farmlcltinfoEntry',steps:[
 step('seed','육묘 또는 모 확보','정식 전'),step('soil','밭 준비·밑거름·두둑·피복','정식 전'),step('plant','모 순화·정식','늦서리 이후 지역 조건 확인','PROCESS','planting',[0,0]),step('stake','지주·유인','정식 후 조기 설치, 생장 중 보완'),step('fertilize','첫 웃거름 판단','정식 후 약 25~30일','CONDITIONAL','planting',[25,30]),step('care','제초·관수·배수·병해충 관찰','재배 기간 반복','INSPECTION'),step('fertilize-repeat','후속 웃거름 판단','이전 시비 후 약 30일 참고, 생육에 따라','CONDITIONAL'),step('harvest','완숙 고추 반복 수확','열매 성숙에 따라 회차 생성','REPEAT'),step('finish','회차별 건조·선별·반출','매 수확과 연계','REPEAT'),step('cleanup','잔재·피복·지주 정리','마지막 수확 후')]}
};
export type CropAnchors={planting?:string;heading?:string};
export type GuidelineContext={region?:string;regionalProfile?:import('./regional-profile').RegionalProfile;catalog?:CatalogContext;anchors?:Partial<Record<CropCode,CropAnchors>>;operations?:Partial<Record<import('./crop-registry').SupportedCropCode,Record<string,import('./operation-requirements').OperationRule>>>};
export function guidelineTasks(crop:CropCode,year:number,context:GuidelineContext={},horizon?:{start:string;end:string}){
 const configured=context.operations?.[crop]??{};
 for(const code of Object.keys(configured))if(!cropGuidelines[crop].steps.some(s=>s.code===code))throw Error('알 수 없는 작업 단계: '+code);
 const expanded=cropGuidelines[crop].steps.flatMap(op=>{
  const rounds=configured[op.code]?.occurrences;
  if(rounds&&op.kind!=='REPEAT'&&op.kind!=='INSPECTION'&&op.code!=='fertilize-repeat')throw Error('반복 불가 작업');
  if(rounds&&(rounds.length===0||new Set(rounds.map(r=>r.occurrence)).size!==rounds.length||rounds.some(r=>!Number.isInteger(r.occurrence)||r.occurrence<1||r.occurrence>100)))throw Error('반복 회차 중복 또는 오류');
  const finishRounds=op.code==='finish'&&op.kind==='REPEAT'?configured.harvest?.occurrences:undefined;
  if(rounds&&finishRounds&&rounds.some(r=>!finishRounds.some(h=>h.occurrence===r.occurrence)))throw Error('수확 없는 후처리 회차');
  const instances=rounds??finishRounds?.map(r=>({occurrence:r.occurrence,from:'',to:''}))??[{occurrence:1,from:'',to:''}];
  return [...instances].sort((a,b)=>a.occurrence-b.occurrence).map(r=>({...op,occurrence:r.occurrence,instanceCode:op.code+(r.occurrence>1?':'+r.occurrence:''),round:r}));
 });
 return expanded.map(op=>{
 const anchor=op.anchor?context.anchors?.[crop]?.[op.anchor]:undefined;
 if(anchor&&(!/^\d{4}-\d{2}-\d{2}$/.test(anchor)||!Number.isFinite(Date.parse(anchor))||new Date(anchor+'T00:00:00Z').toISOString().slice(0,10)!==anchor||(horizon?anchor<horizon.start||anchor>horizon.end:!anchor.startsWith(year+'-'))))throw Error('재배 기준일 확인 필요');
 const shift=(days:number)=>new Date(Date.parse(anchor!+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
 const rule=op.round.from?{...configured[op.code],from:op.round.from,to:op.round.to}:configured[op.code];
 const override=rule?.from&&rule?.to?{from:rule.from,to:rule.to,basis:'OPERATOR_PROVISIONAL_WINDOW'}:null;
 if(override&&[override.from,override.to].some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||(horizon?d<horizon.start||d>horizon.end:!d.startsWith(year+'-'))||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)||override&&override.from>override.to)throw Error('작업기간 확인 필요');
 const window=override??(anchor&&op.offset?{from:shift(op.offset[0]),to:shift(op.offset[1]),basis:'GUIDELINE_RELATIVE_TO_OPERATOR_ANCHOR'}:null);
 if(horizon&&window&&(window.from<horizon.start||window.to>horizon.end))throw Error('작업이 재배 기간을 벗어납니다.');
 return {...op,date:window&&window.from===window.to?window.from:null,window,timingStatus:window?'PROVISIONAL':'ANCHOR_OR_STAGE_REQUIRED'};
 });
}
