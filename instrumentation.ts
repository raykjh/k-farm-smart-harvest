export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.NEXT_PHASE!=='phase-production-build'&&process.env.NODE_ENV!=='test'&&process.env.KFARM_PRICE_WORKER==='1'){
  const {startPriceIngestionLoop}=await import('./lib/price-ingestion-loop');startPriceIngestionLoop();
 }
 if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.NEXT_PHASE!=='phase-production-build'&&process.env.NODE_ENV!=='test'&&process.env.KFARM_SMS_WORKER==='1'){
  const {startSmsLoop}=await import('./lib/sms-loop');startSmsLoop();
 }
 if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.NEXT_PHASE!=='phase-production-build'&&process.env.NODE_ENV!=='test'&&process.env.KFARM_LABOR_WORKER!=='0'){
  const {startLaborAttendanceLoop}=await import('./lib/labor-attendance-loop');startLaborAttendanceLoop();
 }
 if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.NEXT_PHASE!=='phase-production-build'&&process.env.KFARM_PRODUCTION_WORKER!=='0'){
  const {startProductionLoop}=await import('./lib/production-loop');startProductionLoop();
 }
}
