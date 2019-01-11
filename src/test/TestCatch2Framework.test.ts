//-----------------------------------------------------------------------------
// vscode-catch2-test-adapter was written by Mate Pek, and is placed in the
// public domain. The author hereby disclaims copyright to this source code.

import * as path from 'path';
import * as fse from 'fs-extra';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { TestLoadFinishedEvent, TestSuiteInfo } from 'vscode-test-adapter-api';
import { inspect, promisify } from 'util';
import { EOL } from 'os';
import { example1 } from './example1';
import { TestAdapter, Imitation, waitFor, settings, isWin, ChildProcessStub, FileSystemWatcherStub } from './TestCommon';

///

describe('Test Catch2 Framework', function () {

  let imitation: Imitation;
  let adapter: TestAdapter | undefined = undefined;
  let watchers: Map<string, FileSystemWatcherStub>;


  before(function () {
    imitation = new Imitation();
    fse.removeSync(settings.dotVscodePath);
  })

  after(function () {
    imitation.sinonSandbox.restore();
  })

  beforeEach(async function () {
    this.timeout(8000);
    adapter = undefined;

    imitation.reset();
    watchers = example1.initImitation(imitation);

    // reset config can cause problem with fse.removeSync(dotVscodePath);
    await settings.resetConfig();
    return promisify(setTimeout)(2000);
  })

  afterEach(async function () {
    this.timeout(8000);
    if (adapter)
      await adapter.waitAndDispose(this);
    return promisify(setTimeout)(1000);
  })

  specify('resolving relative defaultCwd', async function () {
    this.slow(500);
    await settings.updateConfig('executables', example1.suite1.execPath);
    await settings.updateConfig('defaultCwd', 'defaultCwdStr');
    adapter = new TestAdapter();

    let assertNoError = false;
    const spawnWithArgs = imitation.spawnStub.withArgs(example1.suite1.execPath, example1.suite1.outputs[1][0]);
    spawnWithArgs.callsFake(function (p: string, args: string[], ops: any) {
      assert.strictEqual(ops.cwd, path.join(settings.workspaceFolderUri.fsPath, 'defaultCwdStr'));
      assertNoError = true;
      return new ChildProcessStub(example1.suite1.outputs[1][1]);
    });

    const callCount = spawnWithArgs.callCount;
    await adapter.load();
    assert.strictEqual(spawnWithArgs.callCount, callCount + 1);
    assert.ok(assertNoError);
  })

  specify('resolving absolute defaultCwd', async function () {
    this.slow(500);
    await settings.updateConfig('executables', example1.suite1.execPath);

    if (isWin)
      await settings.updateConfig('defaultCwd', 'C:\\defaultCwdStr');
    else
      await settings.updateConfig('defaultCwd', '/defaultCwdStr');

    adapter = new TestAdapter();

    let assertNoError = false;
    let cwd = '';
    const spawnWithArgs = imitation.spawnStub.withArgs(example1.suite1.execPath, example1.suite1.outputs[1][0]);
    spawnWithArgs.callsFake(function (p: string, args: string[], ops: any) {
      cwd = ops.cwd;
      if (isWin)
        assert.strictEqual(ops.cwd, 'c:\\defaultCwdStr');
      else
        assert.strictEqual(ops.cwd, '/defaultCwdStr');
      assertNoError = true; // this is necessary because it handles errors
      return new ChildProcessStub(example1.suite1.outputs[1][1]);
    });

    const callCount = spawnWithArgs.callCount;
    await adapter.load();
    assert.strictEqual(spawnWithArgs.callCount, callCount + 1);
    assert.ok(assertNoError, cwd);
  })

  specify('using defaultEnv', async function () {
    this.slow(500);
    await settings.updateConfig('executables', example1.suite1.execPath);
    await settings.updateConfig('defaultEnv', { 'ENVTEST': 'envtest' });

    adapter = new TestAdapter();

    let assertNoError = false;
    const spawnWithArgs = imitation.spawnStub.withArgs(example1.suite1.execPath, example1.suite1.outputs[1][0]);
    spawnWithArgs.callsFake(function (p: string, args: string[], ops: any) {
      assert.ok(ops.env.hasOwnProperty('ENVTEST'));
      assert.equal(ops.env.ENVTEST, 'envtest');
      assertNoError = true; // this is necessary because it handles errors
      return new ChildProcessStub(example1.suite1.outputs[1][1]);
    });

    const callCount = spawnWithArgs.callCount;
    await adapter.load();
    assert.strictEqual(spawnWithArgs.callCount, callCount + 1);
    assert.ok(assertNoError);
  })

  specify('arriving <TestCase> for missing TestInfo', async function () {
    this.slow(500);
    await settings.updateConfig('executables', example1.suite1.execPath);

    adapter = new TestAdapter();

    const testListOutput = example1.suite1.outputs[1][1].split('\n');
    assert.equal(testListOutput.length, 10);
    testListOutput.splice(1, 3);
    const withArgs = imitation.spawnStub.withArgs(
      example1.suite1.execPath, example1.suite1.outputs[1][0]);
    withArgs.onCall(withArgs.callCount)
      .returns(new ChildProcessStub(testListOutput.join(EOL)));


    await adapter.load();

    assert.equal(adapter.testLoadsEvents.length, 2);
    const root =
      (<TestLoadFinishedEvent>adapter.testLoadsEvents[adapter.testLoadsEvents.length - 1]).suite!;

    assert.equal(root.children.length, 1);
    const suite1 = <TestSuiteInfo>root.children[0];
    assert.equal(
      suite1.children.length, 1, inspect([testListOutput, adapter.testLoadsEvents]));
    const s1t2 = suite1.children[0];

    const stateEvents = adapter.testStatesEvents.length;
    await adapter.run([root.id]);

    await waitFor(this, () => {
      return suite1.children.length == 2;
    });
    const s1t1 = suite1.children[0];

    await waitFor(this, () => {
      return adapter!.testStatesEvents.length == stateEvents + 6 + 6;
    });

    assert.deepStrictEqual(adapter.testStatesEvents, [
      { type: 'started', tests: [root.id] },
      { type: 'suite', state: 'running', suite: suite1 },
      { type: 'test', state: 'running', test: s1t2 },
      {
        type: 'test',
        state: 'failed',
        test: s1t2,
        decorations: [{ line: 14, message: '-> false' }],
        message:
          'Duration: 0.000204 second(s).\n>>> "s1t2" at line 13 -> REQUIRE at line 15:\n  Original:\n    std::false_type::value\n  Expanded:\n    false\n<<<\n\n'
      },
      { type: 'suite', state: 'completed', suite: suite1 },
      { type: 'finished' },
      { type: 'started', tests: [s1t1.id] },
      { type: 'suite', state: 'running', suite: suite1 },
      { type: 'test', state: 'running', test: s1t1 },
      {
        type: 'test',
        state: 'passed',
        test: s1t1,
        message: "Duration: 0.000132 second(s).\n",
        decorations: undefined,
      },
      { type: 'suite', state: 'completed', suite: suite1 },
      { type: 'finished' },
    ]);
  })

  specify('test list error: duplicated test name', async function () {
    this.slow(500);
    await settings.updateConfig('executables', example1.suite1.execPath);

    adapter = new TestAdapter();

    const testListOutput = [
      'error: TEST_CASE( "biggest rectangle" ) already defined.',
      '  First seen at ../Task/biggest_rectangle.cpp:46',
      '  Redefined at ../Task/biggest_rectangle.cpp:102',
      ''];
    const withArgs = imitation.spawnStub.withArgs(
      example1.suite1.execPath, example1.suite1.outputs[1][0]);
    withArgs.onCall(withArgs.callCount)
      .returns(new ChildProcessStub('Matching test cases:' + EOL, undefined, testListOutput.join(EOL)));


    await adapter.load();
    assert.equal(adapter.testLoadsEvents.length, 2);
    const root =
      (<TestLoadFinishedEvent>adapter.testLoadsEvents[adapter.testLoadsEvents.length - 1]).suite!;
    assert.equal(root.children.length, 1);

    const suite1 = <TestSuiteInfo>root.children[0];
    assert.equal(
      suite1.children.length, 1, inspect([testListOutput, adapter.testLoadsEvents]));

    assert.strictEqual(suite1.children[0].label, '!! error: TEST_CASE( "biggest rectangle" ) already defined.');
  })

  specify('load executables=<full path of execPath1>', async function () {
    this.slow(500);
    await settings.updateConfig('executables', example1.suite1.execPath);
    adapter = new TestAdapter();

    await adapter.load();
    assert.equal(adapter.testLoadsEvents.length, 2);
    assert.equal(
      (<TestLoadFinishedEvent>adapter.testLoadsEvents[adapter.testLoadsEvents.length - 1])
        .suite!.children.length,
      1);
    adapter.testLoadsEvents.pop();
    adapter.testLoadsEvents.pop();
  })

  specify(
    'load executables=["execPath1", "./execPath2"] with error',
    async function () {
      this.slow(500);
      await settings.updateConfig('executables', ['execPath1', './execPath2']);
      adapter = new TestAdapter();

      const withArgs = imitation.spawnStub.withArgs(
        example1.suite2.execPath, example1.suite2.outputs[1][0]);
      withArgs.onCall(withArgs.callCount).throws(
        'dummy error for testing (should be handled)');

      await adapter.load();
      assert.equal(adapter.testLoadsEvents.length, 2);
      assert.equal(
        (<TestLoadFinishedEvent>adapter.testLoadsEvents[adapter.testLoadsEvents.length - 1])
          .suite!.children.length,
        1);
      adapter.testLoadsEvents.pop();
      adapter.testLoadsEvents.pop();
    })

  specify(
    'load executables=["execPath1", "execPath2Copy"]; delete; sleep 3; create',
    async function () {
      const watchTimeout = 6;
      await settings.updateConfig('defaultWatchTimeoutSec', watchTimeout);
      this.timeout(watchTimeout * 1000 + 2500 /* because of 'delay' */);
      this.slow(watchTimeout * 1000 + 2500 /* because of 'delay' */);
      const execPath2CopyPath =
        path.join(settings.workspaceFolderUri.fsPath, 'execPath2Copy');

      for (let scenario of example1.suite2.outputs) {
        imitation.spawnStub.withArgs(execPath2CopyPath, scenario[0])
          .callsFake(function () {
            return new ChildProcessStub(scenario[1]);
          });
      }

      imitation.fsStatStub.withArgs(execPath2CopyPath)
        .callsFake(imitation.handleStatFileExists);

      imitation.vsfsWatchStub.withArgs(imitation.createAbsVscodeRelativePatternMatcher(execPath2CopyPath))
        .callsFake(imitation.createCreateFSWatcherHandler(watchers));

      imitation.vsFindFilesStub.withArgs(imitation.createAbsVscodeRelativePatternMatcher(execPath2CopyPath))
        .resolves([vscode.Uri.file(execPath2CopyPath)]);

      await settings.updateConfig('executables', ['execPath1', 'execPath2Copy']);
      adapter = new TestAdapter();

      await adapter.load();

      assert.equal(
        (<TestLoadFinishedEvent>adapter.testLoadsEvents[adapter.testLoadsEvents.length - 1])
          .suite!.children.length,
        2);
      adapter.testLoadsEvents.pop();
      adapter.testLoadsEvents.pop();

      assert.ok(watchers.has(execPath2CopyPath));
      const watcher = watchers.get(execPath2CopyPath)!;

      let start: number = 0;
      const newRoot = await adapter.doAndWaitForReloadEvent(this, () => {
        imitation.fsStatStub.withArgs(execPath2CopyPath)
          .callsFake(imitation.handleStatFileNotExists);
        start = Date.now();
        watcher.sendDelete();
        setTimeout(() => {
          assert.equal(adapter!.testLoadsEvents.length, 0);
        }, 1500);
        setTimeout(() => {
          imitation.fsStatStub.withArgs(execPath2CopyPath)
            .callsFake(imitation.handleStatFileExists);
          watcher.sendCreate();
        }, 3000);
      });
      const elapsed = Date.now() - start;

      assert.equal(adapter.testLoadsEvents.length, 2);
      adapter.testLoadsEvents.pop();
      adapter.testLoadsEvents.pop();

      assert.equal(newRoot.children.length, 2);
      assert.ok(3000 < elapsed, inspect(elapsed));
      assert.ok(elapsed < watchTimeout * 1000 + 2400, inspect(elapsed));
    });

  specify(
    'load executables=["execPath1", "execPath2Copy"]; delete second',
    async function () {
      const watchTimeout = 5;
      await settings.updateConfig('defaultWatchTimeoutSec', watchTimeout);
      this.timeout(watchTimeout * 1000 + 6500 /* because of 'delay' */);
      this.slow(watchTimeout * 1000 + 3500 /* because of 'delay' */);
      const execPath2CopyPath =
        path.join(settings.workspaceFolderUri.fsPath, 'execPath2Copy');

      for (let scenario of example1.suite2.outputs) {
        imitation.spawnStub.withArgs(execPath2CopyPath, scenario[0])
          .callsFake(function () {
            return new ChildProcessStub(scenario[1]);
          });
      }

      imitation.fsStatStub.withArgs(execPath2CopyPath)
        .callsFake(imitation.handleStatFileExists);

      imitation.vsfsWatchStub.withArgs(imitation.createAbsVscodeRelativePatternMatcher(execPath2CopyPath))
        .callsFake(imitation.createCreateFSWatcherHandler(watchers));

      imitation.vsFindFilesStub.withArgs(imitation.createAbsVscodeRelativePatternMatcher(execPath2CopyPath))
        .resolves([vscode.Uri.file(execPath2CopyPath)]);

      await settings.updateConfig('executables', ['execPath1', 'execPath2Copy']);
      adapter = new TestAdapter();

      await adapter.load();

      assert.equal(
        (<TestLoadFinishedEvent>adapter.testLoadsEvents[adapter.testLoadsEvents.length - 1])
          .suite!.children.length,
        2);
      adapter.testLoadsEvents.pop();
      adapter.testLoadsEvents.pop();

      assert.ok(watchers.has(execPath2CopyPath));
      const watcher = watchers.get(execPath2CopyPath)!;

      let start: number = 0;
      const newRoot = await adapter.doAndWaitForReloadEvent(this, async () => {
        imitation.fsStatStub.withArgs(execPath2CopyPath)
          .callsFake(imitation.handleStatFileNotExists);
        start = Date.now();
        watcher.sendDelete();
      });
      const elapsed = Date.now() - start;
      adapter.testLoadsEvents.pop();
      adapter.testLoadsEvents.pop();

      assert.equal(newRoot.children.length, 1);
      assert.ok(watchTimeout * 1000 < elapsed, inspect(elapsed));
      assert.ok(elapsed < watchTimeout * 1000 + 2400, inspect(elapsed));
    })

  specify('wrong executables format', async function () {
    this.slow(5000);
    await settings.updateConfig('executables', { name: '' });

    adapter = new TestAdapter();

    await adapter.load();

    const root =
      (<TestLoadFinishedEvent>adapter.testLoadsEvents[adapter.testLoadsEvents.length - 1]).suite!;
    assert.equal(root.children.length, 0);
    adapter.testLoadsEvents.pop();
    adapter.testLoadsEvents.pop();
  })

  specify('variable substitution with executables={...}', async function () {
    this.timeout(8000);
    this.slow(500);
    const wsPath = settings.workspaceFolderUri.fsPath;
    const execPath2CopyRelPath = 'foo/bar/base.second.first';
    const execPath2CopyPath = path.join(wsPath, execPath2CopyRelPath);

    const envArray: [string, string][] = [
      ['${absPath}', execPath2CopyPath],
      ['${relPath}', path.normalize(execPath2CopyRelPath)],
      ['${absDirpath}', path.join(wsPath, 'foo/bar')],
      ['${relDirpath}', path.normalize('foo/bar')],
      ['${filename}', 'base.second.first'],
      ['${baseFilename}', 'base.second'],
      ['${extFilename}', '.first'],
      ['${base2Filename}', 'base'],
      ['${ext2Filename}', '.second'],
      ['${base3Filename}', 'base'],
      ['${ext3Filename}', ''],
      ['${workspaceDirectory}', wsPath],
      ['${workspaceFolder}', wsPath],
    ];
    const envsStr = envArray.map(v => { return v[0] }).join(' , ');
    const expectStr = envArray.map(v => { return v[1] }).join(' , ');

    await settings.updateConfig('executables', {
      name: envsStr,
      pattern: execPath2CopyRelPath,
      cwd: envsStr,
      env: { C2TESTVARS: envsStr }
    });

    for (let scenario of example1.suite2.outputs) {
      imitation.spawnStub.withArgs(execPath2CopyPath, scenario[0])
        .callsFake(function () {
          return new ChildProcessStub(scenario[1]);
        });
    }
    const spawnWithArgs = imitation.spawnStub.withArgs(execPath2CopyPath, example1.suite2.t1.outputs[0][0]);
    spawnWithArgs.callsFake(function (p: string, args: string[], ops: any) {
      assert.equal(ops.cwd, expectStr);
      assert.ok(ops.env.hasOwnProperty('C2TESTVARS'));
      assert.equal(ops.env.C2TESTVARS, expectStr);
      return new ChildProcessStub(example1.suite2.t1.outputs[0][1]);
    });

    imitation.fsStatStub.withArgs(execPath2CopyPath).callsFake(imitation.handleStatFileExists);

    imitation.vsfsWatchStub.withArgs(imitation.createVscodeRelativePatternMatcher(execPath2CopyRelPath))
      .callsFake(imitation.createCreateFSWatcherHandler(watchers));

    imitation.vsFindFilesStub.withArgs(imitation.createVscodeRelativePatternMatcher(execPath2CopyRelPath))
      .resolves([vscode.Uri.file(execPath2CopyPath)]);

    adapter = new TestAdapter();

    await adapter.load();

    const root =
      (<TestLoadFinishedEvent>adapter.testLoadsEvents[adapter.testLoadsEvents.length - 1]).suite!;
    adapter.testLoadsEvents.pop();
    adapter.testLoadsEvents.pop();

    assert.equal(root.children.length, 1);
    assert.equal(root.children[0].type, 'suite');
    const suite = <TestSuiteInfo>root.children[0];
    assert.equal(suite.label, expectStr);

    assert.equal(suite.children.length, 3);

    const callCount = spawnWithArgs.callCount;
    await adapter.run([suite.children[0].id]);
    assert.strictEqual(spawnWithArgs.callCount, callCount + 1);
  })
})
