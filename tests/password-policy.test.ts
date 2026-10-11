import {it,expect} from 'vitest';
import {passwordError,newPasswordSchema} from '../lib/password-policy';
it('accepts 12 ASCII characters without requiring every character category',()=>{
 for(const value of ['Cedar!River27','orchardseason','582936174025','[]{}!@#$%^&*','MiXeDletters'])expect(newPasswordSchema.safeParse(value).success,value).toBe(true);
 expect(newPasswordSchema.safeParse('a'.repeat(129)).success).toBe(false);
 expect(passwordError('CedarRiver1')).toContain('12');
});
it('rejects whitespace, Korean, invisible and non-ASCII characters without conversion',()=>{
 for(const value of ['Cedar River27','Cedar\tRiver27','CedarRiver27\n','Cedar\u00a0River27'])expect(passwordError(value)).toContain('공백');
 for(const value of ['농사비밀번호123456','ㅁㄴㅇㄹ1234567890','CedarRiver27😀','Cedar\u200bRiver27'])expect(passwordError(value)).toContain('영문 입력');
});
it('blocks a basic common-password list and simple repetition',()=>{
 for(const value of ['Password123!','qwertyuiop12','Admin12345678!','abababababab','111112222200000','123456789012'])expect(passwordError(value),value).not.toBeNull();
});
