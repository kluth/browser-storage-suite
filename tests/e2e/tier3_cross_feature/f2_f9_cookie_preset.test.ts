import { describe, it, expect, vi } from 'vitest';
import { getCookiesForTab, CookieItem } from '../../../utils/browserApi';
import { predictPagePresets, PageMetadata } from '../../../utils/presetPredictor';

describe('Tier 3 Interaction: F2 (Cookie Manager) + F9 (Preset Predictor)', () => {
  it('should predict page presets and cross-validate against active tab cookies', async () => {
    // 1. Mock chrome.cookies API for F2
    const mockCookies = [
      { name: 'session_id', value: 'sess_abc123', domain: 'app.example.com', path: '/', secure: true, httpOnly: true },
      { name: 'auth_jwt', value: 'jwt_admin_99', domain: 'app.example.com', path: '/', secure: true, httpOnly: true },
    ];

    global.chrome = {
      cookies: {
        getAll: vi.fn().mockResolvedValue(mockCookies),
      },
    } as unknown as typeof chrome;

    const cookies: CookieItem[] = await getCookiesForTab('https://app.example.com/dashboard');
    expect(cookies.length).toBe(2);
    expect(cookies[0].name).toBe('session_id');

    // 2. Predict preset for active page
    const pageMeta: PageMetadata = {
      url: 'https://app.example.com/dashboard',
      title: 'Admin User Dashboard',
      hasPasswordField: false,
      hasFormCart: false,
      metaTags: ['auth', 'dashboard'],
    };

    const res = predictPagePresets(pageMeta);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const predictions = res.value;
    expect(predictions.length).toBeGreaterThan(0);
    const authPreset = predictions.find((p) => p.category === 'auth');
    expect(authPreset).toBeDefined();

    // Verify cookie manager tokens support predicted auth state
    const hasAuthCookie = cookies.some((c) => c.name.includes('auth') || c.name.includes('session'));
    expect(hasAuthCookie).toBe(true);
  });
});
