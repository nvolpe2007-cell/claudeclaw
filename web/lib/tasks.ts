// The nudge list — kept in sync with the iOS widget's Shared/Tasks.swift.
// Curation rule: every task must stay harmless, legal, and kind.
// Awkward and playful — never risky, illegal, or at anyone else's expense.
//
// Phase 3 will move this into the database so the widget and the web app
// fetch from one source; for now both ship the same list.

export const TASKS: string[] = [
  "Order a soda in a water cup.",
  "Ask a stranger to grab food with you.",
  "Compliment three strangers today.",
  "Take the stairs and greet everyone you pass.",
  'Say "good morning" to five people you don\'t know.',
  "Sit in the middle seat of an empty row on purpose.",
  "Ask someone what the best thing about their day was.",
  "Give a genuine compliment to a cashier.",
  "Wear something slightly mismatched and own it.",
  "Strike up a conversation in an elevator.",
  "Ask a barista what their favorite drink is, then order it.",
  "Leave a kind note somewhere a stranger will find it.",
  "Walk into a store, ask a fun question, and leave.",
  "Introduce yourself to someone new at a coffee shop.",
  "Ask a stranger for a book or movie recommendation.",
  "High-five someone you've never met.",
  "Dance for ten seconds in a public place.",
  "Ask someone to take a photo of you doing something silly.",
  "Sit at a table with people you don't know (ask first!).",
  "Tell a stranger you like their outfit.",
  "Start a slow clap and see if anyone joins.",
  "Ask a shop owner what they'd recommend and buy it.",
  "Say hi to a dog owner and ask the dog's name.",
  "Give up your seat before anyone asks.",
  "Ask a stranger what song they're listening to.",
  "Pay for the coffee of the person behind you.",
  "Ask someone older than you for one piece of advice.",
  "Wave at a passing bus or train.",
  "Ask a stranger to settle a friendly debate.",
  "Try a food you'd normally never order.",
  "Sing along (quietly) to the store music.",
  "Ask three people what their dream job is.",
  "Compliment someone's laugh.",
  "Ask a stranger what made them smile today.",
  "Sit somewhere new and just people-watch for five minutes.",
  "Ask a waiter what the kitchen's favorite dish is.",
  "Give a stranger a sincere thank-you for something small.",
  "Ask someone what they're excited about this week.",
  "Wear sunglasses indoors for an hour, confidently.",
  "Ask a stranger to teach you one word in another language.",
];

export function randomTask(): string {
  return TASKS[Math.floor(Math.random() * TASKS.length)] ?? "Say hi to a stranger.";
}
