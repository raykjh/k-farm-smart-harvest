type EnrollmentField={pnu:string;mode:string};

// Read old participation records without rewriting their agreement or history.
// New fields and changes from delegation back to joint participation are forbidden.
export function assertNoNewJointEnrollment(incoming:EnrollmentField[],previous:EnrollmentField[]=[]){
 for(const field of incoming){
  if(field.mode==='joint'&&!previous.some(old=>old.pnu===field.pnu&&old.mode==='joint')){
   throw Error('농지는 위탁으로만 등록합니다. 인력 근무 신청은 별도로 등록하세요.');
  }
 }
}
