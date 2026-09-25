declare module 'adm-zip' {
  export interface AdmZipEntry {
    entryName: string
    isDirectory: boolean
    getData(): Buffer
  }
  export default class AdmZip {
    constructor(data?: Buffer | string)
    getEntries(): AdmZipEntry[]
    addFile(entryName: string, content: Buffer): void
    addLocalFolder(folderPath: string): void
    writeZip(zipPath?: string): void
    toBuffer(): Buffer
    extractAllTo(targetPath: string, overwrite?: boolean): void
  }
}
