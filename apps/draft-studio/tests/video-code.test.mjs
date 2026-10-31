import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('generated code checker allows animation state and rejects process and filesystem access',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'video-code-'));
 const check=source=>{writeFileSync(root+'/scene.py',source);return spawnSync('python3',[path.resolve('scripts/check_video_code.py'),root+'/scene.py'],{encoding:'utf8'});};
 try{
  expect(check('from manimlib import *\nc=Circle()\nc.save_state()\n').status).toBe(0);
  for(const source of ['from manimlib import os\nos.kill(123,9)','import subprocess\nsubprocess.run([])','open("secret")','from manimlib import *\nx.__class__'])expect(check(source).status).not.toBe(0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
