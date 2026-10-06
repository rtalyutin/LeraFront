// Local preview only; production continues to use the existing NGINX image.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const port=Number(option('--port','4173')),host=option('--host','0.0.0.0');
const upstream=process.env.PREVIEW_BACKEND_URL||'http://127.0.0.1:8092';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname;
  if(pathname.startsWith('/api/')){
    const target=new URL(req.url,upstream);
    const proxy=http.request(target,{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
    proxy.on('error',()=>{res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'Локальный бэк недоступен.'}));});req.pipe(proxy);return;
  }
  if(pathname==='/healthz'){res.writeHead(200);res.end('ok');return;}
  try{const safe=decodeURIComponent(pathname),filename=path.resolve(root,'.'+(safe==='/'?'/index.html':safe));if(!filename.startsWith(root+path.sep))throw new Error('Forbidden');const content=await readFile(filename);res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store'});res.end(content);}catch{res.writeHead(404);res.end('Not found');}
}).listen(port,host,()=>console.log('Lera preview listening on port '+port));
