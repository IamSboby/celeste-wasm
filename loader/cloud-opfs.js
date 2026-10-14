// Loaded in every Emscripten context. Only the dedicated OPFS worker opens
// sync access handles. Observe their lifetime without taking competing locks.
if (typeof FileSystemFileHandle !== 'undefined' && typeof document === 'undefined') {
  const original = FileSystemFileHandle.prototype.createSyncAccessHandle;
  if (original && !FileSystemFileHandle.prototype.__weblesteObserved) {
    FileSystemFileHandle.prototype.__weblesteObserved = true;
    let channel, epoch = 0;
    const active = new Set(), profiles = new Set();
    FileSystemFileHandle.prototype.createSyncAccessHandle = async function() {
      if (!channel) {
        channel = new BroadcastChannel('webleste-opfs-state');
        channel.onmessage = ({data}) => {
          if (data.query && profiles.has(data.profile)) channel.postMessage({reply:data.query, epoch, active:[...active]});
        };
      }
      const root = await navigator.storage.getDirectory();
      const path = (await root.resolve(this))?.join('/');
      if (!path) throw new Error('Cannot resolve OPFS file');
      if(path.startsWith('.cloud-profiles/')) profiles.add(path.split('/')[1]);
      epoch++; active.add(path);
      let handle;
      try { handle = await original.call(this); }
      catch (error) { active.delete(path); epoch++; throw error; }
      const close = handle.close.bind(handle);
      handle.close = function() {
        const result = close(); active.delete(path); epoch++; return result;
      };
      return handle;
    };
  }
}
