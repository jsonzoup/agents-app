import {test,expect} from 'bun:test';
import {xiaohongshuPlainText} from '../lib/channel-text';
test('XHS removes document markup while retaining text, facts and hashtags',()=>{
 expect(xiaohongshuPlainText('## 一个问题\n\n**关键判断**与__事实__\n> `Agent` 是智能体\n[来源](https://example.com)\n#人工智能 #AI\n2 * 3 = 6')).toBe('一个问题\n\n关键判断与事实\nAgent 是智能体\n来源（https://example.com）\n#人工智能 #AI\n2 * 3 = 6');
});
test('XHS cleanup is idempotent',()=>{
 const value='**判断**\n\n正常正文与 #科技';
 expect(xiaohongshuPlainText(xiaohongshuPlainText(value))).toBe(xiaohongshuPlainText(value));
});
