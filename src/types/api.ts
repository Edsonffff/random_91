export type HttpMethod = 'GET' | 'POST' | 'DELETE' | 'PUT';

export interface ApiLogEntry {
  id: string;
  timestamp: string; // e.g. "08:40:01" or ISO string
  method: HttpMethod;
  endpoint: string;
  status: number;
  responseTimeMs: number;
  environment: 'TEST' | 'LOCAL' | 'MOCK';
  requestPayload?: unknown;
  responsePayload?: unknown;
  error?: string;
}

export interface ApiEndpointSpec {
  id: string;
  name: string;
  method: HttpMethod;
  path: string;
  description: string;
  defaultParams?: Record<string, string>;
  defaultBody?: unknown;
  exampleResponse: unknown;
}
