import {getVercelOidcToken} from '@vercel/oidc';
/** Deployment access supplements the existing application signature; it never replaces it. */
export async function deploymentProtectionHeaders(url:string|URL,headers:Record<string,string>,env:Readonly<Record<string,string|undefined>>=process.env,readToken:()=>Promise<string>=async()=>getVercelOidcToken()):Promise<Record<string,string>>{
 if(env.VERCEL!=='1')return headers;
 let origins:unknown;try{origins=JSON.parse(env.PROTECTED_API_ORIGINS||'[]');}catch{throw Error('Protected API origins must be a JSON array of HTTPS origins.');}
 if(!Array.isArray(origins)||!origins.every(value=>{if(typeof value!=='string')return false;try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value;}catch{return false;}}))throw Error('Protected API origins must be a JSON array of HTTPS origins.');
 const target=new URL(String(url));if(target.protocol!=='https:'||!origins.includes(target.origin))return headers;
 const token=await readToken();if(!token)throw Error('Deployment identity is unavailable.');
 return {...headers,'x-vercel-trusted-oidc-idp-token':token};
}
