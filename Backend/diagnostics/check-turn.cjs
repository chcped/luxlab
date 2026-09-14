const { chromium } = require('playwright');
(async () => {
 const browser = await chromium.launch({args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
 let failed = false;
 try {
  for (const transport of ['udp','tcp']) {
   const context = await browser.newContext(); const pages = [await context.newPage(), await context.newPage()];
   for (const page of pages) await page.goto('https://luxlab.net.br');
   let roomId;
   for (let i=0;i<2;i++) {
    roomId = await pages[i].evaluate(async ({roomId, transport, sender}) => {
     const { RoomClient } = await import('/room-client.mjs');
     const response = await fetch('/api/v2/rooms'+(roomId?`/${roomId}/join`:''), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile:{name:'Diagnóstico TURN'}})});
     if(!response.ok) throw Error(`API ${response.status}`);
     const session = await response.json(); if(session.iceTransportPolicy !== 'relay') throw Error('Relay não ativo');
     session.iceServers = session.iceServers.map(s=>({...s,urls:[].concat(s.urls).filter(u=>u.startsWith('turn:') && u.includes(`transport=${transport}`))})).filter(s=>s.urls.length);
     if(!session.iceServers.length) throw Error('TURN ausente');
     window.errors=[]; window.video=document.createElement('video'); window.video.muted=true; window.video.autoplay=true;document.body.append(window.video);
     window.client = new RoomClient(location.origin,session,{stream:(_,s)=>{window.video.srcObject=s;window.video.play().catch(()=>{});},warning:e=>window.errors.push(e),error:e=>window.errors.push(e)});
     await window.client.connect();
     if(sender) {
      const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');let frame=0;
      window.timer=setInterval(()=>{ctx.fillStyle=frame++%2?'#fc4444':'#44ccff';ctx.fillRect(0,0,1280,720);ctx.fillStyle='black';ctx.fillText(String(frame),100,100);},33);
      window.stream=canvas.captureStream(30);window.audio=new AudioContext();const oscillator=window.audio.createOscillator(), destination=window.audio.createMediaStreamDestination();oscillator.connect(destination);oscillator.start();await window.audio.resume();window.stream.addTrack(destination.stream.getAudioTracks()[0]);await window.client.setStream(window.stream);
     }
     return session.roomId;
    }, {roomId,transport,sender:i===0});
   }
   await new Promise(r=>setTimeout(r,22000));
   const results=await Promise.all(pages.map(p=>p.evaluate(async()=>{
    const peers=[];
    for(const {pc} of window.client.peers.values()) {
     const stats=await pc.getStats();const t=[...stats.values()].find(s=>s.type==='transport'&&s.selectedCandidatePairId);const pair=stats.get(t?.selectedCandidatePairId);
     peers.push({state:pc.connectionState,local:stats.get(pair?.localCandidateId)?.candidateType,remote:stats.get(pair?.remoteCandidateId)?.candidateType,relayProtocol:stats.get(pair?.localCandidateId)?.relayProtocol,rttMs:pair?.currentRoundTripTime*1000,media:[...stats.values()].filter(s=>s.type==='inbound-rtp').map(s=>({kind:s.kind,bytes:s.bytesReceived,frames:s.framesDecoded,fps:s.framesPerSecond,freezes:s.freezeCount,packetsLost:s.packetsLost}))});
    }
    return {peers,width:window.video.videoWidth,errors:window.errors};
   })));
   const passed=results.every(r=>r.peers.length&&r.peers.every(p=>p.state==='connected'&&p.local==='relay'&&p.remote==='relay'))&&results[1].width>0&&results[1].peers.some(p=>p.media.some(s=>s.kind==='video'&&s.frames>100)&&p.media.some(s=>s.kind==='audio'&&s.bytes>0));
   failed ||= !passed; console.log(JSON.stringify({transport,passed,results}));
   for(const p of pages) await p.evaluate(()=>{window.client?.close();window.stream?.getTracks().forEach(t=>t.stop());clearInterval(window.timer);window.audio?.close();});
   await context.close();
  }
 } finally {await browser.close();}
 process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
