import { test, expect } from 'bun:test';
import { requestedChannels, toggleChannel } from '../lib/channels';

test('channel selection supports both channels while keeping at least one checked',()=>{
  expect(toggleChannel(['xiaohongshu'],'wechat')).toEqual(['xiaohongshu','wechat']);
  expect(toggleChannel(['xiaohongshu','wechat'],'xiaohongshu')).toEqual(['wechat']);
  expect(toggleChannel(['wechat'],'wechat')).toEqual(['wechat']);
  for(const body of [null,[],true,'wechat'])expect(requestedChannels(body)).toBeNull();
  expect(requestedChannels({})).toEqual(['xiaohongshu']);
  expect(requestedChannels({channel:'wechat'})).toEqual(['wechat']);
  expect(requestedChannels({channels:['wechat','xiaohongshu','wechat'],channel:'wechat'})).toEqual(['xiaohongshu','wechat']);
});

test('all five scenes can be selected independently and reject unknown values', async()=>{
 const {contentChannels,isContentChannel}=await import('../lib/channels');
 const {channelWritingRule,channelVisuals}=await import('../lib/channel-visuals');
 expect(requestedChannels({channels:['toutiao','wechat_card','wechat','xiaohongshu','video']})).toEqual(contentChannels);
 for(const channel of contentChannels){
  expect(requestedChannels({channel})).toEqual([channel]);
  expect(isContentChannel(channel)).toBe(true);
  expect(channelWritingRule(channel).length).toBeGreaterThan(20);
  expect(channelVisuals[channel].width).toBeGreaterThan(1000);
 }
 expect(isContentChannel('other')).toBe(false);
});

test('XHS cover shares body dimensions while remaining independent; Toutiao gets a taller cover while sharing flat body dimensions', async()=>{
 const {channelVisuals,channelWritingRule}=await import('../lib/channel-visuals');
 const xhs=channelVisuals.xiaohongshu;
 expect([xhs.cover.width,xhs.cover.height]).toEqual([1080,810]);
 expect([xhs.width,xhs.height]).toEqual([1080,810]);
 expect(xhs.cover).toEqual({width:xhs.width,height:xhs.height,ratio:xhs.ratio});
 expect(channelVisuals.wechat.cover).toEqual({width:900,height:383,ratio:"2.35:1"});
 expect(channelVisuals.toutiao.cover).toEqual({width:924,height:720,ratio:"77:60"});
 expect(channelVisuals.toutiao.width).toBe(channelVisuals.wechat.width);
 expect(channelVisuals.toutiao.height).toBe(channelVisuals.wechat.height);
 expect(channelVisuals.toutiao.cover.height/channelVisuals.toutiao.cover.width).toBeGreaterThan(channelVisuals.wechat.cover.height/channelVisuals.wechat.cover.width);
 expect(channelVisuals.wechat.height/channelVisuals.wechat.width).toBeLessThan(0.7);
 expect(channelWritingRule('xiaohongshu')).toContain('不超过1000字');
});
