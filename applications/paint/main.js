neo.window.create({title:'Paint',width:820,height:620,minWidth:480,minHeight:380,content:{file:'view.html'}}).then(w=>w.on('message',async m=>{
  if(!m.save)return;
  try{const files=await neo.fs.list('/'),used=new Set(files.map(f=>f.name));let name='Drawing.png',n=2;while(used.has(name))name=`Drawing ${n++}.png`;await neo.fs.write(`/${name}`,m.save,'image/png');w.postMessage({saved:name})}
  catch(e){neo.dialog.alert({title:'Paint error',message:e.message})}
}));
