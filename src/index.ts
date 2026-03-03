import { bot } from "./bot.js";

const REQUIRED_ENV_VARS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_USER_ID",
  "LINEAR_API_KEY",
  "LINEAR_TEAM_ID",
  "OPENAI_API_KEY",
];

const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Starting papai...");

bot.start({
  onStart: () => {
    console.log("papai is running and listening for messages.");
  },
});
