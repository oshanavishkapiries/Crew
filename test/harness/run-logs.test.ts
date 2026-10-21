import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
async function logs(query = '', task = 'a') {
  return fetch(`${h.server.url}/api/tasks/${task}/logs${query}`, { headers: { 'X-Crew-Secret': h.server.perStartSecret } });
}
async function setup() {
  h = await createPipelineHarness();
  await h.createTask({ id: 'a', title: 'Logs', description: 'Historical runs' });
  await h.createTask({ id: 'b', title: 'Other', description: 'Foreign task' });
  for (const [id, taskId, content, time] of [['older','a','older output\n',1],['latest','a','latest output\n',2],['foreign','b','foreign output\n',3]] as const) {
    const logPath = path.join(h.crewHomeDir, 'logs', `${id}.jsonl`); fs.writeFileSync(logPath, content);
    h.db.db.insert(schema.runs).values({ id, taskId, agentId: h.agentId, adapter: 'fake', startedAt: new Date(time * 1000), endedAt: new Date((time+1) * 1000), exitReason: 'done', exitCode: 0, logPath }).run();
  }
}
it('keeps latest default output and reads a named older run through real API and CLI', async () => {
  await setup();
  expect(await (await logs()).json()).toMatchObject({ runId: 'latest', content: 'latest output\n', truncated: false, missing: false, offset: 0 });
  expect(await (await logs('?run=older')).json()).toMatchObject({ runId: 'older', content: 'older output\n', exitCode: 0, exitReason: 'done' });
  const listed = await h.runCrew(['logs','a','--list']); expect(listed.exitCode,listed.stderr).toBe(0); expect(listed.stdout).toContain('older'); expect(listed.stdout).toContain('latest'); expect(listed.stdout).not.toContain('foreign');
  const latest = await h.runCrew(['logs','a'], {}, { stripFinalNewline: false }); expect(latest.exitCode,latest.stderr).toBe(0); expect(latest.stdout).toBe('latest output\n');
  const older = await h.runCrew(['logs','a','--run','older'], {}, { stripFinalNewline: false }); expect(older.exitCode,older.stderr).toBe(0); expect(older.stdout).toBe('older output\n');
  const res = await fetch(`${h.server.url}/api/tasks/a`, { headers: { 'X-Crew-Secret': h.server.perStartSecret } });
  const detail = await res.json() as any;
  expect(detail.runs).toEqual(expect.arrayContaining([expect.objectContaining({ id:'older', startedAt:expect.any(String), endedAt:expect.any(String), exitReason:'done',exitCode:0,adapter:'fake',agentId:h.agentId })]));
});
it('rejects another task run and invalid tail sizes with actionable errors', async () => {
  await setup(); expect((await logs('?run=foreign')).status).toBe(404); expect((await logs('?run=unknown')).status).toBe(404);
  for(const tail of ['0','-1','1.5','2097153','nope','']) expect((await logs(`?tail=${tail}`)).status).toBe(400);
  const bad=await h.runCrew(['logs','a','--tail','2049']); expect(bad.exitCode).not.toBe(0); expect(bad.stderr).toContain('tail');
});
it('returns bounded tails and byte offsets, without loading a large log, and reports CLI truncation', async () => {
  await setup(); const file=path.join(h.crewHomeDir,'logs','latest.jsonl');fs.writeFileSync(file,Buffer.alloc(3*1024*1024,120));
  const defaultTail=await (await logs()).json() as any;
  expect(Buffer.byteLength(defaultTail.content)).toBe(256*1024); expect(defaultTail.offset).toBe(3*1024*1024-256*1024); expect(defaultTail.truncated).toBe(true);
  const maxTail=await (await logs('?tail=2097152')).json() as any;expect(Buffer.byteLength(maxTail.content)).toBe(2*1024*1024);expect(maxTail.offset).toBe(1024*1024);
  const cli=await h.runCrew(['logs','a','--run','latest','--tail','1']);expect(cli.exitCode,cli.stderr).toBe(0);expect(cli.stdout.trim()).toHaveLength(1024);expect(cli.stderr).toContain('truncated');
});
it('reports missing or absent log files explicitly and empty tasks without a 500', async () => {
  await setup(); fs.unlinkSync(path.join(h.crewHomeDir,'logs','latest.jsonl'));
  expect(await (await logs()).json()).toMatchObject({ runId:'latest', content:'',missing:true,truncated:false,offset:0 });
  expect((await h.runCrew(['logs','a'])).stdout).toContain('missing');
  h.db.db.update(schema.runs).set({logPath:null}).where(eq(schema.runs.id,'older')).run();
  expect(await (await logs('?run=older')).json()).toMatchObject({missing:true});
  await h.createTask({ id:'empty',title:'Empty',description:'' });expect(await (await logs('', 'empty')).json()).toMatchObject({runId:null,content:'',missing:false});
});
it('never serves outside paths, traversal, symlink escapes or a directory as a log', async () => {
  await setup(); const outside=path.join(h.crewHomeDir,'outside.txt');fs.writeFileSync(outside,'PRIVATE_OUTSIDE_SENTINEL');
  const link=path.join(h.crewHomeDir,'logs','escape.jsonl');fs.symlinkSync(outside,link);
  for(const logPath of [outside, path.join(h.crewHomeDir,'logs','..','outside.txt'),link,path.join(h.crewHomeDir,'logs')]) {
    h.db.db.update(schema.runs).set({logPath}).where(eq(schema.runs.id,'latest')).run();
    const response=await logs();expect(response.status).toBe(403);expect(await response.text()).not.toContain('PRIVATE_OUTSIDE_SENTINEL');
  }
});

it('rejects a logs-root symlink escaping the real Crew home', async () => {
  await setup();
  const outside = path.join(h.repoDir, 'outside-logs'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'latest.jsonl'), 'PRIVATE_OUTSIDE_SENTINEL');
  fs.renameSync(path.join(h.crewHomeDir, 'logs'), path.join(h.crewHomeDir, 'original-logs'));
  fs.symlinkSync(outside, path.join(h.crewHomeDir, 'logs'));
  const response = await logs(); expect(response.status).toBe(403); expect(await response.text()).not.toContain('PRIVATE_OUTSIDE_SENTINEL');
});
it('reads real Runner logs from both sides of ask/answer while keeping latest default', async () => {
  h = await createPipelineHarness(); await h.createTask({ id:'a', title:'Resume logs',description:'A real run' });
  await h.runTaskWithAgent('a',[{type:'ask',message:'Old run question sentinel'}]);
  await h.waitForTaskStatus('a','blocked'); await h.waitForLiveRuns(0);
  const older = h.db.db.select().from(schema.runs).get()!;
  h.fakeAdapter.setResumeScript([{type:'done',result:'New resumed run sentinel'}]);
  const answer = await h.runCrew(['answer','a','Proceed']); expect(answer.exitCode,answer.stderr).toBe(0);
  await h.waitForTaskStatus('a','verifying'); await h.waitForLiveRuns(0);
  const runs = h.db.db.select().from(schema.runs).all(); expect(runs).toHaveLength(2);
  const latest = await (await logs()).json() as any;
  expect(latest.runId).not.toBe(older.id); expect(latest.content).toContain('New resumed run sentinel');
  const history = await (await logs(`?run=${older.id}`)).json() as any;
  expect(history.runId).toBe(older.id); expect(history.content).toContain('Old run question sentinel'); expect(history.content).not.toContain('New resumed run sentinel');
});
