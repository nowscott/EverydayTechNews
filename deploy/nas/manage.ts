#!/usr/bin/env node
/** 高级版 NAS 控制器入口（TS）：与 deploy/nas/manage.py 的命令行行为一致。 */
import * as base from './base-manage.ts';
import path from 'node:path';

async function main(): Promise<number> {
  process.umask(0o077);
  const argv = process.argv.slice(2);
  const rootIndex = argv.indexOf('--root');
  if (rootIndex < 0 || !argv[rootIndex + 1]) throw new Error('root_required');
  const rest = argv.filter((_value, index) => index !== rootIndex && index !== rootIndex + 1);
  const [operation, tag] = rest;
  const controller = new base.Controller(argv[rootIndex + 1]);
  let result: unknown;
  if (operation === 'status') result = { deployment: controller.state(), last_check: base.readJson(path.join(controller.root, 'status.json'), null) };
  else if (operation === 'rollback') result = controller.rollback(tag);
  else if (operation === 'update') result = await controller.update();
  else if (operation === 'run') result = controller.run();
  else throw new Error('unknown_operation');
  if (result) console.log(String(typeof result === 'string' ? result : JSON.stringify(result, null, 2)));
  if (result && typeof result === 'object') {
    const status = String((result as Record<string, unknown>).status);
    if (['deployment_failed', 'release_check_failed', 'blocked_release'].includes(status)) return 1;
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('manage.ts')) {
  main().then((code) => { process.exitCode = code; })
    .catch((error) => { console.error(String((error as Error).message || error)); process.exitCode = 1; });
}
