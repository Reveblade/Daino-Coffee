export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  mongodbUri: process.env.MONGODB_URI,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  corsOrigins: process.env.CORS_ORIGINS ?? '*',
  menuPublicBaseUrl: process.env.MENU_PUBLIC_BASE_URL,
  owner: {
    phoneE164: process.env.OWNER_PHONE_E164,
    password: process.env.OWNER_PASSWORD,
  },
  netgsm: {
    usercode: process.env.NETGSM_USERCODE ?? '',
    password: process.env.NETGSM_PASSWORD ?? '',
    msgheader: process.env.NETGSM_MSGHEADER ?? '',
    otpDisabled: process.env.NETGSM_OTP_DISABLED === 'true',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },
});
