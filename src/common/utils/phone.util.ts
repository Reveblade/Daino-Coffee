const TR_E164_REGEX = /^\+905\d{9}$/;

/**
 * Turkish GSM → E.164 `+905xxxxxxxx`.
 * Accepts: `+90 555 …`, `0090…`, `90…`, `05…`, `5…` (10 digits), and spaced / dashed / dotted input.
 */
export function normalizeTurkishMobile(input: string): string {
  if (input == null || typeof input !== 'string') {
    return '';
  }
  const digits = input.replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  let d = digits;
  while (d.startsWith('00')) {
    d = d.slice(2);
  }
  if (d.startsWith('90')) {
    d = d.slice(2);
  } else if (d.startsWith('0')) {
    d = d.slice(1);
  }

  if (d.length === 10 && d.startsWith('5')) {
    return `+90${d}`;
  }

  return '';
}

export function isValidTurkishMobileE164(phone: string): boolean {
  return TR_E164_REGEX.test(phone);
}
