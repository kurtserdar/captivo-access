import { describe, it, expect } from "vitest";
import { canRepairConnector, buildReconfigureCommand, buildConnectorRunCommand } from "./repair";

describe("canRepairConnector", () => {
  it("allows re-pair for non-revoked connectors", () => {
    expect(canRepairConnector("PENDING")).toBe(true);
    expect(canRepairConnector("ONLINE")).toBe(true);
    expect(canRepairConnector("OFFLINE")).toBe(true);
  });
  it("blocks re-pair for a revoked connector", () => {
    expect(canRepairConnector("REVOKED")).toBe(false);
  });
});

describe("buildReconfigureCommand", () => {
  it("clears the old token volume and re-runs with the new pair code", () => {
    const cmd = buildReconfigureCommand("CODE123", "https://mgr.example.com", "wss://connect.example.com");
    expect(cmd).toContain("docker rm -f access-connector");
    expect(cmd).toContain("docker volume rm access_connector_data");
    expect(cmd).toContain("PAIR_CODE=CODE123");
    expect(cmd).toContain("MANAGER_URL=https://mgr.example.com");
    expect(cmd).toContain("DATAPLANE_URL=wss://connect.example.com");
    expect(cmd).toContain("ghcr.io/kurtserdar/captivo-access-connector:latest");
  });
});

describe("buildConnectorRunCommand", () => {
  it("has the run flags and NO volume reset prefix", () => {
    const cmd = buildConnectorRunCommand("CODE123", "https://mgr.example.com", "wss://connect.example.com");
    expect(cmd).toContain("docker run -d --name access-connector");
    expect(cmd).toContain("PAIR_CODE=CODE123");
    expect(cmd).not.toContain("docker rm -f");
    expect(cmd).not.toContain("docker volume rm");
  });
  it("buildReconfigureCommand = reset prefix + the run command", () => {
    const run = buildConnectorRunCommand("C", "M", "T");
    const reconfigure = buildReconfigureCommand("C", "M", "T");
    expect(reconfigure).toBe("docker rm -f access-connector && docker volume rm access_connector_data && " + run);
  });
});
