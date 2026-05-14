import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  MONGODB_URI: Joi.string().required(),
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  CORS_ORIGINS: Joi.string().allow('').default('*'),
  MENU_PUBLIC_BASE_URL: Joi.string().uri().required(),
  OWNER_PHONE_E164: Joi.string()
    .pattern(/^\+905\d{9}$/)
    .required(),
  /** If omitted, owner seed is skipped (useful for tests). Production should set this. */
  OWNER_PASSWORD: Joi.string().min(8).optional(),
  NETGSM_USERCODE: Joi.string().allow('').default(''),
  NETGSM_PASSWORD: Joi.string().allow('').default(''),
  NETGSM_MSGHEADER: Joi.string().allow('').default(''),
  NETGSM_OTP_DISABLED: Joi.boolean().default(false),
  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').default(''),
  CLOUDINARY_API_KEY: Joi.string().allow('').default(''),
  CLOUDINARY_API_SECRET: Joi.string().allow('').default(''),
});
