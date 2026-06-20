import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadsService } from './uploads.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';

const MAX_BYTES = 12 * 1024 * 1024;

@Controller('admin/uploads')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN_OWNER, UserRole.ADMIN)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BYTES },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file required');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('image only');
    }
    const res = await this.uploads.uploadOptimizedImage(
      file.buffer,
      file.originalname ?? 'image',
    );
    if (!res) {
      throw new BadRequestException('Cloudinary not configured');
    }
    return {
      url: res.secure_url,
      publicId: res.public_id,
    };
  }
}
