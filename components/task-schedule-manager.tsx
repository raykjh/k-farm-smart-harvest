'use client';
import {operationalText} from '@/lib/operational-i18n';
import {isClosedTask} from '@/lib/task-lifecycle';
import type {Mission,State} from '@/lib/types';
import ReplanManager from './replan-manager';
import {useLanguage} from './language';
export default function TaskScheduleManager({mission:m,state,onClose,onSaved}:{mission:Mission;state?:State;onClose:()=>void;onSaved:()=>Promise<void>}){
 const {locale}=useLanguage();if(isClosedTask(m.status))return <section className="card"><p>{operationalText(m.label,locale)} · {locale==='ko'?'종료된 작업 이력입니다.':'Closed task.'}</p><button onClick={onClose}>{locale==='ko'?'닫기':'Close'}</button></section>;
 return <ReplanManager state={state} ids={[m.id]} preferredDate={m.scheduledDate} onClose={onClose} onSaved={onSaved}/>;
}
