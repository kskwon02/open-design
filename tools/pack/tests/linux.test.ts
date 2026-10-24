import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";

import { findSidecarProcesses, getSidecarStatus, invokeSidecar, stopSidecar } from "@open-design/sidecar";
import {
  APP_KEYS,
  OPEN_DESIGN_SIDECAR_CONTRACT,
  SIDECAR_MESSAGES,
  SIDECAR_MODES,
  SIDECAR_SOURCES,
} from "@open-design/sidecar-proto";
import { describe, expect, it, vi } from "vitest";

const stopSidecarMock = vi.hoisted(() => vi.fn(async (_stamp?: unknown, _options?: unknown) => ({
  alreadyStopped: true,
  forcedPids: [],
  gracefulAccepted: false,
  matchedPids: [],
  remainingPids: [],
  stoppedPids: [],
})));
const stopSidecarsMock = vi.hoisted(() => vi.fn(async (requests: Array<{ options?: unknown; stamp: unknown }>) => {
  const results = await Promise.all(requests.map(async ({ options, stamp }) => ({
    result: await stopSidecarMock(stamp, options),
    stamp,
  })));
  const stopped = results.map(({ result }) => result);
  return {
    alreadyStopped: stopped.every(({ alreadyStopped }) => alreadyStopped),
    forcedPids: [],
    gracefulAccepted: stopped.some(({ gracefulAccepted }) => gracefulAccepted),
    matchedPids: [...new Set(stopped.flatMap(({ matchedPids }) => matchedPids))],
    remainingPids: [...new Set(stopped.flatMap(({ remainingPids }) => remainingPids))],
    results,
    stoppedPids: [...new Set(stopped.flatMap(({ stoppedPids }) => stoppedPids))],
  };
}));

vi.mock("@open-design/sidecar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@open-design/sidecar")>();
  return {
    ...actual,
    findSidecarProcesses: vi.fn(async () => []),
    getSidecarStatus: vi.fn(async () => { throw new Error("status unavailable"); }),
    invokeSidecar: vi.fn(async () => { throw new Error("invoke unavailable"); }),
    stopSidecar: stopSidecarMock,
    stopSidecars: stopSidecarsMock,
  };
});

import type { ToolPackConfig } from "@/config/index.js";
import {
  buildDockerArgs,
  classifyLinuxBuilderArtifacts,
  cleanupPackedLinuxNamespace,
  createLinuxDesktopLaunchEnv,
  inspectPackedLinuxApp,
  LINUX_APPIMAGE_EXECUTABLE_ARGS,
  linuxRpmBuilderOptions,
  matchesAppImageProcess,
  renderDesktopTemplate,
  renderLinuxAppImageAppRun,
  renderLinuxPackagedMainEntry,
  resolveLinuxElectronTargets,
  resolveLinuxLifecycleMode,
  resolveProductionInstallCommand,
  shouldRejectLinuxHeadlessInspectOptions,
  stopPackedLinuxApp,
  sanitizeNamespace,
  stopPackedLinuxHeadless,
} from "@/linux.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function makeConfig(): ToolPackConfig {
  return {
    containerized: true,
    electronBuilderCliPath: "/x/electron-builder/cli.js",
    electronDistPath: "/x/electron/dist",
    electronVersion: "41.3.0",
    macCompression: "normal",
    namespace: "default",
    platform: "linux",
    portable: false,
    removeData: false,
    removeLogs: false,
    removeProductUserData: false,
    removeSidecars: false,
    requireVelaCli: false,
    roots: {
      output: {
        appBuilderRoot: "/work/.tmp/tools-pack/out/linux/namespaces/default/builder",
        namespaceRoot: "/work/.tmp/tools-pack/out/linux/namespaces/default",
        platformRoot: "/work/.tmp/tools-pack/out/linux",
        root: "/work/.tmp/tools-pack/out",
      },
      runtime: {
        namespaceBaseRoot: "/work/.tmp/tools-pack/runtime/linux/namespaces",
        namespaceRoot: "/work/.tmp/tools-pack/runtime/linux/namespaces/default",
      },
      cacheRoot: "/work/.tmp/tools-pack/cache",
      toolPackRoot: "/work/.tmp/tools-pack",
    },
    silent: true,
    signed: false,
    to: "all",
    webOutputMode: "server",
    workspaceRoot: "/work",
  };
}

const linuxOnlyIt = process.platform === "linux" ? it : it.skip;

