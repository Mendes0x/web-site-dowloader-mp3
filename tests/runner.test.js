'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {flagsFor,parseProgress,listArtifacts}=require('../src/runner');
test('flags are scoped and never disable TLS validation',()=>{
 const f=flagsFor({dir:'/tmp/test',format:'audio',quality:'balanced'});
 assert.equal(f.noPlaylist,true);assert.equal(f.extractAudio,true);assert.equal(f.audioFormat,'mp3');
 assert.equal(f.noCheckCertificates,undefined);
 assert.match(flagsFor({dir:'/tmp/test',format:'video',quality:'small'}).format,/height<=480/);
});
test('progress reads final progress percent',()=>{
 assert.equal(parseProgress('MD_PROGRESS: 21.4%\nMD_PROGRESS: 64.3%'),64.3);
 assert.equal(parseProgress('unknown'),null);
});
test('artifact list filters symlinks and unfinished files',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mediadock-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'example.mp3'),'ok');
 await fs.writeFile(path.join(dir,'partial.part'),'no');
 await fs.symlink(path.join(dir,'example.mp3'),path.join(dir,'alias.mp3'));
 const files=await listArtifacts(dir);
 assert.equal(files.length,1);assert.equal(files[0].name,'example.mp3');
});

test('CLI arguments use positional delimiter and safe defaults',()=>{
 const {buildArgs}=require('../src/runner');
 const job={dir:'/tmp/md',url:'https://youtube.com/watch?v=test',format:'video',quality:'balanced'};
 const args=buildArgs(job);
 assert.ok(args.includes('--ignore-config'));
 assert.ok(args.includes('--no-playlist'));
 assert.equal(args.at(-2),'--');
 assert.equal(args.at(-1),job.url);
 assert.equal(args.includes('--no-check-certificates'),false);
});
test('mock subprocess reports progress and makes an artifact',async t=>{
 const {createRunner}=require('../src/runner');
 const {EventEmitter}=require('node:events');
 const {PassThrough}=require('node:stream');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mediadock-mock-'));
 const jobDir=path.join(dir,'job');
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const fakeSpawn=()=>{
   const child=new EventEmitter();
   child.stdout=new PassThrough();child.stderr=new PassThrough();
   child.kill=()=>{child.emit('close',null,'SIGTERM');return true;};
   setImmediate(async()=>{
     await fs.writeFile(path.join(jobDir,'audio.mp3'),'output');
     child.stdout.write('MD_PROGRESS: 54.5%\n');
     child.emit('close',0,null);
   });
   return child;
 };
 let percentage=0;
 const runner=createRunner({spawnProcess:fakeSpawn,executable:'yt-dlp'});
 const files=await runner({dir:jobDir,url:'https://youtube.com/watch?v=x',format:'audio',quality:'best'},{
   signal:new AbortController().signal,progress:percent=>{percentage=percent;}
 });
 assert.equal(percentage,54.5);
 assert.equal(files[0].name,'audio.mp3');
});
