import { env } from "./config/env.js";
import { app } from "./app.js";

app.listen(env.port, function boot() {
  console.log("Hominal Healthcare CRM API running on port " + env.port);
});
