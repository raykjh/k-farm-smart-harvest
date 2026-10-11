import {z} from 'zod';
import {operatorRosterSchema} from './named-operators';
const day=z.string().date().refine(v=>v<=new Date(Date.now()+9*3600000).toISOString().slice(0,10),'확인일은 오늘 이후일 수 없습니다.');
export const evidenceSchema=z.object({basis:z.string().trim().min(3).max(1000),checkedOn:day}).strict();
const version=z.number().int().nonnegative();
export const crewCapacitySchema=z.object({operators:z.number().int().min(0).max(1000),workers:z.number().int().min(0).max(1000)}).strict();
export const centerSettingCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('operators'),version,settingsVersion:version,operators:operatorRosterSchema}).strict(),
 z.object({action:z.literal('capacity'),version,settingsVersion:version,staffCount:z.number().int().min(0).max(1000),transportCount:z.number().int().min(0).max(1000),crewCapacity:crewCapacitySchema.optional(),evidence:evidenceSchema}).strict().refine(v=>!v.crewCapacity||v.crewCapacity.operators+v.crewCapacity.workers<=v.staffCount,'역할별 인원 합계는 전체 작업인원 이내여야 합니다.'),
 z.object({action:z.literal('location'),version,settingsVersion:version,location:z.object({longitude:z.number().min(124).max(132),latitude:z.number().min(32).max(39),nx:z.number().int().min(1).max(149).optional(),ny:z.number().int().min(1).max(253).optional(),sourceUrl:z.url().refine(v=>/^https?:\/\//.test(v)),evidence:evidenceSchema}).strict().refine(v=>(v.nx===undefined)===(v.ny===undefined),'예보 격자 X·Y는 함께 입력하세요.').nullable()}).strict(),
 z.object({action:z.literal('climate'),version,settingsVersion:version,climate:z.object({datasetId:z.string().min(1).max(150),datasetVersion:version,evidence:evidenceSchema}).strict().nullable()}).strict(),
]);
type Evidence=z.infer<typeof evidenceSchema>&{reviewer:string;reviewedAt:string};
export type CenterSettings={capacity?:{staffCount:number;transportCount:number;crewCapacity?:import('./operating-capacity').CrewCapacity;evidence:Evidence};location?:{longitude:number;latitude:number;nx?:number;ny?:number;sourceUrl:string;evidence:Evidence}|null;climate?:{datasetId:string;datasetVersion:number;evidence:Evidence}|null};
