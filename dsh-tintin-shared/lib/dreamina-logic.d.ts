export declare const DREAMINA_GENERATE_COMMANDS: readonly string[]
export declare const DREAMINA_IMAGE_RATIOS: readonly string[]
export declare const DREAMINA_VIDEO_RATIOS: readonly string[]
export declare function isImageCommand(command: string): boolean
export declare function buildGenerateArgs(p: Record<string, unknown>): string[]
export declare function parseCliOutput(text: string): { kind: string; value: unknown }
export declare function extractSubmitId(parsed: unknown): string
export declare function extractGenStatus(parsed: unknown): string
export declare function extractMediaUrls(value: unknown): string[]
export declare function summarizeStatus(input: Record<string, unknown>): Record<string, unknown>
