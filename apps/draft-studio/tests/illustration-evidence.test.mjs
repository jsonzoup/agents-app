import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
test('illustration label validation rejects invented labels and automatic axis numbers',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'illustration-evidence-'));
 const page={title:'核对',lead:'判断',points:[],metrics:[],source:'',evidenceQuotes:['核对形成判断']};
 try{
  await writeFile(path.join(root,'article.json'),JSON.stringify({pages:[page]}));
  const validate=async extra=>{await writeFile(path.join(root,'scene.py'),`from manimlib import *\nclass DraftIllustration0(Scene):\n def construct(self):\n  self.add(Text("核对"),Text("判断"))\n  ${extra}\n`);return ()=>execFileSync('python3',['scripts/check_illustration_text.py',path.join(root,'scene.py'),path.join(root,'article.json')],{stdio:'pipe'});};
  expect(await validate('self.add(Circle())')).not.toThrow();
  for(const extra of ['self.add(Text("99%"))','self.add(Axes().add_coordinate_labels())','Label = Text','self.add(manimlib.Text("99%"))','self.add(NumberLine(include_numbers=True))','self.add(Text("核对",color=BLACK))'])expect(await validate(extra)).toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
