import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../src/models/User.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { MediaUpload } from '../src/models/MediaUpload.js';
import { editMessage, deleteMessage, reactToMessage, clearChat, blockChat, EDIT_WINDOW_MS } from '../src/services/chatActions.js';
import { sendMessage, listMessages, authorizeConversation, conversationPeers, toMessageItem } from '../src/services/communityService.js';
import { editMessageSchema, reactMessageSchema, deleteMessageSchema } from '../src/validators/community.js';
import { uploadSchema } from '../src/routes/mediaRoutes.js';
import { MEDIA_LIMITS, verifyMediaResource } from '../src/services/mediaService.js';
const owner='000000000000000000000001', peer='000000000000000000000002', outsider='000000000000000000000003', thread='000000000000000000000010', other='000000000000000000000011', id='000000000000000000000101';
const query=value=>({select(){return this},sort(){return this},limit(){return this},lean:async()=>value});
const equal=(a,b)=>String(a)===String(b);
function matches(row, filter) {
 return Object.entries(filter).every(([key,value])=>{
  const actual=row[key]; if(value===null) return actual==null;
  if(value && typeof value==='object') {
   if('$ne' in value) return !(Array.isArray(actual)?actual:[actual]).some(item=>equal(item,value.$ne));
   if('$in' in value) return value.$in.some(item=>equal(item,actual));
   if('$gt' in value) return actual>value.$gt;
   if('$lte' in value) return actual<=value.$lte;
  }
  return equal(actual,value);
 });
}
function apply(row, update) {
 for(const [key,value] of Object.entries(update.$set??{})) { if(key.startsWith('reactions.')) row.reactions[key.slice(10)]=value; else row[key]=value; }
 for(const key of Object.keys(update.$unset??{})) delete row.reactions[key.slice(10)];
 for(const [key,value] of Object.entries(update.$inc??{})) row[key]=(row[key]??0)+value;
 for(const [key,value] of Object.entries(update.$addToSet??{})) { row[key]??=[]; if(!row[key].some(item=>equal(item,value))) row[key].push(value); }
 for(const [key,value] of Object.entries(update.$pull??{})) row[key]=(row[key]??[]).filter(item=>!equal(item,value));
}
function fixture(t) {
 const conversation={_id:thread,members:[owner,peer],blockedBy:[]};
 const row={_id:id,conversation:thread,from:owner,text:'Original',createdAt:new Date(),readBy:[owner],reactions:{},hiddenFor:[],deletedAt:null,revision:0};
 const rows=[row];
 t.mock.method(Conversation,'findById',()=>query(conversation));
 t.mock.method(User,'find',()=>query([{_id:owner,name:'A'},{_id:peer,name:'B'}]));
 t.mock.method(Message,'findOne',filter=>query(rows.find(item=>matches(item,filter))??null));
 t.mock.method(Message,'find',filter=>query(rows.filter(item=>matches(item,filter))));
 t.mock.method(Message,'findOneAndUpdate',(filter,update)=>{const found=rows.find(item=>matches(item,filter));if(found)apply(found,update);return query(found??null)});
 t.mock.method(Message,'updateOne',async(filter,update)=>{for(const item of rows.filter(item=>matches(item,filter)))apply(item,update)});
 t.mock.method(Message,'updateMany',async(filter,update)=>{for(const item of rows.filter(item=>matches(item,filter)))apply(item,update)});
 t.mock.method(Conversation,'updateOne',async(_filter,update)=>apply(conversation,update));
 t.mock.method(MediaUpload,'updateOne',async()=>({}));
 t.mock.method(Message,'create',async data=>{const result={...data,_id:'000000000000000000000102',createdAt:new Date()};rows.push(result);return result});
 return {row,rows,conversation};
}

