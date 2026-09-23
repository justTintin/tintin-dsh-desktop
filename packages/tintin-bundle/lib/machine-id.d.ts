export const MACHINE_ID_KEY: string
export interface MachineInfo {
  hostname: string
  platform: string
  machineGuid: string
  mac: string
  cpu: string
  source?: string
}
export function deriveMachineId(info: Partial<MachineInfo> | null | undefined): string
export function collectMachineInfoSync(): MachineInfo
export function resolveMachineIdSync(options?: {
  store?: { get(key: string): unknown; set(key: string, value: unknown): void }
  collect?: () => Partial<MachineInfo>
}): string
