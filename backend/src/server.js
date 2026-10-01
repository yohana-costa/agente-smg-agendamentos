const app = require("./app");
const env = require("./config/env");
const scheduler = require("./services/scheduler.service");

app.listen(env.port, () => {
  console.log(`[server][${new Date().toISOString()}][listening]`, { port: env.port, env: env.nodeEnv });
  scheduler.start();
});
