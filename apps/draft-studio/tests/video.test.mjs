import { test, expect } from 'bun:test';
import { validateVideoInput, videoSourceText, videoSubtitles } from '../lib/video';
import { runVideoCommand } from '../server/video';
import { tmpdir } from 'node:os';
const draft = { title:'谁来核对模型的回答', coverTitle:'更快之后', body:'回答更快了，核对事实这一步却不能省。\n把建议交给模型，把判断留给有证据的人。', wechatSummary:'效率与判断的边界。' };

test('video validates input and subtitles follow director timings', () => {
  validateVideoInput(draft);
  expect(()=>validateVideoInput({...draft,body:''})).toThrow();
  expect(()=>validateVideoInput({...draft,body:'字'.repeat(1601)})).toThrow();
  expect(videoSubtitles([{text:'解释机制',duration:5},{text:'说明边界',duration:7}])).toContain('00:00:05,000 --> 00:00:12,000');
  expect(videoSourceText({...draft, body:draft.body+'修改'})).not.toBe(videoSourceText(draft));
});

test('video subprocess scrubs credentials and reports failure and timeout', async()=>{
  process.env.VIDEO_TEST_API_KEY='never-send-to-renderer';
  try {
    await runVideoCommand(process.execPath,['-e', 'if(process.env.VIDEO_TEST_API_KEY)process.exit(1)'],tmpdir(),5000);
    await expect(runVideoCommand(process.execPath,['-e','process.exit(2)'],tmpdir(),5000)).rejects.toThrow('视频渲染失败');
    await expect(runVideoCommand(process.execPath,['-e','setInterval(()=>{},1000)'],tmpdir(),50)).rejects.toThrow('视频渲染超时');
  } finally { delete process.env.VIDEO_TEST_API_KEY; }
});

