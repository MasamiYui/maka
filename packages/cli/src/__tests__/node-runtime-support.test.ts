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
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  isSupportedNodeRuntimeVersion,
  probeNodeRuntime,
  SUPPORTED_NODE_RUNTIME_RANGE,
  unusableNodeRuntimeMessage,
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

test('an unsupported version is named together with the binary it was read from', () => {
  const message = unusableNodeRuntimeMessage(
    { kind: 'version', version: '23.7.0' },
    '/opt/node-23.7.0/bin/node',
  );
  assert.ok(message);
  assert.match(message, /23\.7\.0/u);
  assert.match(message, /\/opt\/node-23\.7\.0\/bin\/node/u);
  assert.match(message, />=22\.19\.0 <23\.0\.0 \|\| >=23\.8\.0/u);
  assert.equal(
    unusableNodeRuntimeMessage({ kind: 'version', version: process.versions.node }),
    undefined,
  );
});

test('a runtime that cannot be executed is unusable, not unknown', () => {
  const message = unusableNodeRuntimeMessage(
    { kind: 'unusable', detail: 'the pinned binary does not exist' },
    '/opt/maka/node',
  );
  assert.ok(message);
  assert.match(message, /\/opt\/maka\/node/u);
  assert.match(message, /does not exist/u);
});

test('only a probe that could not answer leaves the runtime unjudged', () => {
  assert.equal(
    unusableNodeRuntimeMessage({ kind: 'unknown', detail: 'the runtime did not answer' }),
    undefined,
  );
});

test('probing this process reports its own version without launching it', async () => {
  assert.deepEqual(await probeNodeRuntime(process.execPath), {
    kind: 'version',
    version: process.versions.node,
  });
});

test('each way a pinned binary can fail is classified as unusable', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'maka-node-runtime-probe-'));
  t.after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  const absent = await probeNodeRuntime(join(base, 'absent'));
  assert.equal(absent.kind, 'unusable');
  assert.match(absent.kind === 'unusable' ? absent.detail : '', /does not exist/u);

  const notExecutable = join(base, 'not-executable');
  await writeFile(notExecutable, 'not a runtime\n');
  await chmod(notExecutable, 0o644);
  assert.equal((await probeNodeRuntime(notExecutable)).kind, 'unusable');

  if (process.platform !== 'win32') {
    const failing = join(base, 'failing');
    await writeFile(failing, '#!/bin/sh\nexit 3\n');
    await chmod(failing, 0o755);
    assert.equal((await probeNodeRuntime(failing)).kind, 'unusable');

    const chatty = join(base, 'chatty');
    await writeFile(chatty, '#!/bin/sh\necho not-a-version\n');
    await chmod(chatty, 0o755);
    const malformed = await probeNodeRuntime(chatty);
    assert.equal(malformed.kind, 'unusable');
    assert.match(malformed.kind === 'unusable' ? malformed.detail : '', /did not report/u);

    const supported = join(base, 'supported');
    await writeFile(supported, '#!/bin/sh\necho 24.21.0\n');
    await chmod(supported, 0o755);
    assert.deepEqual(await probeNodeRuntime(supported), {
      kind: 'version',
      version: '24.21.0',
    });
  }
});
