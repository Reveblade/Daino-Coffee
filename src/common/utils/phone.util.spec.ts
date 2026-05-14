import { isValidTurkishMobileE164, normalizeTurkishMobile } from './phone.util';

describe('phone.util', () => {
  it('normalizes plain 5…, 05…, 90…, +90… and separators', () => {
    expect(normalizeTurkishMobile('5551112233')).toBe('+905551112233');
    expect(normalizeTurkishMobile('05551112233')).toBe('+905551112233');
    expect(normalizeTurkishMobile('905551112233')).toBe('+905551112233');
    expect(normalizeTurkishMobile('+905551112233')).toBe('+905551112233');
    expect(normalizeTurkishMobile('+90 555 111 22 33')).toBe('+905551112233');
    expect(normalizeTurkishMobile('0 555 111 22 33')).toBe('+905551112233');
    expect(normalizeTurkishMobile('0555-111-22-33')).toBe('+905551112233');
    expect(normalizeTurkishMobile('(555) 111 22 33')).toBe('+905551112233');
    expect(normalizeTurkishMobile('00905551112233')).toBe('+905551112233');
    expect(isValidTurkishMobileE164('+905551112233')).toBe(true);
    expect(isValidTurkishMobileE164('+904551112233')).toBe(false);
    expect(normalizeTurkishMobile('553')).toBe('');
    expect(normalizeTurkishMobile('9055511122334')).toBe('');
  });
});
