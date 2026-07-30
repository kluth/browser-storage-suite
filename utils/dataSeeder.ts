import { faker } from '@faker-js/faker';

export type SeedTemplate = 'user_profiles' | 'cart_items' | 'auth_tokens' | 'app_settings';

export interface SeededRecord {
  key: string;
  value: string;
  type: string;
  sizeBytes: number;
}

export function generateSelectiveSeedData(template: SeedTemplate, count: number): SeededRecord[] {
  const records: SeededRecord[] = [];

  for (let i = 1; i <= count; i++) {
    if (template === 'user_profiles') {
      const user = {
        id: faker.string.uuid(),
        fullName: faker.person.fullName(),
        email: faker.internet.email(),
        role: i === 1 ? 'admin' : 'member',
        createdAt: faker.date.past().toISOString(),
      };
      const key = `user_record_${i}`;
      const value = JSON.stringify(user);
      records.push({ key, value, type: 'JSON', sizeBytes: new Blob([key + value]).size });
    } else if (template === 'cart_items') {
      const item = {
        productId: faker.string.alphanumeric(8),
        productName: faker.commerce.productName(),
        price: parseFloat(faker.commerce.price()),
        quantity: faker.number.int({ min: 1, max: 5 }),
      };
      const key = `cart_item_${i}`;
      const value = JSON.stringify(item);
      records.push({ key, value, type: 'JSON', sizeBytes: new Blob([key + value]).size });
    } else if (template === 'auth_tokens') {
      const token = `bearer_${faker.string.alphanumeric(48)}`;
      const key = `auth_token_${i}`;
      records.push({ key, value: token, type: 'String', sizeBytes: new Blob([key + token]).size });
    } else {
      const key = `setting_${faker.word.sample()}_${i}`;
      const value = faker.datatype.boolean() ? 'true' : 'false';
      records.push({ key, value, type: 'Boolean', sizeBytes: new Blob([key + value]).size });
    }
  }

  return records;
}
