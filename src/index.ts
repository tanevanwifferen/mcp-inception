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
}

class McpInceptionServer {
  private server: Server;
  private executable: string;
  private workingDirectory: string;

  constructor(config: McpInceptionConfig = {}) {
    this.executable = process.env.MCP_INCEPTION_EXECUTABLE || config.executable || 'llm';
    this.workingDirectory = process.env.MCP_INCEPTION_WORKING_DIR || config.workingDirectory || process.cwd();
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
  private async safeCommandPipe(input: string, command: string): Promise<{stdout: string, stderr: string}> {
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
      proc.stdin.write(Buffer.from(input + '\n'));
      proc.stdin.end();
    });
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
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'execute_mcp_client') {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }

      const args = request.params.arguments as { command: string };
      
      try {
        // Safely pipe the command to the configured executable
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
