"use client";

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';
import Toast from './Toast';
import { trackDumpParse } from '@/lib/analytics';
import { getCurrentAppUser } from '@/lib/users/linking';
import { TASK_SOURCES } from '@/lib/taskSources';

export default function FloatingBrainDump() {
  const { user } = useAuth();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  
  // Voice recording states
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Initialize Speech Recognition
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = 'en-US';

        recognitionRef.current.onresult = (event: any) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcriptPiece = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcriptPiece + ' ';
            } else {
              interimTranscript += transcriptPiece;
            }
          }

          setTranscript(prev => prev + finalTranscript);
          // Show interim results in real-time
          if (interimTranscript) {
            setContent(prev => {
              const withoutInterim = prev.split('...')[0];
              return withoutInterim + finalTranscript + interimTranscript + '...';
            });
          } else {
            setContent(prev => prev + finalTranscript);
          }
        };

        recognitionRef.current.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
          if (event.error !== 'aborted' && event.error !== 'no-speech') {
            setToast("That didn\'t work - want to try again?");
          }
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
        };
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const startListening = () => {
    if (recognitionRef.current) {
      setTranscript('');
      setIsListening(true);
      recognitionRef.current.start();
    } else {
      setToast('Voice input not supported in this browser');
    }
  };

  const stopListening = async () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      
      // Clean up interim markers
      setContent(prev => prev.replace(/\.\.\.$/, '').trim());
      
      // Auto-submit after stopping if there's content
      if (content.trim()) {
        setTimeout(() => {
          handleSubmit();
        }, 500);
      }
    }
  };

  const LOG = '[BrainDump]';

  // Task creation flow: parseDump (rules-only, no AI) → insert → success. Never waits on OpenAI.
  const handleSubmit = async () => {
    if (!content.trim() || !user) return;

    console.log(LOG, '1. Starting save', { textLength: content.trim().length, userId: user.id });
    setLoading(true);
    try {
      console.log(LOG, '2. Getting session...');
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
        console.log(LOG, '2. Session OK, sending Bearer token');
      } else {
        console.warn(LOG, '2. No session/access_token – API may return 401');
      }

      console.log(LOG, '3. Calling POST /api/parseDump...');
      const response = await fetch('/api/parseDump', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: content }),
      });

      console.log(LOG, '4. Response received', { status: response.status, ok: response.ok });

      if (!response.ok) {
        const body = await response.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
        console.error(LOG, '4. API error', { status: response.status, body: parsed });
        if (response.status === 429) {
          const data = typeof parsed === 'object' && parsed !== null && 'error' in parsed
            ? (parsed as { error?: string })
            : {};
          setToast(data.error || "Too many requests. Try again in a minute.");
          return;
        }
        throw new Error(`Parse failed: ${response.status} ${body.slice(0, 200)}`);
      }

      const { tasks, summary } = await response.json();
      console.log(LOG, '5. Parsed OK', { taskCount: tasks?.length, summary });

      console.log(LOG, '6. Resolving app user...');
      const appUser = await getCurrentAppUser();
      const appUserId = appUser?.id ?? null;
      console.log(LOG, '6. App user', appUserId ? { appUserId } : 'none (tasks will use user_id only)');

      const proposedTasks = tasks.map((t: any) => ({
        title: t.title,
        due_date: t.due_date,
        due_time: t.due_time,
        category: t.category ?? 'Tasks',
        inferred_date: !!t.inferred_date,
        inferred_time: !!t.inferred_time,
        rawCandidate: t.rawSegmentText ?? t.title,
      }));

      console.log(LOG, '7. Calling POST /api/tasks/import/confirm (insertTasksWithDedupe)...');
      const insertRes = await fetch('/api/tasks/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({
          tasks: proposedTasks,
          source: TASK_SOURCES.WEB_BRAIN_DUMP,
          app_user_id: appUserId,
        }),
      });

      if (!insertRes.ok) {
        const errBody = await insertRes.text();
        throw new Error(insertRes.status === 400 ? errBody : 'Insert failed');
      }

      const { inserted, duplicates } = await insertRes.json();
      console.log(LOG, '7. Insert OK', { inserted: inserted?.length, duplicates: duplicates?.length });

      trackDumpParse(inserted?.length ?? 0);

      setContent('');
      setTranscript('');
      setIsOpen(false);

      const currentPath = window.location.pathname;
      if (currentPath === '/tasks') {
        window.location.reload();
      } else {
        router.refresh();
      }

      const insertedCount = Array.isArray(inserted) ? inserted.length : 0;
      const dupCount = Array.isArray(duplicates) ? duplicates.length : 0;
      const toastMsg = dupCount > 0
        ? `Created ${insertedCount} task(s)${dupCount > 0 ? ` (${dupCount} duplicate(s) skipped)` : ''}.`
        : (summary || `Created ${insertedCount} task(s)!`);
      setTimeout(() => setToast(toastMsg), 100);
      console.log(LOG, '8. Done – success');

      // Fire-and-forget: refine in background; refresh list if any task was updated (failure-safe, non-blocking)
      if (inserted?.length && session?.access_token) {
        const dupSet = new Set((duplicates ?? []).map((d: { index: number }) => d.index));
        const insertedIndices = tasks.map((_: any, i: number) => i).filter((i: number) => !dupSet.has(i));
        const refinePayload = insertedIndices.slice(0, inserted.length).map((taskIdx: number, j: number) => ({
          id: inserted[j]?.id,
          rawSegmentText: tasks[taskIdx].rawSegmentText ?? '',
          title: tasks[taskIdx].title,
          due_date: tasks[taskIdx].due_date,
          due_time: tasks[taskIdx].due_time,
          category: tasks[taskIdx].category,
          dueDateWasDefaulted: tasks[taskIdx].dueDateWasDefaulted,
          dueTimeWasDefaulted: tasks[taskIdx].dueTimeWasDefaulted,
        })).filter((r: any) => r.id);
        if (refinePayload.length > 0) {
          fetch('/api/refineTasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ tasks: refinePayload, fullDumpText: content.trim() || undefined }),
          })
            .then((res) => res.ok ? res.json() : null)
            .then((body: any) => {
              if (body?.refined && body?.updatedCount > 0) {
                console.log(LOG, 'Refinement updated', body.updatedCount, 'task(s)');
                router.refresh();
              }
            })
            .catch(() => { /* failure-safe: no UI impact */ });
        }
      }
    } catch (error: any) {
      console.error(LOG, 'Failed', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        stack: error?.stack?.split('\n').slice(0, 3),
      });
      setToast("That didn't work - want to try again?");
    } finally {
      setLoading(false);
      console.log(LOG, '9. Loading cleared');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Submit on Cmd/Ctrl + Enter
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Don't show if not authenticated
  if (!user) return null;

  return (
    <>
      {/* Floating Button — hidden on desktop */}
      <button
        onClick={() => setIsOpen(true)}
        className="lg:hidden fixed bottom-36 right-4 md:bottom-6 md:right-6 z-50 w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-600 text-white rounded-full shadow-lg hover:shadow-xl hover:scale-110 transition-all duration-200 flex items-center justify-center group"
        aria-label="Open Brain Dump"
        title="Brain Dump 💡"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="w-6 h-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
          />
        </svg>
      </button>

      {/* Modal/Drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              if (isListening) {
                stopListening();
              }
              setIsOpen(false);
            }}
          />

          {/* Modal */}
          <div className="relative w-full max-w-lg bg-gray-900 rounded-t-2xl md:rounded-2xl shadow-2xl p-6 animate-slide-up md:animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">Brain Dump 🧠</h2>
                <p className="text-sm text-gray-400">
                  {isListening ? '🎤 Listening...' : 'Quick capture your thoughts'}
                </p>
              </div>
              <button
                onClick={() => {
                  if (isListening) {
                    stopListening();
                  }
                  setIsOpen(false);
                }}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
                  placeholder="What's on your mind?"
              autoFocus
              rows={6}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
            />

            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-2">
                {/* Microphone Button */}
                <button
                  onClick={isListening ? stopListening : startListening}
                  className={`p-3 rounded-full transition-all ${
                    isListening
                      ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                      : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                  aria-label={isListening ? 'Stop recording' : 'Start recording'}
                >
                  {isListening ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                      className="w-5 h-5 text-white"
                    >
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      className="w-5 h-5 text-white"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
                      />
                    </svg>
                  )}
                </button>
                
              <span className="text-xs text-gray-500">
                  {isListening ? 'Recording...' : 'Cmd/Ctrl + Enter to save'}
              </span>
              </div>
              
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (isListening) {
                      stopListening();
                    }
                    setIsOpen(false);
                  }}
                  className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!content.trim() || loading || isListening}
                  className="px-6 py-2 bg-gradient-to-r from-purple-500 to-blue-600 text-white rounded-lg font-medium hover:from-purple-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? 'Saving...' : 'Capture'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast}
          onClose={() => setToast(null)}
        />
      )}
    </>
  );
}