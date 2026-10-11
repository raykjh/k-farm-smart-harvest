import {AsyncLocalStorage} from 'node:async_hooks';
import {currentPrincipal} from './auth';
import {knownCenter} from './center-registry';
export type Workspace='operations'|'sandbox';
const context=new AsyncLocalStorage<Workspace>();
export const workspace=()=>context.getStore()??'sandbox';
const centers=new AsyncLocalStorage<string>();
export function centerId(){
 const principal=currentPrincipal();
 if(principal){if(!knownCenter(principal.centerId))throw Error('지역 업무 계정으로 접속하세요.');return principal.centerId;}
 return centers.getStore()??(workspace()==='operations'?'operations':'demo');
}
export const recordSpace=(id=centerId())=>id==='demo'?'sandbox':`center:${id}`;
export const reportSpace=(id=centerId())=>id==='demo'?'reports':`reports:${id}`;
export const receiptId=(key:string)=>centerId()==='demo'?key:`${centerId()}:${key}`;
/** Explicit center context for trusted background jobs; never read from request input. */
export function inCenter<T>(id:string,fn:()=>T){if(!knownCenter(id))throw Error('센터 확인 필요');return centers.run(id,fn);}
export const inWorkspace=<T>(value:Workspace,fn:()=>T)=>context.run(value,fn);
export function parseWorkspace(value:string|null):Workspace{
 if(value!==null&&value!=='operations'&&value!=='sandbox')throw Error('작업 공간을 선택하세요.');
 return 'sandbox';
}
