/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Session Bundles statically import the `node:zlib` Zstandard bindings, which Node
 * added in 22.15.0 and 23.8.0. Releases 23.0 through 23.7 satisfy the `>=22.19.0`
 * baseline yet cannot load the Host at all, so they are excluded explicitly.
 */
export const SUPPORTED_NODE_RUNTIME_RANGE = '>=22.19.0 <23.0.0 || >=23.8.0';

const NODE_RUNTIME_PROBE_TIMEOUT_MS = 5_000;

const NODE_RUNTIME_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]*)?$/u;

export function isSupportedNodeRuntimeVersion(version: string): boolean {
  const parsed = NODE_RUNTIME_VERSION_PATTERN.exec(version.trim());
  if (!parsed) return false;
  const major = Number(parsed[1]);
  const minor = Number(parsed[2]);
  if (major > 23) return true;
  if (major === 23) return minor >= 8;
  if (major === 22) return minor >= 19;
  return false;
}

/**
 * Describes why a runtime cannot be used, or nothing when it is supported. An absent
 * or unrecognized version is missing evidence rather than proof of an unusable
 * runtime, so it never produces a message.
 */
export function unsupportedNodeRuntimeMessage(
  version: string | undefined,
  nodePath?: string,
): string | undefined {
  if (version === undefined) return undefined;
  const trimmed = version.trim();
  if (!NODE_RUNTIME_VERSION_PATTERN.test(trimmed) || isSupportedNodeRuntimeVersion(trimmed)) {
    return undefined;
  }
  return [
    `The managed Runtime Host cannot run on Node.js ${trimmed}`,
    nodePath ? ` (${nodePath})` : '',
    `; install Node.js ${SUPPORTED_NODE_RUNTIME_RANGE} and retry.`,
  ].join('');
}

/**
 * Reports the version a Node binary identifies itself as. A deployment can carry a
 * pinned path forward from an earlier install, so only the binary's own answer is
 * authoritative; an unreadable runtime reports nothing rather than a guess.
 */
export async function probeNodeRuntimeVersion(nodePath: string): Promise<string | undefined> {
  if (resolve(nodePath) === resolve(process.execPath)) return process.versions.node;
  try {
    const { stdout } = await execFileAsync(nodePath, ['-p', 'process.versions.node'], {
      timeout: NODE_RUNTIME_PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
