import {registeredDemo,DEMO_BATCH} from './registered-demo-fixture';
import type {DemoRemovalSnapshot} from '../lib/demo-removal-preflight';
export function demoRemovalFixture(){
 const b=registeredDemo();
 const snapshot:DemoRemovalSnapshot={centerVersion:1,records:[
  {workspace:'sandbox',kind:'demoManifest',id:DEMO_BATCH,version:1,payload:{fields:b.fields,consultations:b.consultations,simulated:true}},
  {workspace:'sandbox',kind:'fields',id:'current',version:1,payload:structuredClone(b.fields)},
  ...b.consultations.map(c=>({workspace:'sandbox',kind:'consultation',id:c.id,version:1,payload:structuredClone(c.payload)})),
 ],outbox:[],receipts:[],otherCenters:[]};
 return {b,snapshot};
}
