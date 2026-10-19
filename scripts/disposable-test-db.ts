// Test-only destinations. Never accept arbitrary hosts, credentials or DB names.
export const localTestDatabaseBase='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/';
export function fourCenterDatabase(value=process.env.KFARM_FOUR_CENTER_DATABASE??'kfarm_centers_e2e'){
 if(!/^kfarm_centers_e2e(?:_[a-z0-9_]{1,30})?$/.test(value))throw Error('Explicit local four-center test database required');
 return value;
}
export const fourCenterDatabaseUrl=(value?:string)=>localTestDatabaseBase+fourCenterDatabase(value);
export function acceptanceDatabaseUrl(value:unknown){
 if(typeof value!=='string')throw Error('Explicit disposable acceptance database required');
 return value==='kfarm_test'?localTestDatabaseBase+value:fourCenterDatabaseUrl(value);
}