async function waitForChildExit(child: ChildProcess, timeoutMs = 5000): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("buildDockerArgs", () => {
  it("returns the expected docker argv array", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expect(args).toContain("--user");
    expect(args).toContain("1000:1000");
    expect(args).toContain("electronuserland/builder:base");
  });

  it("mounts the workspace at /project", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    expect(args).toContain("-v");
    expect(args).toContain("/work:/project");
  });

  it("mounts docker home and electron caches under .tmp/tools-pack/.docker-*", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    expect(args).toContain(`${posix.join("/work/.tmp/tools-pack", ".docker-home")}:/home/builder`);
    expect(args).toContain(`${posix.join("/work/.tmp/tools-pack", ".docker-cache", "electron")}:/home/builder/.cache/electron`);
    expect(args).toContain(
      `${posix.join("/work/.tmp/tools-pack", ".docker-cache", "electron-builder")}:/home/builder/.cache/electron-builder`,
    );
  });

  it("mounts the tool-pack root at /tools-pack so inner build writes to host-visible output dir", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    expect(args).toContain("/work/.tmp/tools-pack:/tools-pack");
  });

  it("sets HOME and ELECTRON_CACHE env vars", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    expect(args).toContain("HOME=/home/builder");
    expect(args).toContain("ELECTRON_CACHE=/home/builder/.cache/electron");
    expect(args).toContain("ELECTRON_BUILDER_CACHE=/home/builder/.cache/electron-builder");
  });

  it("passes the telemetry relay URL into containerized builds when configured", () => {
    const args = buildDockerArgs(
      {
        ...makeConfig(),
        telemetryRelayUrl: "https://telemetry.open-design.ai/api/langfuse",
      },
      { uid: 1000, gid: 1000 },
    );
    expect(args).toContain("OPEN_DESIGN_TELEMETRY_RELAY_URL=https://telemetry.open-design.ai/api/langfuse");
  });

  it("passes the AMR profile into containerized builds when configured", () => {
    const args = buildDockerArgs(
      {
        ...makeConfig(),
        amrProfile: "test",
      },
      { uid: 1000, gid: 1000 },
    );
    expect(args).toContain("OPEN_DESIGN_AMR_PROFILE=test");
  });

  it("bind-mounts the host Vela binary directory and rewrites the env path into the container", () => {
    const previous = process.env.OPEN_DESIGN_VELA_CLI_BIN;
    process.env.OPEN_DESIGN_VELA_CLI_BIN = "/host/bin/vela";
    try {
      const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
      // The container only mounts /project, /tools-pack, and cache/home by
      // default — a host-path env value like `/host/bin/vela` would resolve
      // to a non-existent path inside. The directory must be bind-mounted
      // and the env rewritten to the container-side path so the resource
      // copier can actually read the binary.
      expect(args).toContain("/host/bin:/opt/vela-cli:ro");
      expect(args).toContain("OPEN_DESIGN_VELA_CLI_BIN=/opt/vela-cli/vela");
      expect(args).not.toContain("OPEN_DESIGN_VELA_CLI_BIN=/host/bin/vela");
    } finally {
      if (previous === undefined) delete process.env.OPEN_DESIGN_VELA_CLI_BIN;
      else process.env.OPEN_DESIGN_VELA_CLI_BIN = previous;
    }
  });

  it("runs the built tools-pack CLI through node inside the container without generated package-bin shims", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    const last = args[args.length - 1];
    expect(last).toMatch(/command -v curl >\/dev\/null/);
    expect(last).toMatch(/case "\$\(uname -m\)" in/);
    expect(last).toMatch(/x86_64\) PNPM_ASSET=pnpm-linuxstatic-x64; PNPM_SHA256=[a-f0-9]{64}/);
    expect(last).toMatch(/aarch64\) PNPM_ASSET=pnpm-linuxstatic-arm64; PNPM_SHA256=[a-f0-9]{64}/);
    expect(last).toMatch(
      /curl --retry 3 --retry-all-errors --connect-timeout 10 --max-time 60 -fsSL "https:\/\/github\.com\/pnpm\/pnpm\/releases\/download\/v\d+\.\d+\.\d+\/\$PNPM_ASSET" -o \/tmp\/pnpm\.tmp/,
    );
    expect(last).toMatch(/echo "\$PNPM_SHA256  \/tmp\/pnpm\.tmp" \| sha256sum -c -/);
    expect(last).toMatch(/mv \/tmp\/pnpm\.tmp \/tmp\/pnpm/);
    expect(last).toMatch(/chmod \+x \/tmp\/pnpm/);
    expect(last).toMatch(/\/tmp\/pnpm env use --global 24\.\d+\.\d+/);
    expect(last).toMatch(/\/tmp\/pnpm install --frozen-lockfile/);
    expect(last).toMatch(/node tools\/pack\/bin\/tools-pack\.mjs linux build --to all --namespace default/);
    expect(last).not.toMatch(/\/tmp\/pnpm tools-pack linux build/);
    expect(last).not.toMatch(/--containerized/);
  });

  it("fetches pnpm standalone binary instead of relying on image npm tooling", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    const last = args[args.length - 1];
    expect(last).not.toMatch(/corepack/);
    expect(last).not.toMatch(/\bnpx\b/);
    expect(last).not.toMatch(/(^|[;&|]\s*)npm(\s|$)/);
    expect(last).toMatch(/pnpm-linuxstatic-x64/);
    expect(last).toMatch(/pnpm-linuxstatic-arm64/);
  });

  it("routes container setup and install output to stderr before the JSON-emitting build", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    const last = args[args.length - 1];
    expect(last).toContain("{ command -v curl");
    expect(last).toContain("/tmp/pnpm install --frozen-lockfile; } >&2 && node tools/pack/bin/tools-pack.mjs linux build");
    expect(last.indexOf("/tmp/pnpm install --frozen-lockfile")).toBeLessThan(
      last.indexOf("} >&2 && node tools/pack/bin/tools-pack.mjs linux build"),
    );
  });

  it("picks the pnpm asset by container CPU so amd64 and arm64 hosts both work", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    const last = args[args.length - 1];
    expect(last).toContain('case "$(uname -m)" in');
    expect(last).toContain("x86_64) PNPM_ASSET=pnpm-linuxstatic-x64");
    expect(last).toContain("aarch64) PNPM_ASSET=pnpm-linuxstatic-arm64");
    expect(last).toMatch(/unsupported container arch/);
  });

  it("verifies the downloaded standalone pnpm binary before executing it", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    const last = args[args.length - 1];
    expect(last).toMatch(/PNPM_SHA256=[a-f0-9]{64}/);
    expect(last).toMatch(/sha256sum -c -/);
    expect(last).toMatch(/\/tmp\/pnpm\.tmp/);
    expect(last.indexOf("sha256sum -c -")).toBeLessThan(last.indexOf("mv /tmp/pnpm.tmp /tmp/pnpm"));
    expect(last.indexOf("mv /tmp/pnpm.tmp /tmp/pnpm")).toBeLessThan(last.indexOf("chmod +x /tmp/pnpm"));
  });

  it("hardcoded pnpm version stays in lockstep with root package.json `packageManager`", () => {
    // Guard against silent drift: if someone bumps packageManager in the
    // root package.json but forgets to update PNPM_VERSION in linux.ts,
    // the Linux container build would silently keep downloading the old pnpm.
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
      packageManager?: string;
    };
    const match = String(rootPkg.packageManager ?? "").match(/^pnpm@(\d+\.\d+\.\d+)$/);
    expect(match, `expected root packageManager "pnpm@x.y.z", got ${rootPkg.packageManager}`).not.toBeNull();
    const expectedVersion = match![1];

    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    const last = args[args.length - 1];
    expect(last).toContain(`pnpm/releases/download/v${expectedVersion}/$PNPM_ASSET`);
  });

  it("container Node major stays in lockstep with root .node-version", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const expectedMajor = readFileSync(join(repoRoot, ".node-version"), "utf-8").trim();
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    const last = args[args.length - 1];
    const match = last.match(/\/tmp\/pnpm env use --global (\d+)\.\d+\.\d+/);
    expect(match, "expected container bootstrap to install an explicit Node version").not.toBeNull();
    expect(match?.[1]).toBe(expectedMajor);
  });

  it("forwards --dir /tools-pack so inner build output lands under the mounted host dir", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    const last = args[args.length - 1];
    expect(last).toMatch(/--dir \/tools-pack/);
  });

  it("forwards --portable when config.portable is true", () => {
    const args = buildDockerArgs({ ...makeConfig(), portable: true }, { uid: 1000, gid: 1000 });
    const last = args[args.length - 1];
    expect(last).toMatch(/--portable/);
  });

  it("forwards --require-vela-cli to the inner containerized build when strict packaging is requested", () => {
    const args = buildDockerArgs({ ...makeConfig(), requireVelaCli: true }, { uid: 1000, gid: 1000 });
    const last = args[args.length - 1];
    expect(last).toMatch(/--require-vela-cli/);
  });

  it("omits --require-vela-cli from containerized builds by default", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    const last = args[args.length - 1];
    expect(last).not.toMatch(/--require-vela-cli/);
  });

  it("omits --portable when config.portable is false", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    const last = args[args.length - 1];
    expect(last).not.toMatch(/--portable/);
  });

  it("forwards a shell-quoted --app-version to the inner build", () => {
    const args = buildDockerArgs(
      { ...makeConfig(), appVersion: "0.5.0-beta.1;echo-nope" },
      { uid: 1000, gid: 1000 },
    );
    const last = args[args.length - 1];
    expect(last).toContain("--app-version '0.5.0-beta.1;echo-nope'");
  });

  it("shell-quotes apostrophes in --app-version", () => {
    const args = buildDockerArgs(
      { ...makeConfig(), appVersion: "0.5.0-beta.1'quoted" },
      { uid: 1000, gid: 1000 },
    );
    const last = args[args.length - 1];
    expect(last).toContain("--app-version '0.5.0-beta.1'\\''quoted'");
  });

  it("exports OD_TOOLS_PACK_PNPM_BIN=/tmp/pnpm so the inner build's production install skips npm", () => {
    const args = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    const envFlagIndex = args.findIndex(
      (arg, i) => arg === "-e" && args[i + 1] === "OD_TOOLS_PACK_PNPM_BIN=/tmp/pnpm",
    );
    expect(envFlagIndex).toBeGreaterThan(-1);
  });
});

