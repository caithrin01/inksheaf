import assert from 'node:assert/strict';
import {preparedPressArgs} from './run-prepared-press.mjs';
const image='ghcr.io/caithrin01/inksheaf-press@sha256:'+'a'.repeat(64),sha='b'.repeat(40),secret='do-not-print',env={OPENROUTER_API_KEY:secret,PUBLICATION_URL:'https://example.com',HOME:'/private',UNRELATED_SECRET:secret};
const args=preparedPressArgs({image,sha,output:'/tmp/press-output',env});
assert(!args.join(' ').includes(secret));assert(!args.includes('HOME'));assert(!args.includes('UNRELATED_SECRET'));assert(args.includes('OPENROUTER_API_KEY'));assert(args.includes('GITHUB_SHA='+sha));assert.equal(args.at(-1),image);
for(const bad of [image.replace('caithrin01','someone'),image.replace('@sha256:','/'),image+'\n--privileged','ghcr.io/caithrin01/inksheaf-press:latest'])assert.throws(()=>preparedPressArgs({image:bad,sha,output:'/tmp/out',env}));
assert.throws(()=>preparedPressArgs({image,sha:'main',output:'/tmp/out',env}));
console.log('PASS immutable release image, exact source identity, explicit environment and no credentials in process arguments');
