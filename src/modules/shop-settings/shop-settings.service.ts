import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ShopSettings,
  ShopSettingsDocument,
} from './schemas/shop-settings.schema';

@Injectable()
export class ShopSettingsService {
  constructor(
    @InjectModel(ShopSettings.name)
    private readonly model: Model<ShopSettingsDocument>,
  ) {}

  async getSingleton(): Promise<ShopSettingsDocument> {
    let doc = await this.model.findOne().exec();
    if (!doc) {
      doc = await this.model.create({ serviceEnabled: false });
    }
    return doc;
  }

  async setServiceEnabled(enabled: boolean): Promise<ShopSettingsDocument> {
    const doc = await this.getSingleton();
    doc.serviceEnabled = enabled;
    await doc.save();
    return doc;
  }

  async acceptsTableOrders(): Promise<boolean> {
    const doc = await this.getSingleton();
    return doc.serviceEnabled;
  }
}
