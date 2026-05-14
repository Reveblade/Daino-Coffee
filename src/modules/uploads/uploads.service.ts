import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

export interface CloudinaryUploadResult {
  secure_url: string;
  public_id: string;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private configured = false;

  constructor(private readonly config: ConfigService) {
    const cloudName = this.config.get<string>('cloudinary.cloudName');
    const apiKey = this.config.get<string>('cloudinary.apiKey');
    const apiSecret = this.config.get<string>('cloudinary.apiSecret');
    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
      this.configured = true;
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async uploadBuffer(
    buffer: Buffer,
    filename: string,
  ): Promise<CloudinaryUploadResult | null> {
    if (!this.configured) {
      this.logger.warn('Cloudinary not configured; skipping upload');
      return null;
    }
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'dainocoffee',
          public_id: filename.replace(/\.[^/.]+$/, ''),
          resource_type: 'image',
        },
        (err, result) => {
          if (err || !result) {
            reject(err);
          } else {
            resolve({
              secure_url: result.secure_url,
              public_id: result.public_id,
            });
          }
        },
      );
      uploadStream.end(buffer);
    });
  }

  async uploadDataUri(dataUri: string): Promise<CloudinaryUploadResult | null> {
    if (!this.configured) {
      return null;
    }
    const res = await cloudinary.uploader.upload(dataUri, {
      folder: 'dainocoffee',
    });
    return { secure_url: res.secure_url, public_id: res.public_id };
  }

  async deleteByPublicId(publicId: string): Promise<void> {
    if (!this.configured || !publicId) {
      return;
    }
    await cloudinary.uploader.destroy(publicId);
  }
}
