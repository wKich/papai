import { bot } from "./bot.js";

console.log("Starting papai...");

bot.start({
  onStart: () => {
    console.log("papai is running and listening for messages.");
  },
});
