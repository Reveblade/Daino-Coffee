import * as Joi from 'joi';
import {
  isValidTurkishMobileE164,
  normalizeTurkishMobile,
} from '../common/utils/phone.util';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  MONGODB_URI: Joi.string().required(),
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  CORS_ORIGINS: Joi.string().allow('').default('*'),
  MENU_PUBLIC_BASE_URL: Joi.string().uri().required(),
  OWNER_PHONE_E164: Joi.string()
    .required()
    .custom((value, helpers) => {
      const n = normalizeTurkishMobile(String(value));
      if (!isValidTurkishMobileE164(n)) {
        return helpers.error('any.invalid');
      }
      return n;
    }),
  /** If omitted, owner seed is skipped (useful for tests). Production should set this. */
  OWNER_PASSWORD: Joi.string().min(8).optional(),
  NETGSM_USERNAME: Joi.string().allow('').default(''),
  NETGSM_PASSWORD: Joi.string().allow('').default(''),
  NETGSM_MSGHEADER: Joi.string().allow('').default(''),
  NETGSM_APPNAME: Joi.string().allow('').default(''),
  /** String env vars from Cloud Run / shells; read as flag in configuration. */
  NETGSM_OTP_DISABLED: Joi.string().valid('true', 'false', '').default(''),
  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').default(''),
  CLOUDINARY_API_KEY: Joi.string().allow('').default(''),
  CLOUDINARY_API_SECRET: Joi.string().allow('').default(''),
});
