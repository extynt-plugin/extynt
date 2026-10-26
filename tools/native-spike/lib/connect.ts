/** Connects to a running native plugin from its discovery file. */
import { NativeClient } from "./client.ts";
import { assertFresh, defaultDiscoveryPath, readDiscovery } from "./discovery.ts";
import type { Discovery } from "./discovery.ts";

/** The command-line options that decide how to reach the plugin. */
export interface ConnectOptions {
  readonly discovery: string | undefined;
  readonly skipPidCheck: boolean;
  readonly timeoutMs: number;
}

/** A connected client with the discovery file it came from. */
export interface Connection {
  readonly client: NativeClient;
  readonly discovery: Discovery;
  readonly discoveryPath: string;
}

/** The discovery facts safe to print: never the token. */
export interface PublicDiscovery {
  readonly path: string;
  readonly port: number;
  readonly pid: number | null;
  readonly aeVersion: string | null;
  readonly pluginVersion: string | null;
}

/** Reads the discovery file, checks it is not stale, and opens a client. */
export async function connectNative(options: ConnectOptions): Promise<Connection> {
  const discoveryPath = options.discovery ?? defaultDiscoveryPath();
  const discovery = readDiscovery(discoveryPath);
  assertFresh(discovery, discoveryPath, { skipPidCheck: options.skipPidCheck });
  const client = new NativeClient({ port: discovery.port, token: discovery.token, timeoutMs: options.timeoutMs });
  await client.connect();
  return { client, discovery, discoveryPath };
}

/** The discovery facts safe to print: never the token. */
export function publicDiscovery(discovery: Discovery, path: string): PublicDiscovery {
  return {
    path,
    port: discovery.port,
    pid: discovery.pid,
    aeVersion: discovery.aeVersion,
    pluginVersion: discovery.pluginVersion,
  };
}
