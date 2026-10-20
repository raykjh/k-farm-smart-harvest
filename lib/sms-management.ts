import type {SmsMessageView} from './sms-policy';
export const messageStatuses=['QUEUED','FAILED','SENT','ATTENDING','DECLINED','NO_RESPONSE'] as const;
export type MessageStatus=typeof messageStatuses[number];
export type ManagedSms=SmsMessageView&{workDate:string;sendDate:string;managementStatus:MessageStatus;laborVersion:number;editable:boolean};
export const messageDay=(value:string)=>new Date(Date.parse(value)+9*3600000).toISOString().slice(0,10);
