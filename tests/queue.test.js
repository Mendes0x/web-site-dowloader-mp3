'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DownloadQueue}=require('../src/queue');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const input={url:'https://youtube.com/watch?v=x',format:'audio',quality:'balanced'};
test('concurrent queue serializes jobs when concurrency=1',async()=>{
 let active=0,maximum=0;
 const q=new DownloadQueue({root:'/tmp/mediadock-tests',concurrency:1,runner:async(j,{progress})=>{active++;maximum=Math.max(maximum,active);progress(65);await wait(20);active--;return [{id:'0',name:'test.mp3',size:12}];}});
 const first=q.submit(input),second=q.submit(input);
 await wait(95);
 assert.equal(q.get(first.id).state,'completed');assert.equal(q.get(second.id).state,'completed');
 assert.equal(q.get(first.id).progress,100);assert.equal(maximum,1);
});
test('cancelled pending jobs do not start',async()=>{
 const started=[];
 const q=new DownloadQueue({root:'/tmp/mediadock-tests',concurrency:1,runner:async(j)=>{started.push(j.id);await wait(30);return [];}});
 const first=q.submit(input),second=q.submit(input);
 q.cancel(second.id);
 await wait(65);
 assert.deepEqual(started,[first.id]);
 assert.equal(q.get(second.id).state,'cancelled');
});
test('a late result cannot finish a cancelled running job',async()=>{
 const q=new DownloadQueue({root:'/tmp/mediadock-tests',runner:async()=>{await wait(35);return [];}});
 const j=q.submit(input);
 await wait(9);q.cancel(j.id);await wait(49);
 assert.equal(q.get(j.id).state,'cancelled');
});
test('record caps enforce bounded memory',()=>{
 const q=new DownloadQueue({root:'/tmp/mediadock-tests',maxJobs:1,runner:async()=>new Promise(()=>{})});
 q.submit(input);assert.throws(()=>q.submit(input),/Too many saved jobs/);q.stop();
});

test('completed jobs are never silently evicted while files remain',async()=>{
 const q=new DownloadQueue({root:'/tmp/mediadock-tests',maxJobs:1,runner:async()=>[]});
 const first=q.submit(input);
 await wait(15);
 assert.equal(q.get(first.id).state,'completed');
 assert.throws(()=>q.submit(input),/Too many saved jobs/);
 await q.remove(first.id);
 const second=q.submit(input);
 assert.notEqual(first.id,second.id);
 await wait(15);
});
test('a cancelled worker must finish stopping before deletion',async()=>{
 const q=new DownloadQueue({
   root:'/tmp/mediadock-tests',
   runner:async()=>{await wait(42);return [];}
 });
 const job=q.submit(input);
 await wait(8);
 q.cancel(job.id);
 await assert.rejects(q.remove(job.id),/worker is still stopping/i);
 await wait(62);
 await q.remove(job.id);
 assert.equal(q.get(job.id),null);
});
