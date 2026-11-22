// The script mock server (wazoo-api#149): control plane, data plane and
// console behind one route table. Each script passes its own resolved base
// URLs so planes match by origin, and mock mode never touches the network.
import { createMockServer } from "./router.mjs";
import { createMockState } from "./state.mjs";
import { healthRoutes, identityRoutes, worldListRoutes } from "./control-plane.mjs";
import { worldByIdRoutes } from "./control-plane-worlds.mjs";
import { platformTokenRoutes } from "./control-plane-tokens.mjs";
import {
  meteringRoutes,
  embeddingCredentialRoutes,
} from "./control-plane-metering.mjs";
import { dataPlaneBaseRoutes } from "./data-plane.mjs";
import { worldDataRoutes } from "./data-plane-world.mjs";
import { consoleRoutes } from "./console.mjs";

export function createPlatformMock({ api, worlds, console: consoleUrl }) {
  const hosts = { api, worlds, console: consoleUrl };
  const state = createMockState();
  return createMockServer(
    [
      ...healthRoutes(),
      ...identityRoutes(state),
      ...worldListRoutes(state),
      ...worldByIdRoutes(state),
      ...platformTokenRoutes(state),
      ...meteringRoutes(state),
      ...embeddingCredentialRoutes(state),
      ...dataPlaneBaseRoutes(state),
      ...worldDataRoutes(state),
      ...consoleRoutes(),
    ],
    hosts,
  );
}
