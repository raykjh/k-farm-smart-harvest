// Cached prototype clients must not bypass ordinary registration, work windows,
// common reservations or recorded outcomes. Historical records stay readable.
export const legacyDemoActions=new Set(['register','choose','plan','wind','replan','approve','lock']);
export const retiredDemoWorkflow={
 code:'LEGACY_DEMO_WORKFLOW_RETIRED',
 error:'별도 시연용 등록·고정 일정 생성은 종료되었습니다. 농지 등록과 공통 계획·일정변경·작업기록을 이용하세요. 기존 자료는 변경하지 않았습니다.',
 registrationUrl:'/register',
} as const;
