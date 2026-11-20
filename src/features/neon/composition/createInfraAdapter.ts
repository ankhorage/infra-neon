import type {
  InfraDestroyRequest,
  InfraExecutionContext,
  InfraPlanAction,
  InfraReconcileResult,
  InfraResourceStatus,
  InfraResult,
  InfraServiceAdapter,
} from '@ankhorage/contracts/infra';

import { infraAdapterDescriptor } from '../../../constants/infra.js';
import type {
  NeonAdapterOptions,
  NeonControlPlane,
  NeonControlPlaneRequest,
  NeonProject,
} from '../../../types/neon.js';
import { createFetchNeonControlPlane } from '../adapters/outbound/createFetchNeonControlPlane.js';

/** Create the canonical Neon service adapter using the published Infra lifecycle boundary. */
export function createInfraAdapter(options: NeonAdapterOptions = {}): InfraServiceAdapter {
  const controlPlane = options.controlPlane ?? createFetchNeonControlPlane();
  return {
    descriptor: infraAdapterDescriptor,
    validateAsync: (context) => validateNeonAsync(context),
    planAsync: (context) => Promise.resolve(planNeon(context)),
    desiredWorkloadsAsync: () => Promise.resolve({ ok: true, value: [], diagnostics: [] }),
    reconcileAsync: (context) => reconcileNeonAsync(controlPlane, context),
    statusAsync: (context) => statusNeonAsync(controlPlane, context),
    destroyAsync: (context, request) => destroyNeonAsync(controlPlane, context, request),
  };
}

/** Validate configuration and resolve the API token only at the execution boundary. */
async function validateNeonAsync(context: InfraExecutionContext): Promise<InfraResult<null>> {
  const resources = resourceNames(context);
  if (!resources.ok) return resources;
  const resolved = await resolveRequestAsync(context);
  return resolved.ok ? { ok: true, value: null, diagnostics: [] } : resolved;
}

/** Plan desired persistent resources from ledger ownership without provider mutation. */
function planNeon(context: InfraExecutionContext): InfraResult<readonly InfraPlanAction[]> {
  const desired = resourceNames(context);
  if (!desired.ok) return desired;
  return {
    ok: true,
    value: desired.value.map((resourceId) => ({
      owner: identity(context, resourceId),
      operation: wasOwned(context, resourceId) ? 'noop' : 'create',
      impact: 'none',
      detail: `Neon ${resourceId}: ${wasOwned(context, resourceId) ? 'noop' : 'create'}.`,
      dependsOn: [],
    })),
    diagnostics: [],
  };
}

/** Reconcile the configured project and optional branch, database, and role idempotently. */
async function reconcileNeonAsync(
  controlPlane: NeonControlPlane,
  context: InfraExecutionContext,
): Promise<InfraResult<InfraReconcileResult>> {
  const request = await resolveRequestAsync(context);
  if (!request.ok) return request;
  const project = await ensureProjectAsync(controlPlane, request.value, context);
  if (!project.ok) return project;
  const branch = await ensureBranchAsync(controlPlane, request.value, context, project.value);
  if (!branch.ok) return branch;
  const ensured =
    branch.value === undefined
      ? { ok: true as const, value: null, diagnostics: [] }
      : await ensureBranchResourcesAsync(
          controlPlane,
          request.value,
          context,
          project.value.id,
          branch.value,
        );
  if (!ensured.ok) return ensured;
  const names = resourceNames(context);
  return names.ok
    ? {
        ok: true,
        value: {
          resources: names.value.map((resourceId) => ({
            identity: identity(context, resourceId),
            persistent: true,
            retention: 'retain',
            dependsOn: [],
          })),
          outputs: [],
        },
        diagnostics: [],
      }
    : names;
}

/** Report the provider project’s presence without mutating state. */
async function statusNeonAsync(
  controlPlane: NeonControlPlane,
  context: InfraExecutionContext,
): Promise<InfraResult<readonly InfraResourceStatus[]>> {
  const request = await resolveRequestAsync(context);
  if (!request.ok) return request;
  const projects = await controlPlane.listProjectsAsync(request.value);
  if (!projects.ok) return projects;
  const names = resourceNames(context);
  if (!names.ok) return names;
  const exists = projects.value.some(
    (project) =>
      project.name === neon(context).project.name &&
      project.regionId === neon(context).project.regionId,
  );
  return {
    ok: true,
    value: names.value.map((resourceId) => ({
      owner: identity(context, resourceId),
      state: exists ? 'ready' : 'absent',
    })),
    diagnostics: [],
  };
}

/** Delete only the explicitly confirmed root project; all provider children disappear with it. */
async function destroyNeonAsync(
  controlPlane: NeonControlPlane,
  context: InfraExecutionContext,
  request: InfraDestroyRequest,
): Promise<InfraResult<InfraReconcileResult>> {
  if (
    request.projectId !== context.projectId ||
    request.environment !== context.environment ||
    request.confirmation.projectId !== context.projectId ||
    request.confirmation.environment !== context.environment ||
    request.persistence.policy !== 'delete' ||
    !request.persistence.confirmedResources.some(
      (resource) => resource.resourceId === 'project' && resource.adapter === 'neon',
    )
  )
    return failure(
      'neon-destroy-unconfirmed',
      'Neon project deletion requires exact confirmation and explicit data-deletion authorization.',
    );
  const resolved = await resolveRequestAsync(context);
  if (!resolved.ok) return resolved;
  const projects = await controlPlane.listProjectsAsync(resolved.value);
  if (!projects.ok) return projects;
  const project = projects.value.find(
    (candidate) =>
      candidate.name === neon(context).project.name &&
      candidate.regionId === neon(context).project.regionId,
  );
  if (project === undefined)
    return { ok: true, value: { resources: [], outputs: [] }, diagnostics: [] };
  const deleted = await controlPlane.deleteProjectAsync({
    ...resolved.value,
    projectId: project.id,
  });
  return deleted.ok
    ? { ok: true, value: { resources: [], outputs: [] }, diagnostics: [] }
    : deleted;
}

