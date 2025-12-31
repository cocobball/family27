
export const NETWORK_EVENTS = {
  SESSION_STARTED: "NETWORK/SESSION_STARTED",
  SESSION_ENDED: "NETWORK/SESSION_ENDED",
  GRANT_TIME: "NETWORK/GRANT_TIME",
  BLOCK_NOW: "NETWORK/BLOCK_NOW",
};

export function defaultNetworkData() {
  return {
    version: 1,
    kids: {
      harvey: { ruleId: "", allowedUntil: 0 },
      brady: { ruleId: "", allowedUntil: 0 },
    }
  };
}
