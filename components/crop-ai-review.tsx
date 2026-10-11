'use client';
import {useState} from 'react';
import type {ProductionItem} from '@/lib/continuous-production';
import type {CropPriority} from '@/lib/operating-crop-adviser';
import {cropDisplayNames} from '@/lib/crop-registry';
import {useLanguage} from './language';
import {Button} from './ui/button';

export default function CropAiReview({item,canManage,busy,onReview,requestedPriority}:{item:ProductionItem;canManage:boolean;busy:boolean;onReview:(priority:CropPriority)=>void;requestedPriority?:CropPriority}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [priority,setPriority]=useState<CropPriority>(requestedPriority??item.decision?.priority??'BALANCED');
 const crops=cropDisplayNames(locale==='ko'),decision=item.decision,facts=item.candidateFacts??[];
 const name=(id:string)=>{const fact=facts.find(c=>c.id===id);return fact?(crops[fact.crop as keyof typeof crops]??fact.crop)+' · '+id:id};
 const labels={score:t('배치 평가점수','Allocation ranking score'),specialtyBonus:t('지역 특화 가점','Regional specialty bonus'),supplyPenalty:t('수급 주의 감점','Supply-risk deduction'),borrowedEquipmentTasks:t('차용 장비 작업(건)','Borrowed-equipment tasks'),personMinutes:t('인력 수요(인·분)','Staff demand (person-minutes)')};
 return <div className="production-crop-review" data-testid="crop-ai-review">
  <p>{decision?.source==='NEBIUS'?t('AI 검토 완료 · 선택·탈락 근거 검증됨 · 담당자 확정 전','AI reviewed · choice and rejection evidence verified · approval required'):t('계산 기준 추천 · AI 미검토','Calculation-based recommendation · not yet AI-reviewed')}</p>
  {canManage&&<div className="registration-grid"><label>{t('작물 판단 우선순위','Crop decision priority')}<select aria-label={t('작물 판단 우선순위','Crop decision priority')} value={priority} disabled={busy} onChange={e=>setPriority(e.target.value as CropPriority)}><option value="BALANCED">{t('적합도·지역 기준 우선','Suitability and regional criteria first')}</option><option value="MIN_EXTERNAL">{t('외부 장비 차용 최소화','Minimize external equipment')}</option><option value="MIN_LABOR">{t('인력 투입 최소화','Minimize staff demand')}</option></select></label><Button variant="outline" disabled={busy} onClick={()=>onReview(priority)}>{t('AI 작물 검토','Review crops with AI')}</Button></div>}
  {decision?.source==='NEBIUS'&&<details><summary>{t('AI 선택·탈락 근거','AI choice and rejection evidence')}</summary>
   <p>{t('선택','Selected')}: {name(decision.candidateId!)} · {decision.model}{decision.selectionReason==='ONLY_ELIGIBLE'&&' · '+t('유일한 실행 가능 후보','Only feasible candidate')}</p>
   <ul>{decision.rejections.map(r=><li key={r.candidateId}>{name(r.candidateId)} — {r.metric?`${labels[r.metric]}: ${t('선택','Selected')} ${facts.find(c=>c.id===decision.candidateId)?.[r.metric]} / ${t('이 후보','This candidate')} ${facts.find(c=>c.id===r.candidateId)?.[r.metric]}`:t('동점: 후보 ID 고정 순서 적용','Tie: stable candidate-ID order')}</li>)}</ul>
   <p>{t('숫자는 계산 엔진의 값입니다. 인·분과 차용 건수는 금액이 아니며, 미참여 농지까지 포함한 전국 공급 판단은 아닙니다.','Values come from the calculation engine. Staff minutes and borrowing counts are not money; nationwide supply including nonparticipants is unknown.')}</p>
  </details>}
 </div>;
}
