import { Result } from './result';

export interface DiscoveredBackend {
  port?: number;
  baseUrl: string;
  type: 'swagger' | 'openapi' | 'graphql' | 'rest';
  specUrl: string;
  endpointsFound: string[];
  schemasCount: number;
}

export type BackendDiscoveryErrorKind =
  | 'INVALID_URL'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'INVALID_SPEC_JSON'
  | 'NO_SPEC_FOUND'
  | 'CHROME_API_UNAVAILABLE';

export interface BackendDiscoveryError {
  kind: BackendDiscoveryErrorKind;
  message: string;
  cause?: unknown;
}

export const BackendDiscoveryError = {
  invalidUrl: (url: string): BackendDiscoveryError => ({
    kind: 'INVALID_URL',
    message: `Invalid API endpoint URL: ${url}`,
  }),
  networkError: (message: string, cause?: unknown): BackendDiscoveryError => ({
    kind: 'NETWORK_ERROR',
    message,
    cause,
  }),
  httpError: (status: number, statusText: string): BackendDiscoveryError => ({
    kind: 'HTTP_ERROR',
    message: `HTTP error ${status}: ${statusText}`,
  }),
  invalidSpecJson: (message: string): BackendDiscoveryError => ({
    kind: 'INVALID_SPEC_JSON',
    message,
  }),
  noSpecFound: (baseUrl: string): BackendDiscoveryError => ({
    kind: 'NO_SPEC_FOUND',
    message: `No OpenAPI/Swagger/GraphQL specification discovered at base URL: ${baseUrl}`,
  }),
  chromeApiUnavailable: (): BackendDiscoveryError => ({
    kind: 'CHROME_API_UNAVAILABLE',
    message: 'chrome.webRequest API is unavailable in current runtime context',
  }),
};

class NetworkRequestSnifferImpl {
  private capturedUrls: Set<string> = new Set();

  public reset(): void {
    this.capturedUrls.clear();
  }

  public captureRequestUrl(url: string): void {
    if (!url || typeof url !== 'string') return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        this.capturedUrls.add(parsed.origin);
      }
    } catch {
      // Ignore invalid URLs
    }
  }

  public getCapturedOrigins(): string[] {
    return Array.from(this.capturedUrls);
  }

  public getCapturedPorts(): number[] {
    const ports = new Set<number>();
    for (const origin of this.capturedUrls) {
      try {
        const parsed = new URL(origin);
        if (parsed.port) {
          const portNum = parseInt(parsed.port, 10);
          if (!isNaN(portNum)) {
            ports.add(portNum);
          }
        } else if (parsed.protocol === 'http:') {
          ports.add(80);
        } else if (parsed.protocol === 'https:') {
          ports.add(443);
        }
      } catch {
        // Safe skip
      }
    }
    return Array.from(ports);
  }

  public attachListener(): boolean {
    if (typeof chrome !== 'undefined' && chrome?.webRequest?.onBeforeRequest) {
      try {
        chrome.webRequest.onBeforeRequest.addListener(
          (details) => {
            this.captureRequestUrl(details.url);
          },
          { urls: ['<all_urls>'] }
        );
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export const NetworkRequestSniffer = new NetworkRequestSnifferImpl();

export function validateApiUrl(urlStr: string): Result<URL, BackendDiscoveryError> {
  if (!urlStr || typeof urlStr !== 'string') {
    return Result.err(BackendDiscoveryError.invalidUrl(String(urlStr)));
  }
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return Result.ok(parsed);
    }
    return Result.err(BackendDiscoveryError.invalidUrl(urlStr));
  } catch {
    return Result.err(BackendDiscoveryError.invalidUrl(urlStr));
  }
}

class EnvironmentProberImpl {
  private keyPattern = /api|backend|endpoint|host|server/i;
  private urlPattern = /(https?:\/\/[^\s"',;]+)/gi;

  public probeStorage(storageMap?: Record<string, string>): string[] {
    if (!storageMap || typeof storageMap !== 'object' || Array.isArray(storageMap)) return [];
    const candidates = new Set<string>();

    for (const [key, value] of Object.entries(storageMap)) {
      if (typeof value !== 'string') continue;
      if (this.keyPattern.test(key) || this.keyPattern.test(value)) {
        this.extractOriginsFromText(value, candidates);
      } else if (value.includes('http')) {
        this.extractOriginsFromText(value, candidates);
      }
    }
    return Array.from(candidates);
  }

  public extractCandidates(
    storageMap?: Record<string, string>,
    extraOrigins: string[] = []
  ): string[] {
    const origins = new Set<string>();
    for (const origin of NetworkRequestSniffer.getCapturedOrigins()) {
      origins.add(origin);
    }
    for (const origin of this.probeStorage(storageMap)) {
      origins.add(origin);
    }
    if (Array.isArray(extraOrigins)) {
      for (const extra of extraOrigins) {
        const valid = validateApiUrl(extra);
        if (valid.ok) {
          origins.add(valid.value.origin);
        }
      }
    }
    return Array.from(origins);
  }

  private extractOriginsFromText(text: string, origins: Set<string>): void {
    if (!text || typeof text !== 'string') return;
    const matches = text.match(this.urlPattern);
    if (!matches) return;

    for (const match of matches) {
      const valid = validateApiUrl(match);
      if (valid.ok) {
        origins.add(valid.value.origin);
      }
    }
  }
}

export const EnvironmentProber = new EnvironmentProberImpl();

export function getLocalhostDevPorts(): number[] {
  return NetworkRequestSniffer.getCapturedPorts();
}

export function getStandardApiSpecPaths(): string[] {
  return [
    '/swagger.json',
    '/v3/api-docs',
    '/openapi.json',
    '/api-docs',
    '/graphql',
  ];
}

export async function safeFetchSpec(
  url: string
): Promise<Result<Record<string, any>, BackendDiscoveryError>> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return Result.err(BackendDiscoveryError.httpError(res.status, res.statusText));
    }
    const json = await res.json().catch(() => null);
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return Result.err(BackendDiscoveryError.invalidSpecJson(`Response from ${url} is not a valid JSON object`));
    }
    return Result.ok(json);
  } catch (err) {
    return Result.err(BackendDiscoveryError.networkError(`Failed to fetch spec from ${url}`, err));
  }
}

