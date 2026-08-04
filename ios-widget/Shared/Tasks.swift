import Foundation

/// The bundled list of "nudges" — small, friendly challenges that gently
/// step outside an everyday social norm (make a friend at the beach, start a
/// game with a stranger, a little public silliness). Shipping these inside
/// the app means the widget works instantly, offline, with zero backend.
///
/// Kept in sync with the web app's `web/lib/tasks.ts`.
///
/// Curation rules for every nudge:
///   • Harmless & legal — awkward at worst, never dangerous.
///   • Kind — brighten someone's day, never annoy or embarrass them.
///   • Doable — something a normal person could pull off in a day, anywhere.
///   • Consent-first — anyone involved can happily say no.
enum Tasks {

    enum Category: String, CaseIterable {
        case makeAFriend = "Make a Friend"
        case getActive = "Get Active"
        case randomKindness = "Random Kindness"
        case beBold = "Be Bold"
        case trySomethingNew = "Try Something New"
        case smallTalk = "Small Talk"
    }

    struct Nudge {
        let text: String
        let category: Category
    }

    static let nudges: [Nudge] = [
        // Make a Friend
        Nudge(text: "Make a friend at the beach and learn where they're from.", category: .makeAFriend),
        Nudge(text: "Ask someone new if they'd like to take a short walk with you.", category: .makeAFriend),
        Nudge(text: "Find someone reading a book and ask what it's about.", category: .makeAFriend),
        Nudge(text: "Compliment a stranger's dog and ask to say hi.", category: .makeAFriend),
        Nudge(text: "Swap a fun fact about yourself with someone you just met.", category: .makeAFriend),
        Nudge(text: "Ask a person nearby what brought them here today.", category: .makeAFriend),
        Nudge(text: "Introduce yourself to one new person at a coffee shop.", category: .makeAFriend),
        Nudge(text: "Trade a song recommendation with someone new.", category: .makeAFriend),
        Nudge(text: "Ask someone to recommend their favorite local spot.", category: .makeAFriend),
        Nudge(text: "Join a group activity and learn one person's name.", category: .makeAFriend),

        // Get Active
        Nudge(text: "Invite someone to a quick game of catch or frisbee.", category: .getActive),
        Nudge(text: "Ask if you can join a pickup game at the park.", category: .getActive),
        Nudge(text: "Build something in the sand with someone at the beach.", category: .getActive),
        Nudge(text: "Dip your feet in the water and chat with whoever's nearby.", category: .getActive),
        Nudge(text: "Take a spontaneous 10-minute walk somewhere brand new.", category: .getActive),
        Nudge(text: "Try a cartwheel or handstand in the grass.", category: .getActive),
        Nudge(text: "Race a friend (or a willing stranger) to the next lamppost.", category: .getActive),
        Nudge(text: "Watch a sunrise or sunset somewhere you've never watched one.", category: .getActive),
        Nudge(text: "Start a mini beach or park cleanup and invite someone to help.", category: .getActive),
        Nudge(text: "Learn a simple dance move from a video and do it outside.", category: .getActive),

        // Random Kindness
        Nudge(text: "Pay for the coffee of the person behind you.", category: .randomKindness),
        Nudge(text: "Leave an encouraging note where a stranger will find it.", category: .randomKindness),
        Nudge(text: "Give a genuine compliment to three different people today.", category: .randomKindness),
        Nudge(text: "Tell a worker they're doing a great job.", category: .randomKindness),
        Nudge(text: "Let someone go ahead of you in line.", category: .randomKindness),
        Nudge(text: "Offer to take a photo for a couple or a group.", category: .randomKindness),
        Nudge(text: "Thank someone who's usually overlooked — a driver, a janitor.", category: .randomKindness),
        Nudge(text: "Leave a bigger tip than usual with a kind little note.", category: .randomKindness),
        Nudge(text: "Give up your seat before anyone has to ask.", category: .randomKindness),
        Nudge(text: "Hold the door and greet everyone who walks through.", category: .randomKindness),

        // Be Bold
        Nudge(text: "Order a soda in a water cup.", category: .beBold),
        Nudge(text: "Dance for ten seconds in a public place.", category: .beBold),
        Nudge(text: "Start a slow clap and see if anyone joins.", category: .beBold),
        Nudge(text: "Wear sunglasses indoors for an hour, confidently.", category: .beBold),
        Nudge(text: "Do your most confident strut down the sidewalk.", category: .beBold),
        Nudge(text: "Sing along (quietly) to the music in a store.", category: .beBold),
        Nudge(text: "Ask a stranger for a high-five.", category: .beBold),
        Nudge(text: "Wear something slightly mismatched and own it.", category: .beBold),
        Nudge(text: "Skip instead of walk for one whole block.", category: .beBold),
        Nudge(text: "Give yourself a small round of applause in public.", category: .beBold),

        // Try Something New
        Nudge(text: "Order the menu item you'd never normally pick.", category: .trySomethingNew),
        Nudge(text: "Take a different route and notice three things you've never seen.", category: .trySomethingNew),
        Nudge(text: "Try a food from a cuisine you've never had.", category: .trySomethingNew),
        Nudge(text: "Learn one word in a new language from a stranger.", category: .trySomethingNew),
        Nudge(text: "Doodle or sketch something in public for a minute.", category: .trySomethingNew),
        Nudge(text: "Say yes to the next small invitation you'd normally decline.", category: .trySomethingNew),
        Nudge(text: "Ask a shop owner for their personal favorite and get it.", category: .trySomethingNew),
        Nudge(text: "Ask someone to teach you something they're good at.", category: .trySomethingNew),
        Nudge(text: "Try a brand-new hobby for ten minutes today.", category: .trySomethingNew),
        Nudge(text: "Sit somewhere new and just people-watch for five minutes.", category: .trySomethingNew),

        // Small Talk
        Nudge(text: "Say \"good morning\" to five people you don't know.", category: .smallTalk),
        Nudge(text: "Ask a stranger what made them smile today.", category: .smallTalk),
        Nudge(text: "Ask someone what they're excited about this week.", category: .smallTalk),
        Nudge(text: "Compliment someone's laugh.", category: .smallTalk),
        Nudge(text: "Strike up a conversation in an elevator.", category: .smallTalk),
        Nudge(text: "Ask a barista their favorite drink, then order it.", category: .smallTalk),
        Nudge(text: "Ask three people what their dream job is.", category: .smallTalk),
        Nudge(text: "Ask someone older than you for one piece of advice.", category: .smallTalk),
        Nudge(text: "Ask a stranger for a book or movie recommendation.", category: .smallTalk),
        Nudge(text: "Ask a waiter what the kitchen's favorite dish is.", category: .smallTalk)
    ]

    /// Flat list of all nudge texts.
    static let all: [String] = nudges.map { $0.text }

    /// A random nudge. Falls back to a safe default if the list is ever empty.
    static func random() -> String {
        all.randomElement() ?? "Say hi to a stranger."
    }

    /// A random nudge from one mood/category.
    static func random(in category: Category) -> String {
        let pool = nudges.filter { $0.category == category }
        return pool.randomElement()?.text ?? random()
    }
}
