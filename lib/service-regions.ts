/** User-selected pilot scope, not a claim of an operating agreement or secured resources. */
export const serviceRegionSource = 'https://www.jangsu.go.kr/index.jangsu?menuCd=DOM_000000103003003000';
export const serviceRegions = [
  {id:'janggye', township:'장계면', office:'장계농협', legacyCenterId:null},
  {id:'cheoncheon', township:'천천면', office:'장계농협 천천지점', legacyCenterId:null},
  {id:'gyebuk', township:'계북면', office:'장계농협 계북지점', legacyCenterId:'demo'},
  {id:'gyenam', township:'계남면', office:'장계농협 계남지점', legacyCenterId:null},
] as const;
export const serviceRegionScope = {
  version:'jangsu-four-myeon-2026-10-01',
  province:'전북특별자치도', district:'장수군',
  status:'PROPOSED' as const,
  // Consultation and field custody remain local. These are candidates, not approved loans.
  sharingPool:serviceRegions.map(r=>r.id),
  requiresConfirmedLoan:true,
};
