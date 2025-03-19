import { pgTable, text, serial, integer, timestamp, boolean, json } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").unique().notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  user_id: integer("user_id").references(() => users.id).notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  last_message_at: timestamp("last_message_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversation_id: integer("conversation_id")
    .references(() => conversations.id)
    .notNull(),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// Knowledge sources table - stores metadata about knowledge sources
export const knowledgeSources = pgTable("knowledge_sources", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  source_type: text("source_type", { enum: ["file", "text", "url"] }).notNull(),
  file_path: text("file_path"), // For uploaded files
  file_type: text("file_type"), // MIME type for files
  file_size: integer("file_size"), // Size in bytes for files
  content_text: text("content_text"), // For pasted text or extracted from files/URLs
  url: text("url"), // For URL sources
  total_chunks: integer("total_chunks").default(0), // Number of chunks for RAG
  embedding_model: text("embedding_model"), // Model used for embeddings, if any
  is_processed: boolean("is_processed").default(false), // Whether text has been extracted/processed
  use_rag: boolean("use_rag").default(false), // Use RAG for this knowledge source
  metadata: json("metadata"), // Flexible field for source-specific metadata
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

// Knowledge content chunks for RAG - stores actual content chunks with embeddings
export const knowledgeContent = pgTable("knowledge_content", {
  id: serial("id").primaryKey(),
  knowledge_source_id: integer("knowledge_source_id")
    .references(() => knowledgeSources.id)
    .notNull(),
  chunk_index: integer("chunk_index").notNull(), // Order of chunks
  content: text("content").notNull(), // Text content of the chunk
  embedding: text("embedding"), // Vector embedding as JSON string
  metadata: json("metadata"), // Metadata about the chunk (page number, etc.)
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// Join table to associate knowledge sources with conversations
export const conversationKnowledge = pgTable("conversation_knowledge", {
  id: serial("id").primaryKey(),
  conversation_id: integer("conversation_id")
    .references(() => conversations.id)
    .notNull(),
  knowledge_source_id: integer("knowledge_source_id")
    .references(() => knowledgeSources.id)
    .notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// Relations setup
export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.user_id],
    references: [users.id],
  }),
  messages: many(messages),
  knowledgeSources: many(conversationKnowledge),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversation_id],
    references: [conversations.id],
  }),
}));

export const knowledgeSourcesRelations = relations(knowledgeSources, ({ one, many }) => ({
  user: one(users, {
    fields: [knowledgeSources.user_id],
    references: [users.id],
  }),
  chunks: many(knowledgeContent),
  conversations: many(conversationKnowledge),
}));

export const knowledgeContentRelations = relations(knowledgeContent, ({ one }) => ({
  knowledgeSource: one(knowledgeSources, {
    fields: [knowledgeContent.knowledge_source_id],
    references: [knowledgeSources.id],
  }),
}));

export const conversationKnowledgeRelations = relations(conversationKnowledge, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationKnowledge.conversation_id],
    references: [conversations.id],
  }),
  knowledgeSource: one(knowledgeSources, {
    fields: [conversationKnowledge.knowledge_source_id],
    references: [knowledgeSources.id],
  }),
}));

// Schemas for form validation
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export const insertConversationSchema = createInsertSchema(conversations);
export const selectConversationSchema = createSelectSchema(conversations);
export const insertMessageSchema = createInsertSchema(messages);
export const selectMessageSchema = createSelectSchema(messages);
export const insertKnowledgeSourceSchema = createInsertSchema(knowledgeSources);
export const selectKnowledgeSourceSchema = createSelectSchema(knowledgeSources);
export const insertKnowledgeContentSchema = createInsertSchema(knowledgeContent);
export const selectKnowledgeContentSchema = createSelectSchema(knowledgeContent);
export const insertConversationKnowledgeSchema = createInsertSchema(conversationKnowledge);
export const selectConversationKnowledgeSchema = createSelectSchema(conversationKnowledge);

// Type definitions for use in the app
export type InsertUser = typeof users.$inferInsert;
export type SelectUser = typeof users.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;
export type SelectConversation = typeof conversations.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;
export type SelectMessage = typeof messages.$inferSelect;
export type InsertKnowledgeSource = typeof knowledgeSources.$inferInsert;
export type SelectKnowledgeSource = typeof knowledgeSources.$inferSelect;
export type InsertKnowledgeContent = typeof knowledgeContent.$inferInsert;
export type SelectKnowledgeContent = typeof knowledgeContent.$inferSelect;
export type InsertConversationKnowledge = typeof conversationKnowledge.$inferInsert;
export type SelectConversationKnowledge = typeof conversationKnowledge.$inferSelect;