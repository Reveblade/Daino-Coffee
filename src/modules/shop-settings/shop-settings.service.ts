import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ShopSettings,
  ShopSettingsDocument,
} from './schemas/shop-settings.schema';
import { StoreRealtimeGateway } from '../store-realtime/store-realtime.gateway';

@Injectable()
export class ShopSettingsService {
  constructor(
    @InjectModel(ShopSettings.name)
    private readonly model: Model<ShopSettingsDocument>,
    private readonly storeRealtime: StoreRealtimeGateway,
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
    this.storeRealtime.notifyShopChanged();
    return doc;
  }

  async acceptsTableOrders(): Promise<boolean> {
    const doc = await this.getSingleton();
    return doc.serviceEnabled;
  }
}
