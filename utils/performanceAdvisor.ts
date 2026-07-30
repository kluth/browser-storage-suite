export interface StorageInsight {
  id: string;
  type: 'warning' | 'tip' | 'success';
  title: string;
  description: string;
  recommendation: string;
}

export interface PerformanceQuotaMetrics {
  localStorageBytes: number;
  localStorageLimitBytes: number;
  sessionStorageBytes: number;
  cookieCount: number;
  insights: StorageInsight[];
}

export function analyzeStoragePerformance(
  localEntries: Record<string, string>,
  cookies: { name: string; value: string }[]
): PerformanceQuotaMetrics {
  let localStorageBytes = 0;
  const insights: StorageInsight[] = [];

  Object.entries(localEntries).forEach(([key, val]) => {
    const itemSize = new Blob([key + val]).size;
    localStorageBytes += itemSize;

    // Detect Anti-pattern 1: Very large item in LocalStorage (>100KB)
    if (itemSize > 100 * 1024) {
      insights.push({
        id: `large_item_${key}`,
        type: 'warning',
        title: `Großes Objekt in LocalStorage (${Math.round(itemSize / 1024)} KB)`,
        description: `Der Schlüssel '${key}' verbraucht über 100 KB im synchronen LocalStorage.`,
        recommendation: 'Lagere große JSON-Objekte in IndexedDB aus, um den Hauptthread beim Seitenstart nicht zu blockieren.',
      });
    }

    // Detect Anti-pattern 2: Storing raw JWT tokens without expiration check
    if (key.toLowerCase().includes('token') || key.toLowerCase().includes('jwt')) {
      insights.push({
        id: `jwt_sec_${key}`,
        type: 'tip',
        title: 'Sicherheitshinweis: Auth Token in LocalStorage',
        description: `Verwendung von LocalStorage für '${key}' macht das Token anfällig für XSS-Angriffe.`,
        recommendation: 'Verwende für sensible Sitzungstokens ein HttpOnly, Secure SameSite Cookie.',
      });
    }
  });

  const localStorageLimitBytes = 5 * 1024 * 1024; // 5 MB Limit
  const usagePercentage = (localStorageBytes / localStorageLimitBytes) * 100;

  if (usagePercentage > 75) {
    insights.push({
      id: 'quota_warning',
      type: 'warning',
      title: 'LocalStorage Quota über 75%',
      description: `Der LocalStorage-Verbrauch liegt bei ${usagePercentage.toFixed(1)}%.`,
      recommendation: 'Führe regelmäßige Bereinigungen (Storage Cleanup) oder eine Migration zu IndexedDB durch.',
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: 'optimal_storage',
      type: 'success',
      title: 'Optimale Storage Performance',
      description: 'Keine Performance-Engpässe oder Anti-Pattern in den aktiven Speichern erkannt.',
      recommendation: 'Deine Speicherzugriffe laufen synchron und thread-schonend.',
    });
  }

  return {
    localStorageBytes,
    localStorageLimitBytes,
    sessionStorageBytes: 0,
    cookieCount: cookies.length,
    insights,
  };
}
