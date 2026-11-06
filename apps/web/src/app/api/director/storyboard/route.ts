import { getServerEnv } from "@motion-dna/config";
import { BriefSchema, DNAResultSchema, StoryboardSchema } from "@motion-dna/dna-schema";
export async function POST(request:Request){
 const headers={"Cache-Control":"no-store"};
 const origin=request.headers.get("origin");if(origin&&!getServerEnv().CORS_ALLOWED_ORIGINS.includes(origin))return Response.json({error:{message:"Origin not allowed."}},{status:403,headers});
 try{
  const reader=request.body?.getReader();if(!reader)throw new Error("input");const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>131072){await reader.cancel();return Response.json({error:{message:"Director input exceeds 128 KB."}},{status:413,headers});}chunks.push(value);}
  const input=BriefSchema.extend({dna:DNAResultSchema}).strict().parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  const response=await fetch(`${getServerEnv().API_BASE_URL}/api/director/storyboard`,{method:"POST",body:JSON.stringify(input),headers:{"Content-Type":"application/json"},signal:AbortSignal.timeout(18000),cache:"no-store"});
  if(!response.ok)return Response.json({error:{message:response.status===429?"The Director is busy. Please retry shortly.":"Director input was rejected or the service is unavailable."}},{status:response.status,headers});
  return Response.json(StoryboardSchema.parse(await response.json()),{headers});
 }catch{return Response.json({error:{message:"The Director could not be reached or its response was invalid. Check the local API and retry."}},{status:503,headers});}
}
