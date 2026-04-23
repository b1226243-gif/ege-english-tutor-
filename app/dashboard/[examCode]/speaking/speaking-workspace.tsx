"use client";

import * as React from "react";
import { Mic, Square } from "lucide-react";

import { ChatBox } from "@/components/chat-box";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SupportedExamCode } from "@/lib/exams";

/**
 * Speaking workspace (Phase 1 logic, factored out of the old page).
 *
 * Phase 2 just wraps this inside `/dashboard/[examCode]/speaking` so it's
 * addressable per exam. Full Tasks 1–4 (ЕГЭ) / Tasks 1–3 (ОГЭ) with FIPI
 * timers + MediaRecorder + Whisper land in PR #6; for now this is the
 * single-shot practice capture we shipped in PR #1.
 */
export function SpeakingWorkspace({ examCode }: { examCode: SupportedExamCode }) {
  const [transcript, setTranscript] = React.useState("");
  const [recording, setRecording] = React.useState(false);
  const [submittedAt, setSubmittedAt] = React.useState(0);
  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null);

  const supported = React.useSyncExternalStore(
    () => () => {},
    () => {
      const w = window as WindowWithSpeech;
      return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
    },
    () => true,
  );

  React.useEffect(() => {
    const w = window as WindowWithSpeech;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        finalText += event.results[i][0].transcript;
      }
      setTranscript((prev) => (prev ? prev + " " : "") + finalText.trim());
    };
    rec.onend = () => setRecording(false);
    recognitionRef.current = rec;
    return () => {
      rec.onresult = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  const start = () => {
    setTranscript("");
    recognitionRef.current?.start();
    setRecording(true);
  };
  const stop = () => {
    recognitionRef.current?.stop();
    setRecording(false);
  };

  const chatKey = `speaking-${submittedAt}`;
  const autoSubmit = React.useMemo(() => {
    if (submittedAt === 0) return undefined;
    const exam = examCode === "ege_en" ? "ЕГЭ" : "ОГЭ";
    return `Please evaluate my spoken response for the ${exam} English oral part (transcribed by the browser).\n\nTranscript:\n"""\n${transcript}\n"""`;
  }, [submittedAt, transcript, examCode]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Устная часть ·{" "}
        {examCode === "ege_en" ? "ЕГЭ" : "ОГЭ"}
      </h1>

      <div className="grid gap-4 lg:grid-cols-2 min-h-[70vh]">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Запись голоса</CardTitle>
            <CardDescription>
              Web Speech API (Chrome / Edge). Если браузер не поддерживает —
              введите транскрипт вручную.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-3">
            {supported ? (
              <div className="flex items-center gap-2">
                {recording ? (
                  <Button variant="destructive" onClick={stop}>
                    <Square className="mr-2 h-4 w-4" /> Остановить запись
                  </Button>
                ) : (
                  <Button onClick={start}>
                    <Mic className="mr-2 h-4 w-4" /> Начать запись
                  </Button>
                )}
                <span
                  className={cn(
                    "text-xs",
                    recording ? "text-red-600" : "text-zinc-500",
                  )}
                >
                  {recording ? "● Запись…" : "Ожидание"}
                </span>
              </div>
            ) : (
              <p className="text-sm text-amber-600">
                Этот браузер не поддерживает Web Speech API. Введите ответ
                в поле ниже.
              </p>
            )}
            <Textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Здесь появится транскрипт…"
              className="flex-1 min-h-[260px] font-mono text-sm"
            />
            <div className="flex justify-end">
              <Button
                onClick={() => setSubmittedAt(Date.now())}
                disabled={!transcript.trim() || recording}
              >
                Оценить
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Фидбек экзаменатора</CardTitle>
            <CardDescription>
              Посегментная оценка FIPI (Tasks 1–4 для ЕГЭ / Tasks 1–3 для ОГЭ).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            <ChatBox
              key={chatKey}
              module="speaking"
              autoSubmit={autoSubmit}
              variant="feedback"
              placeholder="Задайте уточняющий вопрос экзаменатору…"
              className="h-full"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ──────────────────────────── Web Speech API types ────────────────────────────

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type WindowWithSpeech = Window & {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};
