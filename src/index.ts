/** Public Neon infrastructure adapter package boundary. */
export { infraAdapterDescriptor } from './constants/infra.js';
export { createFetchNeonControlPlane } from './features/neon/adapters/outbound/createFetchNeonControlPlane.js';
export { createInfraAdapter } from './features/neon/composition/createInfraAdapter.js';
export type {
  NeonAdapterOptions,
  NeonControlPlane,
  NeonControlPlaneRequest,
} from './types/neon.js';
