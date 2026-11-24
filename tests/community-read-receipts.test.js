import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../src/models/User.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { listMessages, markRead } from '../src/services/communityService.js';
import { markReadSchema } from '../src/validators/community.js';

const sender='000000000000000000000001', receiver='000000000000000000000002', outsider='000000000000000000000003';
const conversationId='000000000000000000000010', otherConversation='000000000000000000000011';
const id=n=>String(n).padStart(24,'0');
function fixture(t) {
  const rows=[
    {_id:id(101),conversation:conversationId,from:sender,text:'Hello',createdAt:new Date(),readBy:[sender]},
    {_id:id(102),conversation:conversationId,from:receiver,text:'Reply',createdAt:new Date(),readBy:[receiver]},
    {_id:id(103),conversation:otherConversation,from:sender,text:'Private',createdAt:new Date(),readBy:[sender]},
  ];
  const query=value=>({select(){return this},sort(){return this},limit(){return this},lean:async()=>value});
  const matches=(row,filter)=>Object.entries(filter).every(([key,value])=>{
    const actual=row[key];
    if(value && typeof value==='object') {
      if('$in' in value)return value.$in.map(String).includes(String(actual));
      if('$ne' in value)return !(Array.isArray(actual)?actual.map(String):[String(actual)]).includes(String(value.$ne));
    }
    return String(actual)===String(value);
  });
  t.mock.method(Conversation,'findById',()=>query({_id:conversationId,members:[sender,receiver]}));
  t.mock.method(User,'find',()=>query([{_id:sender,name:'Sender'},{_id:receiver,name:'Receiver'}]));
  t.mock.method(Message,'find',filter=>query(rows.filter(row=>matches(row,filter))));
  const writes=t.mock.method(Message,'updateMany',async(filter,update)=>{
    for(const row of rows.filter(row=>matches(row,filter))) if(!row.readBy.includes(update.$addToSet.readBy)) row.readBy.push(update.$addToSet.readBy);
  });
  t.mock.method(Message,'countDocuments',async filter=>rows.filter(row=>matches(row,filter)).length);
  return {rows,writes,matches};
}

test('sender receipt is persisted and returned after reloading messages',async t=>{
  const f=fixture(t);
  assert.equal((await listMessages(sender,conversationId)).find(m=>m.id===id(101)).seen,false);
  const receipt=await markRead(receiver,conversationId,[id(101)]);
  assert.deepEqual(receipt.messageIds,[id(101)]);
  assert.equal(receipt.unread,0);
  assert.equal((await listMessages(sender,conversationId)).find(m=>m.id===id(101)).seen,true);
  await markRead(receiver,conversationId,[id(101)]);
  assert.equal(f.rows[0].readBy.length,2);
});

test('receipt is scoped to the conversation and excludes the reader’s own messages',async t=>{
  const f=fixture(t);
  const receipt=await markRead(receiver,conversationId,[id(102),id(103)]);
  assert.deepEqual(receipt.messageIds,[]);
  assert.equal(receipt.unread,1);
  assert.equal(f.writes.mock.callCount(),0);
  await assert.rejects(markRead(outsider,conversationId,[id(101)]),/not yours/);
  assert.equal(f.writes.mock.callCount(),0);
});

test('new arrivals during a read write are not accidentally marked Seen',async t=>{
  const f=fixture(t);
  f.writes.mock.mockImplementation(async(filter,update)=>{
    f.rows.push({_id:id(104),conversation:conversationId,from:sender,text:'New',createdAt:new Date(),readBy:[sender]});
    for(const row of f.rows.filter(row=>f.matches(row,filter))) row.readBy.push(update.$addToSet.readBy);
  });
  const receipt=await markRead(receiver,conversationId);
  assert.deepEqual(receipt.messageIds,[id(101)]);
  assert.equal(receipt.unread,1);
  assert.deepEqual(f.rows.at(-1).readBy,[sender]);
});

test('read request IDs are validated and bounded; older clients remain supported',()=>{
  const parse=body=>markReadSchema.safeParse({body,query:{},params:{}}).success;
  assert.equal(parse({conversationId}),true);
  assert.equal(parse({conversationId,messageIds:[id(101)]}),true);
  assert.equal(parse({conversationId,messageIds:[]}),false);
  assert.equal(parse({conversationId,messageIds:['invalid']}),false);
  assert.equal(parse({conversationId,messageIds:Array(101).fill(id(101))}),false);
});
