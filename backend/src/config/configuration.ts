import { normalizeTurkishMobile } from '../common/utils/phone.util';

export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  mongodbUri: process.env.MONGODB_URI,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  corsOrigins: process.env.CORS_ORIGINS ?? '*',
  menuPublicBaseUrl: process.env.MENU_PUBLIC_BASE_URL,
  owner: {
    phoneE164: normalizeTurkishMobile(process.env.OWNER_PHONE_E164 ?? ''),
    password: process.env.OWNER_PASSWORD,
  },
  netgsm: {
    username: process.env.NETGSM_USERNAME ?? '',
    password: process.env.NETGSM_PASSWORD ?? '',
    msgheader: process.env.NETGSM_MSGHEADER ?? '',
    appname: process.env.NETGSM_APPNAME ?? '',
    otpDisabled: process.env.NETGSM_OTP_DISABLED === 'true',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },
});
