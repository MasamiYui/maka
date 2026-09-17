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

const NODE_RUNTIME_PROBE_TIMEOUT_MS = 10_000;

const NODE_RUNTIME_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]*)?$/u;

/**
 * A deployment launches its pinned binary directly, so a runtime that cannot be
 * executed or that answers unintelligibly is unusable rather than unknown. Only
 * evidence the probe could not obtain — a timed out spawn on a loaded machine —
 * leaves the runtime unjudged.
 */
export type NodeRuntimeProbe =
  | { readonly kind: 'version'; readonly version: string }
  | { readonly kind: 'unusable'; readonly detail: string }
  | { readonly kind: 'unknown'; readonly detail: string };

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

/** Describes why a probed runtime cannot be pinned, or nothing when it may be. */
export function unusableNodeRuntimeMessage(
  probe: NodeRuntimeProbe,
  nodePath?: string,
): string | undefined {
  const where = nodePath ? ` (${nodePath})` : '';
  if (probe.kind === 'unknown') return undefined;
  if (probe.kind === 'unusable') {
    return `The managed Runtime Host cannot use the selected Node.js runtime${where}: ${probe.detail}.`;
  }
  if (isSupportedNodeRuntimeVersion(probe.version)) return undefined;
  return `The managed Runtime Host cannot run on Node.js ${probe.version}${where}; install Node.js ${SUPPORTED_NODE_RUNTIME_RANGE} and retry.`;
}

/**
 * Reports what a Node binary says it is. A deployment carries a pinned path forward
 * from an earlier install, so only the binary's own answer is authoritative.
 */
export async function probeNodeRuntime(nodePath: string): Promise<NodeRuntimeProbe> {
  // A record that names no runtime cannot be probed. Deciding that is the decoded
  // config's job at the lifecycle boundary, so an early caller learns nothing here.
  if (typeof nodePath !== 'string' || nodePath.trim() === '') {
    return { kind: 'unknown', detail: 'the deployment names no runtime to probe' };
  }
  if (resolve(nodePath) === resolve(process.execPath)) {
    return { kind: 'version', version: process.versions.node };
  }
  try {
    const { stdout } = await execFileAsync(nodePath, ['-p', 'process.versions.node'], {
      timeout: NODE_RUNTIME_PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    const version = stdout.trim();
    return NODE_RUNTIME_VERSION_PATTERN.test(version)
      ? { kind: 'version', version }
      : { kind: 'unusable', detail: 'it did not report a Node.js version' };
  } catch (error) {
    // A killed probe is this timeout, not the runtime refusing to run.
    if (isTimedOutProbe(error)) {
      return { kind: 'unknown', detail: 'the runtime did not answer before the probe deadline' };
    }
    return { kind: 'unusable', detail: probeFailureDetail(error) };
  }
}

function isTimedOutProbe(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'killed' in error &&
    (error as { killed?: unknown }).killed === true
  );
}

function probeFailureDetail(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'it could not be executed';
  const code = (error as { code?: unknown }).code;
  if (code === 'ENOENT') return 'the pinned binary does not exist';
  if (code === 'EACCES' || code === 'EPERM') return 'the pinned binary is not executable';
  if (typeof code === 'number') return `it exited with code ${code}`;
  return typeof code === 'string'
    ? `it could not be executed (${code})`
    : 'it could not be executed';
}
