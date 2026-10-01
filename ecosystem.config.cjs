/**
 * PM2 process definition for the API.
 *
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: "hrm-api",
      script: "server.js",
      cwd: __dirname,
      instances: process.env.WEB_CONCURRENCY || 1,
      exec_mode: "cluster",
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
      // Env values (secrets, DB URIs) come from server/.env — not committed here.
      time: true,
    },
  ],
};
