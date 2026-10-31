// Real sandboxed Manim + FFmpeg; synthetic speech avoids provider charges.
import { test, expect, mock } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
let finalFailures=0,finalAudits=0;
const code=`from manimlib import *
class DraftVideoScene(Scene):
    def construct(self):
        self.camera.frame.set_shape(8,14.222222)
        self.mark_scene("a")
        c=Circle(color=TEAL)
        self.play(ShowCreation(c),run_time=10)
        self.mark_scene("b")
        self.play(Transform(c,Square(color=TEAL)),run_time=10)
        self.mark_scene("__end__")
`;
mock.module('../lib/harness',()=>({runHarnessResearch:async(prompt,on,signal,options)=>{
 if(prompt.includes('完整read review-input.json')){
  for(const name of ['grill-with-docs','humanizer-zh']){on({kind:'tool_call',tool:'skill',callId:name,input:{name}});on({kind:'tool_result',tool:'skill',callId:name,status:'completed'});}
  const input=JSON.parse(await readFile(path.join(options.cwd,'review-input.json'),'utf8'));
  const final=!!input.candidate.timings;if(final)finalAudits++;const failure=final && finalFailures-->0;
  return JSON.stringify({passed:!failure,issues:failure?['封面主视觉需改善']:[],limitation:'技术测试，无目视检查'});
 }

 on({kind:'tool_call',tool:'read',callId:'creative-method',input:{file_path:'creative-method/SKILL.md'}});on({kind:'tool_result',tool:'read',callId:'creative-method',status:'completed'});
  on({kind:'tool_call',tool:'skill',callId:'1',input:{name:'manimgl-best-practices'}});on({kind:'tool_result',tool:'skill',callId:'1',status:'completed'});
 return JSON.stringify({style:'墨色青绿连续几何变化解释核对过程',thesis:'线索必须核对才能形成有依据的判断',sceneCode:code,scenes:[{id:'a',explanation:'收集线索建立判断的前提',visualMechanism:'圆形建立稳定的线索结构',narration:'先整理线索。',duration:10,sourceIds:[]},{id:'b',explanation:'核对证据改变判断结构',visualMechanism:'圆形连续变换方形表示状态改变',narration:'再核对证据。',duration:10,sourceIds:[]}],review:'技术链路测试，不作为创意审美验收；测试使用固定代码。'});
}}));
const voice=await import('../server/video-voice');
mock.module('../server/video-voice',()=>({...voice,synthesizeVoice:async(text,work,index)=>{
 const file=path.join(work,`voice-${index}.wav`);
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=440:duration=1','-ar','24000','-ac','1',file]);
 return {file,words:[{text,begin_time:80,end_time:900}],model:'synthetic-test',voice:'test',rate:1};
}}));
const {renderDraftVideo}=await import('../server/video');
const enabled=process.platform==='darwin' && !!process.env.MANIMGL_BIN;
test.skipIf(!enabled)('real video includes cover first frame, H264 AAC, speech offsets and reproducible package',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'video-render-test-'));
 try{
  await sharp({create:{width:1080,height:1920,channels:3,background:'#14685e'}}).composite([{input:Buffer.from('<svg width="1080" height="1920"><rect x="100" y="500" width="800" height="300" fill="#f4f1e9"/></svg>')}]).png().toFile(path.join(root,'cover.png'));
  finalFailures=1;let repaired=0;
  const result=await renderDraftVideo({id:'draft_test',title:'核对证据',body:'先整理线索，再核对证据。',wechatSummary:'有依据再判断',wechatCover:{fileName:'cover.png'},channelVariants:{}},root,path.dirname(path.dirname(path.dirname(process.env.MANIMGL_BIN))),{input:{sources:[],originals:[],entities:[],relations:[]},repairCover:async()=>{repaired++;return path.join(root,'cover.png');}});
  expect(repaired).toBe(1);expect(finalAudits).toBe(2);
  const file=path.join(root,result.fileName);const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',file]));
  expect(info.streams.map(s=>s.codec_name)).toEqual(['h264','aac']);expect([info.streams[0].width,info.streams[0].height,info.streams[0].r_frame_rate]).toEqual([1080,1920,'30/1']);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',file,'-frames:v','1',path.join(root,'first.png')]);
  const cover=await sharp(path.join(root,'first.png')).stats();expect(cover.channels[1].mean).toBeGreaterThan(80);
  const plan=JSON.parse(await readFile(path.join(root,result.planFile),'utf8'));expect(plan.speech.at(-1).trailingPause).toBeGreaterThanOrEqual(1.19);
  const srt=await readFile(path.join(root,result.subtitleFile),'utf8');expect(srt).toContain('00:00:01,080');
  const JSZip=(await import('jszip')).default;const zip=await JSZip.loadAsync(await readFile(path.join(root,result.projectFile)));expect(zip.file('render_delivery.py')).not.toBeNull();expect(zip.file('cover.png')).not.toBeNull();
 }finally{await rm(root,{recursive:true,force:true});}
},120000);
