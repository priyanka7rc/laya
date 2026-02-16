# Conversational Focus Implementation

**Date:** February 4, 2026  
**Status:** ✅ Complete

---

## Summary

Replaced time-window-based task edit targeting with an explicit conversational focus model. Edits now apply to the last-interacted task, not the most-recently-created-within-N-minutes task.

---

## Changes Made

### 1. Focus Store (In-Memory)

**File:** `src/lib/whatsapp-processor.ts`

```typescript
interface FocusState {
  taskId: string;
  setAt: Date;
}

const userFocusStore = new Map<string, FocusState>();
```

**TTL:** 2 hours (generous, cleared explicitly)

**Functions:**
- `setFocus(userId, taskId)` - Set current focus
- `getFocus(userId)` - Get current focus (null if expired/not set)
- `clearFocus(userId, reason)` - Clear focus with logging

---

## Focus Set Rules

Focus is set when:
- ✅ **Task created via WhatsApp** (`saveStructuredData`)
- ✅ **Task edited via WhatsApp** (`handleTaskEdit`)
- ✅ **Task selected via clarification** (`handleEditClarification`)

---

## Focus Clear Rules

Focus is cleared when:
- ✅ **New task created** (`saveStructuredData` - before setting new focus)
- ✅ **Query processed** (`handleTaskQuery`)
- ✅ **User cancels** (`checkAndClearPendingClarification`)
- ✅ **Clarification expires** (`handleEditClarification`)
- ✅ **Focus task not found** (`handleTaskEdit`)
- ✅ **Focus TTL exceeded** (automatic in `getFocus`)

---

## Edit Handling (New Behavior)

### Before (Time-Based)
```typescript
// Find tasks created in last 5 minutes
const fiveMinutesAgo = new Date();
fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

const { data: recentTasks } = await supabase
  .from('tasks')
  .gte('created_at', fiveMinutesAgo.toISOString());
```

### After (Focus-Based)
```typescript
// Get current focus task
const focusTaskId = getFocus(userId);

if (!focusTaskId) {
  // No focus → ask clarification
  // Show recent open tasks (no time limit)
}

// Fetch focused task directly
const { data: taskToEdit } = await supabase
  .from('tasks')
  .select('*')
  .eq('id', focusTaskId)
  .single();
```

---

## Code Removals

**Removed:**
- ❌ All `fiveMinutesAgo` time-based task queries
- ❌ Edit behavior based purely on recency
- ❌ Implicit time-window assumptions

**What remains:**
- ✅ Clarification expiry (2 hours, matching focus TTL)
- ✅ Open task filtering (not time-based, just `is_done = false`)

---

## Acceptance Tests

### Test 1: Focus Persistence
```
User: "Buy milk tomorrow"
→ Task created
→ Focus set to milk task

(User waits 30 minutes)

User: "Make it 6pm"
→ Milk task updated ✅
```

**Verification:**
- Focus persists beyond 5-minute window
- Edit applies to correct task

---

### Test 2: Focus Cleared by Query
```
User: "Buy milk tomorrow"
→ Task created
→ Focus set

User: "What do I have today?"
→ Query response
→ Focus cleared ✅

User: "Make it 6pm"
→ Clarification prompt ✅ (no focus)
```

**Verification:**
- Query clears focus
- Subsequent edit requires clarification

---

### Test 3: No Ambiguity with Multiple Tasks
```
User: "Buy milk"
→ Focus: milk

User: "Pay bills"
→ Focus cleared (new task)
→ Focus: bills

User: "Make it 6pm"
→ Bills task updated ✅ (not milk)
```

**Verification:**
- New task clears old focus
- Focus always points to most recent interaction

---

### Test 4: Clarification Sets Focus
```
User: "Buy milk"
User: "Pay bills"
→ Focus: bills

User: "What do I have?"
→ Focus cleared

User: "Make it 6pm"
→ Clarification: "Which task?"
→ 1) Pay bills
→ 2) Buy milk

User: "1"
→ Focus set to bills ✅
→ Bills updated to 6pm
```

**Verification:**
- Clarification selection sets focus
- Subsequent edits apply to selected task

---

## Migration Notes

### No Schema Changes Required ✅
- Focus state is in-memory only
- No database migrations needed
- State lost on server restart (acceptable - TTL is 2 hours anyway)

### No Breaking Changes ✅
- Task creation behavior unchanged
- Query behavior unchanged
- Only edit targeting logic changed (improvement)

---

## Files Modified

**1 file changed:**
- `src/lib/whatsapp-processor.ts`

**Lines added/modified:**
- Focus store: ~45 lines
- `saveStructuredData`: Clear focus + set focus on creation
- `handleTaskQuery`: Clear focus on query
- `handleTaskEdit`: Use focus instead of time-based query
- `handleEditClarification`: Set focus on selection, remove time-based task query
- `checkAndClearPendingClarification`: Clear focus on cancel

---

## Production Readiness

✅ **No time-window logic remains**  
✅ **All acceptance tests pass**  
✅ **Focus model is simple and predictable**  
✅ **Logging added for debugging**  
✅ **TTL prevents stale focus**  

**Status:** Ready for Feb 28 MVP

---

## Debugging

**Check focus state:**
```typescript
console.log(userFocusStore.get(userId));
```

**Log output:**
```
🎯 Focus set: user=abc123, task=task-456
🎯 Focus cleared: user=abc123, reason=new_task_created
🎯 Focus expired: user=abc123
```

**Reasons for clearing:**
- `new_task_created`
- `query_processed`
- `user_cancelled`
- `clarification_expired`
- `focus_task_not_found`
