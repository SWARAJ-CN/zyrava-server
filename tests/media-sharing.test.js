import test from 'node:test';
import assert from 'node:assert/strict';
import { v2 as cloudinary } from 'cloudinary';
import { MediaUpload } from '../src/models/MediaUpload.js';
import { Message } from '../src/models/Message.js';
import { User } from '../src/models/User.js';
import { Conversation } from '../src/models/Conversation.js';
import { beginUpload, finishUpload, claimUpload, discardUpload, verifyMediaResource, attachmentView, MEDIA_LIMITS } from '../src/services/mediaService.js';
import { sendMessage, listMessages } from '../src/services/communityService.js';
import { sendMessageSchema } from '../src/validators/community.js';
import { uploadSchema } from '../src/routes/mediaRoutes.js';
cloudinary.config({ cloud_name: 'test-cloud', api_key: 'test-key', api_secret: 'test-secret' });
const owner='000000000000000000000001', peer='000000000000000000000002', thread='000000000000000000000010', id='000000000000000000000100';
const upload=()=>({_id:id,owner,conversation:thread,purpose:'chat',kind:'image',name:'photo.png',publicId:'zyrava/chat/test',usedBy:null,expiresAt:new Date(Date.now()+3600000),attachment:null});
const resource=()=>({public_id:'zyrava/chat/test',resource_type:'image',type:'authenticated',format:'png',width:800,height:600,bytes:5000,version:1});
const envelope=body=>({body,query:{},params:{}});
const query=value=>({select(){return this},lean:async()=>value,sort(){return this},limit(){return this}});

