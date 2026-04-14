#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMCPServer, setAuthFromApiKey, setUserId } from './server.js';
import dotenv from 'dotenv';
dotenv.config();
async function main() {
    // Check for API key in environment
    const apiKey = process.env.CORELINE_API_KEY;
    const userId = process.env.CORELINE_USER_ID;
    if (apiKey) {
        const authenticated = await setAuthFromApiKey(apiKey);
        if (!authenticated) {
            console.error('Invalid API key');
            process.exit(1);
        }
    }
    else if (userId) {
        // Direct user ID for testing/development
        setUserId(userId);
    }
    else {
        console.error('No authentication provided. Set CORELINE_API_KEY or CORELINE_USER_ID environment variable.');
        process.exit(1);
    }
    const server = await createMCPServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Handle shutdown gracefully
    process.on('SIGINT', async () => {
        await server.close();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        await server.close();
        process.exit(0);
    });
}
main().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map