describe("stopPackedLinuxHeadless", () => {
  it("ignores the desktop AppImage identity marker and reads only the headless marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-linux-headless-marker-"));
    const namespace = "marker-split";
    const namespaceRoot = join(root, "runtime", "linux", "namespaces", namespace);
    const config: ToolPackConfig = {
      ...makeConfig(),
      namespace,
      roots: {
        ...makeConfig().roots,
        runtime: {
          namespaceBaseRoot: join(root, "runtime", "linux", "namespaces"),
          namespaceRoot,
        },
      },
    };
    const markerPath = join(namespaceRoot, "runtime", "desktop-root.json");
    const stamp = {
      app: APP_KEYS.DESKTOP,
      ipc: "/deprecated-derived-identity",
      mode: SIDECAR_MODES.RUNTIME,
      namespace,
      source: SIDECAR_SOURCES.PACKAGED,
    };

    try {
      await mkdir(dirname(markerPath), { recursive: true });
      await writeFile(
        markerPath,
        `${JSON.stringify({
          appPath: "/tmp/Open-Design.AppImage",
          executablePath: "/tmp/.mount_od/AppRun",
          logPath: join(namespaceRoot, "logs", "desktop", "latest.log"),
          namespaceRoot,
          pid: Number.MAX_SAFE_INTEGER,
          ppid: 1,
          stamp,
          startedAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          version: 1,
        })}\n`,
        "utf8",
      );

      const result = await stopPackedLinuxHeadless(config);

      expect(result.status).toBe("not-running");
      expect(result.fallback).toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("removes stale desktop AppImage markers during headless cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-linux-headless-cleanup-"));
    const namespace = "cleanup-split";
    const namespaceRoot = join(root, "runtime", "linux", "namespaces", namespace);
    const config: ToolPackConfig = {
      ...makeConfig(),
      namespace,
      roots: {
        ...makeConfig().roots,
        output: {
          ...makeConfig().roots.output,
          namespaceRoot: join(root, "out", "linux", "namespaces", namespace),
        },
        runtime: {
          namespaceBaseRoot: join(root, "runtime", "linux", "namespaces"),
          namespaceRoot,
        },
      },
    };
    const markerPath = join(namespaceRoot, "runtime", "desktop-root.json");
    const stamp = {
      app: APP_KEYS.DESKTOP,
      ipc: "/deprecated-derived-identity",
      mode: SIDECAR_MODES.RUNTIME,
      namespace,
      source: SIDECAR_SOURCES.PACKAGED,
    };

    try {
      await mkdir(dirname(markerPath), { recursive: true });
      await writeFile(
        markerPath,
        `${JSON.stringify({
          appPath: "/tmp/Open-Design.AppImage",
          executablePath: "/tmp/.mount_od/AppRun",
          logPath: join(namespaceRoot, "logs", "desktop", "latest.log"),
          namespaceRoot,
          pid: Number.MAX_SAFE_INTEGER,
          ppid: 1,
          stamp,
          startedAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          version: 1,
        })}\n`,
        "utf8",
      );
      await mkdir(config.roots.output.namespaceRoot, { recursive: true });

      const result = await cleanupPackedLinuxNamespace(config, { headless: true });

      expect(result.skipped).toBe(false);
      expect(result.removedOutputRoot).toBe(true);
      expect(result.removedRuntimeNamespaceRoot).toBe(true);
      expect(await pathExists(markerPath)).toBe(false);
      expect(await pathExists(namespaceRoot)).toBe(false);
      expect(await pathExists(config.roots.output.namespaceRoot)).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("skips headless cleanup while the desktop marker PID is live in the snapshot table", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-linux-headless-cleanup-live-"));
    const namespace = "cleanup-split-live";
    const namespaceRoot = join(root, "runtime", "linux", "namespaces", namespace);
    const config: ToolPackConfig = {
      ...makeConfig(),
      namespace,
      roots: {
        ...makeConfig().roots,
        output: {
          ...makeConfig().roots.output,
          namespaceRoot: join(root, "out", "linux", "namespaces", namespace),
        },
        runtime: {
          namespaceBaseRoot: join(root, "runtime", "linux", "namespaces"),
          namespaceRoot,
        },
      },
    };
    try {
      vi.mocked(findSidecarProcesses).mockImplementation(async (stamp) =>
        stamp.mode === SIDECAR_MODES.RUNTIME ? [{ command: "desktop", pid: process.pid, ppid: 1 }] : [],
      );
      await mkdir(namespaceRoot, { recursive: true });
      await mkdir(config.roots.output.namespaceRoot, { recursive: true });

      const result = await cleanupPackedLinuxNamespace(config, { headless: true });

      expect(result.skipped).toBe(true);
      expect(result.removedOutputRoot).toBe(false);
      expect(result.removedRuntimeNamespaceRoot).toBe(false);
      expect(await pathExists(namespaceRoot)).toBe(true);
      expect(await pathExists(config.roots.output.namespaceRoot)).toBe(true);
    } finally {
      vi.mocked(findSidecarProcesses).mockResolvedValue([]);
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("stopPackedLinuxApp", () => {
  it("stops both exact launch sources without consulting derived files", async () => {
    const stop = vi.mocked(stopSidecar);
    stop.mockClear();
    stop.mockResolvedValue({
      alreadyStopped: true,
      forcedPids: [],
      gracefulAccepted: false,
      matchedPids: [],
      remainingPids: [],
      stoppedPids: [],
    });
    await expect(stopPackedLinuxApp(makeConfig())).resolves.toMatchObject({ status: "not-running" });
    expect(stop).toHaveBeenCalledTimes(12);
    expect(stop).toHaveBeenCalledWith(
      expect.objectContaining({ source: SIDECAR_SOURCES.TOOLS_PACK }),
      undefined,
    );
    expect(stop).toHaveBeenCalledWith(
      expect.objectContaining({ source: SIDECAR_SOURCES.PACKAGED }),
      undefined,
    );
  });
});

describe("resolveProductionInstallCommand", () => {
  it("defaults to npm install --omit=dev --no-package-lock when OD_TOOLS_PACK_PNPM_BIN is unset", () => {
    expect(resolveProductionInstallCommand({})).toEqual({
      command: "npm",
      args: ["install", "--omit=dev", "--no-package-lock"],
    });
  });

  it("treats an empty OD_TOOLS_PACK_PNPM_BIN as unset and keeps the npm host default", () => {
    expect(resolveProductionInstallCommand({ OD_TOOLS_PACK_PNPM_BIN: "" })).toEqual({
      command: "npm",
      args: ["install", "--omit=dev", "--no-package-lock"],
    });
  });

  it("uses OD_TOOLS_PACK_PNPM_BIN with hoisted-layout pnpm flags when set", () => {
    // --config.node-linker=hoisted intentionally matches the prior
    // npm/electron-builder packaging layout so the AppImage pack step keeps
    // working when the assembled-app install runs through pnpm.
    expect(
      resolveProductionInstallCommand({ OD_TOOLS_PACK_PNPM_BIN: "/tmp/pnpm" }),
    ).toEqual({
      command: "/tmp/pnpm",
      args: ["install", "--prod", "--no-lockfile", "--config.node-linker=hoisted"],
    });
  });

  it("chains end-to-end with buildDockerArgs: docker exports OD_TOOLS_PACK_PNPM_BIN and the resolver returns the standalone pnpm install for that value", () => {
    const dockerArgs = buildDockerArgs(makeConfig(), { uid: 1000, gid: 1000 });
    const envFlagIndex = dockerArgs.findIndex(
      (arg, i) => arg === "-e" && dockerArgs[i + 1]?.startsWith("OD_TOOLS_PACK_PNPM_BIN="),
    );
    expect(envFlagIndex).toBeGreaterThan(-1);
    const envValue = dockerArgs[envFlagIndex + 1]?.split("=")[1];
    expect(envValue).toBe("/tmp/pnpm");

    const resolved = resolveProductionInstallCommand({ OD_TOOLS_PACK_PNPM_BIN: envValue });
    expect(resolved).toEqual({
      command: "/tmp/pnpm",
      args: ["install", "--prod", "--no-lockfile", "--config.node-linker=hoisted"],
    });
    expect(resolved.command).not.toBe("npm");
  });
});

describe("renderDesktopTemplate", () => {
  const template = `[Desktop Entry]
Type=Application
Name=Open Design (@@NAMESPACE@@)
Exec=env -u ELECTRON_RUN_AS_NODE OD_PACKAGED_NAMESPACE=@@NAMESPACE@@ @@EXEC_PATH@@ %U
Icon=@@ICON_PATH@@
MimeType=x-scheme-handler/od;
`;

  it("substitutes all @@TOKEN@@ placeholders", () => {
    const out = renderDesktopTemplate(template, {
      namespace: "default",
      execPath: "/home/u/.local/bin/Open-Design.default.AppImage",
      iconName: "open-design-default",
    });
    expect(out).toContain("Name=Open Design (default)");
    expect(out).toContain(
      "Exec=env -u ELECTRON_RUN_AS_NODE OD_PACKAGED_NAMESPACE=default /home/u/.local/bin/Open-Design.default.AppImage %U",
    );
    expect(out).toContain("Icon=open-design-default");
  });

  it("uses OD_PACKAGED_NAMESPACE (not OD_NAMESPACE) so apps/packaged actually picks up the namespace override", () => {
    const out = renderDesktopTemplate(template, {
      namespace: "ns",
      execPath: "/x",
      iconName: "open-design-ns",
    });
    expect(out).toMatch(/^Exec=env -u ELECTRON_RUN_AS_NODE OD_PACKAGED_NAMESPACE=ns /m);
    expect(out).not.toMatch(/OD_NAMESPACE=/);
  });

  it("unsets ELECTRON_RUN_AS_NODE on the Exec= line so desktop launches run Electron normally", () => {
    const out = renderDesktopTemplate(template, {
      namespace: "ns",
      execPath: "/x",
      iconName: "open-design-ns",
    });
    expect(out).toMatch(/^Exec=env -u ELECTRON_RUN_AS_NODE /m);
  });

  it("does not force --appimage-extract-and-run on every menu launch", () => {
    const out = renderDesktopTemplate(template, {
      namespace: "ns",
      execPath: "/x",
      iconName: "open-design-ns",
    });
    expect(out).not.toContain("--appimage-extract-and-run");
  });

  it("leaves no @@...@@ tokens unsubstituted", () => {
    const out = renderDesktopTemplate(template, {
      namespace: "ns",
      execPath: "/x",
      iconName: "open-design-ns",
    });
    expect(out).not.toMatch(/@@[A-Z_]+@@/);
  });

  it("preserves the MimeType=x-scheme-handler/od; line", () => {
    const out = renderDesktopTemplate(template, {
      namespace: "ns",
      execPath: "/x",
      iconName: "open-design-ns",
    });
    expect(out).toContain("MimeType=x-scheme-handler/od;");
  });
});

describe("renderLinuxPackagedMainEntry", () => {
  it("loads the ESM packaged entry without require or temporary keepalive handles", () => {
    const out = renderLinuxPackagedMainEntry();

    expect(out).toContain('import("@open-design/packaged")');
    expect(out).not.toContain('require("@open-design/packaged")');
    expect(out).not.toContain("setTimeout");
  });
});

describe("LINUX_APPIMAGE_EXECUTABLE_ARGS", () => {
  it("keeps the AppImage no-sandbox fallback explicit for constrained Linux hosts", () => {
    expect([...LINUX_APPIMAGE_EXECUTABLE_ARGS]).toEqual(["--no-sandbox"]);
  });
});

describe("resolveLinuxElectronTargets", () => {
  it("keeps `all` on the single release-published AppImage target", () => {
    expect(resolveLinuxElectronTargets("all")).toEqual(["AppImage"]);
    expect(resolveLinuxElectronTargets("appimage")).toEqual(["AppImage"]);
  });

  it("maps the native rpm target and the unpacked dir target", () => {
    expect(resolveLinuxElectronTargets("rpm")).toEqual(["rpm"]);
    expect(resolveLinuxElectronTargets("dir")).toEqual(["dir"]);
  });

  it("rejects deb and build outputs that belong to other platforms", () => {
    expect(() => resolveLinuxElectronTargets("deb" as never)).toThrow(/unsupported linux build output: deb/);
    expect(() => resolveLinuxElectronTargets("dmg")).toThrow(/unsupported linux build output: dmg/);
    expect(() => resolveLinuxElectronTargets("nsis")).toThrow(/unsupported linux build output: nsis/);
  });
});

describe("linuxRpmBuilderOptions", () => {
  it("pins fpm's single-threaded xz encoder for RPM payloads", () => {
    expect(linuxRpmBuilderOptions(["rpm"])).toEqual({
      fpm: ["--rpm-compression", "xz"],
    });
  });

  it("leaves non-RPM targets on electron-builder's default", () => {
    expect(linuxRpmBuilderOptions(["dir"])).toBeNull();
    expect(linuxRpmBuilderOptions(["AppImage"])).toBeNull();
  });
});

describe("classifyLinuxBuilderArtifacts", () => {
  it("finds every artifact kind in one output directory", () => {
    const root = "/work/out/linux/namespaces/default/builder";

    expect(classifyLinuxBuilderArtifacts(
      ["Open Design-default.AppImage", "Open Design-default.deb", "Open Design-default.rpm", "builder-debug.yml"],
      root,
    )).toEqual({
      appImage: join(root, "Open Design-default.AppImage"),
      deb: join(root, "Open Design-default.deb"),
      rpm: join(root, "Open Design-default.rpm"),
    });
  });

  it("returns nulls for artifact kinds that were not built", () => {
    expect(classifyLinuxBuilderArtifacts(["Open Design-default.deb"], "/out")).toEqual({
      appImage: null,
      deb: "/out/Open Design-default.deb",
      rpm: null,
    });
    expect(classifyLinuxBuilderArtifacts([], "/out")).toEqual({
      appImage: null,
      deb: null,
      rpm: null,
    });
  });
});

describe("renderLinuxAppImageAppRun", () => {
  it("unsets ELECTRON_RUN_AS_NODE before execing the Electron binary", () => {
    const out = renderLinuxAppImageAppRun();

    expect(out).toContain("unset ELECTRON_RUN_AS_NODE");
    expect(out.indexOf("unset ELECTRON_RUN_AS_NODE")).toBeLessThan(out.indexOf('exec "$BIN"'));
    expect(out).toContain('BIN="$APPDIR/Open Design"');
  });

  it("preserves AppImageLauncher install-only behavior", () => {
    const out = renderLinuxAppImageAppRun();

    expect(out).toContain('if [ -z "$APPIMAGE_EXIT_AFTER_INSTALL" ] ; then');
    expect(out).toContain("trap atexit EXIT");
  });

  it("passes desktop Exec arguments through to Electron", () => {
    const out = renderLinuxAppImageAppRun();

    expect(out).toContain('args=("$@")');
    expect(out).toContain('exec "$BIN" "${args[@]}"');
  });

  it("sets APPIMAGE when running an extracted AppRun directly", () => {
    const out = renderLinuxAppImageAppRun();

    expect(out).toContain('APPIMAGE="$APPDIR/AppRun"');
  });

  linuxOnlyIt("exports APPIMAGE fallback to the execed Electron process", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-linux-apprun-export-"));
    const appDir = join(root, "AppDir");
    const appRunPath = join(appDir, "AppRun");
    const observedEnvPath = join(root, "observed-env.txt");
    const electronPath = join(appDir, "Open Design");

    try {
      await mkdir(appDir, { recursive: true });
      await writeFile(appRunPath, renderLinuxAppImageAppRun(), "utf8");
      await chmod(appRunPath, 0o755);
      await writeFile(
        electronPath,
        `#!/bin/bash
{
  printf 'APPIMAGE=%s\\n' "$APPIMAGE"
  printf 'ELECTRON_RUN_AS_NODE=%s\\n' "\${ELECTRON_RUN_AS_NODE-unset}"
} > ${JSON.stringify(observedEnvPath)}
`,
        "utf8",
      );
      await chmod(electronPath, 0o755);

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        APPDIR: appDir,
        ELECTRON_RUN_AS_NODE: "1",
      };
      delete env.APPIMAGE;
      const child = spawn(appRunPath, [], { env, stdio: "ignore" });
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });

      expect(exit).toEqual({ code: 0, signal: null });
      expect(await readFile(observedEnvPath, "utf8")).toBe(
        `APPIMAGE=${appRunPath}\nELECTRON_RUN_AS_NODE=unset\n`,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("renderLinuxAppImageAppRun sandbox policy", () => {
  async function observeElectronArgs(options: {
    args?: string[];
    env?: NodeJS.ProcessEnv;
    usernsProbeExitCode?: number;
  }): Promise<string[]> {
    const root = await mkdtemp(join(tmpdir(), "od-linux-apprun-sandbox-"));
    const appDir = join(root, "AppDir");
    const binDir = join(root, "bin");
    const appRunPath = join(appDir, "AppRun");
    const electronPath = join(appDir, "Open Design");
    const argsPath = join(root, "args.txt");

    try {
      await mkdir(appDir, { recursive: true });
      await mkdir(binDir, { recursive: true });
      await writeFile(appRunPath, renderLinuxAppImageAppRun(), "utf8");
      await chmod(appRunPath, 0o755);
      await writeFile(
        join(binDir, "unshare"),
        `#!/bin/bash\nexit ${options.usernsProbeExitCode ?? 0}\n`,
        "utf8",
      );
      await chmod(join(binDir, "unshare"), 0o755);
      await writeFile(
        electronPath,
        `#!/bin/bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argsPath)}\n`,
        "utf8",
      );
      await chmod(electronPath, 0o755);

      const isolatedEnv: NodeJS.ProcessEnv = { ...process.env };
      delete isolatedEnv.OD_LINUX_SANDBOX;
      delete isolatedEnv.APPIMAGE;
      delete isolatedEnv.OD_APPIMAGE_EXTRACTED_RUN;

      const child = spawn(appRunPath, options.args ?? [], {
        env: {
          ...isolatedEnv,
          APPDIR: appDir,
          PATH: `${binDir}:/usr/bin:/bin`,
          ...options.env,
        },
        stdio: "ignore",
      });
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });

      expect(exit).toEqual({ code: 0, signal: null });
      const raw = await readFile(argsPath, "utf8");
      return raw.length === 0 ? [] : raw.trimEnd().split("\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }

  it("keeps the sandbox when unprivileged user namespaces work", async () => {
    await expect(observeElectronArgs({ args: ["--flag"], usernsProbeExitCode: 0 }))
      .resolves.toEqual(["--flag"]);
  });

  it("strips --no-sandbox from desktop-entry launches when the sandbox works", async () => {
    await expect(observeElectronArgs({ args: ["--no-sandbox", "--flag"], usernsProbeExitCode: 0 }))
      .resolves.toEqual(["--flag"]);
  });

  it("adds --no-sandbox when the user namespace probe fails", async () => {
    await expect(observeElectronArgs({ args: ["--flag"], usernsProbeExitCode: 1 }))
      .resolves.toEqual(["--flag", "--no-sandbox"]);
  });

  it("does not duplicate an explicit --no-sandbox fallback", async () => {
    await expect(observeElectronArgs({ args: ["--no-sandbox"], usernsProbeExitCode: 1 }))
      .resolves.toEqual(["--no-sandbox"]);
  });

  it("honors OD_LINUX_SANDBOX=off on hosts where the probe would pass", async () => {
    await expect(observeElectronArgs({
      args: ["--flag"],
      env: { OD_LINUX_SANDBOX: "off" },
      usernsProbeExitCode: 0,
    })).resolves.toEqual(["--flag", "--no-sandbox"]);
  });

  it("honors OD_LINUX_SANDBOX=on on hosts where the probe would fail", async () => {
    await expect(observeElectronArgs({
      args: ["--no-sandbox", "--flag"],
      env: { OD_LINUX_SANDBOX: "on" },
      usernsProbeExitCode: 1,
    })).resolves.toEqual(["--flag"]);
  });
});

describe("renderLinuxAppImageAppRun cache", () => {
  type CacheHarness = {
    appRunPath: string;
    argsPath: string;
    cacheRoot: string;
    envPath: string;
    extractMarkerPath: string;
    fallbackArgsPath: string;
    fuseAppDir: string;
    root: string;
    runtimePath: string;
    run: (options?: { args?: string[]; env?: NodeJS.ProcessEnv }) => Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      stderr: string;
    }>;
    writeCachedAppRun: (body?: string) => Promise<void>;
    writeRuntime: (body: string) => Promise<void>;
  };

  const extractionRuntimeBody = `if [ "$1" = "--appimage-extract" ] ; then
  mkdir -p squashfs-root
  cp "$OD_TEST_CACHED_APPRUN" squashfs-root/AppRun
  chmod +x squashfs-root/AppRun
  printf 'extracted\\n' >> "$OD_TEST_EXTRACT_MARKER"
  exit 0
fi
printf 'runtime-called\\n' >> "$OD_TEST_EXTRACT_MARKER"
exit 97
`;

  async function createHarness(): Promise<CacheHarness> {
    const root = await mkdtemp(join(tmpdir(), "od-linux-apprun-cache-"));
    const fuseAppDir = join(root, "mount", ".mount_odcache");
    const appRunPath = join(root, "AppRun");
    const runtimePath = join(root, "Open Design-default.AppImage");
    const cachedAppRunPath = join(root, "cached-AppRun");
    const cacheRoot = join(root, "cache");
    const argsPath = join(root, "args.txt");
    const envPath = join(root, "env.txt");
    const extractMarkerPath = join(root, "extract-marker.txt");
    const fallbackArgsPath = join(root, "fallback-args.txt");

    await mkdir(fuseAppDir, { recursive: true });
    await writeFile(appRunPath, renderLinuxAppImageAppRun(), "utf8");
    await chmod(appRunPath, 0o755);

    const writeCachedAppRun = async (
      body = `#!/bin/bash\nprintf '%s\\n' "$@" > "$OD_TEST_ARGS_PATH"\nprintf 'APPDIR=%s\\nAPPIMAGE=%s\\n' "$APPDIR" "$APPIMAGE" > "$OD_TEST_ENV_PATH"\n`,
    ) => {
      await writeFile(cachedAppRunPath, body, "utf8");
      await chmod(cachedAppRunPath, 0o755);
    };

    const writeRuntime = async (body: string) => {
      await writeFile(runtimePath, `#!/bin/bash\n${body}`, "utf8");
      await chmod(runtimePath, 0o755);
    };

    const run = async (options: { args?: string[]; env?: NodeJS.ProcessEnv } = {}) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        APPDIR: fuseAppDir,
        APPIMAGE: runtimePath,
        XDG_CACHE_HOME: cacheRoot,
        OD_TEST_ARGS_PATH: argsPath,
        OD_TEST_ENV_PATH: envPath,
        OD_TEST_EXTRACT_MARKER: extractMarkerPath,
        OD_TEST_FALLBACK_ARGS_PATH: fallbackArgsPath,
        OD_TEST_CACHED_APPRUN: cachedAppRunPath,
      };
      delete env.OD_APPIMAGE_EXTRACTED_RUN;
      Object.assign(env, options.env);

      const child = spawn(appRunPath, options.args ?? [], {
        env,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once("error", reject);
        // Wait for stdio to drain so stderr assertions see every byte.
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      return { ...exit, stderr };
    };

    return {
      appRunPath,
      argsPath,
      cacheRoot,
      envPath,
      extractMarkerPath,
      fallbackArgsPath,
      fuseAppDir,
      root,
      runtimePath,
      run,
      writeCachedAppRun,
      writeRuntime,
    };
  }

  it("no longer re-execs every FUSE launch through the runtime extractor", () => {
    const out = renderLinuxAppImageAppRun();

    expect(out).not.toContain('exec "$APPIMAGE" --appimage-extract-and-run');
    expect(out).toContain('"$APPIMAGE" --appimage-extract >extract.log');
    expect(out).toContain("XDG_CACHE_HOME");
  });

  it("uses a non-blocking launch lock instead of a timed wait", () => {
    const out = renderLinuxAppImageAppRun();

    expect(out).toContain('exec 8>"$cache_dir.lock"');
    expect(out).toContain("flock -n 8");
    expect(out).toContain("Open Design is already running");
    expect(out).not.toContain("flock -w 600");
  });

  async function waitForFileText(path: string, expected: string, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if ((await readFile(path, "utf8")) === expected) return;
      } catch {
        // The cached AppRun writes the marker after the lock is acquired.
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`timed out waiting for ${path} to contain ${JSON.stringify(expected)}`);
  }

  linuxOnlyIt("exits a second launch while the first holds the desktop lock", async () => {
    const harness = await createHarness();

    try {
      await harness.writeCachedAppRun(
        `#!/bin/bash\nprintf 'started\\n' >> "$OD_TEST_ARGS_PATH"\nsleep 2\n`,
      );
      await harness.writeRuntime(extractionRuntimeBody);

      const first = harness.run({ args: ["--first"] });
      await waitForFileText(harness.argsPath, "started\n");

      const second = await harness.run({ args: ["--second"] });
      expect(second).toMatchObject({ code: 0, signal: null });
      expect(second.stderr).toContain("Open Design is already running");
      expect(await readFile(harness.argsPath, "utf8")).toBe("started\n");

      const firstResult = await first;
      expect(firstResult).toMatchObject({ code: 0, signal: null });
    } finally {
      await rm(harness.root, { force: true, recursive: true });
    }
  });

  linuxOnlyIt("extracts once into XDG_CACHE_HOME and reuses the cached AppRun", async () => {
    const harness = await createHarness();

    try {
      await harness.writeCachedAppRun();
      await harness.writeRuntime(extractionRuntimeBody);

      const first = await harness.run({ args: ["--user-flag"] });
      expect(first).toMatchObject({ code: 0, signal: null });
      expect(await readFile(harness.extractMarkerPath, "utf8")).toBe("extracted\n");
      expect(await readFile(harness.argsPath, "utf8")).toBe("--user-flag\n");
      const cachedEnv = await readFile(harness.envPath, "utf8");
      expect(cachedEnv).toContain(`APPDIR=${join(harness.cacheRoot, "open-design", "appimage")}`);
      expect(cachedEnv).toContain(`APPIMAGE=${harness.runtimePath}`);

      // A warm cache must not invoke the runtime at all; the same script
      // records a non-extract invocation, so its absence proves the cache hit.
      const second = await harness.run({ args: ["--second-flag"] });
      expect(second).toMatchObject({ code: 0, signal: null });
      expect(await readFile(harness.extractMarkerPath, "utf8")).toBe("extracted\n");
      expect(await readFile(harness.argsPath, "utf8")).toBe("--second-flag\n");
    } finally {
      await rm(harness.root, { force: true, recursive: true });
    }
  });

  linuxOnlyIt("keys the cache on the AppImage identity so a replaced file re-extracts", async () => {
    const harness = await createHarness();

    try {
      await harness.writeCachedAppRun();
      await harness.writeRuntime(extractionRuntimeBody);
      await harness.run({ args: ["--first"] });
      expect(await readFile(harness.extractMarkerPath, "utf8")).toBe("extracted\n");

      // Changing the runtime's size changes the cache key.
      await harness.writeRuntime(`${extractionRuntimeBody}\n# rebuilt\n`);
      await harness.run({ args: ["--second"] });
      expect(await readFile(harness.extractMarkerPath, "utf8")).toBe("extracted\nextracted\n");
      expect(await readFile(harness.argsPath, "utf8")).toBe("--second\n");
    } finally {
      await rm(harness.root, { force: true, recursive: true });
    }
  });

  linuxOnlyIt("falls back to the mounted payload when extraction fails", async () => {
    const harness = await createHarness();

    try {
      await harness.writeRuntime("exit 1\n");
      await writeFile(
        join(harness.fuseAppDir, "Open Design"),
        `#!/bin/bash\nprintf '%s\\n' "$@" > "$OD_TEST_FALLBACK_ARGS_PATH"\n`,
        "utf8",
      );
      await chmod(join(harness.fuseAppDir, "Open Design"), 0o755);

      const result = await harness.run({
        args: ["--flag"],
        env: { OD_LINUX_SANDBOX: "on" },
      });
      expect(result).toMatchObject({ code: 0, signal: null });
      expect(await readFile(harness.fallbackArgsPath, "utf8")).toBe("--flag\n");
      expect(result.stderr).toContain("could not prepare the AppImage cache");
    } finally {
      await rm(harness.root, { force: true, recursive: true });
    }
  });

  linuxOnlyIt("does not re-enter the cache when the runtime already extracted", async () => {
    const harness = await createHarness();

    try {
      await harness.writeRuntime(`printf 'runtime-called\\n' >> "$OD_TEST_EXTRACT_MARKER"\nexit 97\n`);
      await writeFile(
        join(harness.fuseAppDir, "Open Design"),
        `#!/bin/bash\nprintf '%s\\n' "$@" > "$OD_TEST_FALLBACK_ARGS_PATH"\n`,
        "utf8",
      );
      await chmod(join(harness.fuseAppDir, "Open Design"), 0o755);

      const result = await harness.run({
        args: ["--flag"],
        env: { OD_APPIMAGE_EXTRACTED_RUN: "1", OD_LINUX_SANDBOX: "on" },
      });
      expect(result).toMatchObject({ code: 0, signal: null });
      expect(await readFile(harness.fallbackArgsPath, "utf8")).toBe("--flag\n");
      await expect(access(harness.extractMarkerPath)).rejects.toThrow();
    } finally {
      await rm(harness.root, { force: true, recursive: true });
    }
  });

  linuxOnlyIt("renders a bash script that parses cleanly", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-linux-apprun-syntax-"));
    const scriptPath = join(root, "AppRun");

    try {
      await writeFile(scriptPath, renderLinuxAppImageAppRun(), "utf8");
      const child = spawn("bash", ["-n", scriptPath], { stdio: "ignore" });
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });

      expect(exit).toEqual({ code: 0, signal: null });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("createLinuxDesktopLaunchEnv", () => {
  it("strips ELECTRON_RUN_AS_NODE before spawning the Electron AppImage", () => {
    const config = makeConfig();
    const stamp = {
      app: APP_KEYS.DESKTOP,
      channel: "stable",
      mode: SIDECAR_MODES.RUNTIME,
      namespace: "default",
      source: SIDECAR_SOURCES.TOOLS_PACK,
    };

    const env = createLinuxDesktopLaunchEnv(config, stamp, {
      ELECTRON_RUN_AS_NODE: "1",
      KEEP_ME: "yes",
    });

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.KEEP_ME).toBe("yes");
    expect(env.OD_SIDECAR_BASE).toBeUndefined();
  });
});

describe("sanitizeNamespace", () => {
  it("replaces non-alphanumeric chars with hyphens", () => {
    expect(sanitizeNamespace("a/b c")).toBe("a-b-c");
  });
});

describe("resolveLinuxLifecycleMode", () => {
  it("uses headless mode for every lifecycle action when --headless is set", () => {
    expect(resolveLinuxLifecycleMode({ headless: true }, "install")).toBe("headless");
    expect(resolveLinuxLifecycleMode({ headless: true }, "start")).toBe("headless");
    expect(resolveLinuxLifecycleMode({ headless: true }, "stop")).toBe("headless");
    expect(resolveLinuxLifecycleMode({ headless: true }, "uninstall")).toBe("headless");
    expect(resolveLinuxLifecycleMode({ headless: true }, "cleanup")).toBe("headless");
  });

  it("uses appimage mode when --headless is omitted", () => {
    expect(resolveLinuxLifecycleMode({}, "install")).toBe("appimage");
    expect(resolveLinuxLifecycleMode({}, "start")).toBe("appimage");
    expect(resolveLinuxLifecycleMode({}, "stop")).toBe("appimage");
    expect(resolveLinuxLifecycleMode({}, "uninstall")).toBe("appimage");
    expect(resolveLinuxLifecycleMode({}, "cleanup")).toBe("appimage");
  });
});

describe("shouldRejectLinuxHeadlessInspectOptions", () => {
  it("allows status-only headless inspect", () => {
    expect(shouldRejectLinuxHeadlessInspectOptions({})).toBe(false);
  });

  it("rejects headless eval and screenshot requests", () => {
    expect(shouldRejectLinuxHeadlessInspectOptions({ expr: "document.title" })).toBe(true);
    expect(shouldRejectLinuxHeadlessInspectOptions({ path: "/tmp/open-design-linux.png" })).toBe(true);
    expect(
      shouldRejectLinuxHeadlessInspectOptions({
        expr: "document.title",
        path: "/tmp/open-design-linux.png",
      }),
    ).toBe(true);
  });
});

describe("inspectPackedLinuxApp", () => {
  it("rejects unsupported headless inspect options before opening IPC", async () => {
    const getStatus = vi.mocked(getSidecarStatus);
    getStatus.mockClear();

    await expect(
      inspectPackedLinuxApp(makeConfig(), {
        expr: "document.title",
        headless: true,
      }),
    ).rejects.toThrow("linux inspect --headless supports status only; omit --expr and --path");
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("allows desktop inspect eval and screenshot options when headless is omitted", async () => {
    vi.mocked(getSidecarStatus).mockImplementation(async (stamp) => {
      if (stamp.source === SIDECAR_SOURCES.TOOLS_PACK) return { state: "running", url: "od://app/" };
      throw new Error("packaged status unavailable");
    });
    vi.mocked(invokeSidecar)
      .mockResolvedValueOnce({ ok: true, value: "Open Design" })
      .mockResolvedValueOnce({ path: "/tmp/open-design-linux.png" });

    const result = await inspectPackedLinuxApp(makeConfig(), {
      expr: "document.title",
      path: "/tmp/open-design-linux.png",
    });

    expect(result).toEqual({
      eval: { ok: true, value: "Open Design" },
      screenshot: { path: "/tmp/open-design-linux.png" },
      status: { state: "running", url: "od://app/" },
    });
    expect(getSidecarStatus).toHaveBeenCalledTimes(2);
    expect(invokeSidecar).toHaveBeenCalledTimes(2);
  });

  it("targets packaged IPC when a tools-pack process marker is stale", async () => {
    vi.mocked(findSidecarProcesses).mockImplementation(async (stamp) =>
      stamp.source === SIDECAR_SOURCES.TOOLS_PACK ? [{ command: "desktop", pid: 42, ppid: 1 }] : [],
    );
    vi.mocked(getSidecarStatus).mockImplementation(async (stamp) => {
      if (stamp.source === SIDECAR_SOURCES.PACKAGED) return { state: "running", url: "od://app/" };
      throw new Error("stale tools-pack endpoint");
    });
    vi.mocked(invokeSidecar).mockResolvedValueOnce({ ok: true, value: "Open Design" });

    const result = await inspectPackedLinuxApp(makeConfig(), { expr: "document.title" });

    expect(result.status).toEqual({ state: "running", url: "od://app/" });
    expect(invokeSidecar).toHaveBeenCalledWith(
      expect.objectContaining({ source: SIDECAR_SOURCES.PACKAGED }),
      SIDECAR_MESSAGES.EVAL,
      { expression: "document.title" },
      { timeoutMs: 5000 },
    );
  });
});

describe("matchesAppImageProcess", () => {
  const installPath = "/home/u/.local/bin/Open-Design.default.AppImage";

  it("matches FUSE-mode (executable === installPath)", () => {
    const ok = matchesAppImageProcess(
      { pid: 1234, executable: installPath, env: {} },
      installPath,
    );
    expect(ok).toBe(true);
  });

  it("matches extracted-mode (env.APPIMAGE === installPath, executable matches /tmp/.mount_*/AppRun)", () => {
    const ok = matchesAppImageProcess(
      { pid: 1234, executable: "/tmp/.mount_abc123/AppRun", env: { APPIMAGE: installPath } },
      installPath,
    );
    expect(ok).toBe(true);
  });

  it("rejects unrelated processes", () => {
    const ok = matchesAppImageProcess(
      { pid: 9999, executable: "/usr/bin/node", env: {} },
      installPath,
    );
    expect(ok).toBe(false);
  });

  it("rejects extracted-mode with mismatched APPIMAGE env", () => {
    const ok = matchesAppImageProcess(
      { pid: 1234, executable: "/tmp/.mount_abc/AppRun", env: { APPIMAGE: "/other/path.AppImage" } },
      installPath,
    );
    expect(ok).toBe(false);
  });

  it("rejects extracted-mode when APPIMAGE env is missing", () => {
    const ok = matchesAppImageProcess(
      { pid: 1234, executable: "/tmp/.mount_abc123/AppRun", env: {} },
      installPath,
    );
    expect(ok).toBe(false);
  });

  it("matches direct AppRun fallback when APPIMAGE points to the sibling AppRun", () => {
    const ok = matchesAppImageProcess(
      {
        pid: 1234,
        executable: "/tmp/appimage_extracted_fe548e54/Open Design",
        env: { APPIMAGE: "/tmp/appimage_extracted_fe548e54/AppRun" },
      },
      installPath,
    );
    expect(ok).toBe(true);
  });

  it("rejects direct AppRun fallback when APPIMAGE points outside the executable directory", () => {
    const ok = matchesAppImageProcess(
      {
        pid: 1234,
        executable: "/tmp/appimage_extracted_fe548e54/Open Design",
        env: { APPIMAGE: "/tmp/other/AppRun" },
      },
      installPath,
    );
    expect(ok).toBe(false);
  });

  it("matches --appimage-extract-and-run mode (executable in /tmp/appimage_extracted_*/<binary>)", () => {
    const ok = matchesAppImageProcess(
      {
        pid: 1234,
        executable: "/tmp/appimage_extracted_fe548e54/Open Design",
        env: { APPIMAGE: installPath },
      },
      installPath,
    );
    expect(ok).toBe(true);
  });

  it("matches AppRun cache mode (executable under open-design/appimage/<key>/<binary>)", () => {
    const ok = matchesAppImageProcess(
      {
        pid: 1234,
        executable: "/home/u/.cache/open-design/appimage/123456-7890/Open Design",
        env: { APPIMAGE: installPath },
      },
      installPath,
    );
    expect(ok).toBe(true);
  });

  it("rejects cache mode with mismatched APPIMAGE env", () => {
    const ok = matchesAppImageProcess(
      {
        pid: 1234,
        executable: "/home/u/.cache/open-design/appimage/123456-7890/Open Design",
        env: { APPIMAGE: "/elsewhere/Other.AppImage" },
      },
      installPath,
    );
    expect(ok).toBe(false);
  });

  it("rejects extract-and-run mode with mismatched APPIMAGE env", () => {
    const ok = matchesAppImageProcess(
      {
        pid: 1234,
        executable: "/tmp/appimage_extracted_fe548e54/Open Design",
        env: { APPIMAGE: "/elsewhere/Other.AppImage" },
      },
      installPath,
    );
    expect(ok).toBe(false);
  });
});
