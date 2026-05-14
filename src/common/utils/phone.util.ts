const TR_E164_REGEX = /^\+905\d{9}$/;

export function normalizeTurkishMobile(input: string): string {
  let s = input.trim().replace(/\s+/g, '');
  if (s.startsWith('00')) {
    s = '+' + s.slice(2);
  }
  if (!s.startsWith('+')) {
    if (s.startsWith('0')) {
      s = s.slice(1);
    }
    if (s.startsWith('90')) {
      s = '+' + s;
    } else if (s.startsWith('5')) {
      s = '+90' + s;
    }
  }
  return s;
}

export function isValidTurkishMobileE164(phone: string): boolean {
  return TR_E164_REGEX.test(phone);
}

export function toNetgsmNo(phoneE164: string): string {
  // Netgsm expects 90XXXXXXXXXX without +
  if (!phoneE164.startsWith('+90')) {
    throw new Error('Invalid E.164 for Netgsm');
  }
  return phoneE164.slice(1);
}
