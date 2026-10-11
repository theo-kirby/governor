import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseReportGraph} from '../shared/report';
const fixture=()=>({schemaVersion:1,repositoryId:'synthetic',head:'sha256:'+'a'.repeat(64),loadedAt:'2026-10-11T12:00:00Z',nodes:[{id:'a',title:'Root',parentId:null,childCount:0,edgeCount:0,lifecycle:'live'}],edges:[]});
test('report projection keeps topology, discards paths, bodies, tags and staged data',()=>{
 const f=fixture();const g=parseReportGraph({...f,repo:'/private/repo',stagedOperations:4,nodes:[{...f.nodes[0],content:'private body',tags:[{id:'secret'}]}]});
 assert.deepEqual(g,{...f,nodes:[{...f.nodes[0],tags:[]}]});
});
test('report projection rejects malformed topology and oversized input',()=>{
 const f=fixture();
 for(const bad of [{...f,head:'not-a-head'},{...f,loadedAt:'yesterday'},{...f,nodes:[f.nodes[0],f.nodes[0]]},{...f,nodes:[{...f.nodes[0],parentId:'absent'}]},{...f,edges:[{id:'edge',source:'a',target:'absent',kind:'semantic'}]},{...f,nodes:[{...f.nodes[0],title:'x'.repeat(2001)}]}])assert.throws(()=>parseReportGraph(bad));
 assert.deepEqual(parseReportGraph({...f,nodes:[],edges:[]}).nodes,[]);
});

test('Governor role, status, record age and edge relations survive projection',()=>{
 const f=fixture();const tags=[{id:'graph:root',name:'root'},{id:'status:working',name:'working'}];
 const g=parseReportGraph({...f,nodes:[{...f.nodes[0],tags,createdAt:f.loadedAt}],edges:[{id:'e',source:'a',target:'a',kind:'semantic',relation:'citation',content:'private body'}]});
 assert.deepEqual(g.nodes[0].tags,tags);assert.equal(g.nodes[0].createdAt,f.loadedAt);assert.equal(g.edges[0].relation,'citation');assert.equal(g.edges[0].content,undefined);
});
