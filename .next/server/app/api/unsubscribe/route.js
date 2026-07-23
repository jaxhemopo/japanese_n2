"use strict";(()=>{var e={};e.id=297,e.ids=[297],e.modules={2934:e=>{e.exports=require("next/dist/client/components/action-async-storage.external.js")},4580:e=>{e.exports=require("next/dist/client/components/request-async-storage.external.js")},5869:e=>{e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},1282:e=>{e.exports=require("child_process")},4770:e=>{e.exports=require("crypto")},665:e=>{e.exports=require("dns")},7702:e=>{e.exports=require("events")},2048:e=>{e.exports=require("fs")},2615:e=>{e.exports=require("http")},5240:e=>{e.exports=require("https")},8216:e=>{e.exports=require("net")},9801:e=>{e.exports=require("os")},5315:e=>{e.exports=require("path")},8621:e=>{e.exports=require("punycode")},6162:e=>{e.exports=require("stream")},2452:e=>{e.exports=require("tls")},7360:e=>{e.exports=require("url")},1764:e=>{e.exports=require("util")},1568:e=>{e.exports=require("zlib")},4087:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>h,patchFetch:()=>x,requestAsyncStorage:()=>g,routeModule:()=>d,serverHooks:()=>f,staticGenerationAsyncStorage:()=>m});var i={};r.r(i),r.d(i,{GET:()=>c,dynamic:()=>u});var n=r(633),a=r(6488),s=r(3342),o=r(223),l=r(1247),p=r(4104);let u="force-dynamic";async function c(e){let t=e.nextUrl.searchParams.get("token");if(!t)return new o.NextResponse("Missing token.",{status:400,headers:{"Content-Type":"text/plain; charset=utf-8"}});let r=(0,l.r_)(t);if(!r)return new o.NextResponse("This unsubscribe link is invalid or has expired. Please visit your settings page to unsubscribe from there.",{status:400,headers:{"Content-Type":"text/plain; charset=utf-8"}});let i=(0,p.m)(),n=new Date().toISOString();await i.from("n2_subscribers").upsert({user_id:r,unsubscribed_at:n},{onConflict:"user_id"});let a=`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Unsubscribed &middot; N2 Daily Mock</title>
  <style>
    body { font-family: Georgia, serif; background: #F5F2EA; color: #1A1A18; margin: 0; padding: 60px 24px; text-align: center; }
    .card { max-width: 480px; margin: 0 auto; background: #ECE8DD; border-radius: 8px; padding: 48px 36px; }
    h1 { font-size: 24px; font-weight: 600; margin: 0 0 16px; }
    p { font-size: 14px; color: #5B5A54; line-height: 1.7; margin: 0 0 16px; }
    a { color: #2B5B4F; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Unsubscribed.</h1>
    <p>You won't receive any more daily-mock notification emails.</p>
    <p><a href="https://japanese-n2.vercel.app/settings">Manage settings</a> &middot; <a href="https://japanese-n2.vercel.app">Home</a></p>
  </div>
</body>
</html>`;return new o.NextResponse(a,{status:200,headers:{"Content-Type":"text/html; charset=utf-8"}})}let d=new n.AppRouteRouteModule({definition:{kind:a.x.APP_ROUTE,page:"/api/unsubscribe/route",pathname:"/api/unsubscribe",filename:"route",bundlePath:"app/api/unsubscribe/route"},resolvedPagePath:"/Users/jacksonhemopo/projects/japanese-n2/app/api/unsubscribe/route.ts",nextConfigOutput:"",userland:i}),{requestAsyncStorage:g,staticGenerationAsyncStorage:m,serverHooks:f}=d,h="/api/unsubscribe/route";function x(){return(0,s.patchFetch)({serverHooks:f,staticGenerationAsyncStorage:m})}},1247:(e,t,r)=>{r.d(t,{HS:()=>d,XZ:()=>f,r_:()=>g});var i=r(4770),n=r.n(i),a=r(8184);let s=process.env.GMAIL_USER,o=process.env.GMAIL_APP_PASSWORD,l=process.env.UNSUBSCRIBE_SECRET||"dev-only-secret-rotate-this-in-v1",p=process.env.EMAIL_FROM||(s?`N2 Daily Mock <${s}>`:"N2 Daily Mock <onboarding@resend.dev>"),u=process.env.NEXT_PUBLIC_BASE_URL||"https://japanese-n2.vercel.app",c=null;function d(e){let{userId:t,date:r,focus:i}=e,a=function(e){let t=`${e}.${Math.floor(Date.now()/1e3)}`,r=n().createHmac("sha256",l).update(t).digest("base64url");return`${Buffer.from(t).toString("base64url")}.${r}`}(t),s=`${u}/api/unsubscribe?token=${encodeURIComponent(a)}`,o=`${u}/today`,p=`${u}/settings`,c=new Date(`${r}T00:00:00+09:00`),d=c.toLocaleDateString("en-US",{month:"long",timeZone:"Asia/Tokyo"}),g=c.getUTCDate(),m=`${d} ${g}`,f=`今日の N2 モック公開 — ${m}`,h=`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${f}</title>
</head>
<body style="margin:0;padding:0;background:#3A3D2F;font-family:Georgia,'Times New Roman',serif;color:#1A1A18;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#3A3D2F;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="background:#F5F2EA;border-radius:8px;padding:36px 32px 28px 32px;">

              <div style="font-family:Georgia,serif;font-style:italic;font-size:14px;color:#5B5A54;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 8px 0;">
                N2 Daily Mock Exam
              </div>

              <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:600;color:#1A1A18;margin:0 0 4px 0;line-height:1.2;letter-spacing:-0.01em;">
                今日の N2 モック公開
              </h1>

              <div style="font-family:Georgia,serif;font-size:15px;color:#5B5A54;font-style:italic;margin:0 0 20px 0;">
                ${m} &middot; Today's focus: ${i.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
              </div>

              <div style="background:#ECE8DD;border-radius:6px;padding:14px 18px;margin:0 0 24px 0;">
                <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:500;color:#5B5A54;text-transform:uppercase;letter-spacing:1.2px;margin:0 0 6px 0;">
                  What you'll see
                </div>
                <ul style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1A1A18;margin:0;padding-left:18px;line-height:1.6;">
                  <li>5 questions across reading, grammar, and vocabulary</li>
                  <li>~7 minutes total &middot; score &amp; explanations immediately</li>
                  <li>Streak counts each day you finish</li>
                </ul>
              </div>

              <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#1A1A18;margin:0 0 24px 0;">
                Today's mock is ready. Click below when you're set up &mdash; no rush, today's stays open all day.
              </p>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background:#2B5B4F;border-radius:6px;">
                    <a href="${o}" target="_blank" style="display:inline-block;padding:14px 28px;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;letter-spacing:0.3px;text-decoration:none;border-radius:6px;">
                      今日のモックを受ける &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <div style="border-top:1px solid #C9C2B0;padding-top:16px;margin-top:8px;">
                <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#8A8880;line-height:1.6;margin:0;">
                  You're getting this because you subscribed at
                  <a href="${p}" style="color:#5B5A54;text-decoration:underline;">your settings</a>.
                  Don't want these? <a href="${s}" style="color:#8A8880;text-decoration:underline;">Unsubscribe</a>.
                </p>
              </div>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;return{subject:f,html:h,text:`今日の N2 モック公開 — ${m}

Today's focus: ${i}

Today's mock is ready. ~7 minutes, 5 questions, scored instantly.

Take today's mock: ${o}

---
You're getting this because you subscribed. Manage: ${p}
Unsubscribe: ${s}`}}function g(e){try{let t=e.split(".");if(4!==t.length)return null;let[r,i,a]=t;if(!r||!i||!a)return null;let s=Buffer.from(r,"base64url").toString("utf8"),o=`${s}.${i}`,p=n().createHmac("sha256",l).update(o).digest("base64url");if(a.length!==p.length||!n().timingSafeEqual(Buffer.from(a),Buffer.from(p)))return null;let u=parseInt(i,10);if(!Number.isFinite(u)||Date.now()/1e3-u>5184e3)return null;return s}catch{return null}}async function m(e,t){let r=c||(s&&o?c=a.createTransport({host:"smtp.gmail.com",port:587,secure:!1,requireTLS:!0,auth:{user:s,pass:o},connectionTimeout:1e4,greetingTimeout:1e4,socketTimeout:2e4,tls:{rejectUnauthorized:!0,minVersion:"TLSv1.2"}}):null);if(!r)return{ok:!1,error:"Gmail SMTP not configured — GMAIL_USER and/or GMAIL_APP_PASSWORD missing in env"};try{let i=await r.sendMail({from:p,to:e,subject:t.subject,html:t.html,text:t.text,headers:{"X-Mailer":"japanese-n2-cron/1.0 (Vercel)"}});return{ok:!0,resendId:i.messageId}}catch(e){return{ok:!1,error:e instanceof Error?e.message:String(e)}}}async function f(e,t,r=3){let i;for(let n=1;n<=r;n++){let a=await m(e,t);if(a.ok)return{ok:!0,resendId:a.resendId,attempts:n};if(i=a.error,n<r){let e=1e3*Math.pow(2,n-1);await new Promise(t=>setTimeout(t,e))}}return{ok:!1,error:i,attempts:r}}},4104:(e,t,r)=>{r.d(t,{$:()=>o,m:()=>l});var i=r(8458),n=r(3760),a=r(1143);function s(e){let t=process.env[e];if(!t)throw Error(`[supabase] Missing required env var ${e}. Set it in .env.local before starting the dev server.`);return t}function o(){let e=(0,i.cookies)();return(0,n.l)(s("NEXT_PUBLIC_SUPABASE_URL"),s("NEXT_PUBLIC_SUPABASE_ANON_KEY"),{cookies:{get:t=>e.get(t)?.value,set(t,r,i){try{e.set({name:t,value:r,...i})}catch{}},remove(t,r){try{e.set({name:t,value:"",...r})}catch{}}}})}function l(){return(0,a.eI)(s("NEXT_PUBLIC_SUPABASE_URL"),s("SUPABASE_SERVICE_ROLE_KEY"),{auth:{autoRefreshToken:!1,persistSession:!1}})}},3760:(e,t,r)=>{r.d(t,{l:()=>i.l});var i=r(4976)}};var t=require("../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),i=t.X(0,[378,30,976,606,578],()=>r(4087));module.exports=i})();