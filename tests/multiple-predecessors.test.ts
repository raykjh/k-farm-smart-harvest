import {it,expect} from 'vitest';
import {verifyAssignments} from '../lib/annual-replanning';
it('checks every predecessor, not only the first one',()=>{
 const base={field:'parcel',duration:2,resource:null,person:null,staff:0,transport:0,selected:true,preferred:null,predecessor:null};
 const c={tasks:[{...base,id:'soil',original:0,allowed:[0]},{...base,id:'nursery',original:4,allowed:[4]},{...base,id:'plant',original:2,allowed:[2,6],predecessors:['soil','nursery']}],freezeBefore:0,staffCapacity:2,transportCapacity:2,daily:false};
 expect(()=>verifyAssignments(c,[{id:'soil',start:0},{id:'nursery',start:4},{id:'plant',start:2}],'REBUILD_RELATED')).toThrow('순서');
 expect(()=>verifyAssignments(c,[{id:'soil',start:0},{id:'nursery',start:4},{id:'plant',start:6}],'REBUILD_RELATED')).not.toThrow();
});
