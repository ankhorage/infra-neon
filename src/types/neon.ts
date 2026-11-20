import type { InfraResult } from '@ankhorage/contracts/infra';

export interface NeonProject {
  readonly id: string;
  readonly name: string;
  readonly regionId: string;
}

interface NeonBranch {
  readonly id: string;
  readonly name: string;
}

export interface NeonControlPlaneRequest {
  readonly token: string;
  readonly signal?: AbortSignal;
}

export interface NeonControlPlane {
  listProjectsAsync(request: NeonControlPlaneRequest): Promise<InfraResult<readonly NeonProject[]>>;
  createProjectAsync(
    request: NeonControlPlaneRequest & { readonly name: string; readonly regionId: string },
  ): Promise<InfraResult<NeonProject>>;
  deleteProjectAsync(
    request: NeonControlPlaneRequest & { readonly projectId: string },
  ): Promise<InfraResult<null>>;
  listBranchesAsync(
    request: NeonControlPlaneRequest & { readonly projectId: string },
  ): Promise<InfraResult<readonly NeonBranch[]>>;
  createBranchAsync(
    request: NeonControlPlaneRequest & { readonly projectId: string; readonly name: string },
  ): Promise<InfraResult<NeonBranch>>;
  deleteBranchAsync(
    request: NeonControlPlaneRequest & { readonly projectId: string; readonly branchId: string },
  ): Promise<InfraResult<null>>;
  listDatabaseNamesAsync(
    request: NeonControlPlaneRequest & { readonly projectId: string; readonly branchId: string },
  ): Promise<InfraResult<readonly string[]>>;
  createDatabaseAsync(
    request: NeonControlPlaneRequest & {
      readonly projectId: string;
      readonly branchId: string;
      readonly name: string;
    },
  ): Promise<InfraResult<null>>;
  deleteDatabaseAsync(
    request: NeonControlPlaneRequest & {
      readonly projectId: string;
      readonly branchId: string;
      readonly name: string;
    },
  ): Promise<InfraResult<null>>;
  listRoleNamesAsync(
    request: NeonControlPlaneRequest & { readonly projectId: string; readonly branchId: string },
  ): Promise<InfraResult<readonly string[]>>;
  createRoleAsync(
    request: NeonControlPlaneRequest & {
      readonly projectId: string;
      readonly branchId: string;
      readonly name: string;
    },
  ): Promise<InfraResult<null>>;
  deleteRoleAsync(
    request: NeonControlPlaneRequest & {
      readonly projectId: string;
      readonly branchId: string;
      readonly name: string;
    },
  ): Promise<InfraResult<null>>;
}

export interface NeonAdapterOptions {
  readonly controlPlane?: NeonControlPlane;
}
