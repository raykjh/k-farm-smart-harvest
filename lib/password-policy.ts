import {z} from 'zod';
export const PASSWORD_HELP='12~128자 · 영문 대소문자·숫자·특수문자 사용 가능 · 공백·한글 불가. 네 종류를 모두 넣을 필요는 없습니다.';
export function passwordError(value:string):string|null{
 if(/\s/.test(value))return '비밀번호에는 공백을 사용할 수 없습니다.';
 if(/[^\x21-\x7e]/.test(value))return '영문 입력으로 전환해주세요. 영문·숫자·특수문자만 사용할 수 있습니다.';
 if(value.length<12||value.length>128)return '비밀번호는 12~128자로 입력해주세요.';
 const lower=value.toLowerCase(),plain=lower.replace(/[^a-z0-9]/g,'');
 if(new Set(lower).size<=3||/^(.{1,6})\1+$/.test(lower))return '단순 반복 대신 추측하기 어려운 비밀번호를 사용해주세요.';
 if(/^(password|qwerty|qwertyuiop|asdfgh|asdfghjkl|letmein|welcome|admin|administrator|iloveyou|1234567890|0987654321)[0-9]*$/.test(plain)||/^(0123456789|123456789|9876543210)+[0-9]*$/.test(plain))return '흔한 비밀번호나 연속된 키 배열은 사용할 수 없습니다.';
 return null;
}
// Only new credentials use this policy. Login verifies old hashes without transforming input.
export const newPasswordSchema=z.string().superRefine((value,ctx)=>{const message=passwordError(value);if(message)ctx.addIssue({code:'custom',message})});
