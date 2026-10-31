// Real ManimGL/OpenGL static rendering; no paid model or image API calls.
import { test, expect, mock } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
let malformed=false, auditFailures=0, auditCalls=0, generationCalls=0;
const source = shape => `from manimlib import *
class DraftIllustration0(Scene):
    def construct(self):
        self.camera.frame.set_shape(14, ${shape})
        self.camera.background_color = "#F4F1E9"
        title=Text("线索经过核对再判断",font="PingFang SC",font_size=38).set_color("#173B36").to_edge(UP,buff=0.6)
        a=RoundedRectangle(width=3,height=2,corner_radius=0.18,color=TEAL).shift(LEFT*4)
        b=Circle(radius=1,color=TEAL)
        c=Polygon([-1,-1,0],[1,-1,0],[0,1,0],color=GOLD).shift(RIGHT*4)
        self.add(title,a,b,c,Arrow(a.get_right(),b.get_left(),color=TEAL),Arrow(b.get_right(),c.get_left(),color=TEAL))
        self.add(Text("线索",font="PingFang SC",font_size=27).set_color("#173B36").move_to(a),Text("核对",font="PingFang SC",font_size=27).set_color("#173B36").move_to(b),Text("判断",font="PingFang SC",font_size=27).set_color("#173B36").next_to(c,DOWN))
        for pos in [-0.5,0,0.5]:
            self.add(Line([-4.7,pos,0],[-3.3,pos,0],color=TEAL,stroke_width=2))
`;
let shape=7.875;
mock.module('../lib/harness',()=>({runHarnessResearch:async(prompt,on)=>{
 if(prompt.includes('review-input.json')) {
  auditCalls++;
  for(const name of ['grill-with-docs','humanizer-zh']) {on({kind:'tool_call',tool:'skill',callId:name,input:{name}});on({kind:'tool_result',tool:'skill',callId:name,status:'completed'});}
  const passed=auditFailures===0;if(auditFailures>0)auditFailures--;
  return JSON.stringify({passed,issues:passed?[]:['标签对比度不足，请加深文字'],limitation:'测试未使用视觉模型'});
 }
 generationCalls++;

 on({kind:'tool_call',tool:'read',callId:'creative-method',input:{file_path:'creative-method/SKILL.md'}});on({kind:'tool_result',tool:'read',callId:'creative-method',status:'completed'});
  on({kind:'tool_call',tool:'skill',callId:'1',input:{name:'manimgl-best-practices'}});
 on({kind:'tool_result',tool:'skill',callId:'1',status:'completed'});
 return JSON.stringify({sceneCode:malformed?source(shape).replace('Text("线索",','Text("99%",'):source(shape),review:'使用资料页、核对圆和判断三角，连线表现核对关系。测试生成代码，未用于创意质量验收。'});
}}));
const {renderManimIllustrations,visualInputDigest}=await import('../server/manim-illustration');
const root=await mkdtemp(path.join(tmpdir(),'manim-illustration-test-'));
const page={kind:'illustration',renderer:'manim',layout:'hero_illustration',role:'核对机制',title:'线索经过核对再判断',lead:'核对',points:[],metrics:[],source:'',prompt:'资料页经过核对形成判断',claim:'核对形成判断',valueReason:'解释步骤关系',evidenceQuotes:['线索经过核对再判断']};
const draft={id:'draft_test',title:page.title,body:page.title,channel:'wechat',sources:'',creativeBrief:{},channelVariants:{}};
const research={sources:[],originals:[],entities:[],relations:[]};
const available=process.platform==='darwin' && !!process.env.MANIMGL_BIN;
test.skipIf(!available)('real landscape and square PNGs use grounded Manim labels without image API',async()=>{
 try {
  for(const channel of ['wechat','wechat_card']){
   shape=channel==='wechat'?7.875:14;
   const result=await renderManimIllustrations({draft:{...draft,channel},pages:[page],research,style:'暖白墨绿',mediaRoot:root,runtimeRoot:path.dirname(path.dirname(path.dirname(process.env.MANIMGL_BIN))),onStage:async()=>{}});
   const bytes=await readFile(path.join(root,result[0].fileName));const meta=await sharp(bytes).metadata();
   expect([meta.width,meta.height]).toEqual(channel==='wechat'?[1200,675]:[1080,1080]);
   expect((await sharp(bytes).stats()).channels[0].stdev).toBeGreaterThan(8);
   expect(result[0].qualityReview.passed).toBe(true);expect(result[0].qualityReview.visualChecked).toBe(false);expect(result[0].qualityReview.limitation).toContain('未完成目视');
  }
  shape=7.875;
  const renderInput={draft,pages:[page],research,style:'暖白墨绿',mediaRoot:root,runtimeRoot:path.dirname(path.dirname(path.dirname(process.env.MANIMGL_BIN))),onStage:async()=>{}};
  let beforeAudit=auditCalls,beforeGeneration=generationCalls;auditFailures=1;
  const repaired=await renderManimIllustrations(renderInput);
  expect(repaired[0].qualityReview.passed).toBe(true);expect(auditCalls-beforeAudit).toBe(2);expect(generationCalls-beforeGeneration).toBe(2);
  beforeAudit=auditCalls;beforeGeneration=generationCalls;auditFailures=3;
  await expect(renderManimIllustrations(renderInput)).rejects.toThrow('标签对比度不足');
  expect(auditCalls-beforeAudit).toBe(3);expect(generationCalls-beforeGeneration).toBe(3);
  auditFailures=0;
  malformed=true;
  await expect(renderManimIllustrations({draft,pages:[page],research,style:'暖白墨绿',mediaRoot:root,runtimeRoot:path.dirname(path.dirname(path.dirname(process.env.MANIMGL_BIN))),onStage:async()=>{}})).rejects.toThrow('99%');
 } finally{await rm(root,{recursive:true,force:true});}
},120000);
test('visual freshness includes article channel and art direction',()=>{
 expect(visualInputDigest(draft)).not.toBe(visualInputDigest({...draft,body:'新依据'}));
 expect(visualInputDigest(draft)).not.toBe(visualInputDigest({...draft,channel:'wechat_card'}));
});
