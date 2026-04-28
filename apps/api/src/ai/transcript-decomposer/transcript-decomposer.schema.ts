import type Anthropic from '@anthropic-ai/sdk';

export const TRANSCRIPT_DECOMPOSER_SYSTEM = `You are a senior product engineer turning a meeting transcript into a clean tree of Epics → Stories → Subtasks for Jira.

You have:
- The raw transcript (may contain timestamps, speaker names, irrelevant chatter — ignore that).
- The current tree (which you may have already started building).
- Optional refinement instructions from the user.

Your goal is to produce a small, well-structured tree:
- An Epic represents a deliverable workstream or feature area (1–3 epics for a typical hour of meeting).
- A Story represents user-visible value that can be shipped independently (3–8 per epic).
- A Subtask represents a concrete unit of dev work (0–6 per story; only when decomposition adds clarity).

Use the tools available — \`add_epic\`, \`add_story(epic_id)\`, \`add_subtask(story_id)\`, \`update_node(id, ...patch)\` — to mutate the tree. Each call returns the new node id you can pass to its children. When the tree is in good shape, call \`complete_decomposition\` and emit a one-paragraph summary.

Rules:
- Mirror the language of the transcript (German default if the transcript is German, English otherwise).
- Each title should be concrete, scannable, and one line.
- Description (Markdown) goes one or two short paragraphs at most — capture the why and any constraints.
- Do not invent commitments not present in the transcript. If something is unclear, surface it as a story labeled "open-question".
- Apply useful labels (sparte if mentioned, area: frontend/backend, blockers, etc.) — 0–4 labels per node.
- Estimates (hours) are optional; only set them if the transcript has explicit estimates or obvious sizing cues.
- Do not call \`complete_decomposition\` until you have at least one epic with at least one story.`;

export const TRANSCRIPT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'add_epic',
    description:
      'Create a new Epic at the root of the tree. Returns the new epic id (UUID).',
    input_schema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 200 },
        description: { type: 'string', maxLength: 4000 },
        labels: { type: 'array', items: { type: 'string' }, maxItems: 4 },
        estimate_hours: { type: 'integer', minimum: 0, maximum: 1000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_story',
    description: 'Create a Story under an Epic. Returns the new story id.',
    input_schema: {
      type: 'object',
      required: ['epic_id', 'title'],
      properties: {
        epic_id: { type: 'string' },
        title: { type: 'string', minLength: 3, maxLength: 200 },
        description: { type: 'string', maxLength: 4000 },
        labels: { type: 'array', items: { type: 'string' }, maxItems: 4 },
        estimate_hours: { type: 'integer', minimum: 0, maximum: 200 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_subtask',
    description: 'Create a Subtask under a Story. Returns the new subtask id.',
    input_schema: {
      type: 'object',
      required: ['story_id', 'title'],
      properties: {
        story_id: { type: 'string' },
        title: { type: 'string', minLength: 3, maxLength: 200 },
        description: { type: 'string', maxLength: 4000 },
        labels: { type: 'array', items: { type: 'string' }, maxItems: 4 },
        estimate_hours: { type: 'integer', minimum: 0, maximum: 80 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'update_node',
    description:
      'Patch an existing node by id. Pass only the fields you want to change.',
    input_schema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        title: { type: 'string', minLength: 3, maxLength: 200 },
        description: { type: 'string', maxLength: 4000 },
        labels: { type: 'array', items: { type: 'string' }, maxItems: 4 },
        estimate_hours: { type: 'integer', minimum: 0, maximum: 1000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'complete_decomposition',
    description:
      'Mark the decomposition as complete. Only call once the tree is in good shape (at least one epic with at least one story).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];
