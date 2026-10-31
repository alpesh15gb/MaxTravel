/** Use an operator-configured address, or Vercel's trusted per-deployment hostname. */
export function configuredAppOrigin(env:NodeJS.ProcessEnv=process.env):string|undefined{
 if(env.APP_ORIGIN)return env.APP_ORIGIN;
 if(env.VERCEL==='1'&&env.VERCEL_URL&&/^[a-z0-9-]+\.vercel\.app$/i.test(env.VERCEL_URL))return 'https://'+env.VERCEL_URL;
 return undefined;
}
