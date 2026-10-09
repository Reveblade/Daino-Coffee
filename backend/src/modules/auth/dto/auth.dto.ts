import {
  IsJWT,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

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

  /** İsim/soyisim; yeni müşteri kaydında boş olabilir, sonra Profilim’den tamamlanır. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  lastName?: string;
}

export class OwnerLoginDto {
  @IsString()
  phone: string;

  @IsString()
  @Length(8, 128)
  password: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsJWT()
  refreshToken: string;
}
