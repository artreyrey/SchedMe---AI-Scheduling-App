# SchedMe

### Make room for what matters.

SchedMe is an AI-assisted personal scheduling app that turns thoughts, tasks, and natural-language requests into a clear weekly plan.

## Live app

**[Open SchedMe](https://schedme.vercel.app)**

## The gap

Most planning tools fall into one of two extremes:

- Traditional calendars require users to create and reorganize every event manually.
- AI assistants can discuss a schedule but may ask repetitive questions, lose conversational context, or claim an action happened without reliably saving it.

Users need a faster bridge between *remembering something* and *giving it a real place in their week*. They should not have to repeat task details, rebuild interrupted scheduling flows, or resolve every calendar conflict themselves.

## Our answer

SchedMe combines conversational AI with deterministic scheduling controls.

A user can capture an idea in **What's on my mind**, schedule it later through a short conversation, enter a complete request such as `Schedule dinner tomorrow from 8-9pm`, or edit the calendar directly. The assistant asks only for missing information, recognizes when the user changes direction, checks for conflicts, and confirms completion only after the change has been saved.

This creates a planning experience that feels conversational without sacrificing predictability or user control.

## Features

- Natural-language scheduling for tasks, days, and time ranges.
- Compact commands such as `Thesis / Monday / 2-3pm`.
- A **What's on my mind** inbox for unscheduled thoughts and tasks.
- Guided scheduling of outstanding tasks, ordered by urgency and age.
- Conflict detection with alternatives and safe replacement choices.
- Move, reschedule, unschedule, cancel, complete, skip, and undo actions.
- Manual calendar creation and editing for titles, times, completion, and colors.
- Animated drag-and-drop between calendar days and time sections.
- Urgent, important, not urgent, and free-form task groups.
- Persistent conversation history and personalized interaction preferences.
- A daily greeting that appears only once instead of interrupting every action.
- Light, Dark, Pink, Berry Sunset, Matcha, and Night themes.
- Email/password and Google authentication through Firebase.
- Responsive glass-inspired interface with reduced-motion support.

## Our edge

- **Reliable execution:** AI interprets intent, while deterministic application logic performs calendar writes and validates the result.
- **Fewer prompts:** Complete requests are scheduled immediately, and the assistant asks only for missing information.
- **Context-aware conversations:** New named requests can override stale scheduling flows instead of being forced onto the previous task.
- **Multiple ways to plan:** Users can chat, use compact commands, complete forms, or drag tasks directly on the calendar.
- **Conflict safety:** Existing appointments are protected from accidental overwrites.
- **User control:** Priorities remain intact when tasks are scheduled, and displaced tasks return safely to the inbox.
- **Persistent personalization:** Themes, conversation history, assistant preferences, and communication style remain available across sessions.
- **Privacy-focused storage:** Personal schedules and conversations are scoped to the authenticated user through Firebase security rules.

---

Built with React, Vite, Tailwind CSS, Firebase, Gemini, and Vercel.
