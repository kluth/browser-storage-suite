import { describe, it, expect } from 'vitest';
import { generateSelectiveSeedData } from '../../../utils/dataSeeder';

describe('Feature 08: Selective Storage Data Seeder', () => {
  it('8.1 should generate user_profiles seed data with UUID, email, and admin/member role', () => {
    const records = generateSelectiveSeedData('user_profiles', 5);

    expect(records).toHaveLength(5);
    expect(records[0].key).toBe('user_record_1');
    expect(records[0].type).toBe('JSON');

    const parsed = JSON.parse(records[0].value);
    expect(parsed).toHaveProperty('id');
    expect(parsed).toHaveProperty('fullName');
    expect(parsed).toHaveProperty('email');
    expect(parsed.role).toBe('admin');

    const parsedSecond = JSON.parse(records[1].value);
    expect(parsedSecond.role).toBe('member');
  });

  it('8.2 should generate cart_items seed data with product fields and JSON format', () => {
    const records = generateSelectiveSeedData('cart_items', 3);

    expect(records).toHaveLength(3);
    expect(records[0].key).toBe('cart_item_1');
    expect(records[0].type).toBe('JSON');

    const parsed = JSON.parse(records[0].value);
    expect(parsed).toHaveProperty('productId');
    expect(parsed).toHaveProperty('productName');
    expect(parsed).toHaveProperty('price');
    expect(parsed).toHaveProperty('quantity');
    expect(typeof parsed.price).toBe('number');
    expect(typeof parsed.quantity).toBe('number');
  });

  it('8.3 should generate auth_tokens seed data with bearer prefix and string type', () => {
    const records = generateSelectiveSeedData('auth_tokens', 4);

    expect(records).toHaveLength(4);
    expect(records[0].key).toBe('auth_token_1');
    expect(records[0].type).toBe('String');
    expect(records[0].value).toMatch(/^bearer_[a-zA-Z0-9]{48}$/);
  });

  it('8.4 should generate app_settings seed data with boolean values and Boolean type', () => {
    const records = generateSelectiveSeedData('app_settings', 6);

    expect(records).toHaveLength(6);
    records.forEach((rec) => {
      expect(rec.type).toBe('Boolean');
      expect(['true', 'false']).toContain(rec.value);
      expect(rec.key).toMatch(/^setting_/);
    });
  });

  it('8.5 should calculate sizeBytes for each seeded record accurately matching Blob size', () => {
    const records = generateSelectiveSeedData('user_profiles', 2);

    records.forEach((rec) => {
      const expectedSize = new Blob([rec.key + rec.value]).size;
      expect(rec.sizeBytes).toBe(expectedSize);
      expect(rec.sizeBytes).toBeGreaterThan(0);
    });
  });

  it('8.6 should generate requested count of records accurately even for large numbers', () => {
    const records = generateSelectiveSeedData('auth_tokens', 150);

    expect(records).toHaveLength(150);
    expect(records[149].key).toBe('auth_token_150');
  });
});
