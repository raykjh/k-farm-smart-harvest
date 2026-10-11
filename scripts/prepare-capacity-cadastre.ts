import {fetchFourCenterCadastre,cadastralStudy,cadastreFingerprint} from '../lib/four-center-cadastre';
import {distributeScenarioCrops,referenceCropWeights} from '../lib/capacity-study-input';
import {summarizeCapacity} from '../lib/capacity-workload';
// stdout is a public-geography / fictitious-owner input artifact, never a DB seed.
// The caller saves a successful complete response; partial acquisition is rejected.
try{
 process.loadEnvFile('.env.local');
 const snapshot=await fetchFourCenterCadastre(),input=distributeScenarioCrops(cadastralStudy(snapshot,2026),referenceCropWeights,'reference-weighted-v1');
 const analysis=summarizeCapacity(input);
 console.log(JSON.stringify({snapshot,snapshotHash:cadastreFingerprint(snapshot),input,resources:analysis.baseline,summary:{owners:analysis.participation.populationCount,selected:analysis.participation.selectedCount,selectedParcels:analysis.participation.parcels.length,tasks:analysis.tasks.length,blockers:analysis.blockers,byCenter:analysis.participation.byCenter}}));
}catch{console.error('4센터 실제 지적도 입력 준비 실패. 인증키·요청 URL·응답 본문을 로그에 노출하지 않았습니다.');process.exitCode=1;}
