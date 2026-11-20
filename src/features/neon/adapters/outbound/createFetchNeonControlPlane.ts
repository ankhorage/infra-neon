import type { InfraResult } from '@ankhorage/contracts/infra';

import type { NeonControlPlane, NeonControlPlaneRequest } from '../../../../types/neon.js';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
interface NeonEntity {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly region_id?: unknown;
}

/** Create the documented Neon API adapter without exposing response bodies or credentials. */
export function createFetchNeonControlPlane(fetcher: FetchLike = fetch): NeonControlPlane {
  return {
    listProjectsAsync: (request) => listProjectsAsync(fetcher, request),
    createProjectAsync: (request) =>
      createProjectAsync(fetcher, request, request.name, request.regionId),
    deleteProjectAsync: (request) =>
      emptyAsync(fetcher, request, `/projects/${request.projectId}`, 'DELETE'),
    listBranchesAsync: (request) => listBranchesAsync(fetcher, request),
    createBranchAsync: (request) =>
      createBranchAsync(fetcher, request, request.projectId, request.name),
    deleteBranchAsync: (request) =>
      emptyAsync(
        fetcher,
        request,
        `/projects/${request.projectId}/branches/${request.branchId}`,
        'DELETE',
      ),
    listDatabaseNamesAsync: (request) => listNamesAsync(fetcher, request, 'databases'),
    createDatabaseAsync: (request) => createNamedAsync(fetcher, request, 'databases', 'database'),
    deleteDatabaseAsync: (request) => deleteNamedAsync(fetcher, request, 'databases'),
    listRoleNamesAsync: (request) => listNamesAsync(fetcher, request, 'roles'),
    createRoleAsync: (request) => createNamedAsync(fetcher, request, 'roles', 'role'),
    deleteRoleAsync: (request) => deleteNamedAsync(fetcher, request, 'roles'),
  };
}

/** List provider projects as a narrow, non-secret response. */
async function listProjectsAsync(
  fetcher: FetchLike,
  request: NeonControlPlaneRequest,
): Promise<
  InfraResult<readonly { readonly id: string; readonly name: string; readonly regionId: string }[]>
> {
  const response = await requestAsync(fetcher, request, '/projects', 'GET');
  if (!response.ok) return response;
  const payload = await parseJsonAsync(response.value);
  if (!payload.ok || !isRecord(payload.value) || !Array.isArray(payload.value.projects))
    return invalidResponse();
  const projects = payload.value.projects.flatMap((item) =>
    isProject(item) ? [{ id: item.id, name: item.name, regionId: item.region_id }] : [],
  );
  return projects.length === payload.value.projects.length
    ? { ok: true, value: projects, diagnostics: [] }
    : invalidResponse();
}

/** Create one provider project from public desired-state fields. */
async function createProjectAsync(
  fetcher: FetchLike,
  request: NeonControlPlaneRequest,
  name: string,
  regionId: string,
): Promise<InfraResult<{ readonly id: string; readonly name: string; readonly regionId: string }>> {
  const response = await requestAsync(fetcher, request, '/projects', 'POST', {
    project: { name, region_id: regionId },
  });
  if (!response.ok) return response;
  const payload = await parseJsonAsync(response.value);
  return payload.ok && isRecord(payload.value) && isProject(payload.value.project)
    ? {
        ok: true,
        value: {
          id: payload.value.project.id,
          name: payload.value.project.name,
          regionId: payload.value.project.region_id,
        },
        diagnostics: [],
      }
    : invalidResponse();
}

/** List branches without retaining full provider metadata. */
async function listBranchesAsync(
  fetcher: FetchLike,
  request: NeonControlPlaneRequest & { readonly projectId: string },
): Promise<InfraResult<readonly { readonly id: string; readonly name: string }[]>> {
  const response = await requestAsync(
    fetcher,
    request,
    `/projects/${request.projectId}/branches`,
    'GET',
  );
  if (!response.ok) return response;
  const payload = await parseJsonAsync(response.value);
  if (!payload.ok || !isRecord(payload.value) || !Array.isArray(payload.value.branches))
    return invalidResponse();
  const branches = payload.value.branches.flatMap((item) =>
    isBranch(item) ? [{ id: item.id, name: item.name }] : [],
  );
  return branches.length === payload.value.branches.length
    ? { ok: true, value: branches, diagnostics: [] }
    : invalidResponse();
}

/** Create one named branch under a known project. */
async function createBranchAsync(
  fetcher: FetchLike,
  request: NeonControlPlaneRequest,
  projectId: string,
  name: string,
): Promise<InfraResult<{ readonly id: string; readonly name: string }>> {
  const response = await requestAsync(fetcher, request, `/projects/${projectId}/branches`, 'POST', {
    branch: { name },
  });
  if (!response.ok) return response;
  const payload = await parseJsonAsync(response.value);
  return payload.ok && isRecord(payload.value) && isBranch(payload.value.branch)
    ? {
        ok: true,
        value: { id: payload.value.branch.id, name: payload.value.branch.name },
        diagnostics: [],
      }
    : invalidResponse();
}

