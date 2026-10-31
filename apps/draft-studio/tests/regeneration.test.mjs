import {test,expect} from 'bun:test';
import {clearRegeneratedOutput,draftMediaFiles} from '../lib/regeneration';
const version=()=>({title:'选题标题',coverTitle:'选题标题',body:'旧正文',tags:'#AI',wechatSummary:'摘要',images:[{id:'body',fileName:'body.png'}],imageFile:'body.png',wechatCover:{id:'cover',fileName:'cover.png'},imagePlacements:{body:2},wechatDraft:{mediaId:'stale'}});
test('regenerating images clears cover, body images and legacy fallback without touching text',()=>{
 const draft=version();const files=clearRegeneratedOutput(draft,{content:false,images:true,cover:true});
 expect(new Set(files)).toEqual(new Set(['body.png','cover.png']));
 expect(draft.images).toEqual([]);expect(draft.wechatCover).toBeUndefined();expect(draft.imageFile).toBeUndefined();
 expect(draft.body).toBe('旧正文');expect(draft.title).toBe('选题标题');
});
test('content-only regeneration retains images and other channel references prevent file deletion',()=>{
 const draft={...version(),channelVariants:{wechat:version()}};
 clearRegeneratedOutput(draft,{content:true,images:false});
 expect(draft.body).toBe('');expect(draft.tags).toBe('');expect(draft.images).toHaveLength(1);
 clearRegeneratedOutput(draft,{content:false,images:true});
 expect(draftMediaFiles(draft)).toContain('body.png');
 expect(draft.channelVariants.wechat.body).toBe('旧正文');
});

test('cover and illustration selections clear only their own assets',()=>{
 const coverOnly=version();
 expect(clearRegeneratedOutput(coverOnly,{content:false,images:false,cover:true})).toEqual(['cover.png']);
 expect(coverOnly.images).toHaveLength(1);expect(coverOnly.imageFile).toBe('body.png');
 const bodyOnly=version();
 clearRegeneratedOutput(bodyOnly,{content:false,images:true,cover:false});
 expect(bodyOnly.wechatCover.fileName).toBe('cover.png');expect(bodyOnly.images).toEqual([]);
});