/** Resolve the configured control-plane token without returning it to outputs or diagnostics. */
async function resolveRequestAsync(
  context: InfraExecutionContext,
): Promise<InfraResult<NeonControlPlaneRequest>> {
  const resolved = await context.credentials.resolveAsync(neon(context).project.credentials);
  const token = resolved.ok ? resolved.value.NEON_API_KEY : undefined;
  return typeof token === 'string' && token.length > 0
    ? {
        ok: true,
        value: { token, ...(context.signal === undefined ? {} : { signal: context.signal }) },
        diagnostics: [],
      }
    : failure('neon-credentials-unavailable', 'Neon control-plane credentials are unavailable.');
}
/** Read the validated Neon selection from the canonical database capability. */
function neon(
  context: InfraExecutionContext,
): Extract<
  NonNullable<InfraExecutionContext['desired']['database']>,
  { readonly provider: 'neon' }
> {
  if (context.desired.database?.provider !== 'neon')
    throw new Error('Neon adapter requires the Neon database selection.');
  return context.desired.database;
}
/** Ensure a matching project exists once. */
async function ensureProjectAsync(
  controlPlane: NeonControlPlane,
  request: NeonControlPlaneRequest,
  context: InfraExecutionContext,
): Promise<InfraResult<NeonProject>> {
  const existing = await controlPlane.listProjectsAsync(request);
  if (!existing.ok) return existing;
  const found = existing.value.find(
    (project) =>
      project.name === neon(context).project.name &&
      project.regionId === neon(context).project.regionId,
  );
  return found === undefined
    ? controlPlane.createProjectAsync({ ...request, ...neon(context).project })
    : { ok: true, value: found, diagnostics: [] };
}
/** Ensure the optional configured branch exists and return its provider id. */
async function ensureBranchAsync(
  controlPlane: NeonControlPlane,
  request: NeonControlPlaneRequest,
  context: InfraExecutionContext,
  project: NeonProject,
): Promise<InfraResult<string | undefined>> {
  const name = neon(context).branch?.name;
  if (name === undefined) return { ok: true, value: undefined, diagnostics: [] };
  const branches = await controlPlane.listBranchesAsync({ ...request, projectId: project.id });
  if (!branches.ok) return branches;
  const found = branches.value.find((branch) => branch.name === name);
  const branch =
    found === undefined
      ? await controlPlane.createBranchAsync({ ...request, projectId: project.id, name })
      : { ok: true as const, value: found, diagnostics: [] };
  return branch.ok ? { ok: true, value: branch.value.id, diagnostics: [] } : branch;
}
/** Ensure optional database and role resource names on a known branch. */
async function ensureBranchResourcesAsync(
  controlPlane: NeonControlPlane,
  request: NeonControlPlaneRequest,
  context: InfraExecutionContext,
  projectId: string,
  branchId: string,
): Promise<InfraResult<null>> {
  const selection = neon(context);
  const databases =
    selection.database === undefined
      ? { ok: true as const, value: [] as readonly string[], diagnostics: [] }
      : await controlPlane.listDatabaseNamesAsync({ ...request, projectId, branchId });
  if (!databases.ok) return databases;
  if (selection.database !== undefined && !databases.value.includes(selection.database.name)) {
    const created = await controlPlane.createDatabaseAsync({
      ...request,
      projectId,
      branchId,
      name: selection.database.name,
    });
    if (!created.ok) return created;
  }
  const roles =
    selection.role === undefined
      ? { ok: true as const, value: [] as readonly string[], diagnostics: [] }
      : await controlPlane.listRoleNamesAsync({ ...request, projectId, branchId });
  if (!roles.ok) return roles;
  return selection.role === undefined || roles.value.includes(selection.role.name)
    ? { ok: true, value: null, diagnostics: [] }
    : controlPlane.createRoleAsync({ ...request, projectId, branchId, name: selection.role.name });
}
/** Return desired logical resources in dependency order. */
function resourceNames(context: InfraExecutionContext): InfraResult<readonly string[]> {
  const selection = neon(context);
  if (
    selection.branch === undefined &&
    (selection.database !== undefined || selection.role !== undefined)
  ) {
    return failure(
      'neon-branch-required',
      'Neon database and role resources require an explicitly managed branch.',
    );
  }
  return {
    ok: true,
    value: [
      'project',
      ...(selection.branch === undefined ? [] : ['branch']),
      ...(selection.database === undefined ? [] : ['database']),
      ...(selection.role === undefined ? [] : ['role']),
    ],
    diagnostics: [],
  };
}
/** Build one stable resource identity. */
function identity(context: InfraExecutionContext, resourceId: string) {
  return {
    projectId: context.projectId,
    environment: context.environment,
    adapter: 'neon' as const,
    resourceId,
  };
}
/** Check ledger ownership before treating a plan action as a no-op. */
function wasOwned(context: InfraExecutionContext, resourceId: string): boolean {
  return (
    context.previous?.resources.some(
      (resource) =>
        resource.identity.projectId === context.projectId &&
        resource.identity.environment === context.environment &&
        resource.identity.adapter === 'neon' &&
        resource.identity.resourceId === resourceId,
    ) === true
  );
}
/** Construct a sanitized failed Infra result. */
function failure(code: string, message: string): InfraResult<never> {
  return { ok: false, diagnostics: [{ severity: 'error', code, message }] };
}