test('only the sender can edit and the 20-minute deadline is enforced in the write',async t=>{
 const {row}=fixture(t); const input={conversationId:thread,messageId:id,text:'Edited'};
 await assert.rejects(editMessage(peer,input),/own messages/);
 await assert.rejects(editMessage(outsider,input),/not yours/);
 const result=await editMessage(owner,input); assert.equal(result.message.text,'Edited');assert.ok(result.message.editedAt);assert.equal(result.message.revision,1);
 row.createdAt=new Date(Date.now()-EDIT_WINDOW_MS-1);
 await assert.rejects(editMessage(owner,{...input,text:'Too late'}),/20 minutes/);assert.equal(row.text,'Edited');
});
test('four reactions replace the reader’s own reaction and can be removed independently',async t=>{
 const {row}=fixture(t);const input={conversationId:thread,messageId:id};
 await reactToMessage(owner,{...input,emoji:'❤️'});await reactToMessage(peer,{...input,emoji:'😂'});await reactToMessage(owner,{...input,emoji:'👍'});
 assert.deepEqual(row.reactions,{[owner]:'👍',[peer]:'😂'});
 await reactToMessage(owner,{...input,emoji:null});assert.deepEqual(row.reactions,{[peer]:'😂'});
 await assert.rejects(reactToMessage(owner,{...input,emoji:'🔥'}),/four reactions/);
 await assert.rejects(reactToMessage(outsider,{...input,emoji:'❤️'}),/not yours/);
});
test('individual delete and clear are private and cannot hide later arrivals',async t=>{
 const {row,rows}=fixture(t);
 await deleteMessage(peer,{conversationId:thread,messageId:id,scope:'me'});
 assert.equal((await listMessages(peer,thread)).length,0);assert.equal((await listMessages(owner,thread)).length,1);
 rows.push({...row,_id:'000000000000000000000103',createdAt:new Date(Date.now()+60000),hiddenFor:[]});
 await clearChat(owner,thread);
 assert.equal((await listMessages(owner,thread)).length,1);assert.equal((await listMessages(owner,thread))[0].id,rows[1]._id);
 assert.equal(row.text,'Original');
});
test('delete for everyone is sender-only and removes text, media, reactions and reply content',async t=>{
 const {row}=fixture(t);row.attachment={id:'000000000000000000000200',kind:'image',url:'private'};row.reactions={[peer]:'❤️'};
 await assert.rejects(deleteMessage(peer,{conversationId:thread,messageId:id,scope:'everyone'}),/own messages/);
 const {message}=await deleteMessage(owner,{conversationId:thread,messageId:id,scope:'everyone'});
 assert.equal(message.deleted,true);assert.equal(message.text,'');assert.equal(message.attachment,null);assert.deepEqual(message.reactions,[]);
 await assert.rejects(reactToMessage(peer,{conversationId:thread,messageId:id,emoji:'👍'}),/deleted/);
});
test('replies are scoped to the same thread and do not expose hidden or deleted messages',async t=>{
 const {row}=fixture(t);
 const sent=await sendMessage(peer,thread,'A reply','reply-1',null,id);assert.equal(sent.message.reply.text,'Original');
 row.conversation=other;await assert.rejects(sendMessage(peer,thread,'Wrong thread','reply-2',null,id),/no longer available/);
 row.conversation=thread;row.hiddenFor=[peer];await assert.rejects(sendMessage(peer,thread,'Hidden','reply-3',null,id),/no longer available/);
 row.hiddenFor=[];row.deletedAt=new Date();const history=await listMessages(peer,thread);assert.equal(history.find(item=>item.reply)?.reply.deleted,true);
});
test('a block prevents messages, media grants and typing from either side until unblocked',async t=>{
 const {conversation}=fixture(t);await blockChat(owner,thread,true);
 for(const user of [owner,peer]) { await assert.rejects(sendMessage(user,thread,'Blocked'),/unavailable/);await assert.rejects(authorizeConversation(user,thread),/unavailable/);await assert.rejects(conversationPeers(thread,user),/unavailable/); }
 await assert.rejects(blockChat(outsider,thread,false),/not yours/);
 await blockChat(peer,thread,true);await blockChat(owner,thread,false);assert.deepEqual(conversation.blockedBy,[peer]);await assert.rejects(authorizeConversation(owner,thread),/unavailable/);
 await blockChat(peer,thread,false);assert.ok(await authorizeConversation(owner,thread));
});
test('validators reject forged actions and accept up to 100 MB audio/video',()=>{
 const envelope=body=>({body,query:{},params:{}});const base={conversationId:thread,messageId:id};
 assert.equal(editMessageSchema.safeParse(envelope({...base,text:'New',from:peer})).success,false);
 assert.equal(reactMessageSchema.safeParse(envelope({...base,emoji:'🔥'})).success,false);
 assert.equal(deleteMessageSchema.safeParse(envelope({...base,scope:'everyone'})).success,true);
 for(const kind of ['audio','video']) {
  assert.equal(MEDIA_LIMITS[kind],100_000_000);
  assert.equal(uploadSchema.safeParse(envelope({purpose:'chat',conversation:thread,kind,name:'media.mp4',size:100_000_000})).success,true);
  assert.equal(uploadSchema.safeParse(envelope({purpose:'chat',conversation:thread,kind,name:'media.mp4',size:100_000_001})).success,false);
  const upload={kind,purpose:'chat',publicId:'test'};const resource={public_id:'test',resource_type:'video',type:'authenticated',format:'mp4',bytes:100_000_000,width:kind==='video'?640:0,height:kind==='video'?480:0};
  assert.equal(verifyMediaResource(upload,resource).bytes,100_000_000);assert.throws(()=>verifyMediaResource(upload,{...resource,bytes:100_000_001}));
 }
 assert.deepEqual(toMessageItem({_id:id,conversation:thread,from:owner,text:'secret',attachment:{url:'secret'},deletedAt:new Date(),readBy:[]},peer).attachment,null);
});
