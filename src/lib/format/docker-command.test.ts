import { describe, it, expect } from "vitest";
import { formatDockerRun } from "./docker-command";

const CMD =
  "docker run -d --name access-connector --restart unless-stopped -e MANAGER_URL=https://m -e PAIR_CODE=X -v access_connector_data:/data ghcr.io/kurtserdar/captivo-access-connector:latest";

const EXPECTED = `docker run -d \\
  --name access-connector \\
  --restart unless-stopped \\
  -e MANAGER_URL=https://m \\
  -e PAIR_CODE=X \\
  -v access_connector_data:/data \\
  ghcr.io/kurtserdar/captivo-access-connector:latest`;

describe("formatDockerRun", () => {
  it("pretty-prints a docker run one-liner into multiline continuations", () => {
    expect(formatDockerRun(CMD)).toBe(EXPECTED);
  });
  it("keeps boolean flags on line 1 and groups value flags with their values", () => {
    expect(formatDockerRun("docker run -d --name x -e A=1 image:tag")).toBe(
      "docker run -d \\\n  --name x \\\n  -e A=1 \\\n  image:tag",
    );
  });
  it("returns a non-docker string unchanged", () => {
    expect(formatDockerRun("echo hello world")).toBe("echo hello world");
    expect(formatDockerRun("  ")).toBe("  ");
  });
});
