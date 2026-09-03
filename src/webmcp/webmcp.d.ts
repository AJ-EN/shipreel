/**
 * Minimal ambient types for the WebMCP Imperative API.
 * Mirrors the shape in the WebMCP explainer; kept local so the build has no
 * dependency on a pre-release typings package.
 */
interface WebMCPToolAnnotations {
  /** True when the tool cannot change anything. Absent is not the same as
   *  false: a client that sees neither cannot classify the tool at all. */
  readOnlyHint?: boolean
  /** True when the tool can destroy work the person would want back. */
  destructiveHint?: boolean
  /** True when calling twice with the same input is the same as calling once. */
  idempotentHint?: boolean
  /** True when the tool reaches outside the page. Everything here is local. */
  openWorldHint?: boolean
  /** True when output derives from media or text the person supplied. */
  untrustedContentHint?: boolean
}

interface WebMCPToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: WebMCPToolAnnotations
  execute: (input: any, ctx?: { signal?: AbortSignal }) => unknown | Promise<unknown>
}

interface WebMCPRegisterOptions {
  signal?: AbortSignal
  exposedTo?: string[]
}

interface ModelContext extends EventTarget {
  registerTool(tool: WebMCPToolDescriptor, options?: WebMCPRegisterOptions): Promise<void>
  getTools(options?: { fromOrigins?: string[] }): Promise<any[]>
  executeTool(tool: any, args: string, options?: { signal?: AbortSignal }): Promise<unknown>
}

interface Document {
  modelContext?: ModelContext
}
