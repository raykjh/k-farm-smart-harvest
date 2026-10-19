import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Mission,State} from '../lib/types';
const hooks=vi.hoisted(()=>({effect:vi.fn()}));
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),useEffect:hooks.effect}));
vi.mock('../components/language',()=>({useLanguage:()=>({locale:'en'})}));
vi.mock('../components/use-korea-day',()=>({useKoreaDay:()=> '2026-10-19'}));
vi.mock('../components/schedule-change-dialog',()=>({default:()=>null}));
vi.mock('../components/task-cancel-form',()=>({default:()=>null}));
vi.mock('../components/equipment-mission-panel',()=>({default:()=>null}));
import TaskOperations from '../components/task-operations';

const original={id:'new-field:soil',label:'Soil preparation',status:'PLANNED',scheduledDate:'2027-05-20'} as Mission;
function render(missions:Mission[],planVersion:number){
 return renderToStaticMarkup(createElement(TaskOperations,{mission:original,state:{missions,planVersion} as State,initialTab:'history',onClose:()=>{},onSaved:async()=>{}}));
}
beforeEach(()=>{hooks.effect.mockClear();vi.stubGlobal('fetch',vi.fn(()=>{throw Error('No network in component regression test')}))});
afterEach(()=>vi.unstubAllGlobals());

it('uses the refreshed mission rather than the object captured when management opened',()=>{
 const html=render([{...original,scheduledDate:'2027-05-21'}],22);
 expect(html).toContain('Scheduled date');expect(html).toContain('2027-05-21');expect(html).not.toContain('2027-05-20');
 expect(fetch).not.toHaveBeenCalled();
});
it('invalidates loaded history on plan revision and retains the selected task if absent from the refreshed list',()=>{
 render([original],21);expect(hooks.effect.mock.calls.at(-1)?.[1]).toEqual([0,original.id,21]);
 render([{...original,scheduledDate:'2027-05-21'}],22);expect(hooks.effect.mock.calls.at(-1)?.[1]).toEqual([0,original.id,22]);
 expect(render([],23)).toContain('2027-05-20');expect(fetch).not.toHaveBeenCalled();
});
