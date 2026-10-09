export const PRODUCT_NAME_MAX_LENGTH = 120;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 500;
export const PRODUCT_OPTION_GROUP_LABEL_MAX_LENGTH = 80;
export const PRODUCT_OPTION_CHOICE_LABEL_MAX_LENGTH = 80;
export const PRODUCT_PRICE_MAX_KURUS = 9999999;
export const PRODUCT_OPTION_EXTRA_PRICE_MAX_KURUS = 999999;

/** @param {number} kurus */
export function formatKurusLimit(kurus) {
  return (kurus / 100).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
