/** Verified source facts, not approved regional operating profiles or scheduling thresholds. */
export const cropStageEvidence=[
 {crop:'rice',stage:'POST_HEADING_RIPENING',metric:'40_DAY_MEAN_AIR_C',target:22,sourceUrl:'https://www.rda.go.kr/middlePopOpenPopNongsaroDBView.do?no=1905',checkedOn:'2026-09-20',scope:'RDA_RESEARCH_SUMMARY',schedulingEnabled:false,review:'품종·출수일·지역 적용 검토 필요'},
 {crop:'potato',stage:'SEED_SPROUTING',metric:'SPROUTING_ENVIRONMENT_C',low:15,high:20,daysBeforePlanting:[20,30],sourceUrl:'https://www.rda.go.kr/middlePopOpenPopNongsaroDBView.do?no=1839',checkedOn:'2026-09-20',scope:'SEED_PREPARATION_NOT_OUTDOOR_PLANTING',schedulingEnabled:false,review:'시설 내부 온도이며 관측소 평균기온으로 대체 금지'},
 {crop:'pepper',stage:'TRANSPLANTING',sourceUrl:'https://www.rda.go.kr/board/board.do?dataNo=100000779016&mode=view&prgId=day_farmlcltinfoEntry',checkedOn:'2026-09-20',scope:'SOURCE_RECHECK_REQUIRED',schedulingEnabled:false,review:'원문 재조회 실패. 검색 발췌만으로 수치 활성화하지 않음'},
] as const;
