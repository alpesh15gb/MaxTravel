import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";

export async function GET(req:Request){const secret=process.env.WA_VERIFY_TOKEN;if(!secret)return Response.json({error:"Inbound provider is not configured."},{status:503});const url=new URL(req.url);if(url.searchParams.get("hub.mode")==="subscribe"&&url.searchParams.get("hub.verify_token")===secret)return new Response(url.searchParams.get("hub.challenge"),{status:200});return new Response("Forbidden",{status:403});}

/**
 * Make an inbound message that could not be filed visible to somebody, instead of dropping it.
 *
 * Dropping it was the bug: the customer had sent a real message, the app answered 200, and nobody
 * ever knew it existed. An ambiguous number is fixable in seconds — two customers share a phone and
 * one of them is wrong — so it is raised for an administrator rather than filed on a guess.
 * Never throws: a failed report must not turn the provider's request into a 500.
 */
async function reportUnfiled(from: string, text: string, matches: { id: string; name: string }[]) {
  const preview = text.slice(0, 120);
  if (!matches.length) {
    console.warn(`[whatsapp] inbound message from ${from} matched no customer and was not filed: "${preview}"`);
    return;
  }
  const names = matches.map(m => m.name).join(", ");
  console.warn(`[whatsapp] inbound message from ${from} matched ${matches.length} customers (${names}) and was not filed: "${preview}"`);
  try {
    const admins = await prisma.user.findMany({
      where: { active: true, role: { key: { in: ["OWNER", "SUPER_ADMIN"] } } },
      select: { id: true },
    });
    if (!admins.length) return;
    await prisma.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        title: `Unfiled WhatsApp message from +${from}`,
        body: `Matches ${matches.length} customers (${names}). Open the message with the right one, or correct the duplicate phone number.`,
        link: "/whatsapp",
        severity: "WARNING",
      })),
    });
  } catch (e) {
    console.error("[whatsapp] could not raise a notification for an ambiguous number", e);
  }
}

/** Normalized adapter only; provider-specific signature verification must be configured before external use. */
export async function POST(req:Request){if(process.env.WA_PROVIDER==="meta")return new Response("Legacy webhook disabled",{status:410});const secret=process.env.WA_WEBHOOK_SECRET;if(!secret)return Response.json({error:"Inbound provider is not configured."},{status:503});const supplied=req.headers.get("authorization")??"",expected=`Bearer ${secret}`;if(Buffer.byteLength(supplied)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return new Response("Forbidden",{status:403});try{const b=await req.json();const from=String(b.from??"").replace(/\D/g,""),text=String(b.text??"").trim();if(from.length<10||from.length>15||!text||text.length>4000)return Response.json({error:"International phone and message text required."},{status:400});const customers=await prisma.customer.findMany({select:{id:true,phone:true,name:true}});const matches=customers.filter(c=>c.phone.replace(/\D/g,"")===from);if(matches.length!==1){await reportUnfiled(from,text,matches);return Response.json({ok:true,matched:false,reason:matches.length?"AMBIGUOUS":"NO_MATCH",candidates:matches.length});}const customer=matches[0];const thread=await prisma.$transaction(async tx=>{let t=await tx.whatsAppThread.findFirst({where:{customerId:customer.id}});if(!t)t=await tx.whatsAppThread.create({data:{customerId:customer.id,phone:customer.phone}});await tx.whatsAppMessage.create({data:{threadId:t.id,direction:"IN",body:text,status:"LOGGED"}});await tx.whatsAppThread.update({where:{id:t.id},data:{lastMsgAt:new Date(),unread:{increment:1}}});return t;});return Response.json({ok:true,matched:true,threadId:thread.id});}catch(e){console.error(e);return Response.json({error:"Could not log inbound message."},{status:500});}}