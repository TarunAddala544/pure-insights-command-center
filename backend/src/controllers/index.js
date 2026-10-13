/** Thin controllers: translate HTTP to service calls. No business logic here. */
export const buildControllers = (ctx) => {
  const { auth, analytics, alerts, users, audit, replay, hub, data } = ctx;
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  return {
    login: wrap(async (req, res) => res.json(await auth.login(req.body.email, req.body.password))),
    me: wrap((req, res) => res.json({ user: req.user })),
    health: wrap((_req, res) => res.json({ status: 'ok', simulatedSnowflake: true, uptimeSec: Math.round(process.uptime()) })),
    overview: wrap(async (_req, res) => res.json(await analytics.overview())),
    reports: wrap(async (_req, res) => res.json({ items: await analytics.reports() })),
    reportDetail: wrap(async (req, res) => res.json(await analytics.reportDetail(req.params.id))),
    orphans: wrap(async (_req, res) => res.json(await analytics.orphans())),
    assignOwner: wrap(async (req, res) =>
      res.status(201).json(await analytics.assignOwner(req.params.reportId, req.body.ownerEmail, req.user)),
    ),
    usage: wrap(async (_req, res) => res.json(await analytics.usage())),
    costs: wrap(async (req, res) => res.json(await analytics.costs(analytics.validatePrice(req.query.price)))),
    costSummary: wrap(async (req, res) => res.json(await analytics.costSummary(analytics.validatePrice(req.query.price)))),
    dataQuality: wrap(async (_req, res) => res.json(await analytics.dataQuality())),
    quarantine: wrap(async (_req, res) => res.json({ items: await analytics.quarantine() })),
    alerts: wrap(async (req, res) => res.json(await alerts.list(req.query))),
    ackAlert: wrap(async (req, res) => res.json(await alerts.acknowledge(req.params.id, req.user, 'acknowledged'))),
    resolveAlert: wrap(async (req, res) => res.json(await alerts.acknowledge(req.params.id, req.user, 'resolved'))),
    injectAlert: wrap(async (req, res) => res.status(201).json({ published: await alerts.inject(req.body, req.user, replay.position) })),
    telemetry: wrap(async (_req, res) =>
      res.json({ connections: hub.size, replay: replay.status(), alertCounts: await ctx.alertRepo.counts(), ingestion: data.summary }),
    ),
    replayStatus: wrap((_req, res) => res.json(replay.status())),
    replayAction: (action) =>
      wrap(async (req, res) => {
        const status = await replay[action]();
        audit.record(req.user.email, `replay.${action}`, 'replay');
        res.json(status);
      }),
    users: wrap((_req, res) => res.json({ items: users.list() })),
    updateUser: wrap(async (req, res) => {
      const updated = users.update(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found', requestId: req.id } });
      audit.record(req.user.email, 'user.update', req.params.id, req.body);
      return res.json(updated);
    }),
    audit: wrap((_req, res) => res.json({ items: audit.list() })),
  };
};
