import {it,expect} from 'vitest';
import {AUTOMATIC_REPLAN_LEASE_MS,assertAutomaticLease,automaticLeaseWait,newAutomaticLease} from '../lib/automatic-replan-lease';
it('fences expired, superseded and terminal executions, without renewing them by observation',()=>{
 const now=Date.parse('2026-10-11T09:00:00Z'),lease={status:'PROCESSING',...newAutomaticLease('first',now)};
 expect(()=>assertAutomaticLease(lease,'first',now+1)).not.toThrow();
 expect(automaticLeaseWait(lease,new Date(now),now)).toBe(AUTOMATIC_REPLAN_LEASE_MS);
 expect(()=>assertAutomaticLease(lease,'first',now+AUTOMATIC_REPLAN_LEASE_MS)).toThrow();
 expect(()=>assertAutomaticLease(lease,'second',now)).toThrow();
 expect(()=>assertAutomaticLease({...lease,status:'FAILED'},'first',now)).toThrow();
 expect(()=>assertAutomaticLease({...lease,status:'APPLIED'},'first',now)).toThrow();
 expect(()=>assertAutomaticLease({...lease,leaseExpiresAt:'invalid'},'first',now)).toThrow();
 expect(automaticLeaseWait({status:'PROCESSING'},new Date(now),now+AUTOMATIC_REPLAN_LEASE_MS+1)).toBe(0);
});
