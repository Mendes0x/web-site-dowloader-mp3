'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {validateRequest,allowedHost}=require('../src/validation');
test('accepts known providers and normalizes URLs',()=>{
 const v=validateRequest({url:'https://music.youtube.com/watch?v=abc#fragment',format:'audio',quality:'best'});
 assert.equal(v.format,'audio'); assert.equal(new URL(v.url).hash,'');
 assert.equal(allowedHost('youtube.com.evil.test'),false);
});
test('rejects unsafe URLs and invalid options',()=>{
 for(const url of ['http://youtube.com/watch?v=x','https://127.0.0.1/x','https://localhost/x','https://user:pass@youtube.com/watch?v=x','https://youtube.com:8443/watch?v=x','https://evil.test/','file:///etc/passwd'])
   assert.throws(()=>validateRequest({url}));
 assert.throws(()=>validateRequest(null));
 assert.throws(()=>validateRequest({url:'https://youtube.com/watch?v=x',format:'exe'}));
 assert.throws(()=>validateRequest({url:'https://youtube.com/watch?v=x',quality:'ultra'}));
});