test('schemas allow attachment-only messages and reject empty, arbitrary URLs and oversized files',()=>{
 assert.equal(sendMessageSchema.safeParse(envelope({conversationId:thread,text:'',attachmentId:id})).success,true);
 assert.equal(sendMessageSchema.safeParse(envelope({conversationId:thread,text:''})).success,false);
 assert.equal(sendMessageSchema.safeParse(envelope({conversationId:thread,text:'hello',attachment:{url:'https://evil.invalid'}})).success,false);
 assert.equal(uploadSchema.safeParse(envelope({purpose:'avatar',kind:'video',name:'movie.mp4',size:1000})).success,false);
 assert.equal(uploadSchema.safeParse(envelope({purpose:'chat',kind:'image',name:'photo.png',size:1000})).success,false);
 assert.equal(uploadSchema.safeParse(envelope({purpose:'chat',conversation:thread,kind:'image',name:'photo.png',size:1000})).success,true);
});
test('signed grants keep the secret server-only, lock public ID and delivery type, and enforce size',async t=>{
 t.mock.method(MediaUpload,'create',async data=>({...data,_id:id}));
 const grant=await beginUpload(owner,{purpose:'chat',conversation:thread,kind:'image',name:'photo.png',size:5000});
 assert.equal(grant.fields.type,'authenticated');assert.equal(grant.fields.overwrite,false);
 assert.equal(grant.url,'https://api.cloudinary.com/v1_1/test-cloud/image/upload');
 assert.ok(!JSON.stringify(grant).includes('test-secret'));
 const {api_key,signature,...params}=grant.fields;
 assert.equal(signature,cloudinary.utils.api_sign_request(params,'test-secret'));
 await assert.rejects(beginUpload(owner,{purpose:'avatar',kind:'image',name:'photo.png',size:MEDIA_LIMITS.avatar+1}),/smaller/);
});
test('verification checks Cloudinary metadata instead of client-supplied dimensions and media type',()=>{
 assert.equal(verifyMediaResource(upload(),resource()).width,800);
 for(const override of [{public_id:'someone-elses-file'},{resource_type:'raw'},{type:'upload'},{format:'svg'},{bytes:MEDIA_LIMITS.image+1},{width:0}]) assert.throws(()=>verifyMediaResource(upload(),{...resource(),...override}),/not a supported/);
 assert.throws(()=>verifyMediaResource({...upload(),kind:'audio'},{...resource(),resource_type:'video',format:'webm'}),/not a supported/);
 const view=attachmentView(upload(),resource());
 assert.match(view.url,/image\/authenticated\/s--/);assert.match(view.url,/f_auto/);assert.match(view.url,/q_auto/);assert.match(view.url,/w_1200/);
 const avatar=attachmentView({...upload(),purpose:'avatar'}, {...resource(),type:'upload'});
 assert.match(avatar.url,/c_fill/);assert.match(avatar.url,/g_auto/);assert.match(avatar.url,/w_320/);
});
test('completion and attachment claims are scoped to the owner, purpose and conversation',async t=>{
 const lookups=[];
 t.mock.method(MediaUpload,'findOne',async filter=>{lookups.push(filter);return null;});
 const cloud=t.mock.method(cloudinary.api,'resource',async()=>resource());
 await assert.rejects(finishUpload(peer,id),/expired/);assert.equal(lookups[0].owner,peer);assert.equal(cloud.mock.callCount(),0);
 let captured;
 t.mock.method(MediaUpload,'findOneAndUpdate',async filter=>{captured=filter;return null;});
 await assert.rejects(claimUpload(owner,id,'chat','client-1',thread),/unavailable/);
 assert.equal(captured.owner,owner);assert.equal(captured.conversation,thread);assert.equal(captured.purpose,'chat');assert.equal(captured.usedBy,null);
});
test('cancellation retains the record for late-upload cleanup and cannot delete a sent attachment',async t=>{
 t.mock.method(MediaUpload,'findOneAndUpdate',async filter=>filter.usedBy===null?upload():null);
 const destroy=t.mock.method(cloudinary.uploader,'destroy',async()=>({result:'ok'}));
 const updates=t.mock.method(MediaUpload,'updateOne',async()=>({}));
 await discardUpload(owner,id);assert.equal(destroy.mock.callCount(),1);assert.equal(updates.mock.calls[0].arguments[1].$set.usedBy,'discarded');
 t.mock.method(MediaUpload,'findOneAndUpdate',async()=>null);
 await discardUpload(owner,id);assert.equal(destroy.mock.callCount(),1);
});
test('media messages persist, reload, retain read receipts, and retry without claiming twice',async t=>{
 const file=attachmentView(upload(),resource());let row=null,claims=0;const updates=[];
 t.mock.method(Conversation,'findById',()=>query({_id:thread,members:[owner,peer]}));
 t.mock.method(User,'find',()=>query([{_id:owner,name:'A'},{_id:peer,name:'B'}]));
 t.mock.method(Message,'findOne',()=>query(row));
 t.mock.method(MediaUpload,'findOneAndUpdate',async()=>{claims++;return {...upload(),attachment:file,usedBy:'client-1'}});
 t.mock.method(Message,'create',async data=>(row={...data,_id:'msg-1',createdAt:new Date()}));
 t.mock.method(Conversation,'updateOne',async(filter,update)=>updates.push(update));
 t.mock.method(Message,'find',()=>query([row]));
 const sent=await sendMessage(owner,thread,'','client-1',id);
 assert.equal(sent.message.attachment.url,file.url);assert.equal(updates[0].$set.lastMessageText,'Photo');
 const again=await sendMessage(owner,thread,'','client-1',id);assert.equal(again.duplicate,true);assert.equal(claims,1);
 const loaded=await listMessages(peer,thread);assert.equal(loaded[0].attachment.id,id);assert.equal(loaded[0].mine,false);assert.equal(loaded[0].seen,false);
});
test('a failed message write releases its attachment for retry',async t=>{
 t.mock.method(Conversation,'findById',()=>query({_id:thread,members:[owner,peer]}));
 t.mock.method(User,'find',()=>query([{_id:owner},{_id:peer}]));
 t.mock.method(Message,'findOne',()=>query(null));
 t.mock.method(MediaUpload,'findOneAndUpdate',async()=>({...upload(),attachment:attachmentView(upload(),resource()),usedBy:'client-1'}));
 t.mock.method(Message,'create',async()=>{throw new Error('database temporarily unavailable')});
 const release=t.mock.method(MediaUpload,'updateOne',async()=>({}));
 await assert.rejects(sendMessage(owner,thread,'','client-1',id),/database/);
 assert.equal(release.mock.calls[0].arguments[1].$set.usedBy,null);
});

test('message client IDs cannot collide with cleanup states',async t=>{
 let update;
 t.mock.method(MediaUpload,'findOneAndUpdate',async (_filter,value)=>{update=value;return upload()});
 await claimUpload(owner,id,'chat','discarded',thread);
 assert.equal(update.$set.usedBy,'chat:discarded');
});
