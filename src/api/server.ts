import express from 'express';
import cors from 'cors';
import { authMiddleware } from './middleware/auth.js';
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

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'coreline-v2', timestamp: new Date().toISOString() });
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

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

export function startServer(port: number = 3001): void {
  const app = createApp();

  app.listen(port, () => {
    console.log(`Coreline v2 API running on port ${port}`);
    console.log(`Health check: http://localhost:${port}/api/health`);
  });
}
