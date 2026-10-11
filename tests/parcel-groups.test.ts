import {it,expect} from 'vitest';
import {addParcel,groupParcels,type GroupParcel} from '../lib/parcel-groups';
const a:GroupParcel={pnu:'a',address:'a',crop:'rice',group:'',geometry:null};
it('rejects duplicate parcels',()=>expect(()=>addParcel([a],a)).toThrow('DUPLICATE'));
it('groups same crops without merging identities',()=>{const items=[a,{...a,pnu:'b'}];const result=groupParcels(items,['a','b'],'G1');expect(result.map(p=>p.pnu)).toEqual(['a','b']);expect(result.every(p=>p.group==='G1')).toBe(true);expect(a.group).toBe('')});
it('rejects mixed or unselected crops',()=>{expect(()=>groupParcels([a,{...a,pnu:'b',crop:'potato'}],['a','b'],'G1')).toThrow();expect(()=>groupParcels([{...a,crop:''},{...a,pnu:'b',crop:''}],['a','b'],'G1')).toThrow()});
