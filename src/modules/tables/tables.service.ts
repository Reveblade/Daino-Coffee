import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  Table,
  TableDocument,
  generateTableSlug,
} from './schemas/table.schema';
import { UploadsService } from '../uploads/uploads.service';
import * as QRCode from 'qrcode';

@Injectable()
export class TablesService {
  private readonly logger = new Logger(TablesService.name);

  constructor(
    @InjectModel(Table.name) private readonly tableModel: Model<TableDocument>,
    private readonly config: ConfigService,
    private readonly uploads: UploadsService,
  ) {}

  private baseUrl(): string {
    return this.config
      .getOrThrow<string>('menuPublicBaseUrl')
      .replace(/\/$/, '');
  }

  private menuUrlForSlug(publicSlug: string): string {
    return `${this.baseUrl()}/t/${publicSlug}`;
  }

  /**
   * Recompute stored menu URLs when MENU_PUBLIC_BASE_URL changes (e.g. dev host or production domain).
   */
  async syncMenuUrlsToPublicBase(): Promise<void> {
    const tables = await this.tableModel.find().exec();
    let updated = 0;
    for (const t of tables) {
      const nextUrl = this.menuUrlForSlug(t.publicSlug);
      if (t.menuUrl === nextUrl) continue;
      t.menuUrl = nextUrl;
      if (this.uploads.isConfigured()) {
        try {
          await this.refreshQrImage(t);
        } catch {
          /* optional asset */
        }
      }
      await t.save();
      updated += 1;
    }
    if (updated > 0) {
      this.logger.log(
        `Synced ${updated} table menu URL(s) to MENU_PUBLIC_BASE_URL`,
      );
    }
  }

  async ensureStorefrontTable(): Promise<TableDocument> {
    let t = await this.tableModel.findOne({ number: 0 }).exec();
    if (!t) {
      const slug = generateTableSlug();
      const menuUrl = this.menuUrlForSlug(slug);
      t = await this.tableModel.create({
        number: 0,
        label: 'Storefront',
        publicSlug: slug,
        menuUrl,
        isActive: true,
        isSystem: true,
      });
    }
    if (this.uploads.isConfigured() && !t.qrImageUrl) {
      try {
        await this.refreshQrImage(t);
        await t.save();
      } catch {
        /* optional asset */
      }
    }
    return t;
  }

  async findBySlug(slug: string): Promise<TableDocument | null> {
    return this.tableModel.findOne({ publicSlug: slug, isActive: true }).exec();
  }

  async listAll(): Promise<TableDocument[]> {
    return this.tableModel.find().sort({ number: 1 }).exec();
  }

  async createTable(number: number, label?: string): Promise<TableDocument> {
    if (number === 0) {
      throw new BadRequestException('Use seeded storefront table');
    }
    const exists = await this.tableModel.findOne({ number }).exec();
    if (exists) {
      throw new ConflictException('Table number already exists');
    }
    const slug = generateTableSlug();
    const menuUrl = this.menuUrlForSlug(slug);
    const table = await this.tableModel.create({
      number,
      label,
      publicSlug: slug,
      menuUrl,
      isActive: true,
      isSystem: false,
    });
    await this.refreshQrImage(table);
    return table.save();
  }

  async deleteTable(id: string): Promise<void> {
    const t = await this.tableModel.findById(id).exec();
    if (!t) {
      throw new NotFoundException();
    }
    if (t.isSystem || t.number === 0) {
      throw new ConflictException('Cannot remove system table');
    }
    await this.tableModel.deleteOne({ _id: t._id }).exec();
  }

  async refreshQrImage(table: TableDocument): Promise<void> {
    const png = await QRCode.toBuffer(table.menuUrl, {
      type: 'png',
      width: 512,
    });
    const uploaded = await this.uploads.uploadBuffer(
      png,
      `qr/table-${table.number}-${table.publicSlug}.png`,
    );
    if (uploaded?.secure_url) {
      table.qrImageUrl = uploaded.secure_url;
    }
  }

  async regenerateQr(id: string): Promise<TableDocument> {
    const t = await this.tableModel.findById(id).exec();
    if (!t) {
      throw new NotFoundException();
    }
    const slug = generateTableSlug();
    t.publicSlug = slug;
    t.menuUrl = this.menuUrlForSlug(slug);
    await this.refreshQrImage(t);
    await t.save();
    return t;
  }
}
