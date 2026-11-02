'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server'),{DownloadQueue}=require('../src/queue');
test('API validates requests, guards mutations and serves artifacts',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mediadock-api-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const queue=new DownloadQueue({root,runner:async(job,{progress})=>{
   await fs.mkdir(job.dir,{recursive:true});progress(75);
   await fs.writeFile(path.join(job.dir,'track.mp3'),'test media');
   return [{id:'0',name:'track.mp3',size:10}];
 }});
 const {app}=createApp({queue});
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 const headers={'Content-Type':'application/json','X-MediaDock-Request':'1'};
 assert.equal((await fetch(origin+'/api/health')).status,200);
 assert.equal((await fetch(origin+'/api/jobs',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}})).status,403);
 assert.equal((await fetch(origin+'/api/jobs',{method:'POST',body:'{}',headers:{...headers,Origin:'https://evil.test'}})).status,403);
 assert.equal((await fetch(origin+'/api/jobs',{method:'POST',body:JSON.stringify({url:'https://127.0.0.1'}) ,headers})).status,400);
 const created=await fetch(origin+'/api/jobs',{method:'POST',body:JSON.stringify({url:'https://www.youtube.com/watch?v=example',format:'audio',quality:'best'}),headers});
 assert.equal(created.status,202);
 const id=(await created.json()).job.id;
 let job;
 for(let i=0;i<30;i++){
   job=(await (await fetch(origin+'/api/jobs/'+id)).json()).job;
   if(job.state==='completed')break;
   await new Promise(r=>setTimeout(r,10));
 }
 assert.equal(job.state,'completed');
 const file=await fetch(origin+'/api/jobs/'+id+'/files/0');
 assert.equal(file.status,200);assert.equal(await file.text(),'test media');
 assert.match(file.headers.get('content-disposition'),/attachment/);
 assert.equal((await fetch(origin+'/api/jobs/'+id,{method:'DELETE',headers})).status,204);
 assert.equal((await fetch(origin+'/api/jobs/'+id)).status,404);
});
