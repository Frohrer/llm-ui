import { KnowledgeSourceList } from "./knowledge-source-list";

interface ConversationKnowledgeProps {
  conversationId: number;
}

export function ConversationKnowledge({
  conversationId,
}: ConversationKnowledgeProps) {
  return (
    <KnowledgeSourceList
      mode="conversation"
      conversationId={conversationId}
      gridLayout={true}
    />
  );
}
