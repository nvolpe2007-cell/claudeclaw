// The nudge list — kept in sync with the iOS widget's Shared/Tasks.swift.
//
// A nudge is a small, friendly challenge that gently steps outside an everyday
// social norm: making a friend at the beach, striking up a game with a
// stranger, a little public silliness. The vibe is "playfully brave," never
// risky, illegal, or at anyone else's expense.
//
// Curation rules for every nudge:
//   • Harmless & legal — awkward at worst, never dangerous.
//   • Kind — it should brighten someone's day, not annoy or embarrass them.
//   • Doable — something a normal person could pull off in a day, anywhere.
//   • Consent-first — if it involves another person, they can happily say no.

export type Category =
  | "Make a Friend"
  | "Get Active"
  | "Random Kindness"
  | "Be Bold"
  | "Try Something New"
  | "Small Talk";

export const CATEGORIES: Category[] = [
  "Make a Friend",
  "Get Active",
  "Random Kindness",
  "Be Bold",
  "Try Something New",
  "Small Talk",
];

export interface Nudge {
  text: string;
  category: Category;
}

export const NUDGES: Nudge[] = [
  // ── Make a Friend ─────────────────────────────────────────────
  { text: "Make a friend at the beach and learn where they're from.", category: "Make a Friend" },
  { text: "Ask someone new if they'd like to take a short walk with you.", category: "Make a Friend" },
  { text: "Find someone reading a book and ask what it's about.", category: "Make a Friend" },
  { text: "Compliment a stranger's dog and ask to say hi.", category: "Make a Friend" },
  { text: "Swap a fun fact about yourself with someone you just met.", category: "Make a Friend" },
  { text: "Ask a person nearby what brought them here today.", category: "Make a Friend" },
  { text: "Introduce yourself to one new person at a coffee shop.", category: "Make a Friend" },
  { text: "Trade a song recommendation with someone new.", category: "Make a Friend" },
  { text: "Ask someone to recommend their favorite local spot.", category: "Make a Friend" },
  { text: "Join a group activity and learn one person's name.", category: "Make a Friend" },

  // ── Get Active ────────────────────────────────────────────────
  { text: "Invite someone to a quick game of catch or frisbee.", category: "Get Active" },
  { text: "Ask if you can join a pickup game at the park.", category: "Get Active" },
  { text: "Build something in the sand with someone at the beach.", category: "Get Active" },
  { text: "Dip your feet in the water and chat with whoever's nearby.", category: "Get Active" },
  { text: "Take a spontaneous 10-minute walk somewhere brand new.", category: "Get Active" },
  { text: "Try a cartwheel or handstand in the grass.", category: "Get Active" },
  { text: "Race a friend (or a willing stranger) to the next lamppost.", category: "Get Active" },
  { text: "Watch a sunrise or sunset somewhere you've never watched one.", category: "Get Active" },
  { text: "Start a mini beach or park cleanup and invite someone to help.", category: "Get Active" },
  { text: "Learn a simple dance move from a video and do it outside.", category: "Get Active" },

  // ── Random Kindness ───────────────────────────────────────────
  { text: "Pay for the coffee of the person behind you.", category: "Random Kindness" },
  { text: "Leave an encouraging note where a stranger will find it.", category: "Random Kindness" },
  { text: "Give a genuine compliment to three different people today.", category: "Random Kindness" },
  { text: "Tell a worker they're doing a great job.", category: "Random Kindness" },
  { text: "Let someone go ahead of you in line.", category: "Random Kindness" },
  { text: "Offer to take a photo for a couple or a group.", category: "Random Kindness" },
  { text: "Thank someone who's usually overlooked — a driver, a janitor.", category: "Random Kindness" },
  { text: "Leave a bigger tip than usual with a kind little note.", category: "Random Kindness" },
  { text: "Give up your seat before anyone has to ask.", category: "Random Kindness" },
  { text: "Hold the door and greet everyone who walks through.", category: "Random Kindness" },

  // ── Be Bold ───────────────────────────────────────────────────
  { text: "Order a soda in a water cup.", category: "Be Bold" },
  { text: "Dance for ten seconds in a public place.", category: "Be Bold" },
  { text: "Start a slow clap and see if anyone joins.", category: "Be Bold" },
  { text: "Wear sunglasses indoors for an hour, confidently.", category: "Be Bold" },
  { text: "Do your most confident strut down the sidewalk.", category: "Be Bold" },
  { text: "Sing along (quietly) to the music in a store.", category: "Be Bold" },
  { text: "Ask a stranger for a high-five.", category: "Be Bold" },
  { text: "Wear something slightly mismatched and own it.", category: "Be Bold" },
  { text: "Skip instead of walk for one whole block.", category: "Be Bold" },
  { text: "Give yourself a small round of applause in public.", category: "Be Bold" },

  // ── Try Something New ─────────────────────────────────────────
  { text: "Order the menu item you'd never normally pick.", category: "Try Something New" },
  { text: "Take a different route and notice three things you've never seen.", category: "Try Something New" },
  { text: "Try a food from a cuisine you've never had.", category: "Try Something New" },
  { text: "Learn one word in a new language from a stranger.", category: "Try Something New" },
  { text: "Doodle or sketch something in public for a minute.", category: "Try Something New" },
  { text: "Say yes to the next small invitation you'd normally decline.", category: "Try Something New" },
  { text: "Ask a shop owner for their personal favorite and get it.", category: "Try Something New" },
  { text: "Ask someone to teach you something they're good at.", category: "Try Something New" },
  { text: "Try a brand-new hobby for ten minutes today.", category: "Try Something New" },
  { text: "Sit somewhere new and just people-watch for five minutes.", category: "Try Something New" },

  // ── Small Talk ────────────────────────────────────────────────
  { text: 'Say "good morning" to five people you don\'t know.', category: "Small Talk" },
  { text: "Ask a stranger what made them smile today.", category: "Small Talk" },
  { text: "Ask someone what they're excited about this week.", category: "Small Talk" },
  { text: "Compliment someone's laugh.", category: "Small Talk" },
  { text: "Strike up a conversation in an elevator.", category: "Small Talk" },
  { text: "Ask a barista their favorite drink, then order it.", category: "Small Talk" },
  { text: "Ask three people what their dream job is.", category: "Small Talk" },
  { text: "Ask someone older than you for one piece of advice.", category: "Small Talk" },
  { text: "Ask a stranger for a book or movie recommendation.", category: "Small Talk" },
  { text: "Ask a waiter what the kitchen's favorite dish is.", category: "Small Talk" },
];

/** Flat list of nudge texts — the shape existing callers expect. */
export const TASKS: string[] = NUDGES.map((n) => n.text);

/**
 * A random nudge. Pass a category to draw only from that mood; an unknown or
 * empty category falls back to the full list.
 */
export function randomTask(category?: string): string {
  const pool =
    category && CATEGORIES.includes(category as Category)
      ? NUDGES.filter((n) => n.category === category)
      : NUDGES;
  const list = pool.length > 0 ? pool : NUDGES;
  return list[Math.floor(Math.random() * list.length)]?.text ?? "Say hi to a stranger.";
}

/** The category a given nudge text belongs to (used when displaying posts). */
export function categoryOf(text: string): Category | undefined {
  return NUDGES.find((n) => n.text === text)?.category;
}
