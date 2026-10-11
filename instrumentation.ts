export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.NEXT_PHASE!=='phase-production-build'&&process.env.KFARM_PRODUCTION_WORKER!=='0'){
  const {startProductionLoop}=await import('./lib/production-loop');startProductionLoop();
 }
}
