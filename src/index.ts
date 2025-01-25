#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';

// Convert exec to promise-based
const execAsync = promisify(exec);

/**
 * MCP Inception Server
 * This server provides a wrapper around the ToGODer CLI tool, allowing it to be used through the MCP protocol.
 * It executes shell commands and returns their output, specifically designed for research and data fetching tasks.
 */
interface McpInceptionConfig {
  executable?: string;
  workingDirectory?: string;
  maxConcurrent?: number;
}

class McpInceptionServer {
  private server: Server;
  private executable: string;
  private workingDirectory: string;
  private readonly maxConcurrent: number;

  constructor(config: McpInceptionConfig = {}) {
    this.executable = process.env.MCP_INCEPTION_EXECUTABLE || config.executable || 'llm';
    this.workingDirectory = process.env.MCP_INCEPTION_WORKING_DIR || config.workingDirectory || process.cwd();
    this.maxConcurrent = parseInt(process.env.MCP_INCEPTION_MAX_CONCURRENT || '') || config.maxConcurrent || 10;
    this.server = new Server(
      {
        name: 'mcp-inception',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error: Error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  // Helper function to safely pipe input to a command
  private async safeCommandPipe(input: string, command: string, forceJson: boolean = false): Promise<{stdout: string, stderr: string}> {
    return new Promise((resolve, reject) => {
      // Get the full path to the executable
      const executablePath = join(this.workingDirectory, this.executable);
      console.error(`[Debug] Executing: ${executablePath} in ${this.workingDirectory}`);
      
      const proc = spawn('/bin/bash', [executablePath], { 
        shell: false,
        env: process.env, // Pass through environment variables
        cwd: this.workingDirectory // Use configured working directory
      });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const str = data.toString();
        console.error(`[Debug] stdout: ${str}`);
        stdout += str;
      });

      proc.stderr.on('data', (data) => {
        const str = data.toString();
        console.error(`[Debug] stderr: ${str}`);
        stderr += str;
      });

      proc.on('error', (err) => {
        console.error(`[Debug] Process error: ${err.message}`);
        reject(new Error(`Failed to start process: ${err.message}`));
      });

      proc.on('close', (code) => {
        console.error(`[Debug] Process exited with code ${code}`);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Command failed with code ${code}. stderr: ${stderr}`));
        }
      });

      // Safely write input with newline and close stdin
      // If forceJson is true, append a directive to return JSON
      const inputWithDirective = forceJson ? input + ' [RESPOND IN JSON KEY-VALUE PAIRS]' : input;
      proc.stdin.write(Buffer.from(inputWithDirective + '\n'));
      proc.stdin.end();
    });
  }

  /**
   * Executes multiple commands in parallel with a maximum concurrency limit
   */
  private async executeParallel(prompt: string, items: string[]): Promise<{results: any[], errors: string[]}> {
    const results: any[] = [];
    const errors: string[] = [];
    
    // Process items in chunks based on maxConcurrent
    for (let i = 0; i < items.length; i += this.maxConcurrent) {
      const chunk = items.slice(i, i + this.maxConcurrent);
      const promises = chunk.map(async (item) => {
        try {
          const { stdout, stderr } = await this.safeCommandPipe(`${prompt} ${item}`, this.executable, true);
          if (stdout) {
            results.push(stdout);
          } else if (stderr) {
            errors.push(`Error processing item "${item}": ${stderr}`);
          }
        } catch (error: any) {
          errors.push(`Failed to process item "${item}": ${error.message}`);
        }
      });
      
      // Wait for current chunk to complete before processing next chunk
      await Promise.all(promises);
    }
    
    return { results, errors };
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'execute_mcp_client',
          description: 'Offload certain tasks to AI. Used for research purposes, do not use for code editing or anything code related. Only used to fetch data.',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'The MCP client command to execute',
              },
            },
            required: ['command'],
          },
        },
        {
          name: 'execute_parallel_mcp_client',
          description: 'Execute multiple AI tasks in parallel, with responses in JSON key-value pairs.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The base prompt to use for all executions',
              },
              items: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Array of parameters to process in parallel',
              },
            },
            required: ['prompt', 'items'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'execute_mcp_client': {
          const args = request.params.arguments as { command: string };
          try {
            const { stdout, stderr } = await this.safeCommandPipe(args.command, this.executable);
            return {
              content: [
                {
                  type: 'text',
                  text: stdout || stderr,
                },
              ],
            };
          } catch (error: any) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error executing MCP client command: ${error?.message || 'Unknown error'}`,
                },
              ],
              isError: true,
            };
          }
        }
        
        case 'execute_parallel_mcp_client': {
          const args = request.params.arguments as { prompt: string; items: string[] };
          
          try {
            const { results, errors } = await this.executeParallel(args.prompt, args.items);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ results, errors }, null, 2),
                },
              ],
              isError: errors.length > 0,
            };
          } catch (error: any) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error executing parallel MCP client commands: ${error?.message || 'Unknown error'}`,
                },
              ],
              isError: true,
            };
          }
        }
        
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Inception server running on stdio');
  }
}

const server = new McpInceptionServer();
server.run().catch(console.error);
