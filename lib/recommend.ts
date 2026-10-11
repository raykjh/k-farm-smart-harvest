import type {Field,Crop} from './types';
export function recommend(f:Field){
 return (['쌀','감자','고추'] as Crop[]).map((crop,i)=>{
  const blocked=crop==='쌀'&&!f.water;
  // No verified supply threshold yet: no invented stability points or penalty.
  const parts={fit:crop==='쌀'?32:crop==='감자'?35:30,feasibility:f.access?(crop==='고추'?19:27):14,weather:7,supply:0,cost:4};
  return {crop,score:blocked?0:Object.values(parts).reduce((a,b)=>a+b,0),parts,blocked,provisional:!f.confirmed,bonus:0,reason:blocked?'용수 미확인으로 쌀 추천 제외':!f.confirmed?'현장 확인 전 잠정 추천':f.access?'장비 진입 가능 · 공동작업 편성 가능':'장비 진입 불가 · 인력 확보 필요',warning:'적합도·생산량은 데모 가정입니다. 실제 기후·토양·수급 검증 전 영농 판단에 사용할 수 없습니다.'};
 }).sort((a,b)=>b.score-a.score);
}
