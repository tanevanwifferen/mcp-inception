# Disclaimer 

Ok this is a difficult one. Will take some setting up unfortunately. 
However, if you manage to make this more straightforward, please send me PR's.

# mcp-inception MCP Server

Call another mcp client from your mcp client. Delegate tasks, offload context windows. An agent for your agent!

This is a TypeScript-based MCP server that implements a simple LLM query system.

- MCP Server and Client in one
- Made with use of [mcp-client-cli](https://github.com/adhikasp/mcp-client-cli)
- Offload context windows
- Delegate tasks
- TODO: parallel execution of tasks - Wait for [this mr](https://github.com/adhikasp/mcp-client-cli/pull/11) before trying parallel execution.

## Features

### Tools
- `execute_mcp_client` - Ask a question to a separate LLM, ignore all the intermediate steps it takes when querying it's tools, and return the output.
  - Takes question as required parameters
  - Returns answer, ignoring all the intermediate context
- execute_parallel_mcp_client - Takes a list of inputs and a main prompt, and executes the prompt in parallel for each string in the input. 
  E.G. get the time of 6 major cities right now - London, Paris, Tokyo, Rio, New York, Sidney.
  - takes main prompt "What is the time in this city?"
  - takes list of inputs, London Paris etc
  - runs the prompt in parallel for each input
  - note: wait for [this](https://github.com/adhikasp/mcp-client-cli/pull/11) before using this feature

## Development

### Dependencies:
- Install mcp-client-cli
	- Also install the config file, and the mcp servers it needs in `~/.llm/config.json`
- create a bash file somewhere that activates the venv and executes the `llm` executable

```bash
#!/bin/bash
source ./venv/bin/activate
llm --no-confirmations
```

### install package
Install dependencies:
```bash
npm install
```

Build the server:
```bash
npm run build
```

For development with auto-rebuild:
```bash
npm run watch
```

## Installation

To use with Claude Desktop, add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-inception": {
      "command": "node",
      "args": ["~/Documents/Cline/MCP/mcp-inception/build/index.js"], // build/index.js from this repo
      "disabled": false,
      "autoApprove": [],
      "env": {
        "MCP_INCEPTION_EXECUTABLE": "./run_llm.sh", // bash file from Development->Dependencies
        "MCP_INCEPTION_WORKING_DIR": "/mcp-client-cli working dir"
      }
    }
  }
}
```

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.
