import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { migrate } from './db.js';
import { seedIfEmpty } from './seed.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { HttpError } from './util.js';
import { pushEnabled } from './push.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

export async function createApp() {
  await migrate();
  if (config.seedOnStart) {
    const seeded = await seedIfEmpty();
    if (seeded) console.log('Database was empty, loaded the starter venues and question bank');
  }

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    if (config.isProd) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.use('/api', publicRouter);
  app.use('/api/admin', adminRouter);

  // The service worker and the manifest must never be served stale.
  app.get(['/sw.js', '/manifest.webmanifest'], (req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    if (req.path === '/sw.js') res.set('Service-Worker-Allowed', '/');
    next();
  });
  app.use(
    express.static(publicDir, {
      extensions: ['html'],
      setHeaders(res, filePath) {
        if (/[\\/]sw\.js$/.test(filePath)) return; // keep the no-cache header set above
        if (/\/(vendor|icons)\//.test(filePath)) res.set('Cache-Control', 'public, max-age=604800');
        else if (/\.(css|js|svg|png)$/.test(filePath)) res.set('Cache-Control', 'public, max-age=3600');
      }
    })
  );

  // App shell routes handled by the client side router.
  app.get(['/v/:slug', '/r/:token', '/rewards', '/privacy', '/about'], (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return res.status(400).json({ error: 'Bad request body' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp()
    .then((app) => {
      app.listen(config.port, () => {
        console.log(`CrowdFeed listening on port ${config.port}${pushEnabled ? '' : ' (push notifications disabled, run npm run vapid to enable them)'}`);
      });
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
