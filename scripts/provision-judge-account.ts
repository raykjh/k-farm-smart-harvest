import {db} from '../lib/db';
import {provisionJudgeAccount} from '../lib/judge-account-provision';

try{
 if(process.argv[2]!=='--apply'||process.argv.length!==3)throw Error('Explicit --apply is required. Configure the new public trial credentials through the deployment environment, not command arguments.');
 const result=await provisionJudgeAccount();
 console.log(JSON.stringify({status:result.created?'CREATED':'ALREADY_CONFIGURED',centerId:result.user.centerId,businessDataChanged:false,paidCalls:0}));
}catch(error){console.error(error instanceof Error?error.message:'Judge provisioning failed.');process.exitCode=1}
finally{await db.$disconnect()}
