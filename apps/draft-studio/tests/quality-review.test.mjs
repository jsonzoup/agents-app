import { test, expect, mock, afterAll } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
let load=true, failures=1, repairs=0, audits=0, view=false, lastPrompt="", histories=[], auditOverride;
mock.module('../lib/harness',()=>({runHarnessResearch:async(prompt,on,signal,options)=>{
 lastPrompt=prompt;
 const data=JSON.parse(await readFile(path.join(options.cwd,'review-input.json'),'utf8'));
 histories.push({candidate:data.candidate, prior:data.priorReviewFindings});
 for(const name of ['grill-with-docs','humanizer-zh']) {
  expect(await readFile(path.join(options.cwd,'skills',name,'SKILL.md'),'utf8')).toContain('name:');
  if(load || name==='grill-with-docs'){on({kind:'tool_call',tool:'skill',callId:name,input:{name}});on({kind:'tool_result',tool:'skill',callId:name,status:'completed'});}
 }
 if(view)for(const file of data.images){on({kind:'tool_call',tool:'read_image',callId:file,input:{file_path:file}});on({kind:'tool_result',tool:'read_image',callId:file,status:'completed'});}
 if(prompt.includes('这是修复任务')){repairs++;return JSON.stringify({...data.candidate,body:'修复后仍保留可能与限制。'});}
 audits++;if(auditOverride)return JSON.stringify(auditOverride());const fail=failures-->0;return JSON.stringify({passed:!fail,issues:fail?['删除无依据的确定结论，保留可能与限制']:[],limitation:''});
}}));
const {reviewAndRepair,auditGenerated}=await import('../server/quality-review');
const root=await mkdtemp(path.join(os.tmpdir(),'quality-tests-'));
afterAll(()=>rm(root,{recursive:true,force:true}));
const input={appRoot:process.cwd(),runtimeRoot:root,context:{facts:'可能有效'},candidate:{body:'一定有效'},validate:x=>x,onPhase:async()=>{}};
test('actual skills are mounted and repaired candidate receives a fresh independent audit',async()=>{
 failures=1;audits=repairs=0;const r=await reviewAndRepair(input);expect(r.candidate.body).toContain('可能');expect(audits).toBe(2);expect(repairs).toBe(1);
});
test('missing successful skill load cannot be reported as reviewed',async()=>{load=false;try{await expect(auditGenerated(input)).rejects.toThrow('humanizer-zh');}finally{load=true;}});
test('persistent issues stop after four repairs',async()=>{failures=99;repairs=0;await expect(reviewAndRepair(input)).rejects.toThrow('4次自动修复');expect(repairs).toBe(4);});
test('unavailable vision is explicit and only successful image calls count',async()=>{
 failures=0;const file=path.join(root,'sample.png');await (await import('node:fs/promises')).writeFile(file,'test');
 let r=await auditGenerated({...input,images:[file]});expect(r.visualChecked).toBe(false);expect(r.limitation).toContain('未完成目视');
 view=true;try{r=await auditGenerated({...input,images:[file]});expect(r.visualChecked).toBe(true);}finally{view=false;}
});

test('text audit excludes future visual inspection and preserves limitations',async()=>{
 failures=0;await auditGenerated(input);expect(lastPrompt).toContain('本轮只审文本');expect(lastPrompt).toContain('不得作为issues');
});

test('subsequent repair and independent audit receive earlier findings and latest candidate',async()=>{
 failures=2;audits=repairs=0;histories=[];const r=await reviewAndRepair(input);expect(histories.at(-1).candidate.body).toContain('可能');expect(histories.at(-1).prior.length).toBe(2);expect(repairs).toBe(2);expect(audits).toBe(3);expect(r.candidate.body).toContain('可能');expect(lastPrompt).toContain('candidate本身');
});

test('structured findings are preserved and drive the repair before recheck',async()=>{
 audits=repairs=0;histories=[];auditOverride=()=>audits===1?{passed:false,issues:[{location:'正文开头',problem:'缺少条件',suggestion:'补充适用范围'}]}:{passed:true,issues:[],limitation:''};
 try{await reviewAndRepair(input);expect(repairs).toBe(1);expect(histories.at(-1).prior[0]).toContain('缺少条件');expect(histories.at(-1).prior[0]).toContain('补充适用范围');}finally{auditOverride=undefined;}
});
test('unusable finding is rejected rather than silently passed',async()=>{
 auditOverride=()=>({passed:false,issues:[{}]});try{await expect(auditGenerated(input)).rejects.toThrow('审校结果格式无效');}finally{auditOverride=undefined;}
});
