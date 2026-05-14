import { isValidTurkishMobileE164, normalizeTurkishMobile } from './phone.util';

describe('phone.util', () => {
  it('normalizes 05… and validates +905…', () => {
    expect(normalizeTurkishMobile('05551112233')).toBe('+905551112233');
    expect(normalizeTurkishMobile('905551112233')).toBe('+905551112233');
    expect(normalizeTurkishMobile('+90 555 111 22 33')).toBe('+905551112233');
    expect(isValidTurkishMobileE164('+905551112233')).toBe(true);
    expect(isValidTurkishMobileE164('+904551112233')).toBe(false);
  });
});
