import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OtpChallengeDocument = HydratedDocument<OtpChallenge>;

@Schema({ timestamps: true })
export class OtpChallenge {
  @Prop({ required: true, index: true })
  phoneE164: string;

  @Prop({ required: true })
  codeHash: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ default: 0 })
  attempts: number;
}

export const OtpChallengeSchema = SchemaFactory.createForClass(OtpChallenge);

OtpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
