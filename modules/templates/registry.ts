import { Platform } from "@prisma/client";

/**
 * Content templates (Phase 2 "Templates", reused by every Studio).
 *
 * These are starting structures, not content — picking one prefills the
 * composer, which then goes through the normal post service like anything else.
 */

export type Template = {
  id: string;
  name: string;
  description: string;
  body: string;
};

export const TEMPLATES: Record<Platform, Template[]> = {
  [Platform.X]: [
    {
      id: "x-contrarian",
      name: "Contrarian take",
      description: "State the common belief, then the exception you've earned.",
      body: "Everyone says [common advice].\n\nWe tried it for [duration]. Here's what actually happened:\n\n[result]\n\nThe version that worked: [your approach].",
    },
    {
      id: "x-thread-lessons",
      name: "Lessons thread",
      description: "Numbered thread built from a real project.",
      body: "[N] things we changed about [process] that cut [metric] from [before] to [after] 🧵\n\n1. [change]\n\n2. [change]\n\n3. [change]",
    },
    {
      id: "x-teardown",
      name: "Teardown",
      description: "Pull one example apart and say why it worked.",
      body: "This [post/campaign] did [result].\n\nThree things it got right:\n\n1. [observation]\n2. [observation]\n3. [observation]\n\nThe one I'd steal: [the transferable bit].",
    },
  ],
  [Platform.TIKTOK]: [
    {
      id: "tt-pov",
      name: "POV hook",
      description: "Drop the viewer into a situation they recognise.",
      body: "POV: [situation the audience knows too well]\n\nHere's the [duration] fix:\n\n1. [step]\n2. [step]\n3. [step]",
    },
    {
      id: "tt-mistake",
      name: "Stop doing X",
      description: "Name the habit, show the cost, give the swap.",
      body: "Stop [common habit].\n\nWatch what happens to [metric] when you don't.\n\n[before number] → [after number]\n\nDo this instead: [swap].",
    },
    {
      id: "tt-series",
      name: "Build in public",
      description: "One episode of an ongoing series.",
      body: "Day [n] of building [thing] in public.\n\nToday: [what you did]\n\nWhat broke: [problem]\n\nTomorrow: [next step]",
    },
  ],
  [Platform.INSTAGRAM]: [
    {
      id: "ig-carousel",
      name: "Carousel breakdown",
      description: "One idea per slide, with a payoff slide at the end.",
      body: "[Number] [things] on [topic] →\n\nSlide 1: [hook]\nSlide 2: [point]\nSlide 3: [point]\nSlide 4: [point]\nSlide 5: [the payoff]\n\nSave this for [when they'd need it].",
    },
    {
      id: "ig-bts",
      name: "Behind the scenes",
      description: "Show the process, not the polish.",
      body: "Behind the scenes on [project].\n\nWhat you see: [the output]\nWhat it took: [the real work]\n\n[One honest detail nobody talks about.]",
    },
    {
      id: "ig-reel",
      name: "Reel caption",
      description: "Short caption that supports a video.",
      body: "[Hook line that works without the video]\n\n[One sentence of context.]\n\n[Question that invites a reply.]",
    },
  ],
  [Platform.FACEBOOK]: [
    {
      id: "fb-longform",
      name: "Long-form story",
      description: "Room to develop one argument properly.",
      body: "A longer post today, because this deserves the room.\n\n[The situation.]\n\n[What we tried first, and why it didn't work.]\n\n[What we do now.]\n\n[What we'd tell someone starting today.]",
    },
    {
      id: "fb-event",
      name: "Event promotion",
      description: "What, when, who it's for, how to join.",
      body: "We're hosting [event] on [date].\n\nWho it's for: [audience]\nWhat you'll leave with: [outcome]\n\n[How to sign up.]",
    },
    {
      id: "fb-question",
      name: "Community question",
      description: "Start a discussion rather than broadcast.",
      body: "Question of the week: [genuine, specific question].\n\nOurs is [your own answer], because [reason].\n\nWhat's yours?",
    },
  ],
  [Platform.YOUTUBE]: [
    {
      id: "yt-walkthrough",
      name: "Full walkthrough",
      description: "Title, description and chapter skeleton.",
      body: "Title: [outcome] — [how, in plain words]\n\nIn this video: [what the viewer gets].\n\nChapters:\n00:00 [hook]\n[time] [section]\n[time] [section]\n[time] [recap]",
    },
    {
      id: "yt-test",
      name: "We tested it",
      description: "Experiment format with a real number.",
      body: "Title: We tested [thing] for [duration]. Here's what moved.\n\nSetup: [what you tested and how]\nResult: [the number]\nWhat surprised us: [detail]\nWhat we'd do differently: [detail]",
    },
    {
      id: "yt-short",
      name: "Short",
      description: "One idea, under 60 seconds.",
      body: "Hook: [the claim, in under 8 words]\n\nProof: [the one example]\n\nTakeaway: [what to do on Monday]",
    },
  ],
};

export function templatesFor(platform: Platform) {
  return TEMPLATES[platform];
}
