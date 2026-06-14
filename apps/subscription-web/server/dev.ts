import { config } from "dotenv";
import express from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import confirmHandler from "../api/confirm.js";
import subscribeHandler from "../api/subscribe.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(currentDirectory, "../../../.env") });
config({ path: resolve(currentDirectory, "../.env.local"), override: true });

const app = express();
const port = 3001;

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.all("/api/subscribe", (request, response) =>
  subscribeHandler(request, response),
);
app.all("/api/confirm", (request, response) =>
  confirmHandler(request, response),
);

app.listen(port, "127.0.0.1", () => {
  console.log(`Subscription API listening on http://127.0.0.1:${port}`);
});
