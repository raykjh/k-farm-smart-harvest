'use client';
import {useState} from 'react';
import {cropCatalog} from '@/lib/crop-catalog';
import {useLanguage} from './language';
export default function CropCatalogPanel(){
 const {locale}=useLanguage(),ko=locale==='ko';
 const [query,setQuery]=useState(''),[category,setCategory]=useState('ALL');
 const categories={ALL:ko?'전체':'All',PADDY:ko?'논농사':'Paddy',UPLAND:ko?'밭농사':'Upland',VEGETABLE:ko?'채소':'Vegetables',ORCHARD:ko?'과수':'Orchards'};
 const rows=cropCatalog.filter(p=>(category==='ALL'||p.category===category)&&p.name.includes(query.trim()));
 return <section className="card section-space" data-testid="crop-catalog"><h2>{ko?'작물·작형 카탈로그':'Crop and cultivation catalog'} · {cropCatalog.length}</h2>
 <p>{ko?'품목과 출처를 먼저 등록하고, 지역 작업 기준과 공동운영의 이점을 확인한 뒤 지원 범위를 넓힙니다. 목록 수록은 자동 배차 가능을 뜻하지 않습니다.':'Catalog entries identify crops and sources, not operational approval. Regional work standards and cooperative benefits require review.'}</p>
 <p className="notice">{ko?'서비스 조건: 공동영농으로 제공 가능 · 스마트팜이 명확히 유리하면 우선 안내 · 개별 영농 대비 효율 이점 확인. 자료 부족은 판단 보류입니다.':'Service criteria: deliverable cooperative farming, smart-farm referral where clearly better, and evidence of benefit over individual farming. Missing evidence means pending review.'}</p>
 <p><a className="button" href="/crop-standards">{ko?'지역별 작물 기준 저장·편집':'Edit regional crop standards'}</a> <a className="button" href="/capacity">{ko?'30작물·자원계획':'30 crops / resources'}</a></p>
 <label>{ko?'품목명 검색':'Search source crop name'} <input value={query} onChange={e=>setQuery(e.target.value)}/></label>
 <label>{ko?'분류':'Category'} <select value={category} onChange={e=>setCategory(e.target.value)}>{Object.entries(categories).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <p role="status">{rows.length}{ko?'개 작물·작형':' crop/practice entries'}</p>
 <div className="table-wrap"><table><thead><tr>{[ko?'품목·작형 (원문)':'Crop/practice (source language)',ko?'준비 상태':'Readiness',ko?'출처':'Source'].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{rows.map(p=><tr key={p.id}><td>{p.name}{p.orchard&&<div className="description">{ko?'과원 조성·수령·성목·다년 점유 확인 필요':'Establishment, tree age, bearing stage and multi-year occupancy required'}</div>}</td><td>{p.legacyPlanner?(ko?'기존 계획 연결 · 지역 기준 검토 필요':'Legacy planner linked; regional review required'):(ko?'목록 수록 · 작업 기준 검토 대기':'Catalog only; work profile pending')}</td><td><a href={p.source.url} target="_blank" rel="noreferrer">{ko?'농촌진흥청 농사로':'RDA Nongsaro'}</a></td></tr>)}</tbody></table></div>
 <p className="description">{ko?'출처 페이지는 공공누리 제2유형 표시. 작업표 본문은 복제하지 않았으며 상업 서비스 재사용은 별도 확인 대상입니다. 작물 수가 아니라 작형별 항목 수입니다.':'Source directories display KOGL Type 2 terms. Calendar content is not reproduced; commercial reuse needs separate review. Count is practice entries, not unique species.'}</p></section>;
}
