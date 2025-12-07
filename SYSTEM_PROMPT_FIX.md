# System Prompt Issue - Root Cause Analysis

## 🐛 **Root Cause Identified**

The system prompt was not being properly saved/updated in Supabase due to **invalid Python syntax in a TypeScript file**.

### **Primary Issue:**
**File:** `src/hooks/useOnboarding.ts` (Line 56)

**Problem:**
```typescript
**User just said:** "{user_data.get('last_message', '')}"
```

This line used **Python dictionary syntax** (`user_data.get()`) in a JavaScript/TypeScript context, which would:
1. Cause a runtime error when the template string is evaluated
2. Result in an invalid system prompt being generated
3. Potentially cause the prompt to be malformed when saved to Supabase

### **Secondary Issues:**

1. **Incorrect JSON format example** (Line 48):
   - **Before:** `{"text" : "sample response"}`
   - **After:** `[{"text": "first message"}, {"text": "second message"}]`
   - The AI was being instructed to return a single object instead of an array

2. **Unnecessary template placeholder:**
   - The `{user_data.get('last_message', '')}` line was not needed in the system prompt
   - User messages are already passed in the conversation history

## ✅ **Fixes Applied**

### 1. **Fixed `useOnboarding.ts`:**
- ✅ Removed the invalid Python syntax line
- ✅ Fixed JSON format instruction to show proper array format
- ✅ Cleaned up the system prompt template

### 2. **Added Debug Logging in `Index.tsx`:**
- ✅ Added console logging when system prompt is generated during onboarding
- ✅ Logs the complete system prompt before saving to Supabase
- ✅ Logs form data for verification

### 3. **Existing Debug Logging:**
- ✅ `Chat.tsx` already logs the system prompt retrieved from Supabase (Line 135)
- ✅ `supabase/functions/chat/index.ts` already logs the system prompt received by the Edge Function (Lines 28-36)

## 🔍 **How to Verify the Fix**

### **Step 1: Clear existing data**
You'll need to test with a new user since existing personas may have the corrupted system prompt.

### **Step 2: Complete onboarding**
1. Go through the onboarding flow
2. Open browser console (F12)
3. Look for: `=== ONBOARDING COMPLETION DEBUG ===`
4. Verify the system prompt looks correct (no Python syntax)

### **Step 3: Check Chat page**
1. After onboarding completes, you'll be redirected to chat
2. In console, look for: `=== CHAT DEBUG SESSION ===`
3. Verify `System Prompt:` shows the correct prompt

### **Step 4: Send a message**
1. Send a message in the chat
2. In console, look for: `=== EDGE FUNCTION DEBUG SESSION ===`
3. Verify `FULL SYSTEM PROMPT:` matches what was saved

## 📊 **Console Log Flow**

```
1. ONBOARDING (Index.tsx)
   └─> "=== ONBOARDING COMPLETION DEBUG ==="
       └─> Shows generated system prompt
       └─> Shows form data

2. CHAT PAGE LOAD (Chat.tsx)
   └─> "=== CHAT DEBUG SESSION ==="
       └─> Shows system prompt from Supabase
       └─> Shows conversation history

3. MESSAGE SENT (Edge Function)
   └─> "=== EDGE FUNCTION DEBUG SESSION ==="
       └─> Shows system prompt received
       └─> Shows all messages
```

## 🎯 **Expected Behavior After Fix**

1. ✅ System prompt should be properly formatted without Python syntax
2. ✅ System prompt should be saved correctly to Supabase
3. ✅ Console logs should show consistent system prompt across all stages
4. ✅ AI should receive proper JSON format instructions
5. ✅ No runtime errors related to template string evaluation

## 🔄 **Next Steps**

1. Test with a new user account (or clear existing persona from database)
2. Monitor console logs throughout the flow
3. Verify the AI responses follow the correct JSON format
4. Check Supabase database directly to confirm system_prompt column has valid data
