import {it,expect} from 'vitest';
import type {Principal} from '../lib/auth';
import {permitted} from '../lib/auth-policy';
import {centerRegistry} from '../lib/center-registry';

const staff:Principal={id:'operator',username:'operator',name:'Operator',role:'CENTER_STAFF',centerId:'demo',enabled:true};
const scheduleActions=['preview','compare','approve','automatic','recoverAutomatic','saveManualAlternative'];

it.each(centerRegistry.map(c=>c.id))('allows routine schedule changes for staff and managers in %s',centerId=>{
 for(const role of ['CENTER_STAFF','CENTER_ADMIN'] as const){
  const actor={...staff,role,centerId};
  expect(permitted(actor,'replanning','GET',null)).toBe(true);
  for(const action of scheduleActions)expect(permitted(actor,'replanning','POST',{action})).toBe(true);
  for(const action of ['preview','save'])expect(permitted(actor,'task-schedule','POST',{action})).toBe(true);
 }
});

it('does not grant centerless, unknown-center or global accounts local scheduling access',()=>{
 for(const actor of [{...staff,centerId:null},{...staff,centerId:'unknown-center'},{...staff,role:'SUPER_ADMIN' as const,centerId:null}]){
  for(const action of scheduleActions)expect(permitted(actor,'replanning','POST',{action})).toBe(false);
  expect(permitted(actor,'task-schedule','POST',{action:'save'})).toBe(false);
 }
});

it('keeps staff scheduling actions explicit without granting account, lending or shared-standard administration',()=>{
 for(const action of ['deleteAll','changeRole',undefined])expect(permitted(staff,'replanning','POST',{action})).toBe(false);
 expect(permitted(staff,'replanning','DELETE',null)).toBe(false);
 expect(permitted(staff,'task-schedule','POST',{action:'deleteAll'})).toBe(false);
 for(const path of ['accounts','regional-crop-standards','center-settings','center-resources','shared-reservations']){
  expect(permitted(staff,path,'POST',{action:'approve'})).toBe(false);
 }
});
