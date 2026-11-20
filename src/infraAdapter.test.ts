import { INFRA_ADAPTER_CATALOG, type InfraExecutionContext } from '@ankhorage/contracts/infra';
import { describe, expect, it } from 'bun:test';

import {
  createFetchNeonControlPlane,
  createInfraAdapter,
  infraAdapterDescriptor,
} from './index.js';

const context: InfraExecutionContext = {
  projectId: 'zefix',
  environment: 'production',
  desired: {
    deployment: {
      compute: { provider: 'hetzner', location: 'nbg1' },
      runtime: { provider: 'k3s' },
    },
    database: {
      provider: 'neon',
      project: {
        name: 'zefix-leads',
        regionId: 'aws-eu-central-1',
        credentials: { source: 'control-plane', name: 'NEON_API_KEY' },
      },
      branch: { name: 'production' },
      database: { name: 'leads' },
      role: { name: 'lead_writer' },
    },
  },
  credentials: {
    findAsync: () => Promise.resolve({ ok: true as const, value: null, diagnostics: [] }),
    resolveAsync: () =>
      Promise.resolve({
        ok: true as const,
        value: { NEON_API_KEY: 'private-token' },
        diagnostics: [],
      }),
    persistAsync: () => Promise.resolve({ ok: true as const, value: null, diagnostics: [] }),
  },
  secrets: {
    resolveAsync: () => Promise.resolve({ ok: true as const, value: 'unused', diagnostics: [] }),
  },
};

describe('Neon infrastructure adapter', () => {
  it('exports the exact published Contracts descriptor', () => {
    expect(infraAdapterDescriptor).toEqual(INFRA_ADAPTER_CATALOG.neon);
    expect(createInfraAdapter().descriptor).toBe(infraAdapterDescriptor);
  });

  it('keeps API tokens in the Authorization header and out of failures', async () => {
    const calls: RequestInit[] = [];
    const controlPlane = createFetchNeonControlPlane((_input, init) => {
      calls.push(init ?? {});
      return Promise.resolve(new Response('unavailable', { status: 503 }));
    });
    const result = await controlPlane.listProjectsAsync({ token: 'private-token' });
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'neon-control-plane-unavailable',
          message: 'The Neon control plane request failed.',
        },
      ],
    });
    expect(calls[0]?.headers).toEqual({ authorization: 'Bearer private-token' });
    expect(JSON.stringify(result)).not.toContain('private-token');
  });

  it('rejects a missing credential bundle before issuing lifecycle work', async () => {
    const result = await createInfraAdapter().validateAsync({
      ...context,
      credentials: {
        ...context.credentials,
        resolveAsync: () => Promise.resolve({ ok: true as const, value: {}, diagnostics: [] }),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('neon-credentials-unavailable');
  });
});
