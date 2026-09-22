import { register, Gauge } from 'prom-client';
import { RequestHandler } from 'express';

export const configureActiveRequestMetrics = (): RequestHandler => {
  const activeRequestsGauge = new Gauge({
    name: 'http_active_requests_total',
    help: 'Number of currently active HTTP requests',
    labelNames: ['method', 'route'],
  });

  register.registerMetric(activeRequestsGauge);

  return (req, res, next) => {
    const labels = {
      method: req.method,
      route: req.route?.path || req.path || 'unknown',
    };

    activeRequestsGauge.inc(labels);

    const cleanup = () => {
      activeRequestsGauge.dec(labels);
    };

    res.on('finish', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);

    next();
  };
};
