import { describe, it, expect } from 'vitest';
import { translateSqlToIDBCursor } from '../../../utils/sqlToIdb';
import { generateSelectiveSeedData, SeedTemplate } from '../../../utils/dataSeeder';
import { predictPagePresets, PageMetadata } from '../../../utils/presetPredictor';
import { getDefaultStoragePresets } from '../../../utils/presetManager';

describe('Tier 2 Boundary & Corner Cases: Query Engine, Data Seeder & Preset Predictor', () => {
  // Feature 7: SQL-to-IDBCursor Translator
  describe('Feature 7: SQL-to-IDBCursor Translator', () => {
    it('TC-F7-B1: returns FULL_TABLE_SCAN plan for empty or whitespace-only SQL queries', () => {
      const planEmpty = translateSqlToIDBCursor('');
      expect(planEmpty.scanStrategy).toBe('FULL_TABLE_SCAN');
      expect(planEmpty.estimatedCostMs).toBe(12.8);
      expect(planEmpty.filterKeyPattern).toBeUndefined();

      const planWhitespace = translateSqlToIDBCursor('   \n  \t ');
      expect(planWhitespace.scanStrategy).toBe('FULL_TABLE_SCAN');
      expect(planWhitespace.estimatedCostMs).toBe(12.8);
    });

    it('TC-F7-B2: extracts filterKeyPattern and sets INDEX_SCAN for WHERE KEY LIKE queries', () => {
      const query = "SELECT * FROM storage WHERE key LIKE '%session_token%'";
      const plan = translateSqlToIDBCursor(query);

      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.estimatedCostMs).toBe(0.42);
      expect(plan.filterKeyPattern).toBe('%session_token%');
      expect(plan.parsedFields).toEqual(['id', 'key', 'value', 'type']);
    });

    it('TC-F7-B3: normalizes mixed-case SQL keywords correctly', () => {
      const query = "sElEcT * fRoM storage wHeRe Key LikE 'user_%'";
      const plan = translateSqlToIDBCursor(query);

      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.filterKeyPattern).toBe('user_%');
    });

    it('TC-F7-B4: defaults to FULL_TABLE_SCAN for queries without WHERE clause', () => {
      const query = 'SELECT COUNT(*) FROM storage';
      const plan = translateSqlToIDBCursor(query);

      expect(plan.scanStrategy).toBe('FULL_TABLE_SCAN');
      expect(plan.estimatedCostMs).toBe(12.8);
      expect(plan.filterKeyPattern).toBeUndefined();
    });

    it('TC-F7-B5: handles extremely long SQL query string without regex failure or crashing', () => {
      const longCondition = "key = '" + 'x'.repeat(5000) + "'";
      const query = `SELECT * FROM storage WHERE ${longCondition}`;
      const plan = translateSqlToIDBCursor(query);

      expect(plan.scanStrategy).toBe('INDEX_SCAN');
      expect(plan.originalQuery).toBe(query);
    });
  });

  // Feature 8: Selective Storage Data Seeder
  describe('Feature 8: Selective Storage Data Seeder', () => {
    it('TC-F8-B1: returns empty array when count is 0', () => {
      const records = generateSelectiveSeedData('user_profiles', 0);
      expect(records).toEqual([]);
    });

    it('TC-F8-B2: returns empty array when count is negative', () => {
      const records = generateSelectiveSeedData('cart_items', -10);
      expect(records).toEqual([]);
    });

    it('TC-F8-B3: falls back to boolean settings template for unknown template names', () => {
      const records = generateSelectiveSeedData('unknown_template' as SeedTemplate, 3);
      expect(records).toHaveLength(3);
      records.forEach((rec) => {
        expect(rec.type).toBe('Boolean');
        expect(['true', 'false']).toContain(rec.value);
        expect(rec.sizeBytes).toBeGreaterThan(0);
      });
    });

    it('TC-F8-B4: generates large batch of records (500) with accurate sizeBytes calculation', () => {
      const records = generateSelectiveSeedData('auth_tokens', 500);
      expect(records).toHaveLength(500);
      expect(records[0].key).toBe('auth_token_1');
      expect(records[499].key).toBe('auth_token_500');

      records.forEach((rec) => {
        const expectedSize = new Blob([rec.key + rec.value]).size;
        expect(rec.sizeBytes).toBe(expectedSize);
      });
    });

    it('TC-F8-B5: verifies JSON payload validity for user_profiles and cart_items templates', () => {
      const userRecords = generateSelectiveSeedData('user_profiles', 5);
      userRecords.forEach((rec) => {
        expect(rec.type).toBe('JSON');
        const parsed = JSON.parse(rec.value);
        expect(parsed.id).toBeDefined();
        expect(parsed.email).toBeDefined();
      });

      const cartRecords = generateSelectiveSeedData('cart_items', 5);
      cartRecords.forEach((rec) => {
        expect(rec.type).toBe('JSON');
        const parsed = JSON.parse(rec.value);
        expect(parsed.productId).toBeDefined();
        expect(parsed.price).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // Feature 9: Smart Preset Predictor
  describe('Feature 9: Smart Preset Predictor', () => {
    it('TC-F9-B1: returns default SaaS presets for empty metadata', () => {
      const emptyMeta: PageMetadata = {
        url: '',
        title: '',
        hasPasswordField: false,
        hasFormCart: false,
        metaTags: [],
      };

      const res = predictPagePresets(emptyMeta);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const predictions = res.value;
      expect(predictions).toHaveLength(2);
      expect(predictions[0].category).toBe('saas');
      expect(predictions[0].id).toMatch(/^pred_saas_darkmode_/);
      expect(predictions[1].id).toMatch(/^pred_saas_features_/);
    });

    it('TC-F9-B2: identifies e-commerce presets for store and checkout URLs', () => {
      const ecomMeta: PageMetadata = {
        url: 'https://shop.mydomain.de/checkout',
        title: 'Online Store Checkout',
        hasPasswordField: false,
        hasFormCart: true,
        metaTags: ['ecommerce'],
      };

      const res = predictPagePresets(ecomMeta);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const predictions = res.value;
      expect(predictions).toHaveLength(2);
      expect(predictions[0].category).toBe('ecommerce');
      expect(predictions[0].id).toMatch(/^pred_cart_/);

      const cartJson = JSON.parse(predictions[0].entries.cart_items);
      expect(cartJson).toHaveLength(2);
    });

    it('TC-F9-B3: identifies auth presets and checks token expiry logic', () => {
      const authMeta: PageMetadata = {
        url: 'https://app.company.org/login',
        title: 'Sign In to Account',
        hasPasswordField: true,
        hasFormCart: false,
        metaTags: [],
      };

      const res = predictPagePresets(authMeta);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const predictions = res.value;
      expect(predictions).toHaveLength(2);
      expect(predictions[0].category).toBe('auth');
      expect(predictions[0].id).toMatch(/^pred_auth_admin_/);
      expect(predictions[1].id).toMatch(/^pred_auth_expired_/);

      const now = Date.now();
      const adminExpiry = Number(predictions[0].entries.session_expiry);
      const expiredExpiry = Number(predictions[1].entries.session_expiry);

      expect(adminExpiry).toBeGreaterThan(now);
      expect(expiredExpiry).toBeLessThan(now);
    });

    it('TC-F9-B4: handles complex URLs with query params and hash fragments', () => {
      const complexMeta: PageMetadata = {
        url: 'https://example.com/products/view?cart=active&item=10#shop',
        title: 'Product View',
        hasPasswordField: false,
        hasFormCart: false,
        metaTags: [],
      };

      const res = predictPagePresets(complexMeta);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value[0].category).toBe('ecommerce');
    });

    it('TC-F9-B5: verifies default storage presets in presetManager', () => {
      const res = getDefaultStoragePresets();
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const defaultPresets = res.value;
      expect(defaultPresets).toHaveLength(3);

      const corruptedPreset = defaultPresets.find((p) => p.entries.user_config_json);
      expect(corruptedPreset).toBeDefined();
    });
  });
});
