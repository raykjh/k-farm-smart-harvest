import {it,expect} from 'vitest';
import {formatBirth,validBirth,formatPhone,intakeField,intakeRecommendations,neighboringParcels,type ParcelGeometry} from '../lib/registration-intake';
import {emptyConditions} from '../lib/field-conditions';
const rectangle=(x:number,y=35.78):ParcelGeometry=>({type:'Polygon',coordinates:[[[x,y],[x+.001,y],[x+.001,y+.001],[x,y+.001],[x,y]]]});
it('accepts eight digits without date-segment selection and rejects impossible/future dates',()=>{
 expect(formatBirth('19600229')).toBe('1960-02-29');expect(formatBirth('1960-02-29')).toBe('1960-02-29');
 expect(validBirth(formatBirth('19600229'),'2026-09-22')).toBe(true);expect(validBirth('1961-02-29','2026-09-22')).toBe(false);expect(validBirth('2027-01-01','2026-09-22')).toBe(false);
 expect(formatPhone('01012345678')).toBe('010-1234-5678');expect(formatPhone('021234567')).toBe('02-123-4567');expect(formatPhone('010-1234-5678')).toBe('010-1234-5678');
});
it('uses real boundary proximity, not array order, addresses or missing geometry',()=>{
 expect(neighboringParcels(rectangle(127.60),rectangle(127.601))).toBe(true);
 expect(neighboringParcels(rectangle(127.60),rectangle(127.604))).toBe(false);
 expect(neighboringParcels(undefined,rectangle(127.60))).toBe(false);
 expect(neighboringParcels({type:'MultiPolygon',coordinates:[(rectangle(127.60) as any).coordinates]},rectangle(127.601))).toBe(true);
});
it('reorders the next parcel when an earlier neighboring crop changes without replacing chosen crops',()=>{
 const previous=intakeField('5274036023106160004','가상 A',rectangle(127.60)),field=intakeField('5274036023106160005','가상 B',rectangle(127.601));
 field.conditions={...emptyConditions(),landUse:'upland',drainage:'good',water:'yes',machineAccess:'yes',laborAvailable:'yes',region:'계북면',climate:{rice:'suitable',potato:'suitable',pepper:'suitable'},evidence:'검증용 확인 근거',checkedOn:'2026-01-01'};
 previous.crop='pepper';field.crop='potato';const first=intakeRecommendations(field,[previous]);expect(first[0]).toMatchObject({crop:'pepper',score:100,neighborBonus:5});expect(first.find(x=>x.crop==='potato')?.score).toBe(95);
 previous.crop='potato';expect(intakeRecommendations(field,[previous])[0]).toMatchObject({crop:'potato',score:100});expect(field.crop).toBe('potato');
 previous.geometry=rectangle(127.61);expect(intakeRecommendations(field,[previous]).every(x=>x.neighborBonus===0)).toBe(true);
 previous.geometry=rectangle(127.601);previous.crop='rice';expect(intakeRecommendations(field,[previous]).find(x=>x.crop==='rice')).toMatchObject({score:0,neighborBonus:0,status:'BLOCKED'});
 field.conditions=emptyConditions();expect(intakeRecommendations(field,[previous]).every(x=>x.score===null&&x.neighborBonus===0)).toBe(true);
});
