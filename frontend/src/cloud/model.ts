export const CONTENT_DIRS = ["Dialog", "Effects", "FMOD", "Graphics", "Maps", "Monocle", "Overworld", "Tutorials"];
export const JOURNAL = ".webleste-sync-v1";
export interface RemoteFile {
  id: string; name: string; mimeType: string; size?: string; modifiedTime?: string;
  version?: string; md5Checksum?: string; sha256Checksum?: string; path: string;
}
export interface Revision {
  schema: 1; id: string; path: string; parents: string[]; base: string;
  blob?: string; hash?: string; size: number; deleted: boolean; time: string;
}
export interface Baseline { revision: string; base: string; hash: string; size: number; modified: number }
export interface Pending extends Revision { snapshot?: string; uploadId?: string; session?: string }
export interface SyncState {
  schema: 1; account: string; folder: string; baselines: Record<string, Baseline>;
  queue: Record<string, Pending>; ready: boolean; prepared?: string; lastSync?: string;
}
export type Status = "Synced" | "Syncing" | "Offline" | "Pending Changes" | "Sync Error" | "Conflict Detected";
export interface Progress {
  status: Status; message: string; total: number; done: number; bytes: number; totalBytes: number;
  speed: number; current: string; pending: string[]; conflicts: string[]; lastSync?: string;
}
export const initialProgress = (): Progress => ({status: "Offline", message: "Connect Google Drive", total: 0, done: 0, bytes: 0, totalBytes: 0, speed: 0, current: "", pending: [], conflicts: []});
export function safePath(path: string): string {
  if (!path || path.length > 2048 || path.split("/").some(p => !p || p === "." || p === ".." || /[\\\x00-\x1f]/.test(p))) throw new Error(`Unsafe path: ${path}`);
  return path;
}
export function fingerprint(file?: RemoteFile): string { return file ? `drive:${file.id}:${file.version}` : "absent"; }
export function tips(revisions: Revision[]): Revision[] {
  const parents = new Set(revisions.flatMap(r => r.parents));
  return revisions.filter(r => !parents.has(r.id));
}
// Keep the Drive layout intact; translate only the paths required by the existing loader.
export function localPath(path: string): string {
  safePath(path);
  if (/^(Saves|Mods|Everest)\//.test(path)) return `Celeste/${path}`;
  return path;
}
export function remotePath(path: string): string {
  return path.replace(/^Celeste\/(Saves|Mods|Everest)\//, "$1/");
}
export function managed(path: string): boolean {
  return !path.startsWith(".cloud/") && !path.startsWith(`${JOURNAL}/`) &&
    ![".ContentExists", "CustomCeleste.dll", "Celeste.Mod.mm.dll", "MMHOOK_Celeste.dll", "everest.zip"].includes(path) &&
    !/^Celeste\/Mods\/Cache\//.test(path);
}
export function assertInstallation(paths: string[]) {
  if (!paths.includes("Celeste.exe") && !paths.includes("orig/Celeste.exe") && !paths.includes("Celeste.dll")) throw new Error("Select the FNA installation root containing Celeste.exe (or orig/Celeste.exe), and Content.");
  for (const dir of CONTENT_DIRS) if (!paths.some(p => p.startsWith(`Content/${dir}/`))) throw new Error(`Incomplete installation: Content/${dir} has no files`);
}
