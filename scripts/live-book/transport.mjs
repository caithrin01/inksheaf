// Live-book test transport. Every child HTTP request is handled by the parent
// test harness; only the parent can permit an external destination.
const native=globalThis.fetch,origin=process.env.ACCEPTANCE_ORIGIN;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin||''))throw Error('Missing isolated transport');
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init),url=new URL(request.url);
 if(url.origin===origin)return native(request);
 const body=['GET','HEAD'].includes(request.method)?null:Buffer.from(await request.arrayBuffer()).toString('base64');
 const response=await native(origin+'/__transport',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:request.url,method:request.method,headers:[...request.headers],body}),signal:request.signal});
 return response;
};
