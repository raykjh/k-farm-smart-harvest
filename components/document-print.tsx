'use client';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
export default function DocumentPrint({title,sections}:{title:string;sections:{title:string;rows:[string,string][]}[]}){
 const [ready,setReady]=useState(false);useEffect(()=>setReady(true),[]);
 return <><button className="document-print-button" disabled={!ready} onClick={()=>window.print()}>인쇄 / PDF 저장</button>{ready&&createPortal(<article className="paper-print"><header><p>K-Farm : Smart Harvest</p><h1>{title}</h1><p>작성 내용 출력본 · 접수·승인 상태는 별도 확인</p></header>{sections.map((s,i)=><section key={i}><h2>{s.title}</h2><dl>{s.rows.map(([label,value],j)=><div key={j}><dt>{label}</dt><dd>{value||'미입력'}</dd></div>)}</dl></section>)}<footer>출력 시점의 입력 내용입니다. 저장·접수·승인 여부는 시스템 기록을 확인하세요.</footer></article>,document.body)}</>;
}
