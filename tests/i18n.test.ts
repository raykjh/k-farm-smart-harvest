import {it,expect} from 'vitest';
import {translate} from '../lib/i18n';
it('translates labels, dates, revision counts and saved demo alerts without changing source data',()=>{
 expect(translate('쌀')).toBe('Rice');expect(translate('6월 16일 14:00')).toBe('Jun 16, 14:00');
 expect(translate('25건 변경계획 일괄 승인')).toBe('Approve all 25 changes');
 const source='[모의 알림] 농지 A 공동 방제가 강풍으로 6월 16일 14:00로 변경되었습니다. 센터가 장비·인력을 배정합니다. 직접 장비에 접근하지 마세요. 문의는 지원센터로 연락해 주세요.';
 expect(translate(source)).toContain('Do not approach the equipment');expect(source).toContain('농지 A');
 expect(translate('P1')).toBe('P1');expect(translate('사용자가 작성한 고유 지명')).toBe('사용자가 작성한 고유 지명');
});
