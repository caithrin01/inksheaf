import{readFileSync,writeFileSync,mkdirSync,existsSync}from'node:fs';
import{resolve}from'node:path';import{execFileSync}from'node:child_process';
import{fit}from'../lib/fit.mjs';
const root='output/private-acceptance',rows=JSON.parse(readFileSync(`${root}/fetch-results.json`)),results=[];
process.env.BOOK_ENGINE='typst';process.env.BLANK_MAX='0.30';
for(const picked of rows){
 const dir=`${root}/${picked.host}`,row=JSON.parse(readFileSync(`${dir}/fetch.json`));
 if(!row.selectedPosts){results.push({host:row.host,status:'no public binding route'});continue;}
 if(row.bodyErrors?.length){results.push({host:row.host,status:'incomplete body retrieval; not a passing print candidate',missing:row.bodyErrors.length});continue;}
 const marker=`${dir}/render.json`,previous=existsSync(marker)?JSON.parse(readFileSync(marker)):null;if(previous&&!process.argv.includes('--refresh')){results.push(previous);continue;}
 if(previous)writeFileSync(`${dir}/render-before-refresh.json`,JSON.stringify(previous,null,2));
 const html=`${dir}/interior.html`,pdf=resolve(`${dir}/interior.pdf`),args=['scripts/build-book.mjs',`https://${row.host}`,'--fixture',`${dir}/posts.json`,'--posts',`${dir}/selected-posts.json`,'--brand-file',`${dir}/brand.json`,'--out',html,'--print-interior','--images-print','--interior-bw','--engine','typst','--cover-design','masthead','--vol-label',row.volume,'--direct-links'];
 const result={host:row.host,started:new Date().toISOString(),selection:'first volume of recommended calendar route',selectedPosts:row.selectedPosts};const log=[];
 try{const res=fit({args,html,pdf,passes:10,initial:previous?.fit||{},log:m=>{log.push(m);console.log(row.host,m)}});result.fit=res;const report=JSON.parse(readFileSync(html.replace('.html','.report.json')));result.included=report.included;result.pubName=report.pubName;result.deadImages=report.deadImages;result.skips=report.skips;result.pages=+(res.out.match(/OK (\d+)/)?.[1]||0);result.status=res.ok?'rendered, requires whitespace and visual review':'failed';}
 catch(e){result.status='render failed';result.error=e.message;}
 result.completed=new Date().toISOString();writeFileSync(marker,JSON.stringify(result,null,2));writeFileSync(`${dir}/fit.log`,log.join('\n')+'\n');results.push(result);writeFileSync(`${root}/render-results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify({host:row.host,status:result.status,pages:result.pages,error:result.error}));
}
