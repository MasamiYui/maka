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

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  isSupportedNodeRuntimeVersion,
  probeNodeRuntimeVersion,
  SUPPORTED_NODE_RUNTIME_RANGE,
  unsupportedNodeRuntimeMessage,
} from '../node-runtime-support.js';

test('the supported range excludes Node releases without the zstd bindings', () => {
  for (const version of ['22.19.0', '22.20.4', '23.8.0', '23.11.1', '24.0.0', 'v24.18.1']) {
    assert.equal(isSupportedNodeRuntimeVersion(version), true, version);
  }
  for (const version of ['22.14.0', '22.18.9', '23.0.0', '23.7.0', 'v23.7.9', '20.18.0']) {
    assert.equal(isSupportedNodeRuntimeVersion(version), false, version);
  }
});

test('the running runtime satisfies the range the repository declares', () => {
  assert.equal(isSupportedNodeRuntimeVersion(process.versions.node), true);
  assert.equal(SUPPORTED_NODE_RUNTIME_RANGE, '>=22.19.0 <23.0.0 || >=23.8.0');
});

test('an unsupported runtime is named together with the binary it was read from', () => {
  const message = unsupportedNodeRuntimeMessage('23.7.0', '/opt/node-23.7.0/bin/node');
  assert.ok(message);
  assert.match(message, /23\.7\.0/u);
  assert.match(message, /\/opt\/node-23\.7\.0\/bin\/node/u);
  assert.match(message, />=22\.19\.0 <23\.0\.0 \|\| >=23\.8\.0/u);
  assert.equal(unsupportedNodeRuntimeMessage('23.7.0'), unsupportedNodeRuntimeMessage('23.7.0'));
  assert.doesNotMatch(unsupportedNodeRuntimeMessage('23.7.0') ?? '', /undefined/u);
});

test('missing or unrecognized version evidence never blocks a runtime', () => {
  assert.equal(unsupportedNodeRuntimeMessage(undefined), undefined);
  assert.equal(unsupportedNodeRuntimeMessage(''), undefined);
  assert.equal(unsupportedNodeRuntimeMessage('not-a-version'), undefined);
  assert.equal(unsupportedNodeRuntimeMessage(process.versions.node), undefined);
});

test('probing this process reports its own version without launching it', async () => {
  assert.equal(await probeNodeRuntimeVersion(process.execPath), process.versions.node);
});

test('probing a runtime that cannot answer reports no evidence', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'maka-node-runtime-probe-'));
  t.after(async () => {
    await rm(base, { recursive: true, force: true });
  });
  const notExecutable = join(base, 'node');
  await writeFile(notExecutable, 'not a runtime\n');
  assert.equal(await probeNodeRuntimeVersion(notExecutable), undefined);
  assert.equal(await probeNodeRuntimeVersion(join(base, 'absent')), undefined);
});
