import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../src/models/User.js';
import { Conversation } from '../src/models/Conversation.js';
import { ChatRequest } from '../src/models/ChatRequest.js';
import { Message } from '../src/models/Message.js';
import { accountExperience, assertCommunityUser, PERSONAL_ACCOUNT_EMAIL } from '../src/services/accountExperience.js';
import * as community from '../src/services/communityService.js';

const a = '000000000000000000000001';
const b = '000000000000000000000002';
const hidden = '000000000000000000000003';
const privateThread = '000000000000000000000011';
const publicThread = '000000000000000000000012';
const users = [
  {_id:a, name:'Listener A', email:'a@example.com'},
  {_id:b, name:'Listener B', email:'b@example.com'},
  {_id:hidden, name:'Private listener', email:PERSONAL_ACCOUNT_EMAIL},
];
const threads = [
  {_id:privateThread, members:[a,hidden]},
  {_id:publicThread, members:[a,b]},
];
const requests = [
  {_id:'r1',from:hidden,to:a,status:'pending'},
  {_id:'r2',from:b,to:a,status:'pending'},
  {_id:'r3',from:a,to:hidden,status:'pending'},
];
function matches(row, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const value=row[key];
    if (key==='$or') return expected.some(item=>matches(row,item));
    if (expected instanceof RegExp) return expected.test(value ?? '');
    if (expected && typeof expected==='object') {
      if ('$ne' in expected && String(value)===String(expected.$ne)) return false;
      if ('$in' in expected && !expected.$in.map(String).includes(String(value))) return false;
      if ('$all' in expected && !expected.$all.every(id=>value.map(String).includes(String(id)))) return false;
      if ('$nin' in expected && (Array.isArray(value)?value:[value]).some(id=>expected.$nin.map(String).includes(String(id)))) return false;
      return true;
    }
    return Array.isArray(value) ? value.map(String).includes(String(expected)) : String(value)===String(expected);
  });
}
function query(value) {
  return {select(){return this},sort(){return this},limit(){return this},lean(){return Promise.resolve(value)},then(resolve,reject){return Promise.resolve(value).then(resolve,reject)}};
}
function database(t) {
  t.mock.method(User,'find',filter=>query(users.filter(u=>matches(u,filter))));
  t.mock.method(User,'findOne',filter=>query(users.find(u=>matches(u,filter))??null));
  t.mock.method(User,'findById',id=>query(users.find(u=>u._id===String(id))??null));
  t.mock.method(Conversation,'find',filter=>query(threads.filter(c=>matches(c,filter))));
  t.mock.method(Conversation,'findById',id=>query(threads.find(c=>c._id===String(id))??null));
  t.mock.method(ChatRequest,'find',filter=>query(requests.filter(r=>matches(r,filter))));
  t.mock.method(ChatRequest,'countDocuments',async filter=>requests.filter(r=>matches(r,filter)).length);
  t.mock.method(Message,'aggregate',async()=>[]);
  t.mock.method(Message,'countDocuments',async()=>0);
}

test('only the exact normalized account gets the personal experience',()=>{
  assert.equal(accountExperience({email:PERSONAL_ACCOUNT_EMAIL}), 'brown-burgundy');
  assert.equal(accountExperience({email:'  VIMITHARADOTTUKAYA@GMAIL.COM '}), 'brown-burgundy');
  for(const user of [null,{}, {email:'vimitharadottukaya@gmil.com'}, {email:'other@gmil.com'}]) {
    assert.equal(accountExperience(user),'standard');
  }
});

test('community access rejects the private account but preserves other listeners',async t=>{
  database(t);
  await assert.rejects(assertCommunityUser(hidden),{status:403});
  await assertCommunityUser(a);
});

test('people, old requests, conversations and profile lookups exclude the account',async t=>{
  database(t);
  assert.deepEqual((await community.listPeople(a)).map(u=>u.id),[b]);
  assert.deepEqual(await community.listPeople(a,PERSONAL_ACCOUNT_EMAIL),[]);
  const inbox=await community.listRequests(a);
  assert.deepEqual(inbox.incoming.map(r=>r.user.id),[b]);
  assert.deepEqual(inbox.outgoing,[]);
  assert.deepEqual((await community.listConversations(a)).map(c=>c.id),[publicThread]);
  assert.equal(await community.personView(hidden),null);
  assert.equal((await community.personView(b)).id,b);
  assert.equal(await community.conversationSummaryFor(a,privateThread),null);
  assert.equal((await community.conversationSummaryFor(a,publicThread)).user.id,b);
});

test('old thread URLs cannot read, send, mark read, or broadcast typing to the account',async t=>{
  database(t);
  for(const action of [
    ()=>community.listMessages(a,privateThread),
    ()=>community.sendMessage(a,privateThread,'Hello'),
    ()=>community.markRead(a,privateThread),
    ()=>community.conversationPeers(privateThread,a),
  ]) await assert.rejects(action,{status:404});
  assert.deepEqual(await community.conversationAudience(privateThread),[]);
  assert.deepEqual(await community.conversationPeers(publicThread,a),[b]);
  await assert.rejects(community.conversationPeers(publicThread,hidden),{status:403});
});

test('known user IDs and pending requests cannot bypass the exclusion',async t=>{
  database(t);
  await assert.rejects(community.sendRequest(a,hidden),{status:404});
  let saved=false;
  t.mock.method(ChatRequest,'findOne',()=>query({...requests[0],save:async()=>{saved=true}}));
  await assert.rejects(community.respondRequest(a,'r1',true),{status:404});
  assert.equal(saved,false);
});

test('badges do not count hidden conversations or requests',async t=>{
  database(t);
  t.mock.method(Message,'countDocuments',async filter=>{
    assert.deepEqual(filter.conversation.$in,[publicThread]);
    return 2;
  });
  assert.deepEqual(await community.summary(a),{unread:2,requests:1,online:0});
});

test('socket authentication rejects the private account before presence registration',async t=>{
  database(t);
  process.env.JWT_ACCESS_SECRET='test-access-secret-that-is-at-least-32-characters';
  process.env.JWT_REFRESH_SECRET='test-refresh-secret-that-is-at-least-32-characters';
  process.env.MONGO_URI='mongodb://127.0.0.1/test-not-connected';
  const {createServer}=await import('node:http');
  const {attachRealtime}=await import('../src/realtime/io.js');
  const {signAccessToken}=await import('../src/utils/tokens.js');
  const io=attachRealtime(createServer());
  try {
    const authenticate=io.of('/')._fns[0];
    const error=await new Promise(resolve=>authenticate({data:{},handshake:{auth:{token:signAccessToken({_id:hidden})}}},resolve));
    assert.equal(error?.message,'Unauthorized');
    const normalError=await new Promise(resolve=>authenticate({data:{},handshake:{auth:{token:signAccessToken({_id:a})}}},resolve));
    assert.equal(normalError,undefined);
  } finally { await new Promise(resolve=>io.close(resolve)); }
});
