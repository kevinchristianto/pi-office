import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridge}from '../bridge/server.mjs';

test('production HTML and every referenced entry asset are served locally with CSP',async()=>{
  const bridge=await createBridge({token:'production-test-only-token-00000000000000',port:0});
  const url=await bridge.listen();
  try {
    const page=await fetch(url);assert.equal(page.status,200);
    assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);
    const html=await page.text();assert.match(html,/<title>Pi Office/);
    const paths=[...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m=>m[1]);
    assert.ok(paths.length>=2);
    for(const asset of paths){const response=await fetch(url+asset);assert.equal(response.status,200,asset);assert.ok((await response.arrayBuffer()).byteLength>0)}
  } finally {await bridge.close()}
});
