import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fs from 'node:fs';
import { AllConfigType } from '../../config/config.type';
import { TokenUsage } from '../domain/token-usage';
import {
  calculateCostUsd,
  ModelPriceTable,
  parseModelPriceTable,
} from './model-pricing';

/** Loads the editable price table (config/model-prices.json) at startup. */
@Injectable()
export class ModelPricingService implements OnModuleInit {
  private readonly logger = new Logger(ModelPricingService.name);
  private table: ModelPriceTable = { lastUpdated: '', models: {} };

  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  onModuleInit(): void {
    const file = this.configService.getOrThrow('proxy.modelPricesPath', {
      infer: true,
    });
    this.table = parseModelPriceTable(
      JSON.parse(fs.readFileSync(file, 'utf8')) as unknown,
    );
    this.logger.log(
      `Loaded prices for ${Object.keys(this.table.models).length} models (last updated ${this.table.lastUpdated})`,
    );
  }

  costUsd(model: string, usage: TokenUsage): number | null {
    return calculateCostUsd(this.table, model, usage);
  }
}
