import { IsString, Length, Matches } from 'class-validator';

export class OtpRequestDto {
  @IsString()
  phone: string;
}

export class OtpVerifyDto {
  @IsString()
  phone: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code: string;
}

export class OwnerLoginDto {
  @IsString()
  phone: string;

  @IsString()
  @Length(8, 128)
  password: string;
}
