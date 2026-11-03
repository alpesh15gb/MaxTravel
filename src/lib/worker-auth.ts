import {timingSafeEqual} from "node:crypto";
export function bearerMatches(req:Request,secret:string|undefined){if(!secret||secret.length<32)return false;const actual=Buffer.from(req.headers.get("authorization")??""),expected=Buffer.from(`Bearer ${secret}`);return actual.length===expected.length&&timingSafeEqual(actual,expected);}
