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
