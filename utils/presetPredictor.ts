import { StorageKey, StorageValue, StorageTarget } from '../src/domain/model/valueObjects';
import { Result } from './result';

export interface PageMetadata {
  url: string;
  title: string;
  hasPasswordField: boolean;
  hasFormCart: boolean;
  metaTags: string[];
}

export interface PredictedPreset {
  id: string;
  category: 'ecommerce' | 'auth' | 'saas' | 'media';
  name: string;
  description: string;
  entries: Record<string, string>;
  confidenceScore: number;
  target: StorageTarget;
}

function hashDomain(url: string): string {
  if (!url) return 'default';
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/[^a-zA-Z0-9]/g, '_');
  } catch {
    return url.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 16) || 'default';
  }
}

function validateEntries(rawEntries: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawEntries)) {
    const keyRes = StorageKey.create(k);
    const valRes = StorageValue.create(v);
    if (keyRes.ok && valRes.ok) {
      result[keyRes.value.value] = valRes.value.value;
    }
  }
  return result;
}

function isEcommerceContext(meta: PageMetadata): boolean {
  const urlLower = (meta.url || '').toLowerCase();
  const titleLower = (meta.title || '').toLowerCase();
  const metaStr = (meta.metaTags || []).join(' ').toLowerCase();

  return (
    meta.hasFormCart ||
    urlLower.includes('cart') ||
    urlLower.includes('shop') ||
    urlLower.includes('checkout') ||
    urlLower.includes('store') ||
    titleLower.includes('shop') ||
    titleLower.includes('store') ||
    metaStr.includes('e-commerce') ||
    metaStr.includes('shop')
  );
}

function isAuthContext(meta: PageMetadata): boolean {
  const urlLower = (meta.url || '').toLowerCase();
  const titleLower = (meta.title || '').toLowerCase();
  const metaStr = (meta.metaTags || []).join(' ').toLowerCase();

  return (
    meta.hasPasswordField ||
    urlLower.includes('login') ||
    urlLower.includes('auth') ||
    urlLower.includes('dashboard') ||
    urlLower.includes('account') ||
    titleLower.includes('login') ||
    titleLower.includes('auth') ||
    metaStr.includes('auth')
  );
}

function buildEcommercePredictions(domainTag: string, nonce: string): PredictedPreset[] {
  const items = [
    { id: `item_${nonce}_1`, name: `Dynamic Product A (${domainTag})`, price: 49.99, qty: 1 },
    { id: `item_${nonce}_2`, name: `Dynamic Product B (${domainTag})`, price: 99.00, qty: 2 },
  ];

  return [
    {
      id: `pred_cart_${domainTag}_${nonce}`,
      category: 'ecommerce',
      name: `🛒 Dynamic Shopping Cart (${domainTag})`,
      description: 'Dynamically predicted cart cache populated with domain-contextualized line items.',
      confidenceScore: 0.95,
      target: 'localStorage',
      entries: validateEntries({
        cart_id: `cart_${domainTag}_${nonce}`,
        cart_items_count: '3',
        cart_items: JSON.stringify(items),
        selected_currency: 'EUR',
      }),
    },
    {
      id: `pred_checkout_${domainTag}_${nonce}`,
      category: 'ecommerce',
      name: '💳 Dynamic Checkout Session',
      description: 'Pre-configures payment method and shipping session parameters.',
      confidenceScore: 0.88,
      target: 'localStorage',
      entries: validateEntries({
        checkout_step: 'payment_method',
        shipping_country: 'DE',
        express_checkout_enabled: 'true',
      }),
    },
  ];
}

function buildAuthPredictions(domainTag: string, nonce: string): PredictedPreset[] {
  return [
    {
      id: `pred_auth_admin_${domainTag}_${nonce}`,
      category: 'auth',
      name: `🔑 Dynamic Admin Token (${domainTag})`,
      description: 'Dynamically synthesizes active admin JWT token and session claims.',
      confidenceScore: 0.92,
      target: 'localStorage',
      entries: validateEntries({
        access_token: `bearer_admin_jwt_${domainTag}_${nonce}`,
        user_role: 'super_admin',
        session_expiry: String(Date.now() + 86400000),
      }),
    },
    {
      id: `pred_auth_expired_${domainTag}_${nonce}`,
      category: 'auth',
      name: '⌛ Dynamic Expired Token (401 Testing)',
      description: 'Dynamically synthesizes expired session token for refresh handler validation.',
      confidenceScore: 0.85,
      target: 'localStorage',
      entries: validateEntries({
        access_token: `bearer_expired_${domainTag}_${nonce}`,
        session_expiry: String(Date.now() - 10000),
      }),
    },
  ];
}

function buildSaasPredictions(domainTag: string, nonce: string): PredictedPreset[] {
  return [
    {
      id: `pred_saas_darkmode_${domainTag}_${nonce}`,
      category: 'saas',
      name: '⚙️ Dynamic UI Preference State',
      description: 'Dynamically sets dark mode theme and UI density defaults.',
      confidenceScore: 0.75,
      target: 'localStorage',
      entries: validateEntries({
        theme_preference: 'dark',
        ui_density: 'compact',
        locale: 'de-DE',
      }),
    },
    {
      id: `pred_saas_features_${domainTag}_${nonce}`,
      category: 'saas',
      name: '⚡ Dynamic Beta Feature Flags',
      description: 'Dynamically activates feature toggle experiment flags.',
      confidenceScore: 0.70,
      target: 'localStorage',
      entries: validateEntries({
        feature_flag_new_dashboard: 'true',
        feature_flag_v2_grid: 'enabled',
      }),
    },
  ];
}

export function predictPagePresets(meta: PageMetadata): Result<PredictedPreset[], Error> {
  const safeMeta: PageMetadata = {
    url: meta?.url || '',
    title: meta?.title || '',
    hasPasswordField: Boolean(meta?.hasPasswordField),
    hasFormCart: Boolean(meta?.hasFormCart),
    metaTags: Array.isArray(meta?.metaTags) ? meta.metaTags : [],
  };

  const domainTag = hashDomain(safeMeta.url);
  const nonce = Date.now().toString(36);

  if (isEcommerceContext(safeMeta)) {
    return Result.ok(buildEcommercePredictions(domainTag, nonce));
  }

  if (isAuthContext(safeMeta)) {
    return Result.ok(buildAuthPredictions(domainTag, nonce));
  }

  return Result.ok(buildSaasPredictions(domainTag, nonce));
}

