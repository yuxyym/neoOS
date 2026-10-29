export interface WindowOptions { title?: string; width?: number; height?: number; minWidth?: number; minHeight?: number; resizable?: boolean; alwaysOnTop?: boolean; content: { html: string } | { file: string } }
export interface NeoFile { path: string; name: string; type: 'file' | 'directory'; mime?: string; content?: string; bytes?: Uint8Array; size?: number; updated: number }
export interface NeoAccount { id: string; username: string; displayName: string; role: 'admin' | 'user' }
export interface NeoWindow { id: number; setTitle(t: string): Promise<void>; resize(w: number, h: number): Promise<void>; move(x: number, y: number): Promise<void>; focus(): Promise<void>; minimize(): Promise<void>; maximize(): Promise<void>; setAlwaysOnTop(v: boolean): Promise<void>; setBeforeClose(v: boolean): Promise<void>; close(): Promise<void>; postMessage(d: unknown): Promise<void>; on(e: 'close' | 'message' | 'beforeclose', f: (d?: any) => void): () => void }
export interface Neo { pid: number; manifest: any; on(e: 'launch' | 'activate' | 'theme:changed', f: (p: any) => void): () => void;
  window: { create(o: WindowOptions): Promise<NeoWindow> };
  app: { exit(): Promise<void>; getManifest(): Promise<any>; list(): Promise<any[]>; launch(id: string, args?: object): Promise<number> };
  account: { self(): Promise<NeoAccount>; list(): Promise<NeoAccount[]>; create(data: { username: string; displayName: string; password: string }): Promise<NeoAccount> };
  process: { self(): Promise<{ pid: number; appId: string }>; list(): Promise<any[]>; focus(pid: number): Promise<boolean>; minimize(pid: number): Promise<boolean>; kill(pid: number): Promise<boolean> };
  theme: { get(): Promise<string>; set(n: 'dark' | 'light'): Promise<void> };
  desktop: { getWallpaper(): Promise<string>; listWallpapers(): Promise<Array<{id:string;label:string;kind:'preset'|'file'}>>; setWallpaper(id: string): Promise<void> };
  fs: { list(path?: string): Promise<NeoFile[]>; read(path: string): Promise<NeoFile>; write(path: string, content: string | Uint8Array | ArrayBuffer, mime?: string): Promise<NeoFile>; mkdir(path: string): Promise<NeoFile>; remove(path: string): Promise<void>; move(from: string, to: string): Promise<NeoFile> };
  dialog: { openFile(options?: { accept?: string; startPath?: string }): Promise<string | null>; alert(options?: { title?: string; message?: string }): Promise<void>; confirm(options?: { title?: string; message?: string }): Promise<boolean>; choose(options?: { title?: string; message?: string; options: Array<{label:string;value:string}> }): Promise<string | null> };
  notify: { show(options: { title?: string; message?: string; sound?: 'message' | 'alarm' | false }): Promise<boolean> };
  system: { getApiVersion(): Promise<string>; supports(f: string): Promise<boolean>; info(): Promise<any>; storage(): Promise<{ usage?: number; quota?: number } | null>; lock(): Promise<void> };
  log: { write(level: string, msg: string): Promise<void>; read(limit?: number): Promise<Array<{t:number;level:string;src:string;msg:string}>> } }
declare global { const neo: Neo; const neoWindow: { postMessage(d: unknown): void; onMessage(f: (d: any) => void): void } }
