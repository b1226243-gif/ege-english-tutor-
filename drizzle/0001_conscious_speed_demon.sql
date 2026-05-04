CREATE TYPE "public"."attempt_mode" AS ENUM('practice', 'mock_section', 'mock_full');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('in_progress', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."exam_code" AS ENUM('oge_en', 'ege_en', 'ielts', 'toefl', 'cambridge');--> statement-breakpoint
CREATE TYPE "public"."section_kind" AS ENUM('listening', 'reading', 'grammar', 'writing', 'speaking');--> statement-breakpoint
CREATE TYPE "public"."task_source" AS ENUM('fipi_demo', 'ai_generated', 'user_authored');--> statement-breakpoint
CREATE TABLE "answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"raw_answer" jsonb NOT NULL,
	"auto_score" integer,
	"ai_feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"exam_code" "exam_code" NOT NULL,
	"section_id" uuid,
	"task_template_id" uuid,
	"mode" "attempt_mode" DEFAULT 'practice' NOT NULL,
	"status" "attempt_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"total_score" integer,
	"max_score" integer
);
--> statement-breakpoint
CREATE TABLE "exam" (
	"code" "exam_code" PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"locale" text DEFAULT 'ru' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_template_id" uuid NOT NULL,
	"source" "task_source" NOT NULL,
	"stimulus_text" text,
	"stimulus_audio_url" text,
	"assets" jsonb,
	"correct_answers" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"criterion_code" text NOT NULL,
	"criterion_label" text,
	"score" integer NOT NULL,
	"max_score" integer NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_code" "exam_code" NOT NULL,
	"kind" "section_kind" NOT NULL,
	"order_idx" integer NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"time_limit_seconds" integer,
	"max_score" integer NOT NULL,
	"config" jsonb
);
--> statement-breakpoint
CREATE TABLE "task_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"task_number" integer,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"instructions" text NOT NULL,
	"rubric" jsonb NOT NULL,
	"max_score" integer NOT NULL,
	"time_limit_seconds" integer,
	"config" jsonb,
	CONSTRAINT "task_template_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_attempt_id_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_section_id_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_task_template_id_task_template_id_fk" FOREIGN KEY ("task_template_id") REFERENCES "public"."task_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_task_template_id_task_template_id_fk" FOREIGN KEY ("task_template_id") REFERENCES "public"."task_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_score" ADD CONSTRAINT "rubric_score_answer_id_answer_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_exam_code_exam_code_fk" FOREIGN KEY ("exam_code") REFERENCES "public"."exam"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_template" ADD CONSTRAINT "task_template_section_id_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("id") ON DELETE cascade ON UPDATE no action;