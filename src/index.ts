import { bot } from "./bot.js";

console.log("Starting Agent Sniff...");

bot.start({
  onStart: () => {
    console.log("Agent Sniff is running and listening for messages.");
  },
});
