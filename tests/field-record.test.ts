import {it,expect} from 'vitest';
import {fieldInventory} from '../lib/field-record';
const a={pnu:'5274036023106160004',address:'Test',crop:'rice',group:'',area:3000,mode:'joint',rights:'pending'};
it('accepts one crop per field and rejects duplicate identifiers',()=>{expect(fieldInventory.safeParse([a]).success).toBe(true);expect(fieldInventory.safeParse([a,a]).success).toBe(false);expect(fieldInventory.safeParse([{...a,crop:['rice','potato']}]).success).toBe(false)});
it('rejects geometry and rights elevation',()=>{expect(fieldInventory.safeParse([{...a,geometry:{}}]).success).toBe(false);expect(fieldInventory.safeParse([{...a,rights:'approved'}]).success).toBe(false)});
it('requires homogeneous multi-parcel groups',()=>{expect(fieldInventory.safeParse([{...a,group:'G'}]).success).toBe(false);expect(fieldInventory.safeParse([{...a,group:'G'},{...a,pnu:'5274036023102760001',group:'G'}]).success).toBe(true);expect(fieldInventory.safeParse([{...a,group:'G'},{...a,pnu:'5274036023102760001',group:'G',crop:'potato'}]).success).toBe(false)});
