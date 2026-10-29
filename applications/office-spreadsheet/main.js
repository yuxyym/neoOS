const editorOrigin = 'https://edit.chaxus.com';
const requestId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const mimeFor = path => ({ xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', ods: 'application/vnd.oasis.opendocument.spreadsheet', csv: 'text/csv', tsv: 'text/tab-separated-values' })[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
neo.on('launch', async args => {
  let path = args?.path || null, w, queuedOpen = path, ready = false, documentOpened = false;
  try {
    w = await neo.window.create({ title: path?.split('/').pop() || 'Spreadsheets', width: 1180, height: 780, minWidth: 760, minHeight: 480, resizable: true, openFileAction: true, saveFileAction: true, content: { url: `${editorOrigin}/editor` } });
    const openStored = async target => {
      const file = await neo.fs.read(target);
      const bytes = file.bytes ? new Uint8Array(file.bytes) : new TextEncoder().encode(file.content || '');
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      documentOpened = false;
      await w.postMessage({ id: requestId(), type: 'document:open-buffer', payload: { fileName: target.split('/').pop(), buffer, mimeType: mimeFor(target), readonly: false } });
      path = target; await w.setTitle(path.split('/').pop());
    };
    const openTemplate = async () => { const bytes = new Uint8Array(await neo.app.readAsset('blank.xlsx')); documentOpened = false; await w.postMessage({ id: requestId(), type: 'document:open-buffer', payload: { fileName: 'Untitled.xlsx', buffer: bytes.buffer, mimeType: mimeFor('Untitled.xlsx'), readonly: false } }); };
    const pickFile = async () => { const target = await neo.dialog.openFile({ startPath: '/', accept: '.xlsx,.xls,.ods,.csv,.tsv' }); if (target) { if (ready) await openStored(target); else queuedOpen = target; } };
    neo.on('window:remote-message', async ({ wid, data }) => {
      if (wid !== w.id || !data?.type?.startsWith('document:')) return;
      try {
        if (data.type === 'document:ready') { ready = true; if (queuedOpen) { const target = queuedOpen; queuedOpen = null; await openStored(target); } else await openTemplate(); }
        else if (data.type === 'document:opened') documentOpened = true;
        else if (data.type === 'document:error') await neo.dialog.alert({ title: 'Office editor error', message: data.payload?.message || 'The editor could not process that spreadsheet.' });
        else if (data.type === 'document:saved') {
          const file = data.payload?.file;
          if (!file?.arrayBuffer) throw new Error('The editor returned no file data.');
          let name = (file.name || data.payload.fileName || path?.split('/').pop() || 'Untitled.xlsx').replace(/[\\/:*?"<>|]/g, '_');
          if (!path) { const names = new Set((await neo.fs.list('/')).map(entry => entry.name)); const ext = name.includes('.') ? `.${name.split('.').pop()}` : '.xlsx'; const stem = name.replace(/\.[^.]*$/, '') || 'Untitled'; let n = 2; while (names.has(name)) name = `${stem} (${n++})${ext}`; }
          const target = path ? path.replace(/\.xls$/i, '.xlsx') : `/${name}`;
          await neo.fs.write(target, new Uint8Array(await file.arrayBuffer()), mimeFor(target));
          path = target; await w.setTitle(target.split('/').pop());
        }
      } catch (error) { await neo.dialog.alert({ title: 'Office file error', message: error.message }); }
    });
    neo.on('window:remote-error', ({ wid }) => { if (wid === w.id) neo.dialog.alert({ title: 'Office editor unavailable', message: 'Connect to the internet and reopen the app.' }); });
    neo.on('window:action', async ({ wid, action }) => { if (wid !== w.id) return; try { if (action === 'open-file') await pickFile(); else if (action === 'save-file') { if (!documentOpened) throw new Error('Open a spreadsheet and wait for it to finish loading before saving.'); await w.postMessage({ id: requestId(), type: 'document:save', payload: {} }); } } catch (error) { await neo.dialog.alert({ title: action === 'save-file' ? 'Save spreadsheet failed' : 'Open spreadsheet failed', message: error.message }); } });
  } catch (error) { await neo.dialog.alert({ title: 'Unable to start Spreadsheets', message: error.message }); }
});