/** List database or role names for one branch. */
async function listNamesAsync(
  fetcher: FetchLike,
  request: NeonControlPlaneRequest & { readonly projectId: string; readonly branchId: string },
  collection: 'databases' | 'roles',
): Promise<InfraResult<readonly string[]>> {
  const response = await requestAsync(
    fetcher,
    request,
    `/projects/${request.projectId}/branches/${request.branchId}/${collection}`,
    'GET',
  );
  if (!response.ok) return response;
  const payload = await parseJsonAsync(response.value);
  const values =
    payload.ok && isRecord(payload.value)
      ? collection === 'databases'
        ? payload.value.databases
        : payload.value.roles
      : undefined;
  return Array.isArray(values) && values.every(isNamed)
    ? { ok: true, value: values.map((value) => value.name), diagnostics: [] }
    : invalidResponse();
}

/** Create a database or role by its documented nested request body. */
async function createNamedAsync(
  fetcher: FetchLike,
  request: NeonControlPlaneRequest & {
    readonly projectId: string;
    readonly branchId: string;
    readonly name: string;
  },
  collection: 'databases' | 'roles',
  key: 'database' | 'role',
): Promise<InfraResult<null>> {
  const body =
    key === 'database' ? { database: { name: request.name } } : { role: { name: request.name } };
  return emptyAsync(
    fetcher,
    request,
    `/projects/${request.projectId}/branches/${request.branchId}/${collection}`,
    'POST',
    body,
  );
}

/** Delete a database or role using a path-encoded stable name. */
async function deleteNamedAsync(
  fetcher: FetchLike,
  request: NeonControlPlaneRequest & {
    readonly projectId: string;
    readonly branchId: string;
    readonly name: string;
  },
  collection: 'databases' | 'roles',
): Promise<InfraResult<null>> {
  return emptyAsync(
    fetcher,
    request,
    `/projects/${request.projectId}/branches/${request.branchId}/${collection}/${encodeURIComponent(request.name)}`,
    'DELETE',
  );
}

/** Execute an endpoint that exposes no response body to inner policy. */
async function emptyAsync(
  fetcher: FetchLike,
  request: NeonControlPlaneRequest,
  path: string,
  method: 'POST' | 'DELETE',
  body?: unknown,
): Promise<InfraResult<null>> {
  const response = await requestAsync(fetcher, request, path, method, body);
  return response.ok ? { ok: true, value: null, diagnostics: [] } : response;
}

/** Send one authenticated control-plane request while keeping token and body out of diagnostics. */
async function requestAsync(
  fetcher: FetchLike,
  request: NeonControlPlaneRequest,
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
): Promise<InfraResult<Response>> {
  try {
    const response = await fetcher(`https://console.neon.tech/api/v2${path}`, {
      method,
      headers: {
        authorization: `Bearer ${request.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return response.ok ? { ok: true, value: response, diagnostics: [] } : unavailable();
  } catch {
    return unavailable();
  }
}

/** Parse untrusted JSON without surfacing provider payloads. */
async function parseJsonAsync(response: Response): Promise<InfraResult<unknown>> {
  try {
    return { ok: true, value: await response.json(), diagnostics: [] };
  } catch {
    return invalidResponse();
  }
}
/** Check a plain JSON object. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
/** Narrow provider project response fields. */
function isProject(value: unknown): value is NeonEntity & {
  readonly id: string;
  readonly name: string;
  readonly region_id: string;
} {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.region_id === 'string'
  );
}
/** Narrow provider branch response fields. */
function isBranch(
  value: unknown,
): value is NeonEntity & { readonly id: string; readonly name: string } {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}
/** Narrow provider database and role response fields. */
function isNamed(value: unknown): value is { readonly name: string } {
  return isRecord(value) && typeof value.name === 'string';
}
/** Return a stable sanitized availability failure. */
function unavailable(): InfraResult<never> {
  return {
    ok: false,
    diagnostics: [
      {
        severity: 'error',
        code: 'neon-control-plane-unavailable',
        message: 'The Neon control plane request failed.',
      },
    ],
  };
}
/** Return a stable sanitized schema failure. */
function invalidResponse(): InfraResult<never> {
  return {
    ok: false,
    diagnostics: [
      {
        severity: 'error',
        code: 'neon-control-plane-response-invalid',
        message: 'The Neon control plane returned an invalid response.',
      },
    ],
  };
}
