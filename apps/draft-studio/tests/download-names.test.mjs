import {test,expect} from 'bun:test';
import {channelDownloadName} from '../lib/download-names';
test('each publication channel gets a distinct download prefix',()=>{
 const channels=['xiaohongshu','wechat','toutiao','wechat_card'];
 expect(new Set(channels.map(channel=>channelDownloadName(channel,'draft-id','zip'))).size).toBe(4);
 expect(channelDownloadName('toutiao','draft-id','zip')).toBe('toutiao-draft-id.zip');
 expect(channelDownloadName('wechat','draft-id','zip')).toBe('wechat-draft-id.zip');
 expect(channelDownloadName('xiaohongshu','draft-id','zip')).toBe('xiaohongshu-draft-id.zip');
});
