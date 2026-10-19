import {z} from 'zod';

const point=z.tuple([z.number().min(120).max(135),z.number().min(30).max(40)]);
const ring=z.array(point).min(4).max(20000).refine(r=>r[0][0]===r.at(-1)![0]&&r[0][1]===r.at(-1)![1]);
const polygon=z.array(ring).min(1).max(100);
// Advisory parcel grouping only. Never an approved machine work area or route.
export const parcelBoundarySchema=z.object({
 geometry:z.discriminatedUnion('type',[
  z.object({type:z.literal('Polygon'),coordinates:polygon}).strict(),
  z.object({type:z.literal('MultiPolygon'),coordinates:z.array(polygon).min(1).max(100)}).strict(),
 ]).refine(g=>(g.type==='Polygon'?g.coordinates:g.coordinates.flat()).reduce((n,r)=>n+r.length,0)<=20000),
 source:z.enum(['VWORLD','REVIEWED_SURVEY']),checkedOn:z.string().date(),
}).strict();
