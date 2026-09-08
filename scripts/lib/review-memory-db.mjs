// Only an in-process cache for local public-GET review. Never opens a real database.
export function reviewMemoryDb(){
 const cache=new Map();return{prepare(sql){let args=[];return{
   bind(...a){args=a;return this;},
   async first(){return sql.startsWith('SELECT payload')?cache.get(args[0]):{n:0};},
   async run(){if(sql.startsWith('INSERT INTO preview_cache'))cache.set(args[0],{payload:args[1],fetched_at:new Date().toISOString()});return{meta:{changes:1}};}
 };}};
}