export function classifySpecType(
  path: string,
  json: Record<string, any>
): 'swagger' | 'openapi' | 'graphql' | 'rest' {
  if (path && typeof path === 'string' && path.includes('graphql')) return 'graphql';
  if (!json || typeof json !== 'object' || Array.isArray(json)) return 'rest';
  if (json.openapi || json.swagger) return 'openapi';
  return 'rest';
}

export function extractEndpointsAndSchemas(
  json: Record<string, any>
): { endpointsFound: string[]; schemasCount: number } {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { endpointsFound: [], schemasCount: 0 };
  }

  const pathsObj =
    json.paths && typeof json.paths === 'object' && !Array.isArray(json.paths) ? json.paths : {};
  const endpointsFound = Object.keys(pathsObj);

  const componentsObj =
    json.components && typeof json.components === 'object' && !Array.isArray(json.components)
      ? json.components
      : null;
  const rawSchemas = componentsObj ? componentsObj.schemas : json.definitions;
  const schemasObj =
    rawSchemas && typeof rawSchemas === 'object' && !Array.isArray(rawSchemas) ? rawSchemas : {};
  const schemasCount = Object.keys(schemasObj).length;

  return { endpointsFound, schemasCount };
}

export async function probeBackendEndpointResult(
  baseUrl: string
): Promise<Result<DiscoveredBackend, BackendDiscoveryError>> {
  const validUrl = validateApiUrl(baseUrl);
  if (!validUrl.ok) {
    return Result.err(validUrl.error);
  }

  const normalizedBase = baseUrl.replace(/\/$/, '');
  const specPaths = getStandardApiSpecPaths();

  for (const path of specPaths) {
    const specUrl = `${normalizedBase}${path}`;
    const fetchResult = await safeFetchSpec(specUrl);

    if (fetchResult.ok) {
      const json = fetchResult.value;
      const type = classifySpecType(path, json);
      const { endpointsFound, schemasCount } = extractEndpointsAndSchemas(json);

      return Result.ok({
        baseUrl,
        type,
        specUrl,
        endpointsFound,
        schemasCount,
        port: validUrl.value.port ? parseInt(validUrl.value.port, 10) : undefined,
      });
    }
  }

  return Result.err(BackendDiscoveryError.noSpecFound(baseUrl));
}

export async function discoverBackendEndpointsResult(
  storageMap?: Record<string, string>,
  extraOrigins: string[] = []
): Promise<Result<DiscoveredBackend[], BackendDiscoveryError>> {
  const candidates = EnvironmentProber.extractCandidates(storageMap, extraOrigins);

  if (candidates.length === 0) {
    const ports = getLocalhostDevPorts();
    for (const port of ports) {
      candidates.push(`http://localhost:${port}`);
    }
  }

  const discovered: DiscoveredBackend[] = [];

  for (const origin of candidates) {
    const probeRes = await probeBackendEndpointResult(origin);
    if (probeRes.ok) {
      discovered.push(probeRes.value);
    }
  }

  return Result.ok(discovered);
}

export async function probeBackendEndpoint(baseUrl: string): Promise<DiscoveredBackend | null> {
  const result = await probeBackendEndpointResult(baseUrl);
  if (result.ok) {
    return result.value;
  }
  return null;
}
