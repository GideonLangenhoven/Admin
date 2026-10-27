import { describe, expect, it } from "vitest";
import { webChatFixture } from "../helpers/web-chat-fixture";

const alerts = (fixture: ReturnType<typeof webChatFixture>) => fixture.calls.filter(call=>call.kind==="whatsapp-alert");

describe("operator WhatsApp alerts for web chat human requests", () => {
  for(const message of ["btn:human","I want to speak to a human"]){
    it(`alerts the saved business WhatsApp contact for ${message}`,async()=>{
      const f=webChatFixture();
      Object.assign(f.business,{public_whatsapp:"+27820000000"});
      f.rows.businesses.push({...f.business,id:"other",public_whatsapp:"+27829999999"});
      const token=await f.session();
      await f.post(token,"How long is the tour?");
      const result=await f.post(token,message);
      expect(result.state.status).toBe("HUMAN");
      expect(alerts(f)).toHaveLength(1);
      expect(alerts(f)[0]).toMatchObject({name:"a",data:{to:"+27820000000",template:{name:"web_chat_handoff",language:"en"}}});
      const [brand,url]=alerts(f)[0].data.template.params;
      expect(brand).toBe(f.business.business_name);
      expect(new URL(url).origin).toBe("https://admin.bookingtours.co.za");
      expect(new URL(url).searchParams.get("phone")).toBe(f.rows.conversations[0].phone);
      expect(alerts(f)[0].data.message).not.toContain("How long is the tour?");
      await f.post(token,"Here are some more details",result.state);
      await f.post(token,"btn:human",result.state);
      expect(alerts(f)).toHaveLength(1);
    });
  }

  it("alerts when the visitor accepts an offered human handoff",async()=>{
    const f=webChatFixture();Object.assign(f.business,{public_whatsapp:"+27820000000"});
    const result=await f.post(await f.session(),"yes",{step:"IDLE",offered_handoff:true});
    expect(result.state.status).toBe("HUMAN");expect(alerts(f)).toHaveLength(1);
  });

  for(const message of ["Where do we meet?","I don't want to speak to a human","I'm getting a lawyer","I have chest pain"]){
    it(`does not send an operator WhatsApp alert for ${message}`,async()=>{
      const f=webChatFixture();Object.assign(f.business,{public_whatsapp:"+27820000000"});
      await f.post(await f.session(),message);
      expect(alerts(f)).toEqual([]);
    });
  }

  it("retains the handoff when WhatsApp sending fails or no contact is saved",async()=>{
    for(const missingContact of [false,true]){
      const f=webChatFixture();
      if(!missingContact)Object.assign(f.business,{public_whatsapp:"+27820000000"});
      f.failures["whatsapp-alert"]=true;
      const result=await f.post(await f.session(),"btn:human");
      expect(result.status).toBe(200);expect(result.state.status).toBe("HUMAN");
      expect(f.rows.chat_messages).toHaveLength(2);
      expect(alerts(f)).toHaveLength(missingContact?0:1);
    }
  });

  it("never alerts for a handoff that could not be saved",async()=>{
    const f=webChatFixture();Object.assign(f.business,{public_whatsapp:"+27820000000"});
    f.failures["insert:chat_messages"]={message:"Unavailable"};
    expect((await f.post(await f.session(),"btn:human")).status).toBe(500);
    expect(alerts(f)).toEqual([]);
  });
});
