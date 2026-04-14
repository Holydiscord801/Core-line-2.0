import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authMiddleware } from './middleware/auth.js';
import { createMCPServer, setAuthFromApiKey } from '../mcp/server.js';
import jobsRouter from './routes/jobs.js';
import contactsRouter from './routes/contacts.js';
import outreachRouter from './routes/outreach.js';
import battleplanRouter from './routes/battleplan.js';
import followupsRouter from './routes/followups.js';
import summaryRouter from './routes/summary.js';
import authRouter from './routes/auth.js';
import pipelineRouter from './routes/pipeline.js';
import keysRouter from './routes/keys.js';
import usersRouter from './routes/users.js';
import activityRouter from './routes/activity.js';
import hotSignalsRouter from './routes/hot-signals.js';
export function createApp() {
    const app = express();
    app.use(cors());
    app.use(express.json());
    // Serve static HTML mockups from repo root
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = path.resolve(__dirname, '../..');
    app.use(express.static(repoRoot, { index: false, extensions: ['html'] }));
    // Health check
    app.get('/api/health', (_req, res) => {
        res.json({ status: 'ok', service: 'coreline-v2', timestamp: new Date().toISOString() });
    });
    // ============================================
    // MCP HTTP endpoint (Streamable HTTP transport)
    // Handles its own auth via Bearer token — NOT behind authMiddleware.
    // Stateless: fresh MCP Server per request (safe for Vercel serverless).
    // ============================================
    app.post('/mcp', async (req, res) => {
        // Extract API key from Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Missing Authorization header. Use: Bearer cl_YOUR_API_KEY' }, id: null });
            return;
        }
        const [scheme, token] = authHeader.split(' ');
        if (scheme !== 'Bearer' || !token || !token.startsWith('cl_')) {
            res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Invalid API key format. Use: Bearer cl_YOUR_API_KEY' }, id: null });
            return;
        }
        // Authenticate and set user context
        const authed = await setAuthFromApiKey(token);
        if (!authed) {
            res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Invalid API key' }, id: null });
            return;
        }
        try {
            const server = await createMCPServer();
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            res.on('close', () => {
                transport.close();
                server.close();
            });
        }
        catch (error) {
            console.error('MCP HTTP error:', error);
            if (!res.headersSent) {
                res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
            }
        }
    });
    // MCP spec requires GET and DELETE to return 405
    app.get('/mcp', (_req, res) => {
        res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. Use POST.' }, id: null });
    });
    app.delete('/mcp', (_req, res) => {
        res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. Use POST.' }, id: null });
    });
    // All routes require auth
    app.use('/api', authMiddleware);
    app.use('/api/jobs', jobsRouter);
    app.use('/api/contacts', contactsRouter);
    app.use('/api/outreach', outreachRouter);
    app.use('/api/battle-plan', battleplanRouter);
    app.use('/api/followups', followupsRouter);
    app.use('/api/summary', summaryRouter);
    app.use('/api/auth', authRouter);
    app.use('/api/pipeline', pipelineRouter);
    app.use('/api/keys', keysRouter);
    app.use('/api/users', usersRouter);
    app.use('/api/activity', activityRouter);
    app.use('/api/hot-signals', hotSignalsRouter);
    // 404 handler
    app.use((_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });
    return app;
}
export function startServer(port = 3001) {
    const app = createApp();
    app.listen(port, () => {
        console.log(`Coreline v2 API running on port ${port}`);
        console.log(`Health check: http://localhost:${port}/api/health`);
    });
}
//# sourceMappingURL=server.js.map