/**
 * Minimal ambient types for the WebMCP Imperative API.
 * Mirrors the shape in the WebMCP explainer; kept local so the build has no
 * dependency on a pre-release typings package.
 */
interface WebMCPToolAnnotations {
  readOnlyHint?: boolean
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
