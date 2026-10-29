neo.window.create({title:'Calendar',width:760,height:540,minWidth:480,minHeight:420,content:{file:'view.html'}}).then(async w=>{
  let events=[];try{events=JSON.parse((await neo.storage.get('events'))||'[]')}catch{}
  await w.postMessage({events});
  w.on('message',async m=>{if(m.events){try{await neo.storage.set('events',JSON.stringify(m.events));events=m.events}catch(e){await neo.dialog.alert({title:'Calendar error',message:e.message})}}});
});
