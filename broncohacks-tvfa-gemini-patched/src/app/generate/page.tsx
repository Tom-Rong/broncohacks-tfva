"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { GenerateResponse, Lecture, TranscribeResponse, UserNote } from "@/types";

export default function GeneratePage() {
  return (
    <Suspense fallback={<GeneratePageLoading />}>
      <GeneratePageContent />
    </Suspense>
  );
}

function GeneratePageLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-slate-400">Loading...</div>
    </div>
  );
}

function GeneratePageContent() {
  const searchParams = useSearchParams();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const [lectureTitle, setLectureTitle] = useState("");
  const [input, setInput] = useState("");
  const [generatedNotes, setGeneratedNotes] = useState("");
  const [status, setStatus] = useState("");
  const [warning, setWarning] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [styleNoteCount, setStyleNoteCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    async function loadStyleNotes() {
      try {
        const response = await fetch("/api/notes", { cache: "no-store" });
        const data = (await response.json()) as { notes?: UserNote[] };
        setStyleNoteCount(data.notes?.length ?? 0);
      } catch {
        setStyleNoteCount(0);
      }
    }

    void loadStyleNotes();
  }, []);

  useEffect(() => {
    const lectureId = searchParams.get("lectureId");
    if (!lectureId) {
      return;
    }

    async function loadLecture() {
      setStatus("Loading lecture from library...");

      try {
        const response = await fetch(`/api/lectures/${lectureId}`, { cache: "no-store" });
        const data = (await response.json()) as { lecture?: Lecture; error?: string };

        if (!response.ok || !data.lecture) {
          throw new Error(data.error ?? "Failed to load lecture");
        }

        setLectureTitle(data.lecture.title);
        setInput(data.lecture.content);
        setStatus(`Loaded “${data.lecture.title}”.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to load lecture");
      }
    }

    void loadLecture();
  }, [searchParams]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function handleGenerate() {
    if (!input.trim()) {
      setStatus("Paste lecture content or transcribe audio first.");
      return;
    }

    setLoading(true);
    setStatus("");
    setWarning("");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, lectureTitle }),
      });

      const data = (await response.json()) as GenerateResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to generate notes");
      }

      setGeneratedNotes(data.notes);
      setStyleNoteCount(data.styleNoteCount ?? 0);
      setWarning(data.warning ?? "");
      setStatus(data.mode === "gemini" ? "Notes generated with Gemini." : "Notes generated in fallback mode.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to generate notes");
    } finally {
      setLoading(false);
    }
  }

  async function transcribeSelectedFile(selectedFile: File) {
    setTranscribing(true);
    setStatus("");
    setWarning("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as TranscribeResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to transcribe audio");
      }

      setInput(data.text ?? data.transcript ?? "");
      if (!lectureTitle.trim()) {
        setLectureTitle(selectedFile.name.replace(/\.[^.]+$/, ""));
      }
      setWarning(data.warning ?? "");
      setStatus(
        data.mode === "gemini"
          ? `Transcribed ${data.filename} with Gemini.`
          : `Fallback transcript created for ${data.filename}.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to transcribe audio");
    } finally {
      setTranscribing(false);
    }
  }

  async function startRecording() {
    if (recording) {
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Live recording is not supported in this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const preferredMimeType = [
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/webm;codecs=opus",
        "audio/webm",
      ].find((value) => MediaRecorder.isTypeSupported?.(value));

      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const recordedType = recorder.mimeType || preferredMimeType || "audio/webm";
        const extension = recordedType.includes("ogg") ? "ogg" : "webm";
        const recordedBlob = new Blob(chunksRef.current, { type: recordedType });
        const recordedFile = new File([recordedBlob], `live-recording-${Date.now()}.${extension}`, {
          type: recordedType,
        });
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        await transcribeSelectedFile(recordedFile);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setStatus("Recording started...");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to start recording");
    }
  }

  function stopRecording() {
    if (!recording) {
      return;
    }

    mediaRecorderRef.current?.stop();
    setRecording(false);
    setStatus("Recording stopped. Converting audio...");
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-5 rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-300">Generator</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">Generate Personalized Notes</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Paste text, upload audio, or record a clip. Then generate notes in your style.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
            <p className="font-medium text-white">Style notes saved: {styleNoteCount}</p>
            <p className="mt-2">Three or more style samples usually gives better output.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200" htmlFor="lecture-title">
                Lecture title
              </label>
              <input
                id="lecture-title"
                value={lectureTitle}
                onChange={(event) => setLectureTitle(event.target.value)}
                placeholder="CS 101 - Sorting Algorithms"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-sky-400"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200" htmlFor="lecture-input">
                Lecture text
              </label>
              <textarea
                id="lecture-input"
                rows={16}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Paste lecture slides, transcript, or rough notes here."
                className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-sky-400"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-sm font-medium text-white">Upload audio</p>
              <input
                className="mt-3 block w-full text-sm text-slate-300 file:mr-4 file:rounded-full file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-100"
                type="file"
                accept="audio/*"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => {
                  if (file) {
                    void transcribeSelectedFile(file);
                  } else {
                    setStatus("Choose an audio file first.");
                  }
                }}
                disabled={transcribing}
                className="mt-4 rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition cursor-pointer hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {transcribing ? "Transcribing..." : "Transcribe file"}
              </button>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-sm font-medium text-white">Live recording</p>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Record a short lecture clip in the browser, then transcribe it automatically.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  disabled={recording}
                  className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition cursor-pointer hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Start
                </button>
                <button
                  type="button"
                  onClick={stopRecording}
                  disabled={!recording}
                  className="rounded-full border border-rose-500/40 px-4 py-2 text-sm font-medium text-rose-200 transition cursor-pointer hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Stop
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={loading}
              className="rounded-full bg-sky-500 px-5 py-3 text-sm font-medium text-slate-950 transition cursor-pointer hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Generating..." : "Generate notes"}
            </button>
            <button
              type="button"
              onClick={() => {
                setLectureTitle("");
                setInput("");
                setGeneratedNotes("");
                setStatus("");
                setWarning("");
              }}
              className="rounded-full border border-slate-700 px-5 py-3 text-sm font-medium text-slate-200 transition cursor-pointer hover:bg-slate-800"
            >
              Clear
            </button>
          </div>

          {status ? <p className="text-sm text-sky-200">{status}</p> : null}
          {warning ? <p className="text-sm text-amber-200">{warning}</p> : null}
        </div>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold text-white">Generated output</h2>
              <p className="mt-2 text-sm text-slate-300">Your notes will appear here.</p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            {generatedNotes ? (
              <pre className="overflow-x-auto whitespace-pre-wrap text-sm leading-6 text-slate-200">
                {generatedNotes}
              </pre>
            ) : (
              <p className="text-sm leading-6 text-slate-400">
                Nothing generated yet. Paste a lecture, then hit “Generate notes”.
              </p>
            )}
          </div>
        </section>
      </section>
    </div>
  );
}
