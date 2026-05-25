# Chatbot Learning / Answer Audit - 2026-05-25

## Current Structure

The chatbot is not training a model. It uses three runtime memory sources:

1. Server session memory: `lib/chat/memory.js`
   - In-memory only.
   - Per `userId`.
   - Keeps the latest 6 turns.
   - Expires after 30 minutes or server restart.
   - Injected into the SQL agent prompt through `formatHistoryForPrompt`.

2. Browser history: `pages/m/chat.js`
   - Stored in the user's browser `localStorage`.
   - Keeps the latest 100 UI messages.
   - Sent back as `clientHistory` on each chat request.
   - Used when the server memory is empty.

3. Usage preference memory: `lib/apiLogger.js`
   - In-memory API access frequency for 24 hours.
   - Injected into the SQL agent prompt as a weak preference hint.
   - It does not store exact chat content.

## Answer Flow

1. `/api/m/chat` receives the user message.
2. `routeIntent` classifies the question.
3. Simple business questions go to fixed handlers:
   - order, stock, shipment, sales, receivable, order request, help.
4. Complex or follow-up questions go to `handleSqlAgent`.
5. `handleSqlAgent` asks Claude to generate SELECT SQL.
6. `sqlguard` validates the SQL.
7. The SQL runs against DB.
8. Claude formats the DB rows into text/card output.

## Risks Found

- There was no durable server-side chat audit log.
- The only persistent full conversation was browser localStorage, which cannot be inspected from the server.
- Server memory was temporary, so a restart lost the learning context.
- SQL agent `_debug.sql` existed only in the response object and was not retained for later quality checks.
- Fixed handler answers and LLM SQL answers were hard to distinguish after the fact.
- Risky patterns such as empty answer, ask-back, uncertain answer, large result, or SQL-agent answer were not summarized anywhere.

## Added Guardrail

Added `_chat_audit` logging through `lib/chat/audit.js`.

Each chatbot response now stores:

- user id/name
- user message
- payload
- client history count
- flattened bot answer
- response JSON
- SQL debug JSON when present
- route flags such as `RULE_HANDLER`, `LLM_SQL`, `ASKBACK`
- risk flags such as `UNCERTAIN_ANSWER`, `EMPTY_RESPONSE`, `LARGE_RESULT`
- success/error
- duration

Added `/api/m/chat-audit` to inspect recent chatbot answers and summary counts.

## Next Improvement Ideas

- Add an admin UI page for chat audit review.
- Add thumbs up/down feedback to each answer and store it with `AuditKey`.
- Convert repeated bad answers into fixed handler rules instead of relying on SQL-agent guessing.
- Add a test set of common Korean/Kakao-style ERP questions and replay it after each chatbot change.
