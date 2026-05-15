// Validates an outgoing chat.postMessage payload against the publicly
// documented Slack Block Kit and legacy-attachment schemas. Throws on the
// first violation so tests fail with a meaningful path.
//
// Sources (consulted when writing this validator):
//   blocks index:   https://docs.slack.dev/reference/block-kit/blocks
//   section block:  https://docs.slack.dev/reference/block-kit/blocks/section-block
//   context block:  https://docs.slack.dev/reference/block-kit/blocks/context-block
//   chat.postMessage / attachment color: https://api.slack.com/methods/chat.postMessage
//   (color may be one of `good` / `warning` / `danger`, or a hex code.)

const TEXT_OBJECT_TYPES = new Set(['plain_text', 'mrkdwn']);

// "You can include up to 50 blocks in each message" — blocks index doc.
const MAX_BLOCKS_PER_MESSAGE = 50;

// Section: text ≤ 3000 chars; fields ≤ 10 items, each ≤ 2000 chars — section doc.
const SECTION_TEXT_MAX = 3000;
const SECTION_FIELDS_MAX_ITEMS = 10;
const SECTION_FIELD_TEXT_MAX = 2000;

// Context: ≤ 10 elements — context doc.
const CONTEXT_MAX_ELEMENTS = 10;

const BLOCK_TYPES = new Set([
  'section',
  'divider',
  'context',
  'header',
  'actions',
  'image',
  'input',
  'file',
  'video',
  'rich_text',
]);

const ATTACHMENT_COLOR_RE = /^(good|warning|danger|#[0-9a-fA-F]{6})$/;

const fail = (path, msg) => {
  throw new Error(`Slack schema violation at ${path}: ${msg}`);
};

const validateTextObject = (obj, path) => {
  if (!obj || typeof obj !== 'object') fail(path, 'missing text object');
  if (!TEXT_OBJECT_TYPES.has(obj.type)) fail(path, `invalid text type "${obj.type}"`);
  if (typeof obj.text !== 'string' || obj.text.length === 0) fail(path, 'empty text');
};

const validateSection = (block, path) => {
  const hasText = block.text != null;
  const hasFields = Array.isArray(block.fields);
  if (!hasText && !hasFields) fail(path, 'section requires text or fields');
  if (hasText) {
    validateTextObject(block.text, `${path}.text`);
    if (block.text.text.length > SECTION_TEXT_MAX) {
      fail(`${path}.text`, `exceeds ${SECTION_TEXT_MAX} chars`);
    }
  }
  if (hasFields) {
    if (block.fields.length > SECTION_FIELDS_MAX_ITEMS) {
      fail(`${path}.fields`, `more than ${SECTION_FIELDS_MAX_ITEMS} items`);
    }
    block.fields.forEach((f, i) => {
      validateTextObject(f, `${path}.fields[${i}]`);
      if (f.text.length > SECTION_FIELD_TEXT_MAX) {
        fail(`${path}.fields[${i}]`, `exceeds ${SECTION_FIELD_TEXT_MAX} chars`);
      }
    });
  }
};

const validateContext = (block, path) => {
  if (!Array.isArray(block.elements)) fail(path, 'context requires elements array');
  if (block.elements.length > CONTEXT_MAX_ELEMENTS) {
    fail(`${path}.elements`, `more than ${CONTEXT_MAX_ELEMENTS} items`);
  }
  block.elements.forEach((el, i) => {
    if (el?.type === 'image') return;
    validateTextObject(el, `${path}.elements[${i}]`);
  });
};

const validateBlock = (block, path) => {
  if (!block || typeof block !== 'object') fail(path, 'block must be an object');
  if (!BLOCK_TYPES.has(block.type)) fail(path, `unknown block type "${block.type}"`);
  if (block.type === 'section') validateSection(block, path);
  if (block.type === 'context') validateContext(block, path);
};

export const validateSlackMessage = (msg) => {
  if (!msg || typeof msg !== 'object') fail('$', 'payload must be an object');
  if (typeof msg.channel !== 'string' || msg.channel.length === 0) {
    fail('$.channel', 'must be a non-empty string');
  }
  // chat.postMessage requires text OR blocks OR attachments. We always send a
  // top-level `text` fallback so notifications render correctly.
  if (typeof msg.text !== 'string' || msg.text.length === 0) {
    fail('$.text', 'top-level text fallback is required for notifications');
  }

  const attachments = msg.attachments || [];
  if (!Array.isArray(attachments)) fail('$.attachments', 'must be an array');

  attachments.forEach((att, i) => {
    const path = `$.attachments[${i}]`;
    if (att.color != null && !ATTACHMENT_COLOR_RE.test(att.color)) {
      fail(`${path}.color`, `"${att.color}" is not good|warning|danger|#RRGGBB`);
    }
    const blocks = att.blocks || [];
    if (blocks.length > MAX_BLOCKS_PER_MESSAGE) {
      fail(`${path}.blocks`, `exceeds ${MAX_BLOCKS_PER_MESSAGE} blocks`);
    }
    blocks.forEach((b, j) => validateBlock(b, `${path}.blocks[${j}]`));
  });
};

// Slack date helper format from https://docs.slack.dev/messaging/formatting-message-text
//   <!date^TIMESTAMP^TOKEN_STRING|FALLBACK>
// TIMESTAMP must be a unix-seconds integer; FALLBACK is required.
export const SLACK_DATE_RE = /^<!date\^\d+\^[^|>]+\|[^>]+>$/;
