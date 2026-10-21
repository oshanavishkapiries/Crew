import type { CrewMessage } from "./gates-types";
/** A blocked dependency is not a question; an earlier answered question is closed. */
export function openQuestion(
  status: string,
  messages: CrewMessage[],
): CrewMessage | undefined {
  if (status !== "blocked") return;
  let question: CrewMessage | undefined;
  for (const message of messages) {
    if (message.type === "question") question = message;
    if (message.type === "answer") question = undefined;
  }
  return question;
}
