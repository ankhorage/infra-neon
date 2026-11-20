import { INFRA_ADAPTER_CATALOG, type InfraAdapterDescriptor } from '@ankhorage/contracts/infra';

/** Canonical Contracts-backed identity used for Infra adapter discovery. */
export const infraAdapterDescriptor =
  INFRA_ADAPTER_CATALOG.neon satisfies InfraAdapterDescriptor<'neon'>;
