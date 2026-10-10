// A provider can fail after its headers or first body bytes have reached the
// worker. End that connection; writing another status would crash the harness.
export function sendAdapterError(response,error){
  if(response.destroyed||response.writableEnded)return;
  if(response.headersSent){response.destroy();return;}
  response.writeHead(500,{'content-type':'application/json'});
  response.end(JSON.stringify({ok:false,error:String(error.message||error)}));
}
