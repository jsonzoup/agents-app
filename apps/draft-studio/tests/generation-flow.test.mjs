import { test, expect } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GenerationFlow } from '../app/GenerationFlow';
import { generationFlowSteps, generationWorkflowChanged } from '../lib/generation-flow';
const run = { status: '运行中', stage: '审校成图', workflow: { current: 'review', steps: [
 {id:'render',label:'生成图片',status:'complete'},
 {id:'review',label:'自动审校',status:'running'},
 {id:'save',label:'保存',status:'pending'},
] } };
test('persisted steps keep a failed review at the current step without completing future steps', () => {
 const steps = generationFlowSteps({...run,status:'失败',error:'审校未通过'});
 expect(steps.map(s=>s.status)).toEqual(['complete','failed','pending']);
 expect(run.workflow.steps[1].status).toBe('running');
});
test('workflow-only repair progress is detected even if the stage detail remains the same', () => {
 expect(generationWorkflowChanged(run,{...run,workflow:{...run.workflow,repairAttempt:1}})).toBe(true);
 expect(generationWorkflowChanged(run,structuredClone(run))).toBe(false);
});
test('historical records do not invent completed steps from stage wording', () => {
 const steps=generationFlowSteps({status:'运行中',stage:'审校修复完成，准备保存'});
 expect(steps).toEqual([{id:'legacy',label:'生成任务',status:'running'}]);
 expect(generationFlowSteps({status:'完成',stage:'已完成'})[0].status).toBe('complete');
});

test('flow view identifies the current step and automatic repair round accessibly', () => {
 const html=renderToStaticMarkup(createElement(GenerationFlow,{title:'内容',run:{...run,workflow:{...run.workflow,repairAttempt:2}}}));
 expect(html).toContain('aria-label="内容生成流程"');
 expect(html).toContain('aria-current="step"');
 expect(html).toContain('自动修复第 2 轮');
 expect(html).toContain('待进行');
 expect(html).toContain('审校成图');
 expect(html).not.toContain('%');
 expect(renderToStaticMarkup(createElement(GenerationFlow,{title:'视频'}))).toBe('');
});
