// A bounded execution lease fences a late/abandoned handler from committing
// after recovery. Timeouts never authorize a second inference call.
export const AUTOMATIC_REPLAN_LEASE_MS=5*60_000;
type Lease={status?:string;executionToken?:string;leaseExpiresAt?:string};
export function newAutomaticLease(token:string,now=Date.now()){
 return {executionToken:token,leaseExpiresAt:new Date(now+AUTOMATIC_REPLAN_LEASE_MS).toISOString()};
}
export function assertAutomaticLease(payload:Lease,token:string|undefined,now=Date.now()){
 if(payload.status!=='PROCESSING'||!token||payload.executionToken!==token||!(Date.parse(payload.leaseExpiresAt??'')>now))throw Error('재배치 처리 권한이 만료되었거나 다른 처리로 넘어갔습니다. 저장된 결과를 확인하세요.');
}
export function automaticLeaseWait(payload:Lease,updatedAt:Date,now=Date.now()){
 // Old unfinished receipts have no lease field. Allow explicit recovery after
 // a quiet interval; never turn them into successful work retrospectively.
 const expiry=payload.leaseExpiresAt?Date.parse(payload.leaseExpiresAt):updatedAt.getTime()+AUTOMATIC_REPLAN_LEASE_MS;
 return Number.isFinite(expiry)?Math.max(0,expiry-now):0;
}
