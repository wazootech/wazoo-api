// Private beta health: usage/limits/billing step functions (wazoo-api#149).
// Behavior identical to the pre-split inline code.
import { apiRequest } from "./client.mjs";

export function recordUsage(context) {
  return apiRequest(context)(`/v1/worlds/${context.state.worldId}/usage`, {
    method: "POST",
    body: {
      email: context.email,
      metric: "health.requests",
      quantity: 1,
      unit: "request",
    },
  });
}

export function readUsage(context) {
  return apiRequest(context)(
    `/v1/worlds/${context.state.worldId}/usage?email=${encodeURIComponent(context.email)}`,
  );
}

export function readLimits(context) {
  return apiRequest(context)(
    `/v1/worlds/${context.state.worldId}/limits?email=${encodeURIComponent(context.email)}`,
  );
}

export function readBilling(context) {
  return apiRequest(context)(
    `/v1/worlds/${context.state.worldId}/billing?email=${encodeURIComponent(context.email)}`,
  );
}
