import { describe, it, expect } from "vitest";
import {
  canRepairConnector,
  buildReconfigureCommand,
  buildConnectorRunCommand,
  buildConnectorUpdateCommand,
  GATEWAY_NETWORK,
  buildInstallCommand,
} from "./repair";

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

describe("buildConnectorUpdateCommand", () => {
  it("pulls the new image and recreates the container without re-pairing", () => {
    const cmd = buildConnectorUpdateCommand("https://mgr.example.com", "wss://connect.example.com");
    expect(cmd).toContain("docker pull ghcr.io/kurtserdar/captivo-access-connector:latest");
    expect(cmd).toContain("docker rm -f access-connector");
    expect(cmd).toContain("MANAGER_URL=https://mgr.example.com");
    expect(cmd).toContain("DATAPLANE_URL=wss://connect.example.com");
    expect(cmd).toContain("-v access_connector_data:/data");
    expect(cmd).toContain("ghcr.io/kurtserdar/captivo-access-connector:latest");
  });
  it("does NOT include a pair code or wipe the token volume", () => {
    const cmd = buildConnectorUpdateCommand("https://mgr.example.com", "wss://connect.example.com");
    expect(cmd).not.toContain("PAIR_CODE");
    expect(cmd).not.toContain("docker volume rm");
  });
});

describe("gateway-host connector commands", () => {
  const m = "https://manager.access.example.com";
  const t = "wss://connect.access.example.com";

  it("injects the network + ensure-prefix when gatewayHost is true (install)", () => {
    const cmd = buildInstallCommand("CODE123", m, t, true);
    expect(cmd).toContain(`--network ${GATEWAY_NETWORK}`);
    expect(cmd).toContain(`docker network inspect ${GATEWAY_NETWORK}`);
    expect(cmd).toContain(`docker network create ${GATEWAY_NETWORK}`);
  });

  it("omits the network when gatewayHost is false/default (install)", () => {
    expect(buildInstallCommand("CODE123", m, t)).not.toContain("--network");
    expect(buildInstallCommand("CODE123", m, t, false)).not.toContain("--network");
  });

  it("injects the network for the update command when gatewayHost is true", () => {
    const cmd = buildConnectorUpdateCommand(m, t, true);
    expect(cmd).toContain(`--network ${GATEWAY_NETWORK}`);
    expect(cmd).toContain("docker pull");
  });

  it("omits the network for the update command by default", () => {
    expect(buildConnectorUpdateCommand(m, t)).not.toContain("--network");
  });

  it("injects the network for the re-pair command when gatewayHost is true", () => {
    expect(buildReconfigureCommand("CODE123", m, t, true)).toContain(`--network ${GATEWAY_NETWORK}`);
  });
});

describe("gateway-host bundles guacd", () => {
  const m = "https://mgr.example.com";
  const t = "wss://connect.example.com";
  it("install with gatewayHost includes guacd + network + recordings volume", () => {
    const cmd = buildInstallCommand("CODE123", m, t, true);
    expect(cmd).toContain("--name captivo-guacd");
    expect(cmd).toContain(`--network ${GATEWAY_NETWORK}`);
    expect(cmd).toContain("captivo_guacd_recordings");
    expect(cmd).toContain("guacamole/guacd:1.5.5");
    expect(cmd).toContain("docker run -d --name access-connector");
  });
  it("install without gatewayHost has no guacd", () => {
    const cmd = buildInstallCommand("CODE123", m, t, false);
    expect(cmd).not.toContain("captivo-guacd");
    expect(cmd).not.toContain("guacamole/guacd");
  });
  it("update with gatewayHost re-provisions guacd", () => {
    const cmd = buildConnectorUpdateCommand(m, t, true);
    expect(cmd).toContain("--name captivo-guacd");
    expect(cmd).toContain("docker pull ghcr.io/kurtserdar/captivo-access-connector:latest");
  });
  it("gateway install captures guacd logs to a shared volume", () => {
    const cmd = buildInstallCommand("CODE123", m, t, true);
    expect(cmd).toContain("-v captivo_guacd_logs:/guaclog ");
    expect(cmd).toContain("tee /guaclog/guacd.log");
    expect(cmd).toContain("-v captivo_guacd_logs:/guaclog:ro");
  });
  it("non-gateway install has no guacd log volume", () => {
    const cmd = buildInstallCommand("CODE123", m, t, false);
    expect(cmd).not.toContain("captivo_guacd_logs");
    expect(cmd).not.toContain("/guaclog");
  });
});

describe("install/re-pair pull the newest connector image", () => {
  const m = "https://mgr.example.com";
  const t = "wss://connect.example.com";
  const PULL = "docker pull ghcr.io/kurtserdar/captivo-access-connector:latest";

  it("install pulls latest before running (avoids a stale cached :latest)", () => {
    expect(buildInstallCommand("CODE123", m, t)).toContain(PULL);
    expect(buildInstallCommand("CODE123", m, t, true)).toContain(PULL);
  });
  it("re-pair pulls latest before running", () => {
    expect(buildReconfigureCommand("CODE123", m, t)).toContain(PULL);
  });
  it("update pulls exactly once (no double pull)", () => {
    const cmd = buildConnectorUpdateCommand(m, t, true);
    expect(cmd.split(PULL).length - 1).toBe(1);
  });
});
